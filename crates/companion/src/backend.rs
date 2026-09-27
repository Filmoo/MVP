//! Client of our backend (`apps/backend`): player lookups and loading-screen scouting.
//!
//! The Riot API key lives on the server only; the app sends an anonymous install id
//! (`X-MVP-Install`, random, persisted next to the settings) so the server can rate-limit per
//! install. Failures come back as [`BackendError`], which the UI words.
//!
//! Base URL: `MVP_BACKEND_URL` at build time (release builds point at the production server),
//! else [`DEFAULT_BASE_URL`] (a local `pnpm backend`). Debug builds also read `MVP_BACKEND_URL`
//! at run time, to point a dev app at any backend without rebuilding.

use std::collections::hash_map::RandomState;
use std::fmt;
use std::hash::{BuildHasher as _, Hasher as _};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use domain::{
    ApiError, ApiErrorCode, BackendError, PlayerProfile, RiotId, ScoutCard, ScoutRequest,
};
use reqwest::header::{HeaderMap, HeaderValue, RETRY_AFTER};
use reqwest::{StatusCode, Url};
use serde::de::DeserializeOwned;

/// Build-time (all builds) and run-time (debug builds) variable holding the backend's base URL.
pub const BASE_URL_ENV: &str = "MVP_BACKEND_URL";
/// Where a build without `MVP_BACKEND_URL` looks: the backend run locally (`pnpm backend`).
pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8787";
/// Header carrying the install id.
pub const INSTALL_HEADER: &str = "x-mvp-install";
/// File next to `settings.json` holding the install id.
pub const INSTALL_ID_FILE: &str = "install-id";

/// The backend this build talks to (see the module docs).
pub fn base_url() -> String {
    if cfg!(debug_assertions)
        && let Ok(url) = std::env::var(BASE_URL_ENV)
        && !url.trim().is_empty()
    {
        return url.trim().to_owned();
    }
    option_env!("MVP_BACKEND_URL")
        .filter(|url| !url.trim().is_empty())
        .unwrap_or(DEFAULT_BASE_URL)
        .trim()
        .to_owned()
}

/// A random id for this installation: 32 hex digits, from the OS-seeded hasher keys.
fn random_id() -> String {
    let word = || {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos()),
        );
        hasher.finish()
    };
    format!("{:016x}{:016x}", word(), word())
}

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Reads the install id from `dir`, creating (and saving) one on first use. A read-only
/// directory still gets an id, just not a lasting one.
pub fn install_id(dir: &Path) -> String {
    let path = dir.join(INSTALL_ID_FILE);
    if let Ok(saved) = std::fs::read_to_string(&path) {
        let saved = saved.trim();
        if valid_id(saved) {
            return saved.to_owned();
        }
    }
    let id = random_id();
    let saved = std::fs::create_dir_all(dir).and_then(|()| std::fs::write(&path, &id));
    if let Err(error) = saved {
        tracing::warn!(%error, path = %path.display(), "cannot save the install id");
    }
    id
}

#[derive(Debug, thiserror::Error)]
pub enum SetupError {
    #[error("backend URL {0:?} is not an http(s) URL")]
    BadUrl(String),
    #[error("TLS setup: {0}")]
    Tls(#[from] rustls::Error),
    #[error("HTTP client: {0}")]
    Http(#[from] reqwest::Error),
    #[error("install id is not a header value")]
    InstallId,
}

/// Connection settings.
#[derive(Clone)]
pub struct BackendConfig {
    pub base_url: String,
    pub install_id: String,
    pub connect_timeout: Duration,
    /// Whole request, player lookups.
    pub timeout: Duration,
    /// Whole request, scouting batches (the server may take up to 30 s on a cold lobby).
    pub scout_timeout: Duration,
}

impl BackendConfig {
    pub fn new(base_url: impl Into<String>, install_id: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            install_id: install_id.into(),
            connect_timeout: Duration::from_secs(5),
            timeout: Duration::from_secs(20),
            scout_timeout: Duration::from_secs(35),
        }
    }
}

impl fmt::Debug for BackendConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BackendConfig")
            .field("base_url", &self.base_url)
            .field("install_id", &"<redacted>")
            .field("timeout", &self.timeout)
            .finish_non_exhaustive()
    }
}

/// Cheap to clone (shared connection pool).
#[derive(Clone)]
pub struct BackendClient(Arc<Inner>);

struct Inner {
    base: Url,
    http: reqwest::Client,
    timeout: Duration,
    scout_timeout: Duration,
}

impl fmt::Debug for BackendClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BackendClient")
            .field("base", &self.0.base.as_str())
            .finish_non_exhaustive()
    }
}

