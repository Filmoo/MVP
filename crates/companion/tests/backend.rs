//! The backend client against a small fake backend, and loading-screen scouting end to end
//! (fake League client + fake backend). No network.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use companion::Services;
use companion::backend::{ActiveGameAnswer, BackendClient, BackendConfig, INSTALL_HEADER};
use companion::live::LiveConfig;
use domain::{
    BackendError, ChampionInfo, ClientConnection, GameData, LiveGame, LiveNames, RiotId, ScoutCard,
    ScoutRequest, Scouting, Settings,
};
use lcu::ConnectorConfig;
use lcu::tls::pinned_client_config;
use mock_lcu::MockLcu;
use mock_lcu::game::{ALL_GAME_DATA, MockGame, player as game_player};
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
    /// Live game requests as sent: path and query.
    live: Vec<String>,
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

/// Riot's live games as the real backend answers them: game 42 (ranked) is listed with the
/// cards of the players our key knows, game 440 (flex) is "filtered", anything else unknown.
async fn live(
    State(seen): State<Shared>,
    headers: HeaderMap,
    Path((platform, name, tag)): Path<(String, String, String)>,
    uri: Uri,
) -> axum::response::Response {
    record(&seen, &headers, "live".to_owned());
    let game_id = uri
        .query()
        .and_then(|q| q.strip_prefix("gameId="))
        .unwrap_or_default()
        .to_owned();
    seen.lock()
        .unwrap()
        .live
        .push(format!("{platform}/{name}/{tag}?gameId={game_id}"));
    let participant = |team: u32, champion: u32, name: Option<(&str, &str)>, card: bool| {
        json!({
            "teamId": team, "championId": champion, "bot": false, "spells": [4, 14],
            "riotId": name.map(|(n, t)| json!({ "gameName": n, "tagLine": t })),
            "card": name.filter(|_| card).map(|(n, t)| card_json(&format!("api-{}", n.to_lowercase()), n, t)),
        })
    };
    match game_id.as_str() {
        "42" => Json(json!({
            "gameId": 42, "queueId": 420, "cardsComplete": true,
            "participants": [
                participant(100, 54, Some(("Fillmo", "7272")), true),
                participant(100, 64, Some(("Treeline Tom", "EUW")), true),
                // Nobody our key knows: no card.
                participant(100, 103, Some(("Quiet Storm", "0412")), false),
                participant(200, 39, Some(("Blade Dancer", "IRE")), true),
                // Streamer mode: Riot keeps them anonymous.
                participant(200, 234, None, false),
            ]
        }))
        .into_response(),
        "440" => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "filtered", "message": "Riot doesn't share live games of this queue with apps" })),
        )
            .into_response(),
        _ => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "notFound", "message": "not found" })),
        )
            .into_response(),
    }
}

