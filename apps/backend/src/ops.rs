//! Platform services mounted next to the Riot-backed routes: app updates, remote config,
//! crash reports, `/metrics`, and the hardening layers every route goes through (request ids
//! and access logs, per-client rate limit on `/v1/*`, body limits, a whole-request timeout).

use std::fmt;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::from_fn_with_state;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tower_http::cors::CorsLayer;

use crate::cache::CacheStats;
use crate::config::{CONFIG_FILE, ConfigFile};
use crate::limits::{RateLimit, TokenBuckets};
use crate::reports::{REPORTS_DIR, RETENTION_DAYS, Reports};
use crate::store::SNAPSHOT_FILE;
use crate::telemetry::Metrics;
use crate::updates::{RELEASES_FILE, Releases};
use crate::watched::Watched;
use crate::{AppState, config, limits, reports, store, telemetry, updates};

/// Largest request body outside `/v1/reports` (a scouting batch is well under 2 KB).
pub const MAX_BODY: usize = 16 * 1024;

/// Configuration of the platform services (environment variables in `from_env`).
#[derive(Clone)]
pub struct OpsSettings {
    /// `DATA_DIR`: `releases.json`, `config.json`, `reports/`, `cache/`.
    pub data_dir: PathBuf,
    /// `ADMIN_BIND`: serve `/metrics` without a token on this (private) address.
    pub admin_bind: Option<SocketAddr>,
    /// `METRICS_TOKEN`: serve `/metrics` on the public address to `Authorization: Bearer …`.
    pub metrics_token: Option<String>,
    /// `TRUST_PROXY=1`: take the client IP from the last `X-Forwarded-For` hop.
    pub trust_proxy: bool,
    /// `RATE_LIMIT_BURST` / `RATE_LIMIT_PER_MINUTE`: per install id (or IP) on `/v1/*`.
    pub rate_burst: u32,
    pub rate_per_minute: u32,
    /// `REQUEST_TIMEOUT_SECS`.
    pub request_timeout: Duration,
    /// `CACHE_SNAPSHOT=0` disables saving/loading the Riot caches to `cache/`.
    pub cache_snapshot: bool,
    /// How often, at most, a request looks at whether `releases.json`/`config.json` changed.
    pub reload_check: Duration,
}

impl fmt::Debug for OpsSettings {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OpsSettings")
            .field("data_dir", &self.data_dir)
            .field("admin_bind", &self.admin_bind)
            .field(
                "metrics_token",
                &self.metrics_token.as_ref().map(|_| "<redacted>"),
            )
            .field("trust_proxy", &self.trust_proxy)
            .field("rate_burst", &self.rate_burst)
            .field("rate_per_minute", &self.rate_per_minute)
            .field("request_timeout", &self.request_timeout)
            .field("cache_snapshot", &self.cache_snapshot)
            .field("reload_check", &self.reload_check)
            .finish()
    }
}

