//! The backend client against a small fake backend, and loading-screen scouting end to end
//! (fake League client + fake backend). No network.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use companion::backend::{BackendClient, BackendConfig, INSTALL_HEADER};
use domain::{BackendError, ClientConnection, RiotId, ScoutCard, ScoutRequest, Scouting, Settings};
use lcu::ConnectorConfig;
use lcu::tls::pinned_client_config;
use mock_lcu::MockLcu;
use serde_json::{Value, json};
use tokio::sync::watch;

const INSTALL: &str = "0123456789abcdef0123456789abcdef";

#[derive(Default)]
struct Seen {
    installs: Vec<Option<String>>,
    paths: Vec<String>,
    batches: Vec<ScoutRequest>,
    /// Scouting request bodies as sent.
    bodies: Vec<String>,
}

type Shared = Arc<Mutex<Seen>>;

fn record(seen: &Shared, headers: &HeaderMap, path: String) {
    let mut seen = seen.lock().unwrap();
    seen.installs.push(
        headers
            .get(INSTALL_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned),
    );
    seen.paths.push(path);
}

fn profile_json(name: &str, tag: &str) -> Value {
    json!({
        "riotId": { "gameName": name, "tagLine": tag },
        "region": "EUW", "level": 100, "profileIconId": 1,
        "soloQueue": null, "recentMatches": []
    })
}

fn card_json(puuid: &str, name: &str, tag: &str) -> Value {
    json!({
        "puuid": puuid, "riotId": { "gameName": name, "tagLine": tag },
        "soloQueue": { "tier": "emerald", "division": "II", "leaguePoints": 40, "wins": 60, "losses": 50 },
        "gamesSampled": 20, "topChampions": [], "recentResults": [true, true, false],
        "mainRoles": ["jungle"], "tags": [{ "kind": "mainRole", "role": "jungle" }]
    })
}

async fn player(
    State(seen): State<Shared>,
    headers: HeaderMap,
    Path((platform, name, tag)): Path<(String, String, String)>,
) -> axum::response::Response {
    record(&seen, &headers, format!("{platform}/{name}/{tag}"));
    match name.as_str() {
        "Nobody" => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "notFound", "message": "no such Riot ID" })),
        )
            .into_response(),
        "Busy" => (
            StatusCode::TOO_MANY_REQUESTS,
            [("retry-after", "9")],
            Json(json!({ "error": "rateLimited", "message": "slow down", "retryAfter": 12 })),
        )
            .into_response(),
        "Keyless" => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "riotKeyMissing", "message": "the server has no Riot API key" })),
        )
            .into_response(),
        "Proxy" => (StatusCode::BAD_GATEWAY, "<html>bad gateway</html>").into_response(),
        "Slow" => {
            tokio::time::sleep(Duration::from_secs(3)).await;
            Json(profile_json(&name, &tag)).into_response()
        }
        _ => Json(profile_json(&name, &tag)).into_response(),
    }
}

/// Answers like the real backend: cards carry the account's own spelling of the Riot ID (here
/// upper case) and our API key's PUUIDs; nobody is called "Ghost".
async fn batch(State(seen): State<Shared>, headers: HeaderMap, body: String) -> impl IntoResponse {
    record(&seen, &headers, "batch".to_owned());
    let request: ScoutRequest = serde_json::from_str(&body).unwrap();
    let cards: Vec<Value> = request
        .players
        .iter()
        .filter(|p| p.game_name != "Ghost")
        .map(|p| {
            card_json(
                &format!("api-{}", p.game_name.to_lowercase()),
                &p.game_name.to_uppercase(),
                &p.tag_line.to_uppercase(),
            )
        })
        .collect();
    let mut seen = seen.lock().unwrap();
    seen.bodies.push(body);
    seen.batches.push(request);
    Json(cards)
}

/// Starts the fake backend; answers its base URL.
async fn fake_backend() -> (String, Shared) {
    let seen = Shared::default();
    let app = Router::new()
        .route("/v1/players/batch", post(batch))
        .route("/v1/players/{platform}/{name}/{tag}", get(player))
        .with_state(Arc::clone(&seen));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, seen)
}

fn client(base: &str) -> BackendClient {
    let mut config = BackendConfig::new(base, INSTALL);
    config.timeout = Duration::from_millis(500);
    BackendClient::new(&config).unwrap()
}

