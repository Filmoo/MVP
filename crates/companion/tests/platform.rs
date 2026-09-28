//! Remote config, kill switches and crash reports against a small fake backend (and the fake
//! League client for the automations). No network.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use companion::backend::{BackendClient, BackendConfig, INSTALL_HEADER};
use companion::crash::{CrashReporter, DIR_NAME};
use companion::remote::{FILE_NAME, RemoteConfigStore};
use domain::{
    BackendError, ClientConnection, CrashReport, RemoteConfig, ReportKind, Scouting, Settings,
};
use lcu::ConnectorConfig;
use lcu::tls::pinned_client_config;
use mock_lcu::MockLcu;
use serde_json::{Value, json};
use tokio::sync::watch;

const INSTALL: &str = "0123456789abcdef0123456789abcdef";

#[derive(Default)]
struct Server {
    /// The config served, and its `ETag`.
    config: Value,
    etag: String,
    /// `(version, channel, If-None-Match, X-MVP-Install)` of each config request.
    config_requests: Vec<(String, String, Option<String>, Option<String>)>,
    reports: Vec<Value>,
    /// Status answered to reports (202 unless set).
    report_status: Option<StatusCode>,
    batches: usize,
}

type Shared = Arc<Mutex<Server>>;

/// A query parameter of `uri` (plain values only).
fn param(uri: &Uri, name: &str) -> String {
    uri.query()
        .unwrap_or_default()
        .split('&')
        .find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='))
        .unwrap_or_default()
        .to_owned()
}

async fn config(State(server): State<Shared>, uri: Uri, headers: HeaderMap) -> Response {
    let text = |name| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let mut server = server.lock().unwrap();
    let if_none_match = text(header::IF_NONE_MATCH.as_str());
    server.config_requests.push((
        param(&uri, "version"),
        param(&uri, "channel"),
        if_none_match.clone(),
        text(INSTALL_HEADER),
    ));
    if if_none_match.as_deref() == Some(server.etag.as_str()) {
        return StatusCode::NOT_MODIFIED.into_response();
    }
    (
        [(header::ETAG, server.etag.clone())],
        Json(server.config.clone()),
    )
        .into_response()
}

async fn report(State(server): State<Shared>, Json(body): Json<Value>) -> Response {
    let mut server = server.lock().unwrap();
    let status = server.report_status.unwrap_or(StatusCode::ACCEPTED);
    if status == StatusCode::ACCEPTED {
        server.reports.push(body);
        return status.into_response();
    }
    let code = if status == StatusCode::TOO_MANY_REQUESTS {
        "rateLimited"
    } else {
        "badRequest"
    };
    (status, Json(json!({ "error": code, "message": "no" }))).into_response()
}

async fn batch(State(server): State<Shared>) -> Json<Value> {
    server.lock().unwrap().batches += 1;
    Json(json!([]))
}

async fn fake_backend() -> (BackendClient, Shared) {
    let server = Shared::default();
    {
        let mut s = server.lock().unwrap();
        s.config = json!({ "pollAfterSecs": 3600 });
        s.etag = "\"v1\"".into();
    }
    let app = Router::new()
        .route("/v1/config", get(config))
        .route("/v1/reports", post(report))
        .route("/v1/players/batch", post(batch))
        .with_state(Arc::clone(&server));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut config = BackendConfig::new(base, INSTALL);
    config.timeout = Duration::from_secs(2);
    (BackendClient::new(&config).unwrap(), server)
}

