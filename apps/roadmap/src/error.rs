//! API failures: `{ "error": code, "message": words, "retryAfter"? }` with the right status.
//! The UI shows `message` as it is.

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRequest, Request};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::store::StoreError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub retry_after: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Body<'a> {
    error: &'a str,
    message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after: Option<i64>,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            retry_after: None,
        }
    }

    pub fn signed_out(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "signedOut", message)
    }

    pub fn forbidden(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, code, message)
    }

    pub fn rate_limited(retry_after: i64) -> Self {
        Self {
            retry_after: Some(retry_after.max(1)),
            ..Self::new(
                StatusCode::TOO_MANY_REQUESTS,
                "rateLimited",
                "Too many attempts: wait a little and try again.",
            )
        }
    }

    pub fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "Something broke on the server; the log says what.",
        )
    }
}

impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::NotFound(what) => Self::new(
                StatusCode::NOT_FOUND,
                "notFound",
                format!("That {what} doesn't exist."),
            ),
            StoreError::Invalid(message) => Self::new(StatusCode::BAD_REQUEST, "invalid", message),
            StoreError::Denied(message) => Self::forbidden("notAllowed", message),
            StoreError::Conflict(message) => Self::new(StatusCode::CONFLICT, "conflict", message),
            StoreError::Db(e) => {
                tracing::error!(error = %e, "database");
                Self::internal()
            }
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Body {
            error: self.code,
            message: &self.message,
            retry_after: self.retry_after,
        };
        let mut response = (self.status, Json(body)).into_response();
        if let Some(seconds) = self.retry_after
            && let Ok(value) = HeaderValue::from_str(&seconds.to_string())
        {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        response
    }
}

/// A JSON body whose mistakes (bad JSON, unknown or missing fields) answer an `ApiError`.
#[derive(Debug, Clone)]
pub struct Payload<T>(pub T);

impl<S, T> FromRequest<S> for Payload<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(request, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(rejection) => Err(Self::reject(&rejection)),
        }
    }
}

impl<T> Payload<T> {
    fn reject(rejection: &JsonRejection) -> ApiError {
        ApiError::new(StatusCode::BAD_REQUEST, "invalid", rejection.body_text())
    }
}