/// Starts the fake backend; answers its base URL.
async fn fake_backend() -> (String, Shared) {
    let seen = Shared::default();
    let app = Router::new()
        .route("/v1/players/batch", post(batch))
        .route("/v1/players/{platform}/{name}/{tag}", get(player))
        .route("/v1/live/{platform}/{name}/{tag}", get(live))
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

#[tokio::test]
async fn asks_for_riots_live_game_with_the_players_own_riot_id_only() {
    let (base, seen) = fake_backend().await;
    let backend = client(&base);
    let me = riot_id("Fillmo", "7272");
    let game = match backend.active_game("euw1", &me, 42).await.unwrap() {
        ActiveGameAnswer::Game(game) => game,
        other => panic!("expected the game, got {other:?}"),
    };
    assert_eq!(game.participants.len(), 5);
    assert!(game.participants[4].hidden());
    assert_eq!(
        backend.active_game("euw1", &me, 440).await.unwrap(),
        ActiveGameAnswer::Filtered
    );
    assert_eq!(
        backend.active_game("euw1", &me, 7).await.unwrap(),
        ActiveGameAnswer::NotListed
    );
    assert_eq!(
        seen.lock().unwrap().live,
        [
            "euw1/Fillmo/7272?gameId=42",
            "euw1/Fillmo/7272?gameId=440",
            "euw1/Fillmo/7272?gameId=7"
        ]
    );
    // A backend without the route (an older server): not listed either.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let old = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, Router::new()).await.unwrap() });
    assert_eq!(
        client(&old).active_game("euw1", &me, 42).await.unwrap(),
        ActiveGameAnswer::NotListed
    );
}

// ── Loading-screen scouting, end to end ────────────────────────────────────────────────────

/// The test games' champions and spells, as Data Dragon names them.
fn game_data() -> GameData {
    let champion = |id, key: &str| ChampionInfo {
        id,
        key: key.to_owned(),
        name: key.to_owned(),
        tags: Vec::new(),
    };
    GameData {
        version: "16.19.1".to_owned(),
        asset_base: String::new(),
        art_base: String::new(),
        champions: vec![
            champion(54, "Malphite"),
            champion(64, "LeeSin"),
            champion(103, "Ahri"),
            champion(39, "Irelia"),
            champion(234, "Viego"),
            champion(22, "Ashe"),
        ],
        items: Vec::new(),
        summoner_spells: Vec::new(),
        runes: Vec::new(),
    }
}

/// `backend`, and the game's own API at `game`: asked every 50 ms, Riot asked again after 50 ms.
fn services(backend: Option<BackendClient>, game: Option<&MockGame>) -> Services {
    Services {
        backend,
        live: LiveConfig {
            game_client: game.map(MockGame::url),
            game_poll: Duration::from_millis(50),
            riot_retry: Duration::from_millis(50),
        },
        game_ids: Arc::new(game_data()),
        ..Services::default()
    }
}

/// A core connected to `mock` (the settings' sender comes back: keep it alive).
async fn start_core(
    mock: &MockLcu,
    services: Services,
) -> (companion::Companion, watch::Sender<Settings>) {
    let (settings, settings_rx) = watch::channel(Settings {
        auto_switch_view: false,
        ..Settings::default()
    });
    let companion = companion::start_with_services(config_for(mock), settings_rx, services);
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
    (companion, settings)
}

async fn live_until(
    companion: &companion::Companion,
    done: impl FnMut(&Option<LiveGame>) -> bool,
) -> LiveGame {
    let mut live = companion.live.clone();
    tokio::time::timeout(Duration::from_secs(5), live.wait_for(done))
        .await
        .unwrap()
        .unwrap()
        .clone()
        .unwrap()
}

/// The local player (`Fillmo#7272`, client PUUID `me`) and their region.
fn local_player(mock: &MockLcu) {
    mock.set(
        companion::profile::CURRENT_SUMMONER,
        json!({ "gameName": "Fillmo", "tagLine": "7272", "puuid": "me" }),
    );
    mock.set(
        companion::profile::REGION,
        json!({ "region": "EUW", "locale": "en_GB" }),
    );
}

/// A game as the client's session shows it today (2026-09): nobody named, client PUUIDs.
fn nameless_game(game_id: u64, queue: u32) -> Value {
    let member = |puuid: &str, champion: u32, position: &str| {
        json!({ "championId": champion, "lastSelectedSkinIndex": 0, "profileIconId": 1, "puuid": puuid,
                "selectedPosition": position, "selectedRole": "", "summonerId": 7,
                "summonerInternalName": "", "summonerName": "", "teamOwner": false, "teamParticipantId": 1 })
    };
    json!({ "phase": "GameStart", "gameData": {
        "gameId": game_id, "queue": { "id": queue, "mapId": 11 },
        "teamOne": [member("me", 54, "TOP"), member("c-a2", 64, "JUNGLE"), member("c-a3", 103, "MIDDLE")],
        "teamTwo": [member("c-e1", 39, "TOP"), member("c-e2", 234, "JUNGLE")],
        "playerChampionSelections": [{ "championId": 54, "puuid": "me", "spell1Id": 4, "spell2Id": 12 }]
    } })
}

/// The same game as the game's own API lists it; `Viego`'s player is in streamer mode.
fn game_players() -> Vec<Value> {
    let spells = ["SummonerFlash", "SummonerTeleport"];
    vec![
        game_player(
            Some("Fillmo#7272"),
            "Malphite",
            "ORDER",
            "TOP",
            spells,
            false,
        ),
        game_player(
            Some("Treeline Tom#EUW"),
            "LeeSin",
            "ORDER",
            "JUNGLE",
            spells,
            false,
        ),
        game_player(
            Some("Quiet Storm#0412"),
            "Ahri",
            "ORDER",
            "MIDDLE",
            spells,
            false,
        ),
        game_player(
            Some("Blade Dancer#IRE"),
            "Irelia",
            "CHAOS",
            "TOP",
            spells,
            false,
        ),
        game_player(None, "Viego", "CHAOS", "JUNGLE", spells, false),
    ]
}

fn named(player: &domain::LivePlayer) -> Option<&str> {
    player.riot_id.as_ref().map(|id| id.game_name.as_str())
}

#[tokio::test]
async fn names_come_from_riots_live_game() {
    let (base, seen) = fake_backend().await;
    let mock = MockLcu::start().await.unwrap();
    let game_api = mock.start_game().await.unwrap();
    local_player(&mock);
    mock.set(companion::live::SESSION, nameless_game(42, 420));
    let (companion, _settings) =
        start_core(&mock, services(Some(client(&base)), Some(&game_api))).await;

    mock.set(lcu::GAMEFLOW_PHASE, json!("GameStart"));
    let game = live_until(&companion, |g| {
        g.as_ref()
            .is_some_and(|g| g.names == LiveNames::Known && g.scouting == Scouting::Done)
    })
    .await;
    let (allies, enemies) = (&game.allies, &game.enemies);
    assert!(allies[0].is_me && named(&allies[0]) == Some("Fillmo"));
    assert_eq!(allies[0].spells, vec![4, 12], "the client's spells");
    assert!(allies[0].card.is_some(), "your own card");
    assert_eq!(named(&allies[1]), Some("Treeline Tom"));
    assert!(allies[1].card.is_some());
    assert_eq!(named(&allies[2]), Some("Quiet Storm"));
    assert!(allies[2].card.is_none(), "unknown to our backend");
    assert_eq!(named(&enemies[0]), Some("Blade Dancer"));
    assert_eq!(
        enemies[0].card.as_ref().map(|c| c.puuid.as_str()),
        Some("api-blade dancer")
    );
    assert!(enemies[1].hidden && enemies[1].riot_id.is_none());
    let seen = seen.lock().unwrap();
    // Only the local player's own Riot ID and the game's id went out; the cards came with the
    // answer, so no batch.
    assert_eq!(seen.live, ["euw1/Fillmo/7272?gameId=42"]);
    assert!(seen.batches.is_empty());
    assert_eq!(game_api.total(), 0, "Riot answered: the game isn't asked");
}

#[tokio::test]
async fn a_filtered_queue_is_named_by_the_game_once_it_has_loaded() {
    let (base, seen) = fake_backend().await;
    let mock = MockLcu::start().await.unwrap();
    let game_api = mock.start_game().await.unwrap();
    local_player(&mock);
    mock.set(companion::live::SESSION, nameless_game(440, 440));
    let (companion, _settings) =
        start_core(&mock, services(Some(client(&base)), Some(&game_api))).await;

    mock.set(lcu::GAMEFLOW_PHASE, json!("GameStart"));
    // Riot doesn't share live flex games: the view says so while the game loads.
    let waiting = live_until(&companion, |g| {
        g.as_ref()
            .is_some_and(|g| g.names == LiveNames::Waiting { filtered: true })
    })
    .await;
    assert_eq!(waiting.scouting, Scouting::Loading);
    assert!(waiting.enemies.iter().all(|p| p.riot_id.is_none()));
    // The game hasn't loaded: its API answers nothing yet, and is asked again.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(game_api.count(ALL_GAME_DATA) >= 2);
    game_api.set_players(&game_players());

    let game = live_until(&companion, |g| {
        g.as_ref()
            .is_some_and(|g| g.names == LiveNames::Known && g.scouting == Scouting::Done)
    })
    .await;
    assert_eq!(named(&game.allies[1]), Some("Treeline Tom"));
    assert_eq!(named(&game.enemies[0]), Some("Blade Dancer"));
    assert!(
        game.enemies[1].hidden,
        "streamer mode: a stand-in name isn't a Riot ID"
    );
    assert!(
        game.allies
            .iter()
            .chain(&game.enemies)
            .filter(|p| !p.hidden)
            .all(|p| p.card.is_some())
    );
    {
        let seen = seen.lock().unwrap();
        assert_eq!(seen.live.len(), 1, "filtered: not asked again");
        assert_eq!(
            seen.batches[0].players,
            vec![
                riot_id("Fillmo", "7272"),
                riot_id("Treeline Tom", "EUW"),
                riot_id("Quiet Storm", "0412"),
                riot_id("Blade Dancer", "IRE"),
            ]
        );
        for private in ["Viego", "\"me\"", "c-a2", "c-e2"] {
            assert!(!seen.bodies[0].contains(private), "{private} sent");
        }
    }
    // The game answered: it's never asked again for this game.
    let asked = game_api.total();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(game_api.total(), asked);
}

#[tokio::test]
async fn without_a_backend_the_game_names_the_players_and_idle_stays_idle() {
    let mock = MockLcu::start().await.unwrap();
    let game_api = mock.start_game().await.unwrap();
    game_api.set_players(&game_players());
    local_player(&mock);
    mock.set(companion::live::SESSION, nameless_game(9, 400));
    let (companion, _settings) = start_core(&mock, services(None, Some(&game_api))).await;

    // Outside a game nobody asks the game's API.
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(game_api.total(), 0);

    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    let game = live_until(&companion, |g| {
        g.as_ref().is_some_and(|g| {
            g.names == LiveNames::Known && matches!(g.scouting, Scouting::Failed { .. })
        })
    })
    .await;
    assert_eq!(named(&game.allies[2]), Some("Quiet Storm"));
    assert!(game.enemies[1].hidden);
    assert!(matches!(
        game.scouting,
        Scouting::Failed {
            error: BackendError::Unavailable { .. }
        }
    ));
    let asked = game_api.total();
    assert!(asked >= 1);
    mock.set(lcu::GAMEFLOW_PHASE, json!("EndOfGame"));
    live_until_gone(&companion).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(game_api.total(), asked, "the game over, nothing asks it");
}

async fn live_until_gone(companion: &companion::Companion) {
    let mut live = companion.live.clone();
    tokio::time::timeout(Duration::from_secs(5), live.wait_for(Option::is_none))
        .await
        .unwrap()
        .unwrap();
}

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

/// A game loading, as older clients named its players: us, a player the backend doesn't know,
/// one without a Riot ID, an enemy and a streamer-mode enemy. PUUIDs are the client's (`c-…`).
/// Riot's live game doesn't list it.
fn loading_game() -> Value {
    json!({ "phase": "GameStart", "gameData": {
        "gameId": 41, "queue": { "id": 420 },
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
    let (companion, _settings) = start_core(&mock, services(Some(client(&base)), None)).await;
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

    // Riot's live game was asked twice (it may list a game a moment late), with our own Riot
    // ID only.
    assert_eq!(
        seen.lock().unwrap().live,
        ["euw1/Fillmo/7272?gameId=41", "euw1/Fillmo/7272?gameId=41"]
    );

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
    let failed = |g: &Option<LiveGame>| {
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
