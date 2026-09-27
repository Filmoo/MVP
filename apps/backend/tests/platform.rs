//! Platform services end to end (no network): updates, remote config, crash reports, rate
//! limiting, metrics, request ids and the Riot cache snapshot.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path as UrlPath, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use mvp_backend::{AppState, DEFAULT_ALLOWED_ORIGINS, Ops, OpsSettings, service};
use riot_api::limits::parse_limits;
use riot_api::{ApiKey, Config, RiotClient};
use serde_json::{Value, json};

const INSTALL: &str = "0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33";

struct Env {
    base: String,
    http: reqwest::Client,
    dir: tempfile::TempDir,
    ops: Arc<Ops>,
    state: AppState,
}

fn http() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::new()
}

async fn serve(router: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    base
}

fn settings(dir: &Path) -> OpsSettings {
    OpsSettings {
        data_dir: dir.to_path_buf(),
        reload_check: Duration::ZERO,
        ..OpsSettings::default()
    }
}

async fn start_with(
    dir: tempfile::TempDir,
    riot: Option<RiotClient>,
    tweak: impl FnOnce(&mut OpsSettings),
) -> Env {
    let mut s = settings(dir.path());
    tweak(&mut s);
    let ops = Arc::new(Ops::new(s).unwrap());
    let state = AppState::new(riot);
    let origins: Vec<String> = DEFAULT_ALLOWED_ORIGINS.map(str::to_owned).to_vec();
    let base = serve(service(&state, &origins, &ops)).await;
    Env {
        base,
        http: http(),
        dir,
        ops,
        state,
    }
}

async fn start(tweak: impl FnOnce(&mut OpsSettings)) -> Env {
    start_with(tempfile::tempdir().unwrap(), None, tweak).await
}

impl Env {
    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .get(format!("{}{path}", self.base))
            .header("x-mvp-install", INSTALL)
    }

    fn write(&self, file: &str, value: &Value) {
        // Different lengths guarantee the change is seen even on coarse mtime clocks.
        std::fs::write(
            self.dir.path().join(file),
            serde_json::to_vec_pretty(value).unwrap(),
        )
        .unwrap();
    }
}

async fn status_json(res: reqwest::Response) -> (u16, Value) {
    let status = res.status().as_u16();
    (status, res.json().await.unwrap_or(Value::Null))
}

// ---------------------------------------------------------------------------------------------
// Updates

fn release(version: &str, channel: &str, rollout: u8) -> Value {
    json!({
        "version": version, "channel": channel, "pubDate": "2026-09-27T12:00:00Z",
        "notes": { "en": format!("What's new in {version}"), "fr": format!("Nouveautés de {version}") },
        "platforms": { "windows-x86_64": {
            "url": format!("https://github.com/owner/mvp/releases/download/v{version}/MVP_{version}_x64-setup.exe"),
            "signature": format!("c2lnbmF0dXJl{}", version.replace('.', ""))
        } },
        "rollout": rollout
    })
}

#[tokio::test]
async fn updater_answers_204_or_the_tauri_manifest() {
    let env = start(|_| {}).await;
    // No releases.json yet: always up to date.
    let res = env
        .get("/v1/updates/windows/x86_64/0.1.0")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 204);

    env.write(
        "releases.json",
        &json!({ "releases": [release("0.2.0", "stable", 100), release("0.3.0-beta.1", "beta", 100)] }),
    );
    let (status, body) = status_json(
        env.get("/v1/updates/windows/x86_64/0.1.0?channel=stable")
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(
        body,
        json!({
            "version": "0.2.0",
            "notes": "What's new in 0.2.0",
            "pub_date": "2026-09-27T12:00:00Z",
            "platforms": { "windows-x86_64": {
                "signature": "c2lnbmF0dXJl020",
                "url": "https://github.com/owner/mvp/releases/download/v0.2.0/MVP_0.2.0_x64-setup.exe"
            } },
            "mandatory": false,
            "notesI18n": { "en": "What's new in 0.2.0", "fr": "Nouveautés de 0.2.0" }
        })
    );

    let (_, body) = status_json(
        env.get("/v1/updates/windows/x86_64/0.1.0?channel=beta&lang=fr")
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(body["version"], "0.3.0-beta.1");
    assert_eq!(body["notes"], "Nouveautés de 0.3.0-beta.1");

    let res = env
        .get("/v1/updates/windows/x86_64/0.2.0")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 204, "up to date on stable");
    let res = env
        .get("/v1/updates/darwin/aarch64/0.1.0")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 204, "no artifact for that platform");

    for bad in [
        "/v1/updates/windows/x86_64/latest",
        "/v1/updates/windows/x86_64/0.1.0?channel=nightly",
        "/v1/updates/win%20dows/x86_64/0.1.0",
    ] {
        let (status, body) = status_json(env.get(bad).send().await.unwrap()).await;
        assert_eq!(status, 400, "{bad}");
        assert_eq!(body["error"], "badRequest");
    }
}

