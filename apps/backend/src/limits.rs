//! Abuse limits: per-client token buckets (429 + `Retry-After`), a whole-request timeout and
//! the client key used for both rate limiting and logs.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::Json;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use domain::{ApiError, ApiErrorCode};
use tokio::time::Instant;

use crate::telemetry::Metrics;

/// Header carrying the app's random per-install id.
pub const INSTALL_HEADER: &str = "x-mvp-install";

/// A random per-install id as the app makes it (a UUID): 8–64 of `[A-Za-z0-9-]`.
pub fn valid_install_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Token buckets keyed by client: `capacity` requests at once, refilled at `per_sec`.
/// Memory is bounded: past `max_keys` clients, buckets that are full again are dropped.
#[derive(Debug)]
pub struct TokenBuckets {
    capacity: f64,
    per_sec: f64,
    max_keys: usize,
    buckets: Mutex<HashMap<String, Bucket>>,
}

#[derive(Debug, Clone, Copy)]
struct Bucket {
    tokens: f64,
    at: Instant,
}

impl TokenBuckets {
    /// `capacity` at once, then `per_sec` more each second (e.g. `10.0 / 3600.0`: 10 an hour).
    pub fn new(capacity: u32, per_sec: f64) -> Self {
        Self {
            capacity: f64::from(capacity.max(1)),
            per_sec: per_sec.max(1e-6),
            max_keys: 100_000,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Takes a token for `key`, or says how long until one is available.
    pub fn check(&self, key: &str) -> Result<(), Duration> {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().unwrap_or_else(PoisonError::into_inner);
        if buckets.len() >= self.max_keys && !buckets.contains_key(key) {
            buckets.retain(|_, b| self.refilled(*b, now) < self.capacity);
        }
        let bucket = buckets.entry(key.to_owned()).or_insert(Bucket {
            tokens: self.capacity,
            at: now,
        });
        bucket.tokens = self.refilled(*bucket, now);
        bucket.at = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            Err(Duration::from_secs_f64(
                (1.0 - bucket.tokens) / self.per_sec,
            ))
        }
    }

    fn refilled(&self, b: Bucket, now: Instant) -> f64 {
        let elapsed = now.duration_since(b.at).as_secs_f64();
        (b.tokens + elapsed * self.per_sec).min(self.capacity)
    }
}

/// 429 `rateLimited` with `retryAfter` (whole seconds, at least 1) and a `Retry-After` header.
pub fn too_many(wait: Duration, message: &str) -> Response {
    let secs = u32::try_from(wait.as_secs().saturating_add(1)).unwrap_or(u32::MAX);
    let mut res = (
        StatusCode::TOO_MANY_REQUESTS,
        Json(ApiError {
            error: ApiErrorCode::RateLimited,
            message: message.to_owned(),
            retry_after: Some(secs),
        }),
    )
        .into_response();
    res.headers_mut()
        .insert(header::RETRY_AFTER, HeaderValue::from(secs));
    res
}

/// Who is asking: the install id header when present and well-formed, else the client IP.
/// Behind a reverse proxy (`trust_proxy`), the IP is the last `X-Forwarded-For` hop (the one
/// our proxy appended; earlier hops are client-controlled).
pub fn client_key(headers: &HeaderMap, peer: Option<SocketAddr>, trust_proxy: bool) -> String {
    if let Some(id) = headers
        .get(INSTALL_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|id| valid_install_id(id))
    {
        return format!("install:{id}");
    }
    let forwarded = trust_proxy
        .then(|| headers.get("x-forwarded-for")?.to_str().ok())
        .flatten()
        .and_then(|list| list.rsplit(',').next())
        .and_then(|ip| ip.trim().parse::<IpAddr>().ok());
    match forwarded.or_else(|| peer.map(|p| p.ip())) {
        Some(ip) => format!("ip:{ip}"),
        None => "anonymous".to_owned(),
    }
}

#[derive(Debug, Clone)]
pub struct RateLimit {
    pub buckets: Arc<TokenBuckets>,
    pub trust_proxy: bool,
    pub metrics: Arc<Metrics>,
}

/// Rate limits `/v1/*` (CORS preflights excluded).
pub async fn rate_limit(State(limit): State<RateLimit>, req: Request, next: Next) -> Response {
    if req.method() == Method::OPTIONS || !req.uri().path().starts_with("/v1/") {
        return next.run(req).await;
    }
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);
    let key = client_key(req.headers(), peer, limit.trust_proxy);
    match limit.buckets.check(&key) {
        Ok(()) => next.run(req).await,
        Err(wait) => {
            limit.metrics.rate_limited();
            too_many(wait, "too many requests")
        }
    }
}

/// Answers 504 `upstream` when a request takes longer than the given duration (handlers
/// have their own, shorter, Riot timeouts; this is the safety net).
pub async fn timeout(State(limit): State<Duration>, req: Request, next: Next) -> Response {
    match tokio::time::timeout(limit, next.run(req)).await {
        Ok(res) => res,
        Err(_) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(ApiError {
                error: ApiErrorCode::Upstream,
                message: "the request took too long".to_owned(),
                retry_after: None,
            }),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn buckets_refill_over_time() {
        let buckets = TokenBuckets::new(3, 1.0);
        for _ in 0..3 {
            assert!(buckets.check("a").is_ok());
        }
        let wait = buckets.check("a").expect_err("empty");
        assert!(wait <= Duration::from_secs(1), "{wait:?}");
        assert!(buckets.check("b").is_ok(), "other clients are independent");
        tokio::time::advance(Duration::from_millis(1_100)).await;
        assert!(buckets.check("a").is_ok());
        assert!(buckets.check("a").is_err());
        tokio::time::advance(Duration::from_secs(60)).await;
        for _ in 0..3 {
            assert!(
                buckets.check("a").is_ok(),
                "refilled up to the capacity only"
            );
        }
        assert!(buckets.check("a").is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn memory_stays_bounded() {
        let mut buckets = TokenBuckets::new(2, 1.0);
        buckets.max_keys = 10;
        for i in 0..10 {
            assert!(buckets.check(&format!("k{i}")).is_ok());
        }
        tokio::time::advance(Duration::from_secs(5)).await;
        assert!(buckets.check("new").is_ok());
        let len = buckets.buckets.lock().map(|b| b.len()).unwrap_or_default();
        assert_eq!(len, 1, "full buckets were dropped");
    }

    #[test]
    fn client_key_prefers_the_install_id() {
        let peer = SocketAddr::from(([10, 0, 0, 1], 5000));
        let mut headers = HeaderMap::new();
        assert_eq!(client_key(&headers, Some(peer), false), "ip:10.0.0.1");
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("1.1.1.1, 2.2.2.2"),
        );
        assert_eq!(
            client_key(&headers, Some(peer), false),
            "ip:10.0.0.1",
            "untrusted"
        );
        assert_eq!(
            client_key(&headers, Some(peer), true),
            "ip:2.2.2.2",
            "last hop"
        );
        headers.insert(INSTALL_HEADER, HeaderValue::from_static("bad id!"));
        assert_eq!(client_key(&headers, Some(peer), true), "ip:2.2.2.2");
        headers.insert(
            INSTALL_HEADER,
            HeaderValue::from_static("0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33"),
        );
        assert_eq!(
            client_key(&headers, Some(peer), true),
            "install:0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33"
        );
    }
}
