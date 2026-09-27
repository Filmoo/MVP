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
}