// ── Remote config ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn config_is_fetched_revalidated_and_kept_for_the_next_start() {
    let (backend, server) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(FILE_NAME);
    let store = RemoteConfigStore::load(path.clone(), "0.1.0");
    let mut changes = store.subscribe();

    server.lock().unwrap().config = json!({
        "killSwitches": { "autoAccept": true },
        "banners": [{ "id": "patch", "severity": "info", "text": { "en": "Patch day", "fr": "Jour de patch" },
                      "link": null, "startsAt": null, "endsAt": null }],
        "pollAfterSecs": 3600
    });
    assert!(store.refresh(&backend).await.unwrap(), "a new config");
    assert!(changes.has_changed().unwrap());
    let config = changes.borrow_and_update().clone();
    assert!(config.kill_switches.auto_accept);
    assert_eq!(config.banners[0].id, "patch");

    // Unchanged on the server: a bodiless 304, nothing published.
    assert!(!store.refresh(&backend).await.unwrap());
    assert!(!changes.has_changed().unwrap());
    {
        let s = server.lock().unwrap();
        let (version, channel, etag, install) = &s.config_requests[1];
        assert_eq!((version.as_str(), channel.as_str()), ("0.1.0", "stable"));
        assert_eq!(etag.as_deref(), Some("\"v1\""), "revalidated with the ETag");
        assert_eq!(install.as_deref(), Some(INSTALL));
        assert_eq!(
            s.config_requests[0].2, None,
            "first fetch: nothing to revalidate"
        );
    }

    // Changed: the kill switch is lifted at once.
    {
        let mut s = server.lock().unwrap();
        s.config = json!({ "pollAfterSecs": 3600 });
        s.etag = "\"v2\"".into();
    }
    assert!(store.refresh(&backend).await.unwrap());
    assert!(!changes.borrow_and_update().kill_switches.auto_accept);

    // The next start begins from the last answer and revalidates it.
    let restarted = RemoteConfigStore::load(path, "0.1.0");
    assert_eq!(restarted.get(), store.get());
    assert!(!restarted.refresh(&backend).await.unwrap());
    assert_eq!(
        server.lock().unwrap().config_requests[3].2.as_deref(),
        Some("\"v2\"")
    );
}

#[tokio::test]
async fn an_unreachable_server_keeps_the_last_config() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(FILE_NAME);
    let (backend, server) = fake_backend().await;
    server.lock().unwrap().config = json!({ "killSwitches": { "autoAccept": true } });
    RemoteConfigStore::load(path.clone(), "0.1.0")
        .refresh(&backend)
        .await
        .unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let dead = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let offline = BackendClient::new(&BackendConfig::new(dead, INSTALL)).unwrap();
    let store = RemoteConfigStore::load(path, "0.1.0");
    assert!(matches!(
        store.refresh(&offline).await,
        Err(BackendError::Network { .. })
    ));
    assert!(
        store.get().kill_switches.auto_accept,
        "offline: still killed"
    );
}

// ── Kill switches and feature flags in the running core ────────────────────────────────────

fn config_for(mock: &MockLcu) -> ConnectorConfig {
    let lockfile = mock.lockfile();
    ConnectorConfig {
        discover: Box::new(move || {
            lcu::Lockfile::parse(&lockfile)
                .ok()
                .map(|l| l.credentials())
        }),
        tls: pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
        paths: vec![],
        poll_interval: Duration::from_millis(50),
        startup_grace: Duration::from_secs(1),
    }
}

fn auto_accept(delay: u8) -> Settings {
    Settings {
        auto_accept: true,
        auto_accept_delay_seconds: delay,
        auto_switch_view: false,
        bring_to_front_on_champ_select: false,
        ..Settings::default()
    }
}

fn killed(auto_accept: bool) -> RemoteConfig {
    let mut config = RemoteConfig::default();
    config.kill_switches.auto_accept = auto_accept;
    config
}

/// A core following `mock` with `settings` and the `remote` config (sender kept by the test).
async fn connected(
    mock: &MockLcu,
    settings: Settings,
    remote: RemoteConfig,
    backend: Option<BackendClient>,
) -> (
    companion::Companion,
    watch::Sender<Settings>,
    watch::Sender<RemoteConfig>,
) {
    let (settings_tx, settings_rx) = watch::channel(settings);
    let (remote_tx, remote_rx) = watch::channel(remote);
    let companion = companion::start_full(config_for(mock), settings_rx, backend, remote_rx);
    let mut status = companion.status.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        status.wait_for(|s| s.connection == ClientConnection::Connected),
    )
    .await
    .unwrap()
    .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    (companion, settings_tx, remote_tx)
}

