//! Rate limiting that follows Riot's own headers.
//!
//! Riot enforces app limits (per key and routing value) and method limits (per endpoint and
//! routing value), both as several windows (`500:10,30000:600` = 500 per 10 s and 30,000 per
//! 10 min). We start from configured limits, adopt whatever the headers announce, and keep a
//! log of recent requests per window so a request only goes out when every window has room.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use tokio::time::Instant;

/// One window: at most `count` requests per `window`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limit {
    pub count: u32,
    pub window: Duration,
}

/// Parses `20:1,100:120` (count:seconds pairs).
pub fn parse_limits(header: &str) -> Vec<Limit> {
    header
        .split(',')
        .filter_map(|part| {
            let (count, secs) = part.trim().split_once(':')?;
            Some(Limit {
                count: count.trim().parse().ok()?,
                window: Duration::from_secs(secs.trim().parse().ok()?),
            })
        })
        .filter(|l| l.count > 0 && !l.window.is_zero())
        .collect()
}

#[derive(Debug, Default)]
struct Scope {
    limits: Vec<Limit>,
    /// Send times, oldest first, kept for the longest window.
    sent: VecDeque<Instant>,
    blocked_until: Option<Instant>,
}

impl Scope {
    /// When the next request may go out (now if there's room everywhere).
    fn next_slot(&self, now: Instant, headroom_percent: u32) -> Instant {
        let mut at = self.blocked_until.filter(|t| *t > now).unwrap_or(now);
        for limit in &self.limits {
            // Keep a safety margin under the announced count.
            let allowed = usize::try_from(
                (u64::from(limit.count) * u64::from(headroom_percent) / 100).max(1),
            )
            .unwrap_or(usize::MAX);
            let in_window: Vec<&Instant> = self
                .sent
                .iter()
                .filter(|t| now.duration_since(**t) < limit.window)
                .collect();
            if in_window.len() >= allowed {
                // The oldest counted request must leave the window first.
                let oldest = in_window[in_window.len() - allowed];
                at = at.max(*oldest + limit.window);
            }
        }
        at
    }

    fn record(&mut self, at: Instant) {
        self.sent.push_back(at);
        let longest = self
            .limits
            .iter()
            .map(|l| l.window)
            .max()
            .unwrap_or_default();
        while self
            .sent
            .front()
            .is_some_and(|t| at.duration_since(*t) >= longest)
        {
            self.sent.pop_front();
        }
    }
}

/// Limits for every (routing value, scope) pair. Scope `""` is the app scope.
#[derive(Debug)]
pub struct RateLimiter {
    scopes: Mutex<HashMap<(String, String), Scope>>,
    default_app: Vec<Limit>,
    headroom_percent: u32,
}

impl RateLimiter {
    /// `default_app`: limits until headers say otherwise (dev/personal key: `20:1,100:120`).
    /// `headroom_percent`: share of each limit we allow ourselves (e.g. 90).
    pub fn new(default_app: Vec<Limit>, headroom_percent: u32) -> Self {
        Self {
            scopes: Mutex::new(HashMap::new()),
            default_app,
            headroom_percent: headroom_percent.clamp(10, 100),
        }
    }

