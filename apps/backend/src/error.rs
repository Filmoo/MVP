//! Every failure answers JSON (`domain::ApiError`) with a fitting status.

use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use domain::{ApiError, ApiErrorCode};
use riot_api::RiotError;

#[derive(Debug)]
pub struct Failure {
    status: StatusCode,
    body: ApiError,
}

impl Failure {
    pub fn new(status: StatusCode, error: ApiErrorCode, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ApiError {
                error,
                message: message.into(),
                retry_after: None,
            },
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, ApiErrorCode::BadRequest, message)
    }

    pub fn bad_platform(platform: &str) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ApiErrorCode::BadPlatform,
            format!("unknown platform {platform:?} (expected e.g. euw1, eun1, na1, kr)"),
        )
    }

    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, ApiErrorCode::NotFound, "not found")
    }

    pub fn key_missing() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            ApiErrorCode::RiotKeyMissing,
            "the server has no Riot API key (set RIOT_API_KEY)",
        )
    }

    pub fn timeout() -> Self {
        Self::new(
            StatusCode::GATEWAY_TIMEOUT,
            ApiErrorCode::Upstream,
            "Riot API took too long",
        )
    }
}

impl From<RiotError> for Failure {
    fn from(e: RiotError) -> Self {
        match e {
            RiotError::NotFound => Self::not_found(),
            RiotError::RateLimited { retry_after_secs } => {
                let mut f = Self::new(
                    StatusCode::TOO_MANY_REQUESTS,
                    ApiErrorCode::RateLimited,
                    "Riot API rate limit reached",
                );
                f.body.retry_after = Some(u32::try_from(retry_after_secs).unwrap_or(u32::MAX));
                f
            }
            other => {
                tracing::error!(error = %other, "Riot API call failed");
                Self::new(
                    StatusCode::BAD_GATEWAY,
                    ApiErrorCode::Upstream,
                    "Riot API error",
                )
            }
        }
    }
}

impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        let retry_after = self.body.retry_after;
        let mut res = (self.status, Json(self.body)).into_response();
        if let Some(secs) = retry_after {
            res.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(secs));
        }
        res
    }
}
