//! Logs (tracing, JSON in production), request ids and Prometheus metrics without a metrics
//! dependency: a few counters rendered as the text exposition format.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::hash::{BuildHasher as _, RandomState};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use axum::extract::{MatchedPath, Request, State};
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::Response;
use std::sync::Arc;
use tokio::time::Instant;
use tracing::Instrument as _;
use tracing_subscriber::EnvFilter;

pub const REQUEST_ID_HEADER: &str = "x-request-id";

/// `RUST_LOG` filter (default `info`); `LOG_FORMAT=json` for one JSON object per line.
pub fn init_logging() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let json = std::env::var("LOG_FORMAT").is_ok_and(|f| f.eq_ignore_ascii_case("json"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if json {
        builder
            .json()
            .flatten_event(true)
            .with_current_span(true)
            .with_span_list(false)
            .init();
    } else {
        builder.init();
    }
}

#[derive(Debug, Default)]
pub struct Metrics {
    /// (route, method, status) → count.
    requests: Mutex<BTreeMap<(String, String, u16), u64>>,
    /// route → (sum of seconds, count).
    durations: Mutex<BTreeMap<String, (f64, u64)>>,
    rate_limited: AtomicU64,
    /// outcome → count.
    reports: Mutex<BTreeMap<&'static str, u64>>,
    /// Shared Mayhem games by outcome (accepted, duplicate, invalid…).
    mayhem: Mutex<BTreeMap<&'static str, u64>>,
    ids: IdSource,
}

impl Metrics {
    pub fn rate_limited(&self) {
        self.rate_limited.fetch_add(1, Ordering::Relaxed);
    }

    pub fn report(&self, outcome: &'static str) {
        *lock(&self.reports).entry(outcome).or_default() += 1;
    }

    /// `n` shared Mayhem games had this `outcome`.
    pub fn mayhem(&self, outcome: &'static str, n: u64) {
        *lock(&self.mayhem).entry(outcome).or_default() += n;
    }

    fn observe(&self, route: &str, method: &str, status: u16, seconds: f64) {
        *lock(&self.requests)
            .entry((route.to_owned(), method.to_owned(), status))
            .or_default() += 1;
        let mut durations = lock(&self.durations);
        let d = durations.entry(route.to_owned()).or_default();
        d.0 += seconds;
        d.1 += 1;
    }

    /// The service's own counters in Prometheus text format (callers append gauges).
    pub fn render(&self, out: &mut String) {
        out.push_str("# HELP mvp_http_requests_total HTTP requests by route, method and status.\n");
        out.push_str("# TYPE mvp_http_requests_total counter\n");
        for ((route, method, status), n) in lock(&self.requests).iter() {
            let _ = writeln!(
                out,
                "mvp_http_requests_total{{route=\"{}\",method=\"{method}\",status=\"{status}\"}} {n}",
                escape(route)
            );
        }
        out.push_str("# HELP mvp_http_request_duration_seconds Time spent answering, by route.\n");
        out.push_str("# TYPE mvp_http_request_duration_seconds summary\n");
        for (route, (sum, count)) in lock(&self.durations).iter() {
            let route = escape(route);
            let _ = writeln!(
                out,
                "mvp_http_request_duration_seconds_sum{{route=\"{route}\"}} {sum:.6}\n\
                 mvp_http_request_duration_seconds_count{{route=\"{route}\"}} {count}"
            );
        }
        counter(
            out,
            "mvp_rate_limited_total",
            "Requests refused by our per-client rate limit.",
            self.rate_limited.load(Ordering::Relaxed),
        );
        out.push_str("# HELP mvp_reports_total Crash reports by outcome.\n");
        out.push_str("# TYPE mvp_reports_total counter\n");
        for (outcome, n) in lock(&self.reports).iter() {
            let _ = writeln!(out, "mvp_reports_total{{outcome=\"{outcome}\"}} {n}");
        }
        out.push_str("# HELP mvp_mayhem_games_total Shared Mayhem games by outcome.\n");
        out.push_str("# TYPE mvp_mayhem_games_total counter\n");
        for (outcome, n) in lock(&self.mayhem).iter() {
            let _ = writeln!(out, "mvp_mayhem_games_total{{outcome=\"{outcome}\"}} {n}");
        }
    }
}

pub fn counter(out: &mut String, name: &str, help: &str, value: u64) {
    let _ = writeln!(
        out,
        "# HELP {name} {help}\n# TYPE {name} counter\n{name} {value}"
    );
}

fn escape(label: &str) -> String {
    label
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Request ids: a random per-process prefix and a counter (unique, cheap, not guessable
/// across restarts).
#[derive(Debug)]
struct IdSource {
    prefix: u32,
    next: AtomicU64,
}

impl Default for IdSource {
    fn default() -> Self {
        let random = RandomState::new().hash_one(std::process::id());
        Self {
            prefix: u32::try_from(random >> 32).unwrap_or_default(),
            next: AtomicU64::new(1),
        }
    }
}

impl IdSource {
    fn next(&self) -> String {
        format!(
            "{:08x}{:08x}",
            self.prefix,
            self.next.fetch_add(1, Ordering::Relaxed)
        )
    }
}

fn incoming_id(req: &Request) -> Option<String> {
    let id = req.headers().get(REQUEST_ID_HEADER)?.to_str().ok()?;
    ((1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
    .then(|| id.to_owned())
}

/// Gives every request an id (kept from `X-Request-Id` when sane, echoed in the answer),
/// a tracing span, an access log line and its metrics.
pub async fn observe(State(metrics): State<Arc<Metrics>>, req: Request, next: Next) -> Response {
    let started = Instant::now();
    let id = incoming_id(&req).unwrap_or_else(|| metrics.ids.next());
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map_or("unmatched", MatchedPath::as_str)
        .to_owned();
    let method = req.method().as_str().to_owned();
    let span = tracing::info_span!("request", id = %id, method = %method, route = %route);
    let mut res = next.run(req).instrument(span.clone()).await;
    let status = res.status().as_u16();
    let seconds = started.elapsed().as_secs_f64();
    metrics.observe(&route, &method, status, seconds);
    span.in_scope(|| {
        let ms = seconds * 1000.0;
        if route == "/health" {
            tracing::debug!(status, ms, "answered");
        } else if status >= 500 {
            tracing::warn!(status, ms, "answered");
        } else {
            tracing::info!(status, ms, "answered");
        }
    });
    if let Ok(v) = HeaderValue::from_str(&id) {
        res.headers_mut().insert(REQUEST_ID_HEADER, v);
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_prometheus_text() {
        let m = Metrics::default();
        m.observe("/v1/config", "GET", 200, 0.5);
        m.observe("/v1/config", "GET", 200, 0.25);
        m.observe("/v1/config", "GET", 304, 0.1);
        m.rate_limited();
        m.report("accepted");
        let mut out = String::new();
        m.render(&mut out);
        assert!(
            out.contains(
                "mvp_http_requests_total{route=\"/v1/config\",method=\"GET\",status=\"200\"} 2"
            ),
            "{out}"
        );
        assert!(out.contains("mvp_http_request_duration_seconds_count{route=\"/v1/config\"} 3"));
        assert!(out.contains("mvp_rate_limited_total 1"));
        assert!(out.contains("mvp_reports_total{outcome=\"accepted\"} 1"));
    }

    #[test]
    fn ids_are_unique() {
        let ids = IdSource::default();
        assert_ne!(ids.next(), ids.next());
        assert_eq!(ids.next().len(), 16);
    }
}