#[tokio::test]
async fn staged_rollout_and_blocking_through_the_cli() {
    let env = start(|_| {}).await;
    env.write(
        "releases.json",
        &json!({ "releases": [release("0.2.0", "stable", 100)] }),
    );
    let sig = env.dir.path().join("MVP_0.3.0_x64-setup.exe.sig");
    std::fs::write(&sig, "c2lnMDMw\n").unwrap();
    let args: Vec<String> = [
        "release",
        "add",
        "--version",
        "0.3.0",
        "--channel",
        "stable",
        "--url",
        "https://dl.example/MVP_0.3.0_x64-setup.exe",
        "--signature-file",
        sig.to_str().unwrap(),
        "--notes-en",
        "Faster",
        "--notes-fr",
        "Plus rapide",
        "--rollout",
        "30",
    ]
    .map(str::to_owned)
    .to_vec();
    mvp_backend::admin::run(&args, env.dir.path(), &mut Vec::new()).unwrap();

    // Which of 200 installs get 0.3.0 at 30 %: about 30 %, and the same answer every time.
    let version = semver::Version::new(0, 3, 0);
    let mut offered = 0;
    for i in 0..200 {
        let id = format!("install-{i:04}-abcdef");
        let expected = mvp_backend::rollout_bucket(&id, &version) < 3000;
        for _ in 0..2 {
            let (_, body) = status_json(
                env.http
                    .get(format!("{}/v1/updates/windows/x86_64/0.2.0", env.base))
                    .header("x-mvp-install", &id)
                    .send()
                    .await
                    .unwrap(),
            )
            .await;
            assert_eq!(body["version"] == "0.3.0", expected, "{id}");
        }
        offered += usize::from(expected);
    }
    assert!((40..=80).contains(&offered), "{offered} of 200 at 30 %");

    // Pull it: nobody is offered 0.3.0 any more, 0.1.0 installs get 0.2.0.
    let block: Vec<String> = ["release", "block", "--version", "0.3.0"]
        .map(str::to_owned)
        .to_vec();
    mvp_backend::admin::run(&block, env.dir.path(), &mut Vec::new()).unwrap();
    for id in [
        "install-0000-abcdef",
        "install-0001-abcdef",
        "install-0002-abcdef",
    ] {
        let res = env
            .http
            .get(format!(
                "{}/v1/updates/windows/x86_64/0.2.0?install_id={id}",
                env.base
            ))
            .header("x-mvp-install", id)
            .send()
            .await
            .unwrap();
        assert_eq!(res.status().as_u16(), 204);
    }
    let (_, body) = status_json(
        env.get("/v1/updates/windows/x86_64/0.1.0")
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(body["version"], "0.2.0");
}

// ---------------------------------------------------------------------------------------------
// Remote config

#[tokio::test]
async fn config_etag_304_and_hot_reload() {
    let env = start(|_| {}).await;
    let res = env.get("/v1/config?version=0.1.0").send().await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    let etag = res.headers()["etag"].to_str().unwrap().to_owned();
    let body: Value = res.json().await.unwrap();
    assert_eq!(
        body["features"]["scouting"], true,
        "defaults without config.json"
    );
    assert_eq!(body["updateRequired"], false);

    let res = env
        .get("/v1/config?version=0.1.0")
        .header("if-none-match", &etag)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 304);
    assert_eq!(res.headers()["etag"], etag.as_str());

    env.write(
        "config.json",
        &json!({
            "killSwitches": { "autoAccept": true },
            "minVersion": { "version": "0.2.0", "message": { "en": "Update", "fr": "Mettez à jour" } },
            "banners": [{ "id": "euw-issue", "severity": "warn",
                "text": { "en": "Riot login issues on EUW", "fr": "Problèmes de connexion Riot sur EUW" },
                "link": "https://status.riotgames.com", "startsAt": null, "endsAt": null }]
        }),
    );
    let res = env
        .get("/v1/config?version=0.1.0")
        .header("if-none-match", &etag)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 200, "changed: full answer");
    let new_etag = res.headers()["etag"].to_str().unwrap().to_owned();
    assert_ne!(new_etag, etag);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["killSwitches"]["autoAccept"], true);
    assert_eq!(body["updateRequired"], true);
    assert_eq!(body["banners"][0]["id"], "euw-issue");

    // A broken edit keeps the last good config.
    std::fs::write(env.dir.path().join("config.json"), b"{ \"killSwitches\": ").unwrap();
    let res = env
        .get("/v1/config?version=0.1.0")
        .header("if-none-match", &new_etag)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 304);

    let (status, _) = status_json(env.get("/v1/config?version=x").send().await.unwrap()).await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn invalid_files_refuse_to_start() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("config.json"), br#"{"killSwitchs": {}}"#).unwrap();
    let err = Ops::new(settings(dir.path())).unwrap_err();
    assert!(err.contains("killSwitchs"), "{err}");
}