fn riot_id(name: &str, tag: &str) -> RiotId {
    RiotId {
        game_name: name.to_owned(),
        tag_line: tag.to_owned(),
    }
}

#[tokio::test]
async fn looks_players_up_with_the_install_id() {
    let (base, seen) = fake_backend().await;
    let backend = client(&base);
    let profile = backend
        .player("euw1", &riot_id("Hide on bush", "KR1"))
        .await
        .unwrap();
    assert_eq!(profile.riot_id.game_name, "Hide on bush");
    let seen = seen.lock().unwrap();
    assert_eq!(seen.paths, vec!["euw1/Hide on bush/KR1"]);
    assert_eq!(seen.installs, vec![Some(INSTALL.to_owned())]);
}

#[tokio::test]
async fn maps_every_failure() {
    let (base, _) = fake_backend().await;
    let backend = client(&base);
    let lookup = |name: &'static str| {
        let backend = backend.clone();
        async move { backend.player("euw1", &riot_id(name, "EUW")).await }
    };
    assert_eq!(lookup("Nobody").await.unwrap_err(), BackendError::NotFound);
    assert_eq!(
        lookup("Busy").await.unwrap_err(),
        BackendError::RateLimited {
            retry_after: Some(12)
        }
    );
    assert!(matches!(
        lookup("Keyless").await.unwrap_err(),
        BackendError::Unavailable { message } if message.contains("Riot API key")
    ));
    assert_eq!(
        lookup("Proxy").await.unwrap_err(),
        BackendError::Unavailable {
            message: "HTTP 502".into()
        }
    );
    assert!(matches!(
        lookup("Slow").await.unwrap_err(),
        BackendError::Network { message } if message.contains("timed out")
    ));
}

#[tokio::test]
async fn unreachable_backend_is_a_network_error() {
    // Bind then drop: nothing listens on that port any more.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let error = client(&base)
        .player("euw1", &riot_id("Fillmo", "7272"))
        .await
        .unwrap_err();
    assert!(matches!(error, BackendError::Network { .. }), "{error:?}");
}

#[tokio::test]
async fn scouts_a_batch_by_riot_id() {
    let (base, seen) = fake_backend().await;
    let cards: Vec<ScoutCard> = client(&base)
        .scout(
            "euw1",
            &[riot_id("Blade Dancer", "IRE"), riot_id("Ghost", "000")],
        )
        .await
        .unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].puuid, "api-blade dancer");
    let seen = seen.lock().unwrap();
    assert_eq!(seen.batches[0].platform, "euw1");
    assert_eq!(
        seen.batches[0].players,
        vec![riot_id("Blade Dancer", "IRE"), riot_id("Ghost", "000")]
    );
    assert!(seen.batches[0].puuids.is_empty(), "no PUUID leaves the app");
}

// ── Loading-screen scouting, end to end ────────────────────────────────────────────────────

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

/// A game loading: us, a player the backend doesn't know, one without a Riot ID, an enemy and
/// a streamer-mode enemy. PUUIDs are the client's (`c-…`).
fn loading_game() -> Value {
    json!({ "phase": "GameStart", "gameData": {
        "gameId": 42, "queue": { "id": 420 },
        "teamOne": [
            { "championId": 54, "puuid": "me", "gameName": "Fillmo", "tagLine": "7272", "selectedPosition": "TOP" },
            { "championId": 64, "puuid": "c-ghost", "gameName": "Ghost", "tagLine": "000", "selectedPosition": "JUNGLE" },
            { "championId": 99, "puuid": "c-nameless", "selectedPosition": "MIDDLE" }
        ],
        "teamTwo": [
            { "championId": 39, "puuid": "c-enemy", "gameName": "Enemy", "tagLine": "euw", "selectedPosition": "TOP" },
            { "championId": 234, "puuid": "secret", "gameName": "Streamer", "tagLine": "X", "nameVisibilityType": "HIDDEN" }
        ],
        "playerChampionSelections": [{ "championId": 54, "puuid": "me", "spell1Id": 4, "spell2Id": 12 }]
    } })
}

