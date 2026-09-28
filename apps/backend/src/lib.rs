//! Backend HTTP service called by the desktop app. The Riot API key lives only here.
//!
//! Routes (JSON, camelCase, types from `crates/domain`):
//! - `GET /health` → `Health`
//! - `GET /v1/players/{platform}/{gameName}/{tagLine}` → `PlayerProfile`
//! - `POST /v1/players/batch` (`ScoutRequest`: Riot IDs, or the older PUUIDs) → `ScoutCard[]`
//!   for loading-screen scouting
//! - `GET /v1/stats/index` → `StatsIndex`; `GET /v1/stats/{patch}/{queue}/{file…}` → the
//!   published stats files (from `STATS_DIR`, written by `mvp-crawler publish`)
//!
//! Failures answer `ApiError`. Riot-backed routes answer 503 `riotKeyMissing` without a key.
//!
//! Platform services (`service()`, see `ops.rs`): `GET /v1/updates/…` (Tauri updater),
//! `GET /v1/config` (`RemoteConfig`), `POST /v1/reports` (`CrashReport`), `/metrics`, and the
//! hardening layers (rate limit, body limits, timeout, request ids).

mod cache;
mod error;
mod source;
mod stats_files;

// ---- Platform services: updates, remote config, reports, hardening ----
pub mod admin;
mod config;
mod limits;
mod ops;
mod reports;
mod scrub;
mod store;
mod telemetry;
mod updates;
mod watched;

pub use config::ConfigFile;
pub use limits::INSTALL_HEADER;
pub use ops::{Ops, OpsSettings};
pub use reports::{StoredReport, forget as forget_reports, prune as prune_reports};
pub use scrub::scrub;
pub use telemetry::init_logging;
pub use updates::{Channel, Releases, bucket as rollout_bucket};

/// The whole service: `app()` plus the platform routes, behind the hardening layers.
pub fn service(state: &AppState, allowed_origins: &[String], ops: &Ops) -> Router {
    ops.wrap(
        app(state.clone(), allowed_origins),
        state,
        cors(allowed_origins),
    )
}
// ---- end platform services ----

use std::net::SocketAddr;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::{HeaderName, HeaderValue, Method, header};
use axum::routing::{get, post};
use axum::{Json, Router};
use domain::{Health, PlayerProfile, RiotId, ScoutCard, ScoutRequest};
use futures_util::future::join_all;
use players::RiotSource as _;
use riot_api::{ApiKey, Config, Platform, RiotClient, RiotError};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub use cache::Cache;
pub use error::Failure;
pub use source::{CachedRiot, compact_match};

/// Origins of the desktop app's webview (Windows/WebView2 and other platforms) and the dev UI.
pub const DEFAULT_ALLOWED_ORIGINS: [&str; 4] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://127.0.0.1:1420",
];
pub const DEFAULT_BIND: &str = "127.0.0.1:8787";
/// Most players a scouting batch may ask for (one lobby side or a whole lobby of 10).
pub const MAX_BATCH: usize = 10;
/// Games in a profile's recent history.
pub const PROFILE_GAMES: u32 = 20;

const PROFILE_TTL: Duration = Duration::from_secs(2 * 60);
const CARD_TTL: Duration = Duration::from_secs(2 * 60);
const PROFILES_MAX: usize = 2_000;
const CARDS_MAX: usize = 10_000;
/// A player waits on a screen: past this, answer 504 rather than hang.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Configuration from the environment.
#[derive(Debug, Clone)]
pub struct Settings {
    pub bind: SocketAddr,
    pub allowed_origins: Vec<String>,
    pub riot_key: Option<ApiKey>,
    /// Root of the published stats files (`STATS_DIR`); stats routes answer 404 without it.
    pub stats_dir: Option<PathBuf>,
}

impl Settings {
    /// `RIOT_API_KEY` (optional: without it Riot-backed routes answer 503),
    /// `BIND` (default `127.0.0.1:8787`), `ALLOWED_ORIGINS` (comma-separated),
    /// `STATS_DIR` (published stats, e.g. `.cache/crawler/stats`).
    pub fn from_env() -> Result<Self, String> {
        let bind = std::env::var("BIND").unwrap_or_else(|_| DEFAULT_BIND.to_owned());
        let bind = bind
            .parse()
            .map_err(|e| format!("BIND={bind:?} is not an address: {e}"))?;
        let allowed_origins = match std::env::var("ALLOWED_ORIGINS") {
            Ok(list) if !list.trim().is_empty() => list
                .split(',')
                .map(|o| o.trim().to_owned())
                .filter(|o| !o.is_empty())
                .collect(),
            _ => DEFAULT_ALLOWED_ORIGINS.map(str::to_owned).to_vec(),
        };
        Ok(Self {
            bind,
            allowed_origins,
            riot_key: ApiKey::from_env(),
            stats_dir: std::env::var_os("STATS_DIR")
                .filter(|d| !d.is_empty())
                .map(PathBuf::from),
        })
    }
}

