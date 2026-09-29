//! The client against a local fake Riot API.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use riot_api::{ApiKey, Config, Platform, RiotClient, RiotError};

static BASE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

#[derive(Default)]
struct Calls(AtomicUsize);

async fn account(State(calls): State<Arc<Calls>>, headers: HeaderMap) -> impl IntoResponse {
    let n = calls.0.fetch_add(1, Ordering::SeqCst);
    let limits = [
        ("x-app-rate-limit", "20:1,100:120"),
        ("x-app-rate-limit-count", "1:1,1:120"),
    ];
    if headers.get("x-riot-token").and_then(|v| v.to_str().ok()) != Some("RGAPI-test") {
        return (StatusCode::FORBIDDEN, limits, String::new());
    }
    if n == 0 {
        // First call is throttled: the client must wait and retry.
        return (StatusCode::TOO_MANY_REQUESTS, limits, String::new());
    }
    (
        StatusCode::OK,
        limits,
        r#"{"puuid":"p-1","gameName":"Nightfall","tagLine":"EUW","extra":"ignored"}"#.to_owned(),
    )
}

/// Spectator-V5 as Riot answers it: a game with an anonymous player and a bot, "filtered" for
/// a flex game, a plain 404 when not in game.
async fn spectator(axum::extract::Path(puuid): axum::extract::Path<String>) -> impl IntoResponse {
    let not_found = |message: &str| {
        (
            StatusCode::NOT_FOUND,
            format!(r#"{{"status":{{"message":"{message}","status_code":404}}}}"#),
        )
    };
    match puuid.as_str() {
        "p-flex" => not_found("Data not found - filtered"),
        "p-idle" => not_found("Data not found - spectator game info isn't found"),
        _ => (
            StatusCode::OK,
            r#"{"gameId":7100000042,"gameQueueConfigId":420,"gameMode":"CLASSIC","participants":[
                {"puuid":"p-1","riotId":"Nightfall#EUW","teamId":100,"championId":103,"spell1Id":4,"spell2Id":14,"bot":false,"perks":{}},
                {"puuid":null,"teamId":200,"championId":64,"spell1Id":11,"spell2Id":4,"bot":false},
                {"teamId":200,"championId":1,"bot":true}
            ]}"#
            .to_owned(),
        ),
    }
}

async fn start() -> Arc<Calls> {
    let calls = Arc::new(Calls::default());
    let app = Router::new()
        .route(
            "/riot/account/v1/accounts/by-riot-id/{name}/{tag}",
            axum::routing::get(account),
        )
        .route(
            "/lol/summoner/v4/summoners/by-puuid/{puuid}",
            axum::routing::get(|| async { StatusCode::NOT_FOUND }),
        )
        .route(
            "/lol/spectator/v5/active-games/by-summoner/{puuid}",
            axum::routing::get(spectator),
        )
        .with_state(Arc::clone(&calls));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let _ = BASE.set(format!("http://{}", listener.local_addr().unwrap()));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    calls
}

fn client(key: &str) -> RiotClient {
    RiotClient::new(
        ApiKey::new(key),
        Config {
            base_url: |_| BASE.get().cloned().unwrap_or_default(),
            ..Config::default()
        },
    )
    .unwrap()
}

#[tokio::test]
async fn end_to_end_behaviour() {
    let calls = start().await;

    // 429 then success: one retry after Retry-After (defaults to 1 s without the header).
    let started = std::time::Instant::now();
    let account = client("RGAPI-test")
        .account_by_riot_id(Platform::Euw1, "Nightfall", "EUW")
        .await
        .unwrap();
    assert_eq!(account.puuid, "p-1");
    assert_eq!(account.game_name.as_deref(), Some("Nightfall"));
    assert_eq!(calls.0.load(Ordering::SeqCst), 2);
    assert!(started.elapsed() >= std::time::Duration::from_millis(900));

    // 404 and 403 map to typed errors.
    let missing = client("RGAPI-test")
        .summoner_by_puuid(Platform::Euw1, "nobody")
        .await
        .unwrap_err();
    assert!(matches!(missing, RiotError::NotFound));
    let forbidden = client("wrong")
        .account_by_riot_id(Platform::Euw1, "a", "b")
        .await
        .unwrap_err();
    assert!(matches!(forbidden, RiotError::Forbidden(403)));

    // Spectator-V5: a live game with an anonymous player and a bot; "filtered" is not "not
    // found".
    let spectate = |puuid: &'static str| async move {
        client("RGAPI-test")
            .current_game(Platform::Euw1, puuid)
            .await
    };
    let game = spectate("p-1").await.unwrap();
    assert_eq!(
        (game.game_id, game.game_queue_config_id),
        (7_100_000_042, 420)
    );
    assert_eq!(game.participants.len(), 3);
    assert_eq!(
        game.participants[0].riot_id.as_deref(),
        Some("Nightfall#EUW")
    );
    assert_eq!(game.participants[0].spell2_id, 14);
    assert_eq!(game.participants[1].puuid, None, "anonymous");
    assert!(game.participants[2].bot && game.participants[2].puuid.is_none());
    assert!(matches!(
        spectate("p-flex").await.unwrap_err(),
        RiotError::Filtered
    ));
    assert!(matches!(
        spectate("p-idle").await.unwrap_err(),
        RiotError::NotFound
    ));

    // The key never shows up in debug output.
    assert!(!format!("{:?}", ApiKey::new("RGAPI-secret")).contains("secret"));
}
