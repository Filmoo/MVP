use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `GET /health` of the backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Health {
    pub ok: bool,
    pub version: String,
    /// Whether the server has a Riot API key (Riot-backed routes answer 503 without one).
    pub riot_key: bool,
}

/// Every non-2xx answer of the backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApiError {
    pub error: ApiErrorCode,
    /// Human-readable detail (English, for logs; the UI words errors from `error`).
    pub message: String,
    /// Seconds to wait before retrying (with `rateLimited`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub retry_after: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ApiErrorCode {
    /// Malformed request (e.g. too many PUUIDs).
    BadRequest,
    /// Unknown platform id.
    BadPlatform,
    NotFound,
    /// Riot's rate limit is reached: retry after `retryAfter` seconds.
    RateLimited,
    /// The server has no Riot API key configured.
    RiotKeyMissing,
    /// Riot failed or refused (key rejected, outage, timeout).
    Upstream,
    /// Riot doesn't share this with apps: Spectator-V5 answers "filtered" for live games of some
    /// queues (Ranked Flex and Arena in 2026). Answered with 404.
    Filtered,
}

/// Why a backend call made by the app failed, as the UI words it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum BackendError {
    /// No such player (or route).
    NotFound,
    /// Riot's rate limit is reached on the server: retry after `retry_after` seconds.
    #[serde(rename_all = "camelCase")]
    RateLimited { retry_after: Option<u32> },
    /// The service answered but can't serve this now (no Riot key, Riot outage, bad request).
    Unavailable { message: String },
    /// The service couldn't be reached (offline, DNS, timeout).
    Network { message: String },
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => f.write_str("not found"),
            Self::RateLimited {
                retry_after: Some(seconds),
            } => write!(f, "rate limited, retry after {seconds} s"),
            Self::RateLimited { retry_after: None } => f.write_str("rate limited"),
            Self::Unavailable { message } => write!(f, "service unavailable: {message}"),
            Self::Network { message } => write!(f, "backend unreachable: {message}"),
        }
    }
}

impl std::error::Error for BackendError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_errors_are_tagged() {
        let json = serde_json::to_string(&BackendError::RateLimited {
            retry_after: Some(12),
        })
        .expect("serializable");
        assert_eq!(json, r#"{"kind":"rateLimited","retryAfter":12}"#);
        let json = serde_json::to_string(&BackendError::NotFound).expect("serializable");
        assert_eq!(json, r#"{"kind":"notFound"}"#);
    }
}