/// Riot client settings for live lookups: never sleep long on a 429, report it instead.
pub fn live_riot_config() -> Config {
    Config {
        max_retry_wait: Duration::from_secs(5),
        ..Config::default()
    }
}

#[derive(Debug)]
struct Inner {
    riot: Option<CachedRiot>,
    /// Keyed by platform and lower-cased Riot ID.
    profiles: Cache<(Platform, String, String), PlayerProfile>,
    cards: Cache<(Platform, String), ScoutCard>,
    stats_dir: Option<PathBuf>,
}

/// Shared state of the service.
#[derive(Debug, Clone)]
pub struct AppState(Arc<Inner>);

impl AppState {
    /// `riot`: `None` when no API key is configured.
    pub fn new(riot: Option<RiotClient>) -> Self {
        Self::with_stats(riot, None)
    }

    /// Also serves the published stats files under `stats_dir` (see `stats_files`).
    pub fn with_stats(riot: Option<RiotClient>, stats_dir: Option<PathBuf>) -> Self {
        Self(Arc::new(Inner {
            riot: riot.map(CachedRiot::new),
            profiles: Cache::new(Some(PROFILE_TTL), PROFILES_MAX),
            cards: Cache::new(Some(CARD_TTL), CARDS_MAX),
            stats_dir,
        }))
    }

    fn stats_dir(&self) -> Option<&FsPath> {
        self.0.stats_dir.as_deref()
    }

    fn riot(&self) -> Result<&CachedRiot, Failure> {
        self.0.riot.as_ref().ok_or_else(Failure::key_missing)
    }
}

/// CORS for the app's webview origins.
fn cors(allowed_origins: &[String]) -> CorsLayer {
    let origins: Vec<HeaderValue> = allowed_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            header::CONTENT_TYPE,
            header::IF_NONE_MATCH,
            HeaderName::from_static(INSTALL_HEADER),
        ])
        .expose_headers([
            header::ETAG,
            header::RETRY_AFTER,
            HeaderName::from_static(telemetry::REQUEST_ID_HEADER),
        ])
        .max_age(Duration::from_secs(60 * 60))
}

/// The Riot-backed routes with CORS for `allowed_origins` (no platform services; see
/// `service`).
pub fn app(state: AppState, allowed_origins: &[String]) -> Router {
    let cors = cors(allowed_origins);
    Router::new()
        .route("/health", get(health))
        .route(
            "/v1/players/{platform}/{game_name}/{tag_line}",
            get(player_profile),
        )
        .route("/v1/players/batch", post(scout_batch))
        .route("/v1/stats/index", get(stats_files::index))
        .route("/v1/stats/{patch}/{queue}/{*file}", get(stats_files::file))
        .fallback(|| async { Failure::not_found() })
        .layer(cors)
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        ok: true,
        version: env!("CARGO_PKG_VERSION").to_owned(),
        riot_key: state.0.riot.is_some(),
    })
}

fn platform(id: &str) -> Result<Platform, Failure> {
    Platform::from_id(id).ok_or_else(|| Failure::bad_platform(id))
}

async fn with_timeout<T>(fut: impl Future<Output = Result<T, RiotError>>) -> Result<T, Failure> {
    match tokio::time::timeout(REQUEST_TIMEOUT, fut).await {
        Ok(result) => result.map_err(Failure::from),
        Err(_) => Err(Failure::timeout()),
    }
}

async fn player_profile(
    State(state): State<AppState>,
    Path((platform_id, game_name, tag_line)): Path<(String, String, String)>,
) -> Result<Json<PlayerProfile>, Failure> {
    let platform = platform(&platform_id)?;
    let (game_name, tag_line) = (game_name.trim(), tag_line.trim());
    if game_name.is_empty() || tag_line.is_empty() || game_name.len() > 64 || tag_line.len() > 16 {
        return Err(Failure::bad_request("expected a Riot ID: gameName/tagLine"));
    }
    let riot = state.riot()?;
    let riot_id = RiotId {
        game_name: game_name.to_owned(),
        tag_line: tag_line.to_owned(),
    };
    let key = (platform, game_name.to_lowercase(), tag_line.to_lowercase());
    let profile = with_timeout(state.0.profiles.get_or_try_insert(key, || async {
        players::fetch_profile(riot, platform, &riot_id, PROFILE_GAMES)
            .await
            .map_err(|e| match e {
                players::ProfileError::Riot(e) => e,
                // Unreachable: the Riot ID was built from path segments, not parsed.
                players::ProfileError::BadRiotId => RiotError::NotFound,
            })
    }))
    .await?;
    Ok(Json(profile))
}