impl Default for OpsSettings {
    fn default() -> Self {
        Self {
            data_dir: PathBuf::from(".cache/backend"),
            admin_bind: None,
            metrics_token: None,
            trust_proxy: false,
            rate_burst: 60,
            rate_per_minute: 120,
            request_timeout: Duration::from_secs(45),
            cache_snapshot: true,
            reload_check: Duration::from_secs(2),
        }
    }
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn env_parse<T: std::str::FromStr>(name: &str, default: T) -> Result<T, String> {
    env(name).map_or(Ok(default), |v| {
        v.trim()
            .parse()
            .map_err(|_| format!("{name}={v:?} is not valid"))
    })
}

fn flag(name: &str, default: bool) -> bool {
    env(name).map_or(default, |v| {
        matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

impl OpsSettings {
    pub fn from_env() -> Result<Self, String> {
        let d = Self::default();
        let metrics_token = env("METRICS_TOKEN");
        if metrics_token.as_ref().is_some_and(|t| t.len() < 16) {
            return Err("METRICS_TOKEN must be at least 16 characters".into());
        }
        Ok(Self {
            data_dir: env("DATA_DIR").map_or(d.data_dir, PathBuf::from),
            admin_bind: env("ADMIN_BIND")
                .map(|b| b.parse().map_err(|e| format!("ADMIN_BIND={b:?}: {e}")))
                .transpose()?,
            metrics_token,
            trust_proxy: flag("TRUST_PROXY", d.trust_proxy),
            rate_burst: env_parse("RATE_LIMIT_BURST", d.rate_burst)?,
            rate_per_minute: env_parse("RATE_LIMIT_PER_MINUTE", d.rate_per_minute)?,
            request_timeout: Duration::from_secs(env_parse(
                "REQUEST_TIMEOUT_SECS",
                d.request_timeout.as_secs(),
            )?),
            cache_snapshot: flag("CACHE_SNAPSHOT", d.cache_snapshot),
            reload_check: d.reload_check,
        })
    }
}

/// The loaded platform services.
#[derive(Debug)]
pub struct Ops {
    settings: OpsSettings,
    releases: Arc<Watched<Releases>>,
    config: Arc<Watched<ConfigFile>>,
    reports: Arc<Reports>,
    metrics: Arc<Metrics>,
    limiter: Arc<TokenBuckets>,
}

impl Ops {
    /// Loads `releases.json` and `config.json` (missing: defaults; invalid: error).
    pub fn new(settings: OpsSettings) -> Result<Self, String> {
        let dir = &settings.data_dir;
        let releases = Watched::load(
            dir.join(RELEASES_FILE),
            Releases::parse,
            settings.reload_check,
        )?;
        let config = Watched::load(
            dir.join(CONFIG_FILE),
            ConfigFile::parse,
            settings.reload_check,
        )?;
        let metrics = Arc::new(Metrics::default());
        Ok(Self {
            reports: Arc::new(Reports::new(dir.join(REPORTS_DIR), Arc::clone(&metrics))),
            limiter: Arc::new(TokenBuckets::new(
                settings.rate_burst,
                f64::from(settings.rate_per_minute) / 60.0,
            )),
            releases: Arc::new(releases),
            config: Arc::new(config),
            metrics,
            settings,
        })
    }

    pub fn settings(&self) -> &OpsSettings {
        &self.settings
    }

    /// Adds the platform routes to `app` and puts every route behind the hardening layers.
    pub fn wrap(&self, app: Router, state: &AppState, cors: CorsLayer) -> Router {
        let mut routes = Router::new()
            .route(
                "/v1/updates/{target}/{arch}/{current_version}",
                get(updates::check).with_state(Arc::clone(&self.releases)),
            )
            .route(
                "/v1/config",
                get(config::get_config).with_state(Arc::clone(&self.config)),
            )
            .route(
                "/v1/reports",
                post(reports::submit)
                    .with_state(Arc::clone(&self.reports))
                    .layer(DefaultBodyLimit::max(reports::MAX_BODY)),
            );
        if let Some(token) = &self.settings.metrics_token {
            let guarded = MetricsState {
                state: state.clone(),
                metrics: Arc::clone(&self.metrics),
                token: Some(Arc::from(token.as_str())),
            };
            routes = routes.route("/metrics", get(metrics).with_state(guarded));
        }
        let rate_limit = RateLimit {
            buckets: Arc::clone(&self.limiter),
            trust_proxy: self.settings.trust_proxy,
            metrics: Arc::clone(&self.metrics),
        };
        app.merge(routes.layer(cors))
            .layer(DefaultBodyLimit::max(MAX_BODY))
            .layer(from_fn_with_state(
                self.settings.request_timeout,
                limits::timeout,
            ))
            .layer(from_fn_with_state(rate_limit, limits::rate_limit))
            .layer(from_fn_with_state(
                Arc::clone(&self.metrics),
                telemetry::observe,
            ))
    }

    /// `/metrics` without a token, for `ADMIN_BIND` (a private address).
    pub fn admin_router(&self, state: &AppState) -> Router {
        Router::new().route(
            "/metrics",
            get(metrics).with_state(MetricsState {
                state: state.clone(),
                metrics: Arc::clone(&self.metrics),
                token: None,
            }),
        )
    }

    pub fn snapshot_path(&self) -> Option<PathBuf> {
        self.settings
            .cache_snapshot
            .then(|| self.settings.data_dir.join(SNAPSHOT_FILE))
    }

    pub fn reports_dir(&self) -> &Path {
        self.reports.dir()
    }

    /// Deletes reports past the retention (run at startup and daily).
    pub fn prune_reports(&self) {
        let today = time::OffsetDateTime::now_utc().date();
        match reports::prune(self.reports.dir(), today, RETENTION_DAYS) {
            Ok(0) => {}
            Ok(n) => tracing::info!(files = n, "pruned old crash reports"),
            Err(e) => tracing::error!(error = %e, "cannot prune crash reports"),
        }
    }
}

// ---- Cache snapshot and metrics on AppState (its fields are private to the crate root) ----

impl AppState {
    /// Saves the Riot caches (no-op without a Riot key). Returns the entries written.
    pub fn save_riot_cache(&self, path: &Path) -> std::io::Result<usize> {
        self.0
            .riot
            .as_ref()
            .map_or(Ok(0), |riot| store::save(riot, path))
    }

    /// Restores the Riot caches saved by `save_riot_cache`.
    pub fn load_riot_cache(&self, path: &Path) -> std::io::Result<usize> {
        self.0
            .riot
            .as_ref()
            .map_or(Ok(0), |riot| store::load(riot, path))
    }

    fn cache_stats(&self) -> Vec<(&'static str, CacheStats)> {
        let mut stats = vec![
            ("profiles", self.0.profiles.stats()),
            ("scoutCards", self.0.cards.stats()),
            ("liveGames", self.0.live.stats()),
        ];
        if let Some(riot) = &self.0.riot {
            let (by_riot_id, by_puuid, matches) = riot.caches();
            stats.push(("accountsByRiotId", by_riot_id.stats()));
            stats.push(("accountsByPuuid", by_puuid.stats()));
            stats.push(("matches", matches.stats()));
        }
        stats
    }

    fn render_metrics(&self, out: &mut String) {
        use std::fmt::Write as _;
        if let Some(riot) = &self.0.riot {
            let c = riot.client().call_counts();
            out.push_str("# HELP mvp_riot_calls_total HTTP calls to the Riot API by result.\n");
            out.push_str("# TYPE mvp_riot_calls_total counter\n");
            for (result, n) in [
                ("ok", c.ok),
                ("notFound", c.not_found),
                ("rateLimited", c.rate_limited),
                ("failed", c.failed),
            ] {
                let _ = writeln!(out, "mvp_riot_calls_total{{result=\"{result}\"}} {n}");
            }
        }
        let stats = self.cache_stats();
        out.push_str("# HELP mvp_cache_hits_total Lookups served from a cache.\n");
        out.push_str("# TYPE mvp_cache_hits_total counter\n");
        for (name, s) in &stats {
            let _ = writeln!(out, "mvp_cache_hits_total{{cache=\"{name}\"}} {}", s.hits);
        }
        out.push_str("# HELP mvp_cache_misses_total Lookups that went upstream.\n");
        out.push_str("# TYPE mvp_cache_misses_total counter\n");
        for (name, s) in &stats {
            let _ = writeln!(
                out,
                "mvp_cache_misses_total{{cache=\"{name}\"}} {}",
                s.misses
            );
        }
        out.push_str("# HELP mvp_cache_entries Entries held by a cache.\n");
        out.push_str("# TYPE mvp_cache_entries gauge\n");
        for (name, s) in &stats {
            let _ = writeln!(out, "mvp_cache_entries{{cache=\"{name}\"}} {}", s.len);
        }
    }
}

#[derive(Clone)]
struct MetricsState {
    state: AppState,
    metrics: Arc<Metrics>,
    token: Option<Arc<str>>,
}

impl fmt::Debug for MetricsState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MetricsState")
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .finish_non_exhaustive()
    }
}

/// Constant-time comparison (the token must not leak through response timing).
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn metrics(State(m): State<MetricsState>, headers: HeaderMap) -> Response {
    if let Some(token) = &m.token {
        let given = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or_default();
        if !same(given.as_bytes(), token.as_bytes()) {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, "Bearer")],
            )
                .into_response();
        }
    }
    let mut out = String::with_capacity(4096);
    out.push_str("# HELP mvp_build_info The running build.\n# TYPE mvp_build_info gauge\n");
    out.push_str(concat!(
        "mvp_build_info{version=\"",
        env!("CARGO_PKG_VERSION"),
        "\"} 1\n"
    ));
    m.metrics.render(&mut out);
    m.state.render_metrics(&mut out);
    (
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        out,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_comparison() {
        assert!(same(b"abcdefghijklmnop", b"abcdefghijklmnop"));
        assert!(!same(b"abcdefghijklmnop", b"abcdefghijklmnoq"));
        assert!(!same(b"abc", b"abcd"));
    }

    #[test]
    fn debug_redacts_the_token() {
        let s = OpsSettings {
            metrics_token: Some("super-secret-token-123".into()),
            ..OpsSettings::default()
        };
        let debug = format!("{s:?}");
        assert!(!debug.contains("super-secret"), "{debug}");
        assert!(debug.contains("<redacted>"));
    }
}