// ---------------------------------------------------------------------------------------------
// Crash reports

fn report(message: &str) -> Value {
    json!({
        "appVersion": "0.2.0", "osVersion": "Windows 11 23H2 (22631)", "kind": "lcu",
        "message": message, "stack": r"at C:\Users\Jane\AppData\Local\MVP\mvp.exe",
        "installId": INSTALL
    })
}

#[tokio::test]
async fn reports_are_validated_scrubbed_and_limited() {
    let env = start(|_| {}).await;
    let post = |body: Value| {
        env.http
            .post(format!("{}/v1/reports", env.base))
            .json(&body)
            .send()
    };
    let res = post(report("no scout card for Fillmo#7272")).await.unwrap();
    assert_eq!(res.status().as_u16(), 202);

    let files: Vec<_> = std::fs::read_dir(env.dir.path().join("reports"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1);
    let line: Value =
        serde_json::from_str(std::fs::read_to_string(&files[0]).unwrap().trim()).unwrap();
    assert_eq!(line["message"], "no scout <riot-id>");
    assert_eq!(
        line["stack"],
        r"at C:\Users\<user>\AppData\Local\MVP\mvp.exe"
    );
    assert_eq!(line["installId"], INSTALL);
    assert_eq!(line["kind"], "lcu");
    assert!(line.get("ip").is_none());

    // Too big for the body limit: 413 before parsing.
    let mut huge = report("big");
    huge["stack"] = json!("x".repeat(50 * 1024));
    let (status, body) = status_json(post(huge).await.unwrap()).await;
    assert_eq!(status, 413);
    assert_eq!(body["error"], "badRequest");

    for bad in [
        json!({ "appVersion": "0.2.0" }),
        {
            let mut r = report("x");
            r["kind"] = json!("oops");
            r
        },
        {
            let mut r = report("x");
            r["installId"] = json!("../../etc");
            r
        },
    ] {
        let (status, body) = status_json(post(bad.clone()).await.unwrap()).await;
        assert_eq!(status, 400, "{bad}");
        assert_eq!(body["error"], "badRequest");
    }

    // Per install: a burst of 5, then 429 (the first one above counted).
    for _ in 0..4 {
        assert_eq!(post(report("again")).await.unwrap().status().as_u16(), 202);
    }
    let res = post(report("again")).await.unwrap();
    assert_eq!(res.status().as_u16(), 429);
    assert!(
        res.headers()["retry-after"]
            .to_str()
            .unwrap()
            .parse::<u32>()
            .unwrap()
            >= 60
    );
    let mut other = report("from another install");
    other["installId"] = json!("11111111-2222-3333-4444-555555555555");
    assert_eq!(post(other).await.unwrap().status().as_u16(), 202);
}

// ---------------------------------------------------------------------------------------------
// Hardening

#[tokio::test]
async fn rate_limit_answers_429_with_retry_after() {
    let env = start(|s| {
        s.rate_burst = 3;
        s.rate_per_minute = 6;
    })
    .await;
    for _ in 0..3 {
        assert_eq!(
            env.get("/v1/config")
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            200
        );
    }
    let res = env.get("/v1/config").send().await.unwrap();
    assert_eq!(res.status().as_u16(), 429);
    assert_eq!(res.headers()["retry-after"], "10");
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["error"], "rateLimited");
    assert_eq!(body["retryAfter"], 10);

    // Another install has its own bucket; without the header, the IP is the key.
    let other = env
        .http
        .get(format!("{}/v1/config", env.base))
        .header("x-mvp-install", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert_eq!(other.send().await.unwrap().status().as_u16(), 200);
    for _ in 0..3 {
        let res = env
            .http
            .get(format!("{}/v1/config", env.base))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status().as_u16(), 200);
    }
    let res = env
        .http
        .get(format!("{}/v1/config", env.base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 429);
    // Health checks are never limited.
    for _ in 0..10 {
        let res = env
            .http
            .get(format!("{}/health", env.base))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status().as_u16(), 200);
    }
}