fn valid_puuid(p: &str) -> bool {
    (1..=128).contains(&p.len())
        && p.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A Riot ID part we can put in a Riot API path: not empty, bounded, printable, not `.`/`..`.
fn valid_riot_id_part(part: &str, max_bytes: usize) -> bool {
    !part.is_empty()
        && part.len() <= max_bytes
        && part != "."
        && part != ".."
        && !part.chars().any(char::is_control)
}

/// One player of a scouting batch.
enum Wanted {
    /// By Riot ID (the app): resolved to our key's PUUID with account-v1.
    RiotId(RiotId),
    /// By PUUID as our key sees it (apps up to 0.1.0).
    Puuid(String),
}

/// The players of a batch, validated and without repeats (Riot IDs compare case-insensitively),
/// Riot IDs first.
fn wanted(request: ScoutRequest) -> Result<Vec<Wanted>, Failure> {
    let mut out = Vec::with_capacity(request.players.len() + request.puuids.len());
    let mut seen: Vec<(String, String)> = Vec::new();
    for id in request.players {
        let (name, tag) = (id.game_name.trim(), id.tag_line.trim());
        if !valid_riot_id_part(name, 64) || !valid_riot_id_part(tag, 16) {
            return Err(Failure::bad_request("malformed Riot ID"));
        }
        let key = (name.to_lowercase(), tag.to_lowercase());
        if !seen.contains(&key) {
            seen.push(key);
            out.push(Wanted::RiotId(RiotId {
                game_name: name.to_owned(),
                tag_line: tag.to_owned(),
            }));
        }
    }
    for p in request.puuids {
        if !valid_puuid(&p) {
            return Err(Failure::bad_request("malformed PUUID"));
        }
        if !out.iter().any(|w| matches!(w, Wanted::Puuid(q) if *q == p)) {
            out.push(Wanted::Puuid(p));
        }
    }
    if out.is_empty() || out.len() > MAX_BATCH {
        return Err(Failure::bad_request(format!(
            "send 1 to {MAX_BATCH} players"
        )));
    }
    Ok(out)
}

/// One player's card; `None` when our key doesn't know them.
async fn scout_one(
    state: &AppState,
    riot: &CachedRiot,
    platform: Platform,
    wanted: &Wanted,
) -> Result<Option<ScoutCard>, RiotError> {
    let card = match wanted {
        Wanted::Puuid(puuid) => {
            state
                .0
                .cards
                .get_or_try_insert((platform, puuid.clone()), || {
                    players::fetch_scout_card(riot, platform, puuid)
                })
                .await
        }
        Wanted::RiotId(id) => match riot
            .account_by_riot_id(platform, &id.game_name, &id.tag_line)
            .await
        {
            Ok(account) => {
                state
                    .0
                    .cards
                    .get_or_try_insert((platform, account.puuid.clone()), || {
                        players::fetch_scout_card_for(riot, platform, account)
                    })
                    .await
            }
            Err(e) => Err(e),
        },
    };
    match card {
        Ok(card) => Ok(Some(card)),
        // Nobody by that Riot ID, or a PUUID our key can't read (another key's, or the League
        // client's: Riot answers 400 when it can't decrypt it). No card, the others still come.
        Err(RiotError::NotFound | RiotError::Unavailable(400)) => Ok(None),
        Err(e) => Err(e),
    }
}

async fn scout_batch(
    State(state): State<AppState>,
    body: Result<Json<ScoutRequest>, JsonRejection>,
) -> Result<Json<Vec<ScoutCard>>, Failure> {
    let Json(request) = body.map_err(|e| Failure::bad_request(e.body_text()))?;
    let platform = platform(&request.platform)?;
    let wanted = wanted(request)?;
    let riot = state.riot()?;
    let cards = with_timeout(async {
        let results = join_all(wanted.iter().map(|w| scout_one(&state, riot, platform, w))).await;
        let mut cards = Vec::with_capacity(results.len());
        for result in results {
            match result {
                Ok(card) => cards.extend(card),
                Err(e) => return Err(e),
            }
        }
        Ok(cards)
    })
    .await?;
    Ok(Json(cards))
}
