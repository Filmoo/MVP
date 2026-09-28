//! Match insights against the fake League client and a fake backend: your games are read whole
//! from the client once (never again), anyone else's come from the backend. No network.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::{Arc, Mutex};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use companion::backend::{BackendClient, BackendConfig};
use companion::matches::MatchInsights;
use domain::{BackendError, GradeBadge};
use lcu::LcuClient;
use lcu::tls::pinned_client_config;
use mock_lcu::MockLcu;
use mock_lcu::history::{self, Game, Local};
use serde_json::{Value, json};

fn local() -> Local {
    Local {
        puuid: "local-puuid".into(),
        game_name: "Fillmo".into(),
        tag_line: "7272".into(),
        summoner_id: 2_345_678,
    }
}

fn game(game_id: u64, duration: u32, champion: u32, lane: &'static str, win: bool) -> Game {
    Game {
        game_id,
        queue_id: 420,
        map_id: 11,
        created: 1_790_500_000_000 - i64::try_from(game_id % 10).unwrap() * 3_600_000,
        duration,
        champion,
        lane,
        spells: [14, 4],
        win,
    }
}

/// Four games, newest first; the third is a remake.
fn games() -> Vec<Game> {
    vec![
        game(7_000_000_004, 1742, 103, "MIDDLE", true),
        game(7_000_000_003, 1935, 134, "MIDDLE", false),
        game(7_000_000_002, 212, 134, "MIDDLE", false),
        game(7_000_000_001, 1810, 54, "TOP", true),
    ]
}

async fn client_with_history() -> (MockLcu, LcuClient) {
    let mock = MockLcu::start().await.unwrap();
    let me = local();
    mock.set(
        companion::profile::CURRENT_SUMMONER,
        json!({ "gameName": me.game_name, "tagLine": me.tag_line, "puuid": me.puuid,
                "summonerId": me.summoner_id, "summonerLevel": 347, "profileIconId": 6311 }),
    );
    mock.set(
        companion::profile::REGION,
        json!({ "region": "EUW", "locale": "en_GB" }),
    );
    history::serve(&mock, &me, &games());
    let creds = lcu::Lockfile::parse(&mock.lockfile())
        .unwrap()
        .credentials();
    let client = LcuClient::new(
        &creds,
        pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap();
    (mock, client)
}

fn reads(mock: &MockLcu) -> usize {
    mock.requests()
        .iter()
        .filter(|(method, path)| {
            method == "GET" && path.starts_with("/lol-match-history/v1/games/")
        })
        .count()
}

#[tokio::test]
async fn your_games_are_read_whole_once() {
    let (mock, client) = client_with_history().await;
    let insights = MatchInsights::default();

    // The list answers at once, without grades: it holds your side of each game only.
    let profile = insights.profile(&client).await.unwrap();
    let ids: Vec<String> = profile
        .recent_matches
        .iter()
        .map(|m| m.match_id.clone())
        .collect();
    assert_eq!(ids[0], "EUW1_7000000004");
    assert!(profile.recent_matches.iter().all(|m| m.grade.is_none()));
    assert_eq!(reads(&mock), 0);

    // Grades read each game once, the remake not at all.
    let graded = insights.grades(&client, &ids).await;
    assert_eq!(graded.len(), 4);
    assert!(graded[0].grade.is_some() && graded[1].grade.is_some() && graded[3].grade.is_some());
    assert!(graded[2].grade.is_none(), "a remake has no grade");
    assert_eq!(reads(&mock), 3);
    assert_eq!(
        mock.count("GET", &history::game_path(7_000_000_002)),
        0,
        "the remake isn't read"
    );

    // From now on the profile carries them, and nothing is read again.
    let again = insights.profile(&client).await.unwrap();
    for (row, graded) in again.recent_matches.iter().zip(&graded) {
        assert_eq!(row.grade, graded.grade, "{}", row.match_id);
    }
    insights.grades(&client, &ids).await;
    let details = insights
        .details(Some(&client), None, "EUW1_7000000004")
        .await
        .unwrap();
    assert_eq!(reads(&mock), 3, "finished games never change");

    // The details mark your row, with the grade the list shows.
    let mine: Vec<_> = details
        .teams
        .iter()
        .flat_map(|t| &t.players)
        .filter(|p| p.is_me)
        .collect();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].grade, graded[0].grade);
    assert_eq!(
        mine[0].riot_id.as_ref().map(|id| id.game_name.as_str()),
        Some("Fillmo")
    );

    // A game that isn't one of yours is never asked of the client.
    let theirs = insights
        .details(Some(&client), None, "EUW1_5555")
        .await
        .unwrap_err();
    assert!(
        matches!(theirs, BackendError::Unavailable { .. }),
        "{theirs:?}"
    );
    assert_eq!(mock.count("GET", &history::game_path(5555)), 0);
    let none = insights.grades(&client, &["EUW1_5555".to_owned()]).await;
    assert!(none[0].grade.is_none());
    assert_eq!(reads(&mock), 3);
}