#[tokio::test]
async fn request_ids_and_cors() {
    let env = start(|_| {}).await;
    let res = env.get("/v1/config").send().await.unwrap();
    let id = res.headers()["x-request-id"].to_str().unwrap();
    assert_eq!(id.len(), 16);
    let res = env
        .get("/v1/config")
        .header("x-request-id", "trace-abc-123")
        .send()
        .await
        .unwrap();
    assert_eq!(res.headers()["x-request-id"], "trace-abc-123");

    let preflight = env
        .http
        .request(reqwest::Method::OPTIONS, format!("{}/v1/config", env.base))
        .header("Origin", "http://tauri.localhost")
        .header("Access-Control-Request-Method", "GET")
        .header(
            "Access-Control-Request-Headers",
            "x-mvp-install,if-none-match",
        )
        .send()
        .await
        .unwrap();
    assert!(preflight.status().is_success());
    let allowed = preflight.headers()["access-control-allow-headers"]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(allowed.contains("x-mvp-install"), "{allowed}");
    let res = env
        .get("/v1/config")
        .header("Origin", "http://tauri.localhost")
        .send()
        .await
        .unwrap();
    let exposed = res.headers()["access-control-expose-headers"]
        .to_str()
        .unwrap();
    assert!(exposed.contains("etag"), "{exposed}");
}

