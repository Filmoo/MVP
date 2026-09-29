//! Rate limits per client address, in fixed windows: sign-in attempts, and requests with a
//! machine token that doesn't exist (the tokens can't be guessed; this keeps the noise down).

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Mutex, PoisonError};

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::HeaderMap;
use axum::http::request::Parts;

use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Bucket {
    /// `/auth/login` and `/auth/callback`: 10 per 10 minutes.
    SignIn,
    /// Unknown or revoked machine tokens: 20 per 10 minutes.
    BadToken,
}

impl Bucket {
    fn rule(self) -> (u32, i64) {
        match self {
            Self::SignIn => (10, 600),
            Self::BadToken => (20, 600),
        }
    }
}

#[derive(Debug, Default)]
pub struct Limiter {
    windows: Mutex<HashMap<(Bucket, IpAddr), (i64, u32)>>,
}

impl Limiter {
    /// Counts one attempt; `Err(seconds to wait)` once the window is full.
    pub fn hit(&self, bucket: Bucket, ip: IpAddr, now: i64) -> Result<(), i64> {
        let (max, window) = bucket.rule();
        let mut windows = self.windows.lock().unwrap_or_else(PoisonError::into_inner);
        if windows.len() > 10_000 {
            windows.retain(|_, (start, _)| now - *start < window);
        }
        let entry = windows.entry((bucket, ip)).or_insert((now, 0));
        if now - entry.0 >= window {
            *entry = (now, 0);
        }
        if entry.1 >= max {
            return Err(window - (now - entry.0));
        }
        entry.1 += 1;
        Ok(())
    }

    /// Whether the window is full, without counting (`Some(seconds to wait)`).
    pub fn blocked(&self, bucket: Bucket, ip: IpAddr, now: i64) -> Option<i64> {
        let (max, window) = bucket.rule();
        let windows = self.windows.lock().unwrap_or_else(PoisonError::into_inner);
        windows
            .get(&(bucket, ip))
            .filter(|(start, count)| now - start < window && *count >= max)
            .map(|(start, _)| window - (now - start))
    }
}

/// The caller's address: Caddy's `X-Forwarded-For` when the service sits behind it
/// (`ROADMAP_TRUST_PROXY=1`), else the connection's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientIp(pub IpAddr);

pub fn client_ip(headers: &HeaderMap, connection: Option<SocketAddr>, trust_proxy: bool) -> IpAddr {
    if trust_proxy
        && let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse().ok())
    {
        return ip;
    }
    connection.map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), |addr| addr.ip())
}

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let connection = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|info| info.0);
        Ok(Self(client_ip(
            &parts.headers,
            connection,
            state.settings().trust_proxy,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_fill_and_reopen() {
        let limiter = Limiter::default();
        let ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7));
        for _ in 0..10 {
            assert_eq!(limiter.hit(Bucket::SignIn, ip, 1_000), Ok(()));
        }
        assert_eq!(limiter.hit(Bucket::SignIn, ip, 1_100), Err(500));
        assert_eq!(limiter.blocked(Bucket::SignIn, ip, 1_100), Some(500));
        // Another address and another bucket are counted apart.
        assert_eq!(
            limiter.hit(Bucket::SignIn, IpAddr::V4(Ipv4Addr::LOCALHOST), 1_100),
            Ok(())
        );
        assert_eq!(limiter.hit(Bucket::BadToken, ip, 1_100), Ok(()));
        assert_eq!(limiter.hit(Bucket::SignIn, ip, 1_600), Ok(()));
        assert_eq!(limiter.blocked(Bucket::SignIn, ip, 1_600), None);
    }

    #[test]
    fn forwarded_addresses_count_only_behind_the_proxy() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "198.51.100.4, 10.0.0.1"
                .parse()
                .unwrap_or_else(|_| unreachable!()),
        );
        let local = Some(SocketAddr::from(([127, 0, 0, 1], 5000)));
        assert_eq!(client_ip(&headers, local, true).to_string(), "198.51.100.4");
        assert_eq!(client_ip(&headers, local, false).to_string(), "127.0.0.1");
        assert_eq!(
            client_ip(&HeaderMap::new(), None, true).to_string(),
            "0.0.0.0"
        );
    }
}
