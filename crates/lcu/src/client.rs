use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use reqwest::{Method, StatusCode};
use rustls::ClientConfig;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::sync::watch;

use crate::Credentials;

#[derive(Debug, thiserror::Error)]
pub enum LcuError {
    #[error("client not reachable: {0}")]
    Transport(#[source] reqwest::Error),
    #[error("{method} {path} → HTTP {status}: {message}")]
    Http {
        method: Method,
        path: String,
        status: StatusCode,
        message: String,
    },
    #[error("unexpected response for {path}: {source}")]
    Decode {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("invalid credentials header")]
    Header,
}

impl LcuError {
    /// The client answered 404: the resource doesn't exist right now (e.g. no champ select).
    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::Http { status, .. } if *status == StatusCode::NOT_FOUND)
    }

    /// The client didn't answer at all: the request couldn't be sent, or no answer came in time
    /// (an HTTP error is an answer).
    pub fn is_unanswered(&self) -> bool {
        matches!(self, Self::Transport(_))
    }
}

/// REST access to a running League client. Clones share one connection pool, and whether the
/// client answers ([`Self::answering`]).
#[derive(Debug, Clone)]
pub struct LcuClient {
    http: reqwest::Client,
    base: String,
    /// Whether the last request got an answer (any HTTP status): a transport failure turns it
    /// off, the next answer back on.
    answering: Arc<watch::Sender<bool>>,
}

impl LcuClient {
    pub fn new(credentials: &Credentials, tls: Arc<ClientConfig>) -> Result<Self, LcuError> {
        let mut headers = HeaderMap::new();
        let mut auth =
            HeaderValue::from_str(&credentials.authorization()).map_err(|_| LcuError::Header)?;
        auth.set_sensitive(true);
        headers.insert(AUTHORIZATION, auth);
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(Arc::unwrap_or_clone(tls))
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(8))
            .no_proxy()
            .build()
            .map_err(LcuError::Transport)?;
        Ok(Self {
            http,
            base: credentials.base_url(),
            answering: Arc::new(watch::Sender::new(true)),
        })
    }

    /// Whether the client answers requests: follows every request's outcome (a transport
    /// failure turns it off, any answer back on).
    pub fn answering(&self) -> watch::Receiver<bool> {
        self.answering.subscribe()
    }

    /// Whether the last request got an answer.
    pub fn is_answering(&self) -> bool {
        *self.answering.borrow()
    }

    fn answered(&self, answered: bool) {
        self.answering.send_if_modified(|current| {
            let changed = *current != answered;
            *current = answered;
            changed
        });
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, LcuError> {
        let value = self.request(Method::GET, path, None).await?;
        serde_json::from_value(value).map_err(|source| LcuError::Decode {
            path: path.to_owned(),
            source,
        })
    }

    /// `POST path` with an optional JSON body; `Value::Null` for empty answers (204).
    pub async fn post(&self, path: &str, body: Option<&Value>) -> Result<Value, LcuError> {
        self.request(Method::POST, path, body).await
    }

    /// Sends a request; `Value::Null` for empty bodies (204).
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, LcuError> {
        let mut req = self
            .http
            .request(method.clone(), format!("{}{path}", self.base));
        if let Some(body) = body {
            req = req.json(body);
        }
        let answer = async {
            let res = req.send().await?;
            let status = res.status();
            Ok::<_, reqwest::Error>((status, res.bytes().await?))
        };
        let (status, bytes) = match answer.await {
            Ok(answer) => {
                self.answered(true);
                answer
            }
            Err(error) => {
                self.answered(false);
                return Err(LcuError::Transport(error));
            }
        };
        if !status.is_success() {
            let message = serde_json::from_slice::<Value>(&bytes)
                .ok()
                .and_then(|v| v.get("message").and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_else(|| String::from_utf8_lossy(&bytes).chars().take(200).collect());
            return Err(LcuError::Http {
                method,
                path: path.to_owned(),
                status,
                message,
            });
        }
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&bytes).map_err(|source| LcuError::Decode {
            path: path.to_owned(),
            source,
        })
    }
}