impl BackendClient {
    pub fn new(config: &BackendConfig) -> Result<Self, SetupError> {
        use rustls_platform_verifier::BuilderVerifierExt as _;

        let base = Url::parse(config.base_url.trim_end_matches('/'))
            .ok()
            .filter(|u| matches!(u.scheme(), "http" | "https") && !u.cannot_be_a_base())
            .ok_or_else(|| SetupError::BadUrl(config.base_url.clone()))?;
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()?
            .with_platform_verifier()?
            .with_no_client_auth();
        let mut headers = HeaderMap::new();
        headers.insert(
            INSTALL_HEADER,
            HeaderValue::from_str(&config.install_id).map_err(|_| SetupError::InstallId)?,
        );
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(tls)
            .default_headers(headers)
            .user_agent(concat!("mvp-desktop/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(config.connect_timeout)
            .build()?;
        Ok(Self(Arc::new(Inner {
            base,
            http,
            timeout: config.timeout,
            scout_timeout: config.scout_timeout,
        })))
    }

    pub fn base_url(&self) -> &str {
        self.0.base.as_str()
    }

    /// `base/segments…`, each segment percent-encoded (Riot IDs have spaces and non-ASCII).
    fn url(&self, segments: &[&str]) -> Url {
        let mut url = self.0.base.clone();
        if let Ok(mut path) = url.path_segments_mut() {
            path.pop_if_empty().extend(segments);
        }
        url
    }

    /// A player's profile (`GET /v1/players/{platform}/{gameName}/{tagLine}`).
    pub async fn player(
        &self,
        platform: &str,
        riot_id: &RiotId,
    ) -> Result<PlayerProfile, BackendError> {
        let url = self.url(&[
            "v1",
            "players",
            platform,
            &riot_id.game_name,
            &riot_id.tag_line,
        ]);
        receive(self.0.http.get(url).timeout(self.0.timeout).send().await).await
    }

    /// Scouting cards for up to 10 players (`POST /v1/players/batch`). Players the server
    /// doesn't know get no card.
    pub async fn scout(
        &self,
        platform: &str,
        puuids: &[String],
    ) -> Result<Vec<ScoutCard>, BackendError> {
        let body = ScoutRequest {
            platform: platform.to_owned(),
            puuids: puuids.to_vec(),
        };
        let url = self.url(&["v1", "players", "batch"]);
        let request = self
            .0
            .http
            .post(url)
            .json(&body)
            .timeout(self.0.scout_timeout);
        receive(request.send().await).await
    }
}

fn network(error: &reqwest::Error) -> BackendError {
    let message = if error.is_timeout() {
        "the request timed out".to_owned()
    } else if error.is_connect() {
        "couldn't connect".to_owned()
    } else {
        error.to_string()
    };
    BackendError::Network { message }
}

async fn receive<T: DeserializeOwned>(
    sent: Result<reqwest::Response, reqwest::Error>,
) -> Result<T, BackendError> {
    let response = sent.map_err(|e| network(&e))?;
    let status = response.status();
    let retry_header = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u32>().ok());
    let bytes = response.bytes().await.map_err(|e| network(&e))?;
    if status.is_success() {
        return serde_json::from_slice(&bytes).map_err(|error| BackendError::Unavailable {
            message: format!("unexpected answer: {error}"),
        });
    }
    let body: Option<ApiError> = serde_json::from_slice(&bytes).ok();
    Err(map_failure(status, body, retry_header))
}

fn map_failure(
    status: StatusCode,
    body: Option<ApiError>,
    retry_header: Option<u32>,
) -> BackendError {
    let code = body.as_ref().map(|b| b.error);
    if code == Some(ApiErrorCode::NotFound) || (code.is_none() && status == StatusCode::NOT_FOUND) {
        return BackendError::NotFound;
    }
    if code == Some(ApiErrorCode::RateLimited) || status == StatusCode::TOO_MANY_REQUESTS {
        return BackendError::RateLimited {
            retry_after: body.and_then(|b| b.retry_after).or(retry_header),
        };
    }
    BackendError::Unavailable {
        message: body.map_or_else(|| format!("HTTP {}", status.as_u16()), |b| b.message),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    #[test]
    fn install_ids_are_random_and_kept() {
        let dir = tempfile::tempdir().unwrap();
        let id = install_id(dir.path());
        assert!(valid_id(&id), "{id}");
        assert_eq!(install_id(dir.path()), id);
        assert_ne!(random_id(), random_id());
        std::fs::write(dir.path().join(INSTALL_ID_FILE), "garbage").unwrap();
        let replaced = install_id(dir.path());
        assert!(valid_id(&replaced) && replaced != id);
    }

    #[test]
    fn rejects_non_http_urls() {
        for url in ["ftp://x", "not a url", "mailto:a@b"] {
            assert!(matches!(
                BackendClient::new(&BackendConfig::new(url, "0".repeat(32))),
                Err(SetupError::BadUrl(_))
            ));
        }
    }

    #[test]
    fn encodes_path_segments() {
        let client = BackendClient::new(&BackendConfig::new(
            "https://api.example.com/base/",
            "a".repeat(32),
        ))
        .unwrap();
        let url = client.url(&["v1", "players", "euw1", "Hide on bush", "KR/1"]);
        assert_eq!(
            url.as_str(),
            "https://api.example.com/base/v1/players/euw1/Hide%20on%20bush/KR%2F1"
        );
    }

    #[test]
    fn maps_failures() {
        let body = |error, retry_after| ApiError {
            error,
            message: "detail".into(),
            retry_after,
        };
        assert_eq!(
            map_failure(StatusCode::NOT_FOUND, None, None),
            BackendError::NotFound
        );
        assert_eq!(
            map_failure(
                StatusCode::TOO_MANY_REQUESTS,
                Some(body(ApiErrorCode::RateLimited, Some(7))),
                Some(3)
            ),
            BackendError::RateLimited {
                retry_after: Some(7)
            }
        );
        assert_eq!(
            map_failure(StatusCode::TOO_MANY_REQUESTS, None, Some(3)),
            BackendError::RateLimited {
                retry_after: Some(3)
            }
        );
        assert_eq!(
            map_failure(
                StatusCode::SERVICE_UNAVAILABLE,
                Some(body(ApiErrorCode::RiotKeyMissing, None)),
                None
            ),
            BackendError::Unavailable {
                message: "detail".into()
            }
        );
        assert_eq!(
            map_failure(StatusCode::BAD_GATEWAY, None, None),
            BackendError::Unavailable {
                message: "HTTP 502".into()
            }
        );
    }
}