    fn with_scopes<T>(&self, f: impl FnOnce(&mut HashMap<(String, String), Scope>) -> T) -> T {
        let mut guard = self
            .scopes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut guard)
    }

    /// Waits until both the app and the method scope have room, then records the request.
    pub async fn acquire(&self, route: &str, method: &str) {
        loop {
            let now = Instant::now();
            let wait_until = self.with_scopes(|scopes| {
                let app_key = (route.to_owned(), String::new());
                let method_key = (route.to_owned(), method.to_owned());
                if !scopes.contains_key(&app_key) {
                    scopes.insert(
                        app_key.clone(),
                        Scope {
                            limits: self.default_app.clone(),
                            ..Scope::default()
                        },
                    );
                }
                scopes.entry(method_key.clone()).or_default();
                let at = [&app_key, &method_key]
                    .iter()
                    .filter_map(|k| scopes.get(*k))
                    .map(|s| s.next_slot(now, self.headroom_percent))
                    .max()
                    .unwrap_or(now);
                if at <= now {
                    for key in [app_key, method_key] {
                        if let Some(scope) = scopes.get_mut(&key) {
                            scope.record(now);
                        }
                    }
                    None
                } else {
                    Some(at)
                }
            });
            match wait_until {
                None => return,
                Some(at) => tokio::time::sleep_until(at).await,
            }
        }
    }

    /// Adopts the limits announced by a response.
    pub fn update(
        &self,
        route: &str,
        method: &str,
        app: Option<&str>,
        method_limits: Option<&str>,
    ) {
        self.with_scopes(|scopes| {
            if let Some(header) = app {
                let limits = parse_limits(header);
                if !limits.is_empty() {
                    scopes
                        .entry((route.to_owned(), String::new()))
                        .or_default()
                        .limits = limits;
                }
            }
            if let Some(header) = method_limits {
                let limits = parse_limits(header);
                if !limits.is_empty() {
                    scopes
                        .entry((route.to_owned(), method.to_owned()))
                        .or_default()
                        .limits = limits;
                }
            }
        });
    }

    /// After a 429: nothing leaves the affected scope before `retry_after`.
    pub fn block(&self, route: &str, method: Option<&str>, retry_after: Duration) {
        let until = Instant::now() + retry_after;
        self.with_scopes(|scopes| {
            let key = (route.to_owned(), method.unwrap_or_default().to_owned());
            let scope = scopes.entry(key).or_default();
            scope.blocked_until = Some(scope.blocked_until.map_or(until, |t| t.max(until)));
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_limit_headers() {
        assert_eq!(
            parse_limits("20:1,100:120"),
            vec![
                Limit {
                    count: 20,
                    window: Duration::from_secs(1)
                },
                Limit {
                    count: 100,
                    window: Duration::from_secs(120)
                }
            ]
        );
        assert!(parse_limits("garbage, 0:10, 5:0").is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn spaces_requests_to_fit_every_window() {
        let limiter = RateLimiter::new(parse_limits("3:1,5:10"), 100);
        let start = Instant::now();
        let mut times = Vec::new();
        for _ in 0..7 {
            limiter.acquire("euw1", "match").await;
            times.push(start.elapsed());
        }
        // 3 immediately, 2 more after 1 s (5:10 now full), the rest after the 10 s window.
        assert_eq!(times[2], Duration::ZERO);
        assert_eq!(times[3], Duration::from_secs(1));
        assert_eq!(times[4], Duration::from_secs(1));
        assert_eq!(times[5], Duration::from_secs(10));
    }

    #[tokio::test(start_paused = true)]
    async fn routes_are_independent() {
        let limiter = RateLimiter::new(parse_limits("1:10"), 100);
        let start = Instant::now();
        limiter.acquire("euw1", "m").await;
        limiter.acquire("europe", "m").await;
        assert_eq!(start.elapsed(), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn honours_blocks_and_method_limits() {
        let limiter = RateLimiter::new(parse_limits("100:1"), 100);
        limiter.update("euw1", "spectator", None, Some("1:5"));
        let start = Instant::now();
        limiter.acquire("euw1", "spectator").await;
        limiter.acquire("euw1", "spectator").await;
        assert_eq!(start.elapsed(), Duration::from_secs(5));

        limiter.block("euw1", None, Duration::from_secs(3));
        let before = Instant::now();
        limiter.acquire("euw1", "other").await;
        assert_eq!(before.elapsed(), Duration::from_secs(3));
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_headroom() {
        let limiter = RateLimiter::new(parse_limits("10:1"), 80);
        let start = Instant::now();
        for _ in 0..9 {
            limiter.acquire("euw1", "m").await;
        }
        // Only 8 of 10 per second: the 9th waits a second.
        assert_eq!(start.elapsed(), Duration::from_secs(1));
    }
}