async fn accepts_after(mock: &MockLcu, wait: Duration) -> usize {
    tokio::time::sleep(wait).await;
    mock.count("POST", mock_lcu::READY_CHECK_ACCEPT)
}

#[tokio::test]
async fn a_kill_switch_wins_over_the_players_setting() {
    let mock = MockLcu::start().await.unwrap();
    let (_core, _settings, _remote) = connected(&mock, auto_accept(0), killed(true), None).await;
    mock.start_ready_check();
    assert_eq!(accepts_after(&mock, Duration::from_millis(500)).await, 0);
}

#[tokio::test]
async fn a_kill_switch_stops_a_pending_accept_at_once() {
    let mock = MockLcu::start().await.unwrap();
    let (_core, _settings, remote) = connected(&mock, auto_accept(1), killed(false), None).await;
    mock.start_ready_check();
    tokio::time::sleep(Duration::from_millis(300)).await;
    remote.send_replace(killed(true));
    assert_eq!(
        accepts_after(&mock, Duration::from_millis(1_500)).await,
        0,
        "killed during the delay"
    );
}

#[tokio::test]
async fn lifting_a_kill_switch_during_the_pop_up_accepts() {
    let mock = MockLcu::start().await.unwrap();
    let (_core, _settings, remote) = connected(&mock, auto_accept(0), killed(true), None).await;
    mock.start_ready_check();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(mock.count("POST", mock_lcu::READY_CHECK_ACCEPT), 0);
    remote.send_replace(killed(false));
    assert_eq!(accepts_after(&mock, Duration::from_millis(500)).await, 1);
}

#[tokio::test]
async fn scouting_turned_off_remotely_looks_nobody_up() {
    let (backend, server) = fake_backend().await;
    let mock = MockLcu::start().await.unwrap();
    mock.set(
        companion::live::SESSION,
        json!({ "gameData": { "gameId": 7, "queue": { "id": 420 },
            "teamOne": [{ "championId": 54, "puuid": "a", "gameName": "Ally", "tagLine": "EUW" }],
            "teamTwo": [{ "championId": 39, "puuid": "b", "gameName": "Enemy", "tagLine": "EUW" }] } }),
    );
    let mut remote = RemoteConfig::default();
    remote.features.scouting = false;
    let (core, _settings, _remote) =
        connected(&mock, Settings::default(), remote, Some(backend)).await;
    let mut live = core.live.clone();
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    let game = tokio::time::timeout(
        Duration::from_secs(5),
        live.wait_for(|g| {
            g.as_ref()
                .is_some_and(|g| matches!(g.scouting, Scouting::Failed { .. }))
        }),
    )
    .await
    .unwrap()
    .unwrap()
    .clone()
    .unwrap();
    assert_eq!(game.allies.len(), 1, "the teams still show");
    assert_eq!(server.lock().unwrap().batches, 0, "no lookup");
}

// ── Crash reports ──────────────────────────────────────────────────────────────────────────

fn reporter(dir: &std::path::Path, backend: BackendClient) -> Arc<CrashReporter> {
    CrashReporter::new(
        dir.join(DIR_NAME),
        "0.1.0",
        "windows x86_64",
        INSTALL,
        Some(backend),
    )
}

fn private_report() -> CrashReport {
    companion::crash::build_report(
        ReportKind::Panic,
        "no card for Fillmo#7272 (0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33)",
        Some(r"at C:\Users\Jane Doe\AppData\Local\MVP\MVP.exe"),
        "0.1.0",
        "windows x86_64",
        INSTALL,
    )
}

