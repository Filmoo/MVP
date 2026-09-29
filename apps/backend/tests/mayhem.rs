//! ARAM: Mayhem routes end to end (no network): the owner's tiers, the augment catalog, shared
//! games and their pick counts.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use mvp_backend::{AppState, DEFAULT_ALLOWED_ORIGINS, Ops, OpsSettings, service};
use serde_json::{Value, json};

const INSTALL: &str = "0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33";

struct Env {
    base: String,
    http: reqwest::Client,
    dir: tempfile::TempDir,
    _ops: Arc<Ops>,
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

async fn start_in(dir: tempfile::TempDir) -> Env {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let settings = OpsSettings {
        data_dir: dir.path().to_path_buf(),
        reload_check: Duration::ZERO,
        mayhem_catalog: false,
        ..OpsSettings::default()
    };
    let ops = Arc::new(Ops::new(settings).unwrap());
    let origins: Vec<String> = DEFAULT_ALLOWED_ORIGINS.map(str::to_owned).to_vec();
    let base = serve(service(&AppState::new(None), &origins, &ops)).await;
    Env {
        base,
        http: reqwest::Client::new(),
        dir,
        _ops: ops,
    }
}

async fn start() -> Env {
    start_in(tempfile::tempdir().unwrap()).await
}

impl Env {
    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .get(format!("{}{path}", self.base))
            .header("x-mvp-install", INSTALL)
    }

    fn post(&self, body: &Value) -> reqwest::RequestBuilder {
        self.http
            .post(format!("{}/v1/mayhem/games", self.base))
            .header("x-mvp-install", INSTALL)
            .json(body)
    }
}

fn hash(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

fn game(n: u8, patch: &str) -> Value {
    let players: Vec<Value> = (0..10)
        .map(|i| {
            json!({
                "champion": 100 + i,
                "augments": if i < 2 { json!([2137, 1028]) } else { json!([1344]) },
                "items": [3089, 6655]
            })
        })
        .collect();
    json!({ "game": hash(n), "patch": patch, "players": players })
}

#[tokio::test]
async fn tiers_come_from_the_owners_file_with_etags() {
    let env = start().await;
    let res = env.get("/v1/mayhem/tiers").send().await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    let empty: Value = res.json().await.unwrap();
    assert_eq!(
        empty["tiers"],
        json!({ "S": [], "A": [], "B": [], "C": [] }),
        "no file: no tiers"
    );

    std::fs::write(
        env.dir.path().join("mayhem-tiers.json"),
        r#"{ "patch": "26.19", "updatedAt": "2026-09-28", "tiers": { "S": [2137, 1344], "A": [1028] } }"#,
    )
    .unwrap();
    let res = env.get("/v1/mayhem/tiers").send().await.unwrap();
    let etag = res.headers()["etag"].to_str().unwrap().to_owned();
    assert_eq!(res.headers()["cache-control"], "no-cache");
    let tiers: Value = res.json().await.unwrap();
    assert_eq!(tiers["tiers"]["S"], json!([2137, 1344]), "rank order kept");
    let res = env
        .get("/v1/mayhem/tiers")
        .header("if-none-match", &etag)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 304);

    // A broken edit keeps the last good file.
    std::fs::write(
        env.dir.path().join("mayhem-tiers.json"),
        r#"{ "tiers": { "S": [2137], "B": [2137, 7] } }"#,
    )
    .unwrap();
    let tiers: Value = env
        .get("/v1/mayhem/tiers")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(tiers["tiers"]["S"], json!([2137, 1344]));
}

#[tokio::test]
async fn a_broken_tiers_file_stops_the_start() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("mayhem-tiers.json"),
        r#"{ "tiers": { "S": [1, 1] } }"#,
    )
    .unwrap();
    let settings = OpsSettings {
        data_dir: dir.path().to_path_buf(),
        ..OpsSettings::default()
    };
    let err = Ops::new(settings).expect_err("invalid tiers");
    assert!(err.contains("listed twice"), "{err}");
}