#[tokio::test]
async fn scouts_the_game_once_it_loads() {
    let (base, seen) = fake_backend().await;
    let mock = MockLcu::start().await.unwrap();
    mock.set(
        companion::profile::CURRENT_SUMMONER,
        json!({ "gameName": "Fillmo", "tagLine": "7272", "puuid": "me" }),
    );
    mock.set(
        companion::profile::REGION,
        json!({ "region": "EUW", "locale": "en_GB" }),
    );
    mock.set(companion::live::SESSION, loading_game());
    let (_settings, settings_rx) = watch::channel(Settings {
        auto_switch_view: false,
        ..Settings::default()
    });
    let companion = companion::start_with(config_for(&mock), settings_rx, Some(client(&base)));
    let mut status = companion.status.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        status.wait_for(|s| s.connection == ClientConnection::Connected),
    )
    .await
    .unwrap()
    .unwrap();
    // Let the mock register the event subscriptions.
    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut live = companion.live.clone();
    assert!(live.borrow().is_none(), "nothing before the game");

    mock.set(lcu::GAMEFLOW_PHASE, json!("GameStart"));
    let game = tokio::time::timeout(
        Duration::from_secs(5),
        live.wait_for(|g| g.as_ref().is_some_and(|g| g.scouting == Scouting::Done)),
    )
    .await
    .unwrap()
    .unwrap()
    .clone()
    .unwrap();
    assert_eq!(game.platform, "euw1");
    assert!(game.allies[0].is_me);
    assert_eq!(game.allies[0].spells, vec![4, 12]);
    assert!(game.allies[0].card.is_some());
    assert!(game.allies[1].card.is_none(), "unknown to the backend");
    assert!(game.allies[2].card.is_none(), "no Riot ID: not looked up");
    let enemy = &game.enemies[0];
    assert_eq!(
        enemy.card.as_ref().map(|c| c.puuid.as_str()),
        Some("api-enemy"),
        "matched back by Riot ID, whatever its case"
    );
    assert_eq!(
        enemy.riot_id,
        Some(riot_id("Enemy", "euw")),
        "the name the game shows"
    );
    assert!(game.enemies[1].hidden && game.enemies[1].card.is_none());
    {
        let seen = seen.lock().unwrap();
        assert_eq!(seen.batches.len(), 1);
        assert_eq!(
            seen.batches[0].players,
            vec![
                riot_id("Fillmo", "7272"),
                riot_id("Ghost", "000"),
                riot_id("Enemy", "euw")
            ]
        );
        // Streamer mode: neither the name nor the PUUID is ever sent. No client PUUID is.
        let body = &seen.bodies[0];
        for private in [
            "Streamer",
            "secret",
            "\"me\"",
            "c-ghost",
            "c-nameless",
            "c-enemy",
        ] {
            assert!(!body.contains(private), "{private} sent in {body}");
        }
    }

    // Loading → in game: same game, no second lookup. The game ends: the view goes away.
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(seen.lock().unwrap().batches.len(), 1);
    mock.set(lcu::GAMEFLOW_PHASE, json!("EndOfGame"));
    tokio::time::timeout(Duration::from_secs(5), live.wait_for(Option::is_none))
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn scouting_failures_can_be_retried() {
    let mock = MockLcu::start().await.unwrap();
    mock.set(
        companion::live::SESSION,
        json!({ "gameData": { "gameId": 7, "queue": { "id": 440 },
            "teamOne": [{ "championId": 54, "puuid": "a", "gameName": "Ally", "tagLine": "EUW" }],
            "teamTwo": [{ "championId": 39, "puuid": "b", "gameName": "Enemy", "tagLine": "EUW" }] } }),
    );
    // A backend nobody listens on.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let dead = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let (_settings, settings_rx) = watch::channel(Settings::default());
    let companion = companion::start_with(config_for(&mock), settings_rx, Some(client(&dead)));
    let mut live = companion.live.clone();
    let mut status = companion.status.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        status.wait_for(|s| s.connection == ClientConnection::Connected),
    )
    .await
    .unwrap()
    .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    let failed = |g: &Option<domain::LiveGame>| {
        g.as_ref().is_some_and(|g| {
            matches!(
                g.scouting,
                Scouting::Failed {
                    error: BackendError::Network { .. }
                }
            )
        })
    };
    tokio::time::timeout(Duration::from_secs(5), live.wait_for(failed))
        .await
        .unwrap()
        .unwrap();
    live.mark_unchanged();
    companion.scouting.retry();
    // Asked again: loading, then failed again (the backend is still down).
    tokio::time::timeout(Duration::from_secs(5), live.changed())
        .await
        .unwrap()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), live.wait_for(failed))
        .await
        .unwrap()
        .unwrap();
}