async fn reports_received(server: &Shared, count: usize) -> Vec<Value> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let reports = server.lock().unwrap().reports.clone();
            if reports.len() >= count {
                return reports;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn reports_go_out_scrubbed_at_the_next_start_or_at_once() {
    let (backend, server) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    // A release build's panic hook wrote this report just before the app aborted.
    let before = reporter(dir.path(), backend.clone());
    before.set_enabled(true);
    before.save(&private_report()).unwrap();

    // The next start, still opted in: it goes out, scrubbed, and leaves the disk.
    let reporter = reporter(dir.path(), backend);
    reporter.install_panic_hook();
    let (_settings, settings_rx) = watch::channel(Settings {
        crash_reports: true,
        ..Settings::default()
    });
    let task = tokio::spawn(Arc::clone(&reporter).run(settings_rx));
    let reports = reports_received(&server, 1).await;
    let sent = reports[0].to_string();
    for private in ["Fillmo", "7272", "0f8e2a7c", "Jane"] {
        assert!(!sent.contains(private), "{private} in {sent}");
    }
    assert_eq!(reports[0]["kind"], "panic");
    assert_eq!(reports[0]["installId"], INSTALL);
    assert!(reporter.pending().is_empty());

    // A panic the app survives (a task in a debug build) is sent at once.
    let _ = std::thread::spawn(|| panic!("scouting Fillmo#7272 failed"))
        .join()
        .unwrap_err();
    let reports = reports_received(&server, 2).await;
    assert!(
        reports[1]["message"]
            .as_str()
            .unwrap()
            .contains("panicked at"),
        "{}",
        reports[1]
    );
    assert!(!reports[1].to_string().contains("Fillmo"));
    let _ = std::panic::take_hook();

    // UI errors: once each per session.
    for _ in 0..2 {
        reporter
            .report_ui_error(
                "TypeError: x is undefined",
                Some("at render (index.js:1:2)"),
            )
            .await;
    }
    let reports = server.lock().unwrap().reports.clone();
    assert_eq!(reports.len(), 3);
    assert_eq!(reports[2]["kind"], "js");
    task.abort();
}

#[tokio::test]
async fn nothing_is_written_or_sent_while_off() {
    let (backend, server) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let reporter = reporter(dir.path(), backend);
    // Left from when reports were on: turning them off deletes it.
    reporter.save(&private_report()).unwrap();
    let (settings, settings_rx) = watch::channel(Settings::default());
    let task = tokio::spawn(Arc::clone(&reporter).run(settings_rx));
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(reporter.pending().is_empty());
    reporter
        .report_ui_error("TypeError: x is undefined", None)
        .await;
    assert!(server.lock().unwrap().reports.is_empty());

    // Turned on, then off again: from then on nothing goes out.
    settings.send_modify(|s| s.crash_reports = true);
    tokio::time::sleep(Duration::from_millis(100)).await;
    settings.send_modify(|s| s.crash_reports = false);
    tokio::time::sleep(Duration::from_millis(100)).await;
    reporter.report_ui_error("ReferenceError: y", None).await;
    assert!(server.lock().unwrap().reports.is_empty());
    task.abort();
}

#[tokio::test]
async fn refused_reports_are_dropped_and_rate_limited_ones_kept() {
    let (backend, server) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let reporter = reporter(dir.path(), backend);
    reporter.set_enabled(true);
    reporter.save(&private_report()).unwrap();

    server.lock().unwrap().report_status = Some(StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reporter.send_pending().await, 0);
    assert_eq!(reporter.pending().len(), 1, "kept for later");

    server.lock().unwrap().report_status = Some(StatusCode::BAD_REQUEST);
    assert_eq!(reporter.send_pending().await, 0);
    assert!(reporter.pending().is_empty(), "never accepted: dropped");

    server.lock().unwrap().report_status = None;
    reporter.save(&private_report()).unwrap();
    assert_eq!(reporter.send_pending().await, 1);
    assert!(reporter.pending().is_empty());
}