#[tokio::test]
async fn a_game_the_client_lost_is_retried_later() {
    let (mock, client) = client_with_history().await;
    mock.remove(&history::game_path(7_000_000_004));
    let insights = MatchInsights::default();
    let profile = insights.profile(&client).await.unwrap();
    let ids: Vec<String> = profile
        .recent_matches
        .iter()
        .map(|m| m.match_id.clone())
        .collect();
    let graded = insights.grades(&client, &ids).await;
    assert!(
        graded[0].grade.is_none(),
        "not served: no grade, no failure"
    );
    let missing = insights
        .details(Some(&client), None, "EUW1_7000000004")
        .await
        .unwrap_err();
    assert_eq!(missing, BackendError::NotFound);

    // Failures aren't kept: once the client has it, it's read.
    mock.set(
        &history::game_path(7_000_000_004),
        games()[0].document(&local()),
    );
    let graded = insights.grades(&client, &ids[..1]).await;
    assert!(graded[0].grade.is_some());
}

// ---- Other players' games: our backend --------------------------------------------------------

type Seen = Arc<Mutex<Vec<String>>>;

async fn matches_route(
    State(seen): State<Seen>,
    Path((platform, id)): Path<(String, String)>,
) -> axum::response::Response {
    seen.lock().unwrap().push(format!("{platform}/{id}"));
    if id == "NA1_404" {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "notFound", "message": "no such game" })),
        )
            .into_response();
    }
    // A game answered by the backend: the whole game with every player's grade.
    let player = |name: &str, win: bool| {
        json!({ "riotId": { "gameName": name, "tagLine": "NA1" }, "hidden": false, "isMe": false,
                "championId": 103, "championLevel": 16, "role": "middle", "kills": 5, "deaths": 3,
                "assists": 7, "creepScore": 200, "gold": 12_000, "damageToChampions": 20_000,
                "visionScore": 20, "items": [3020], "trinket": 3340, "spells": [4, 14],
                "keystone": 8112, "secondaryTree": 8200,
                "grade": { "score": 7.1, "letter": "A", "place": 2, "badge": if win { Value::Null } else { json!("ace") }, "factors": [] } })
    };
    Json(json!({
        "matchId": id, "queueId": 420, "durationSeconds": 1800, "endedAt": 1_790_000_000_000_i64,
        "teams": [
            { "teamId": 100, "win": true, "players": [player("Blue", true)] },
            { "teamId": 200, "win": false, "players": [player("Red", false)] }
        ]
    }))
    .into_response()
}

async fn fake_backend() -> (BackendClient, Seen) {
    let seen = Seen::default();
    let router = Router::new()
        .route("/v1/matches/{platform}/{id}", get(matches_route))
        .with_state(Arc::clone(&seen));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = BackendClient::new(&BackendConfig::new(
        base,
        "0123456789abcdef0123456789abcdef",
    ))
    .unwrap();
    (client, seen)
}

#[tokio::test]
async fn other_players_games_come_from_the_backend_once() {
    let (mock, lcu) = client_with_history().await;
    let (backend, seen) = fake_backend().await;
    let insights = MatchInsights::default();
    insights.profile(&lcu).await.unwrap();

    let details = insights
        .details(Some(&lcu), Some(&backend), "NA1_123")
        .await
        .unwrap();
    assert_eq!(
        details.teams[1].players[0]
            .grade
            .as_ref()
            .and_then(|g| g.badge),
        Some(GradeBadge::Ace)
    );
    insights
        .details(Some(&lcu), Some(&backend), "NA1_123")
        .await
        .unwrap();
    assert_eq!(
        *seen.lock().unwrap(),
        vec!["na1/NA1_123".to_owned()],
        "asked once, lower-case platform"
    );
    assert_eq!(reads(&mock), 0, "never the League client");

    let missing = insights
        .details(Some(&lcu), Some(&backend), "NA1_404")
        .await
        .unwrap_err();
    assert_eq!(missing, BackendError::NotFound);

    // Your own game the client can't give anymore: the backend has it too.
    mock.remove(&history::game_path(7_000_000_001));
    let fallback = insights
        .details(Some(&lcu), Some(&backend), "EUW1_7000000001")
        .await
        .unwrap();
    assert_eq!(fallback.match_id, "EUW1_7000000001");
    assert!(
        seen.lock()
            .unwrap()
            .contains(&"euw1/EUW1_7000000001".to_owned())
    );
}