#[tokio::test]
async fn augments_are_served_once_built() {
    let env = start().await;
    let res = env.get("/v1/mayhem/augments").send().await.unwrap();
    assert_eq!(res.status().as_u16(), 404);
    let catalog = json!({
        "version": "16.19.1+test", "patch": "16.19", "builtAt": 1,
        "augments": [{ "id": 7, "rarity": "gold", "icon": "assets/ux/kiwi/augments/icons/x_small.png",
                       "name": { "en": "Glass Test", "fr": "Verre test" },
                       "description": { "en": "Made up.", "fr": "Inventé." } }]
    });
    std::fs::create_dir_all(env.dir.path().join("mayhem")).unwrap();
    std::fs::write(
        env.dir.path().join("mayhem/augments.json"),
        serde_json::to_vec(&catalog).unwrap(),
    )
    .unwrap();
    let res = env.get("/v1/mayhem/augments").send().await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    assert_eq!(res.headers()["cache-control"], "public, max-age=3600");
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["augments"][0]["name"]["fr"], "Verre test");
}

#[tokio::test]
async fn shared_games_count_once_and_become_pick_counts() {
    let env = start().await;
    assert_eq!(
        env.get("/v1/mayhem/stats")
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        404,
        "nothing shared yet"
    );
    let upload = json!({ "platform": "EUW1", "games": [game(1, "16.19"), game(2, "16.19")] });
    let res = env.post(&upload).send().await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    let answer: Value = res.json().await.unwrap();
    assert_eq!(answer, json!({ "accepted": 2, "duplicates": 0 }));
    let again: Value = env
        .post(&upload)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        again,
        json!({ "accepted": 0, "duplicates": 2 }),
        "a game counts once"
    );

    let res = env.get("/v1/mayhem/stats").send().await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    assert_eq!(res.headers()["cache-control"], "public, max-age=300");
    let etag = res.headers()["etag"].to_str().unwrap().to_owned();
    let stats: Value = res.json().await.unwrap();
    assert_eq!(
        (stats["games"].as_u64(), stats["players"].as_u64()),
        (Some(2), Some(20))
    );
    assert_eq!(stats["augments"][0], json!({ "id": 1344, "n": 16 }));
    let champion = &stats["champions"][0];
    assert_eq!(champion["id"], 100);
    assert_eq!(
        champion["augments"],
        json!([{ "id": 1028, "n": 2 }, { "id": 2137, "n": 2 }])
    );
    assert!(!stats.to_string().contains("win"), "pick counts only");
    let res = env
        .get("/v1/mayhem/stats?patch=16.19")
        .header("if-none-match", &etag)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 304);
    assert_eq!(
        env.get("/v1/mayhem/stats?patch=nope")
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        400
    );

    // Stored without the install id; counted again after a restart.
    let stored = std::fs::read_to_string(env.dir.path().join("mayhem/games/16.19.jsonl")).unwrap();
    assert_eq!(stored.lines().count(), 2);
    assert!(!stored.contains(INSTALL));
    let dir = env.dir;
    let env = start_in(dir).await;
    let answer: Value = env
        .post(&upload)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(answer["duplicates"], 2);
}

#[tokio::test]
async fn uploads_are_validated_bounded_and_rate_limited() {
    let env = start().await;
    let bad = json!({ "platform": "EUW1", "games": [game(3, "16.19")] });
    let mut wins = bad.clone();
    wins["games"][0]["players"][0]["win"] = json!(true);
    // Unknown fields are ignored: a win never reaches the store.
    assert_eq!(env.post(&wins).send().await.unwrap().status().as_u16(), 200);
    let stored = std::fs::read_to_string(env.dir.path().join("mayhem/games/16.19.jsonl")).unwrap();
    assert!(!stored.contains("win"));

    let mut nine = bad.clone();
    nine["games"][0]["players"].as_array_mut().unwrap().pop();
    let res = env.post(&nine).send().await.unwrap();
    assert_eq!(res.status().as_u16(), 400);
    let body: Value = res.json().await.unwrap();
    assert!(body["message"].as_str().unwrap().contains("10 players"));

    let huge = json!({ "platform": "EUW1", "games": [], "padding": "x".repeat(70 * 1024) });
    assert_eq!(env.post(&huge).send().await.unwrap().status().as_u16(), 413);

    let other = json!({ "platform": "EUW1", "games": [game(4, "16.19")] });
    let mut limited = false;
    for _ in 0..12 {
        if env.post(&other).send().await.unwrap().status().as_u16() == 429 {
            limited = true;
            break;
        }
    }
    assert!(limited, "per install: 10 uploads at once");
}