#[tokio::test]
async fn metrics_need_the_token() {
    let env = start(|_| {}).await;
    let res = env
        .http
        .get(format!("{}/metrics", env.base))
        .send()
        .await
        .unwrap();
    assert_eq!(
        res.status().as_u16(),
        404,
        "not exposed without METRICS_TOKEN"
    );

    let env = start(|s| s.metrics_token = Some("0123456789abcdef-token".into())).await;
    env.get("/v1/config").send().await.unwrap();
    let url = format!("{}/metrics", env.base);
    let res = env.http.get(&url).send().await.unwrap();
    assert_eq!(res.status().as_u16(), 401);
    let res = env
        .http
        .get(&url)
        .bearer_auth("wrong-token-000000000")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 401);
    let res = env
        .http
        .get(&url)
        .bearer_auth("0123456789abcdef-token")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 200);
    let text = res.text().await.unwrap();
    assert!(
        text.contains(r#"mvp_http_requests_total{route="/v1/config",method="GET",status="200"} 1"#),
        "{text}"
    );
    assert!(
        text.contains(r#"mvp_cache_hits_total{cache="profiles"} 0"#),
        "{text}"
    );

    // The admin listener serves it without a token.
    let admin = serve(env.ops.admin_router(&env.state)).await;
    let res = env
        .http
        .get(format!("{admin}/metrics"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 200);
    assert!(res.text().await.unwrap().contains("mvp_build_info"));
}

// ---------------------------------------------------------------------------------------------
// Riot cache snapshot

#[derive(Default)]
struct Calls(Mutex<Vec<String>>);

impl Calls {
    fn to(&self, part: &str) -> usize {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.contains(part))
            .count()
    }
}

async fn fake_riot() -> (Arc<Calls>, String) {
    async fn record(
        State(calls): State<Arc<Calls>>,
        req: axum::extract::Request,
        next: axum::middleware::Next,
    ) -> Response {
        calls.0.lock().unwrap().push(req.uri().path().to_owned());
        next.run(req).await
    }
    let calls = Arc::new(Calls::default());
    let router = Router::new()
        .route(
            "/riot/account/v1/accounts/by-riot-id/{name}/{tag}",
            get(|| async { Json(json!({ "puuid": "p1", "gameName": "Nightfall", "tagLine": "EUW" })) }),
        )
        .route(
            "/lol/summoner/v4/summoners/by-puuid/{puuid}",
            get(|| async { Json(json!({ "puuid": "p1", "profileIconId": 1, "summonerLevel": 30 })) }),
        )
        .route(
            "/lol/league/v4/entries/by-puuid/{puuid}",
            get(|| async { Json(json!([])) }),
        )
        .route(
            "/lol/match/v5/matches/by-puuid/{puuid}/ids",
            get(|| async { Json(json!(["EUW1_1", "EUW1_2"])) }),
        )
        .route(
            "/lol/match/v5/matches/{id}",
            get(|UrlPath(id): UrlPath<String>| async move {
                Json(json!({
                    "metadata": { "matchId": id },
                    "info": { "gameDuration": 1800, "gameEndTimestamp": 1_790_000_000_000_i64, "queueId": 420,
                        "participants": [{ "puuid": "p1", "championId": 1, "teamPosition": "TOP", "win": true,
                            "kills": 1, "deaths": 1, "assists": 1, "totalMinionsKilled": 100, "neutralMinionsKilled": 0 }] }
                }))
                .into_response()
            }),
        )
        .layer(axum::middleware::from_fn_with_state(Arc::clone(&calls), record));
    (calls, serve(router).await)
}

fn riot(base: &str) -> RiotClient {
    RiotClient::new(
        ApiKey::new("RGAPI-test"),
        Config {
            fixed_base_url: Some(base.to_owned()),
            default_app_limits: parse_limits("1000:1"),
            ..Config::default()
        },
    )
    .unwrap()
}

#[tokio::test]
async fn riot_caches_survive_a_restart() {
    let (calls, riot_base) = fake_riot().await;
    let env = start_with(tempfile::tempdir().unwrap(), Some(riot(&riot_base)), |_| {}).await;
    let (status, first) = status_json(
        env.get("/v1/players/euw1/Nightfall/EUW")
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, 200, "{first}");
    assert_eq!(calls.to("/matches/EUW1_"), 2);

    let path = env.ops.snapshot_path().unwrap();
    assert!(
        env.state.save_riot_cache(&path).unwrap() >= 3,
        "account + 2 matches"
    );

    // A new process: accounts and matches come from the snapshot, not from Riot.
    let restarted = AppState::new(Some(riot(&riot_base)));
    assert!(restarted.load_riot_cache(&path).unwrap() >= 3);
    let origins: Vec<String> = DEFAULT_ALLOWED_ORIGINS.map(str::to_owned).to_vec();
    let base = serve(service(&restarted, &origins, &env.ops)).await;
    let (status, again) = status_json(
        env.http
            .get(format!("{base}/v1/players/euw1/Nightfall/EUW"))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(again, first);
    assert_eq!(calls.to("/by-riot-id/"), 1, "account restored");
    assert_eq!(calls.to("/matches/EUW1_"), 2, "matches restored");
    assert_eq!(calls.to("/summoners/"), 2, "live data is fetched again");
}

#[tokio::test]
async fn riot_calls_and_cache_hits_are_counted() {
    let (_, riot_base) = fake_riot().await;
    let env = start_with(tempfile::tempdir().unwrap(), Some(riot(&riot_base)), |s| {
        s.metrics_token = Some("0123456789abcdef-token".into());
    })
    .await;
    for _ in 0..2 {
        let res = env
            .get("/v1/players/euw1/Nightfall/EUW")
            .send()
            .await
            .unwrap();
        assert_eq!(res.status().as_u16(), 200);
    }
    let text = env
        .http
        .get(format!("{}/metrics", env.base))
        .bearer_auth("0123456789abcdef-token")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        text.contains(r#"mvp_riot_calls_total{result="ok"} 6"#),
        "{text}"
    );
    assert!(
        text.contains(r#"mvp_cache_hits_total{cache="profiles"} 1"#),
        "{text}"
    );
    assert!(
        text.contains(r#"mvp_cache_misses_total{cache="matches"} 2"#),
        "{text}"
    );
    assert!(
        text.contains(r#"mvp_cache_entries{cache="matches"} 2"#),
        "{text}"
    );
}
