use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use reqwest::StatusCode;
use reqwest::header::HeaderMap;
use serde::de::DeserializeOwned;

use crate::limits::{Limit, RateLimiter, parse_limits};
use crate::routing::Route;

/// The API key. Server-side only; never logged.
#[derive(Clone)]
pub struct ApiKey(String);

impl ApiKey {
    pub fn new(key: impl Into<String>) -> Self {
        Self(key.into())
    }

    /// Reads `RIOT_API_KEY`.
    pub fn from_env() -> Option<Self> {
        std::env::var("RIOT_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
            .map(Self)
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey(<redacted>)")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RiotError {
    #[error("not found")]
    NotFound,
    /// A 404 Riot calls "filtered": the data exists but isn't shared with apps (Spectator-V5
    /// for live Ranked Flex and Arena games, 2026).
    #[error("filtered by Riot")]
    Filtered,
    /// Invalid/expired key, blocked endpoint (e.g. Brawl) or blacklisting.
    #[error("forbidden (HTTP {0}): check the API key")]
    Forbidden(u16),
    /// Riot keeps answering 429, or asks us to wait longer than `Config::max_retry_wait`.
    #[error("rate limited by Riot, retry after {retry_after_secs} s")]
    RateLimited { retry_after_secs: u64 },
    #[error("Riot API unavailable after retries (HTTP {0})")]
    Unavailable(u16),
    #[error("transport: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("unexpected response from {path}: {source}")]
    Decode {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("TLS setup: {0}")]
    Tls(#[from] rustls::Error),
}

/// Client configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// `https://{route}.api.riotgames.com`; tests point this at a local server.
    pub base_url: fn(Route) -> String,
    /// Sends every route to this base instead (a local fake in tests, or a proxy).
    pub fixed_base_url: Option<String>,
    /// App limits assumed until Riot's headers announce the real ones.
    pub default_app_limits: Vec<Limit>,
    /// Percentage of each limit we allow ourselves (live lookups and crawling share one key).
    pub headroom_percent: u32,
    pub max_retries: u32,
    /// Longest `Retry-After` we sleep through; beyond it the call fails with `RateLimited`.
    /// Crawlers can wait; live lookups (a player waiting on a screen) should not.
    pub max_retry_wait: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            base_url: |route| format!("https://{}.api.riotgames.com", route.id()),
            default_app_limits: parse_limits("20:1,100:120"),
            headroom_percent: 90,
            max_retries: 3,
            fixed_base_url: None,
            max_retry_wait: Duration::from_secs(120),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RiotClient {
    http: reqwest::Client,
    key: ApiKey,
    limiter: Arc<RateLimiter>,
    config: Config,
    calls: Arc<Counters>,
}

/// HTTP calls made to Riot since the client was created (clones share them), for metrics.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CallCounts {
    /// 2xx answers.
    pub ok: u64,
    pub not_found: u64,
    pub rate_limited: u64,
    /// Any other status, or no answer (transport error).
    pub failed: u64,
}

#[derive(Debug, Default)]
struct Counters {
    ok: AtomicU64,
    not_found: AtomicU64,
    rate_limited: AtomicU64,
    failed: AtomicU64,
}

impl RiotClient {
    pub fn new(key: ApiKey, config: Config) -> Result<Self, RiotError> {
        use rustls_platform_verifier::BuilderVerifierExt as _;
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()?
            .with_platform_verifier()?
            .with_no_client_auth();
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(tls)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()?;
        Ok(Self {
            http,
            key,
            limiter: Arc::new(RateLimiter::new(
                config.default_app_limits.clone(),
                config.headroom_percent,
            )),
            config,
            calls: Arc::default(),
        })
    }

    /// Calls made so far (every attempt counts, retries included).
    pub fn call_counts(&self) -> CallCounts {
        let c = &self.calls;
        CallCounts {
            ok: c.ok.load(Ordering::Relaxed),
            not_found: c.not_found.load(Ordering::Relaxed),
            rate_limited: c.rate_limited.load(Ordering::Relaxed),
            failed: c.failed.load(Ordering::Relaxed),
        }
    }

    fn count(&self, status: Option<StatusCode>) {
        let counter = match status {
            Some(s) if s.is_success() => &self.calls.ok,
            Some(StatusCode::NOT_FOUND) => &self.calls.not_found,
            Some(StatusCode::TOO_MANY_REQUESTS) => &self.calls.rate_limited,
            _ => &self.calls.failed,
        };
        counter.fetch_add(1, Ordering::Relaxed);
    }

    /// GET `path` on `route`, rate limited under `method` (the endpoint's limit scope).
    pub async fn get<T: DeserializeOwned>(
        &self,
        route: Route,
        method: &'static str,
        path: &str,
    ) -> Result<T, RiotError> {
        let base = self
            .config
            .fixed_base_url
            .clone()
            .unwrap_or_else(|| (self.config.base_url)(route));
        let url = format!("{base}{path}");
        let mut attempt = 0;
        loop {
            self.limiter.acquire(route.id(), method).await;
            let res = match self
                .http
                .get(&url)
                .header("X-Riot-Token", &self.key.0)
                .send()
                .await
            {
                Ok(res) => res,
                Err(e) => {
                    self.count(None);
                    return Err(e.into());
                }
            };
            let status = res.status();
            self.count(Some(status));
            let headers = res.headers().clone();
            self.limiter.update(
                route.id(),
                method,
                header(&headers, "x-app-rate-limit"),
                header(&headers, "x-method-rate-limit"),
            );
            match status {
                s if s.is_success() => {
                    let bytes = res.bytes().await?;
                    return serde_json::from_slice(&bytes).map_err(|source| RiotError::Decode {
                        path: path.to_owned(),
                        source,
                    });
                }
                StatusCode::NOT_FOUND => {
                    let body = res.bytes().await.unwrap_or_default();
                    return Err(if filtered(&body) {
                        RiotError::Filtered
                    } else {
                        RiotError::NotFound
                    });
                }
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                    return Err(RiotError::Forbidden(status.as_u16()));
                }
                StatusCode::TOO_MANY_REQUESTS => {
                    let retry_after = header(&headers, "retry-after")
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(1);
                    // Typed 429s name the scope; untyped ones come from the service itself.
                    let scope = match header(&headers, "x-rate-limit-type") {
                        Some("method") => Some(method),
                        _ => None,
                    };
                    tracing::warn!(route = %route, method, retry_after, "rate limited by Riot");
                    self.limiter
                        .block(route.id(), scope, Duration::from_secs(retry_after));
                    if attempt >= self.config.max_retries
                        || Duration::from_secs(retry_after) > self.config.max_retry_wait
                    {
                        return Err(RiotError::RateLimited {
                            retry_after_secs: retry_after,
                        });
                    }
                }
                s if s.is_server_error() => {
                    tokio::time::sleep(Duration::from_millis(500 * 2u64.pow(attempt))).await;
                }
                s => return Err(RiotError::Unavailable(s.as_u16())),
            }
            attempt += 1;
            if attempt > self.config.max_retries {
                return Err(RiotError::Unavailable(status.as_u16()));
            }
        }
    }
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// Whether a 404's body is Riot's "filtered" (`{"status":{"message":"Data not found -
/// filtered",…}}`) rather than a plain "not found".
fn filtered(body: &[u8]) -> bool {
    let message = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/status/message")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| String::from_utf8_lossy(body).into_owned());
    message.to_ascii_lowercase().contains("filtered")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_filtered_from_not_found() {
        assert!(filtered(
            br#"{"status":{"message":"Data not found - filtered","status_code":404}}"#
        ));
        assert!(filtered(b"Filtered"));
        assert!(!filtered(
            br#"{"status":{"message":"Data not found - spectator game info isn't found","status_code":404}}"#
        ));
        assert!(!filtered(b""));
    }
}
