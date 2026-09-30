//! ARAM: Mayhem against the fake League client and a fake backend: opted-in sharing sends each
//! Mayhem game once (never while off), reads the whole history once when turned on (never while
//! a game is being played), and the Mayhem data answers from its cache offline. No network.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use companion::backend::{BackendClient, BackendConfig};
use companion::mayhem::{self, MayhemClient, Sharing};
use domain::{
    AugmentRarity, ClientConnection, ClientStatus, GameflowPhase, Language, MayhemUpload,
    RemoteConfig, Settings,
};
use lcu::LcuClient;
use lcu::tls::pinned_client_config;
use mock_lcu::MockLcu;
use mock_lcu::history::{self, Game, Local};
use serde_json::{Value, json};
use tokio::sync::watch;

fn local() -> Local {
    Local {
        puuid: "local-puuid".into(),
        game_name: "Fillmo".into(),
        tag_line: "7272".into(),
        summoner_id: 2_345_678,
    }
}

fn game(game_id: u64, queue_id: u32, map_id: u32) -> Game {
    Game {
        game_id,
        queue_id,
        map_id,
        created: 1_790_500_000_000,
        duration: 1_200,
        champion: 222,
        lane: "BOTTOM",
        spells: [4, 32],
        win: true,
    }
}

async fn client(games: &[Game]) -> (MockLcu, LcuClient) {
    let mock = MockLcu::start().await.unwrap();
    mock.set(
        companion::profile::REGION,
        json!({ "region": "EUW", "locale": "en_GB" }),
    );
    history::serve(&mock, &local(), games);
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

#[derive(Default)]
struct Backend {
    uploads: Mutex<Vec<(Value, Option<String>)>>,
    down: AtomicBool,
}

fn file(body: &Value, etag: &str, headers: &HeaderMap) -> axum::response::Response {
    if headers.get("if-none-match").and_then(|v| v.to_str().ok()) == Some(etag) {
        return (StatusCode::NOT_MODIFIED, [("etag", etag.to_owned())]).into_response();
    }
    ([("etag", etag.to_owned())], Json(body.clone())).into_response()
}

async fn fake_backend() -> (BackendClient, Arc<Backend>) {
    let state = Arc::new(Backend::default());
    let augments = json!({ "version": "16.19.1+test", "patch": "16.19", "builtAt": 1, "augments": [
        { "id": 2137, "rarity": "gold", "icon": "assets/ux/kiwi/augments/icons/a_small.png",
          "name": { "en": "Glass Test", "fr": "Verre test" }, "description": { "en": "Made up.", "fr": "Inventé." } },
        { "id": 1028, "rarity": "silver", "icon": "assets/ux/kiwi/augments/icons/b_small.png",
          "name": { "en": "Spark Test", "fr": "" }, "description": { "en": "", "fr": "" } }
    ] });
    let tiers = json!({ "tiers": { "S": [2137], "A": [1028] } });
    let app = Router::new()
        .route(
            "/v1/mayhem/games",
            post(
                |State(s): State<Arc<Backend>>, headers: HeaderMap, Json(body): Json<Value>| async move {
                    let install = headers
                        .get("x-mvp-install")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_owned);
                    let games = body["games"].as_array().map_or(0, Vec::len);
                    s.uploads.lock().unwrap().push((body, install));
                    Json(json!({ "accepted": games, "duplicates": 0 }))
                },
            ),
        )
        .route(
            "/v1/mayhem/augments",
            get(move |State(s): State<Arc<Backend>>, headers: HeaderMap| {
                let augments = augments.clone();
                async move {
                    if s.down.load(Ordering::SeqCst) {
                        return StatusCode::SERVICE_UNAVAILABLE.into_response();
                    }
                    file(&augments, "\"a1\"", &headers)
                }
            }),
        )
        .route(
            "/v1/mayhem/tiers",
            get(move |State(s): State<Arc<Backend>>, headers: HeaderMap| {
                let tiers = tiers.clone();
                async move {
                    if s.down.load(Ordering::SeqCst) {
                        return StatusCode::SERVICE_UNAVAILABLE.into_response();
                    }
                    file(&tiers, "\"t1\"", &headers)
                }
            }),
        )
        .route(
            "/v1/mayhem/stats",
            get(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "notFound", "message": "not found" }))) }),
        )
        .with_state(Arc::clone(&state));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let backend = BackendClient::new(&BackendConfig::new(base, "a".repeat(32))).unwrap();
    (backend, state)
}

async fn eventually(what: &str, done: impl Fn() -> bool) {
    for _ in 0..100 {
        if done() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for {what}");
}

fn uploads(state: &Backend) -> Vec<MayhemUpload> {
    state
        .uploads
        .lock()
        .unwrap()
        .iter()
        .map(|(body, _)| serde_json::from_value(body.clone()).unwrap())
        .collect()
}

/// Channels the sharing task follows, in `phase`.
struct Follow {
    settings: watch::Sender<Settings>,
    status: watch::Sender<ClientStatus>,
    remote: watch::Sender<RemoteConfig>,
    task: tokio::task::JoinHandle<()>,
}

fn follow(
    lcu: LcuClient,
    backend: BackendClient,
    data: MayhemClient,
    phase: GameflowPhase,
) -> Follow {
    let (settings_tx, settings) = watch::channel(Settings::default());
    let (status_tx, status) = watch::channel(ClientStatus {
        connection: ClientConnection::Connected,
        phase,
    });
    let (remote_tx, remote) = watch::channel(RemoteConfig::default());
    let task = tokio::spawn(mayhem::share(Sharing {
        client: watch::channel(Some(lcu)).1,
        status,
        settings,
        remote,
        backend,
        mayhem: data,
        after_game: Duration::from_millis(50),
        spacing: Duration::from_millis(1),
    }));
    Follow {
        settings: settings_tx,
        status: status_tx,
        remote: remote_tx,
        task,
    }
}

#[tokio::test]
async fn opted_in_players_share_each_mayhem_game_once() {
    let games = [
        game(7_000_000_010, history::MAYHEM_QUEUE, 12),
        game(7_000_000_009, 420, 11),
        game(7_000_000_008, 450, 12),
    ];
    let (mock, lcu) = client(&games).await;
    let (backend, state) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let data = MayhemClient::new(backend.clone(), dir.path());
    let Follow {
        settings: settings_tx,
        status: status_tx,
        remote: remote_tx,
        task,
    } = follow(lcu, backend, data, GameflowPhase::InGame);

    // Not answered yet (off): a game ends, nothing is read or sent.
    status_tx.send_modify(|s| s.phase = GameflowPhase::PostGame);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(uploads(&state).is_empty());
    assert_eq!(
        mock.count("GET", history::LIST),
        0,
        "the history isn't even read"
    );
    // "Not now": the same.
    settings_tx.send_modify(|s| s.share_mayhem_games = Some(false));
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(mock.count("GET", history::LIST), 0);

    // Turned on: the Mayhem game goes at once, and only it.
    settings_tx.send_modify(|s| s.share_mayhem_games = Some(true));
    eventually("the backfill", || uploads(&state).len() == 1).await;
    let first = &uploads(&state)[0];
    assert_eq!(first.platform, "EUW1");
    assert_eq!(first.games.len(), 1);
    let shared = &first.games[0];
    assert_eq!(shared.game, mayhem::game_key("EUW1", 7_000_000_010));
    assert_eq!(shared.patch, "16.19");
    assert_eq!(shared.players.len(), 10);
    assert!(shared.players.iter().all(|p| p.augments.len() == 4));
    let body = state.uploads.lock().unwrap()[0].0.to_string();
    for leak in ["Fillmo", "local-puuid", "2345678", "win", "7000000010"] {
        assert!(!body.contains(leak), "{leak} in {body}");
    }
    assert_eq!(
        state.uploads.lock().unwrap()[0].1.as_deref(),
        Some("a".repeat(32).as_str()),
        "rate limited per install"
    );

    // Another game ends: the history is read again, the shared game isn't sent again.
    status_tx.send_modify(|s| s.phase = GameflowPhase::Lobby);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(uploads(&state).len(), 1);

    // A new Mayhem game: sent when its end-of-game screen shows.
    let mut newer = games.to_vec();
    newer.insert(0, game(7_000_000_011, history::MAYHEM_QUEUE, 12));
    history::serve(&mock, &local(), &newer);
    status_tx.send_modify(|s| s.phase = GameflowPhase::PostGame);
    eventually("the new game", || uploads(&state).len() == 2).await;
    let second = &uploads(&state)[1];
    assert_eq!(second.games.len(), 1);
    assert_eq!(
        second.games[0].game,
        mayhem::game_key("EUW1", 7_000_000_011)
    );

    // The server's flag off: nothing, whatever the setting.
    remote_tx.send_modify(|r| r.features.mayhem_sharing = false);
    newer.insert(0, game(7_000_000_012, history::MAYHEM_QUEUE, 12));
    history::serve(&mock, &local(), &newer);
    status_tx.send_modify(|s| s.phase = GameflowPhase::Lobby);
    status_tx.send_modify(|s| s.phase = GameflowPhase::PostGame);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(uploads(&state).len(), 2);
    task.abort();

    // The record lasts: a new start doesn't send the shared games again.
    let record = std::fs::read_to_string(dir.path().join("shared.json")).unwrap();
    assert!(record.contains(&mayhem::game_key("EUW1", 7_000_000_010)));
}

/// 47 games, newest first: every third one Mayhem (a custom one among them, and a remake), the
/// last page short.
fn long_history() -> Vec<Game> {
    (0..47_u64)
        .map(|i| {
            let id = 7_000_001_000 - i;
            match i {
                1 => game(id, history::MAYHEM_CUSTOM_QUEUE, 12),
                4 => Game {
                    duration: 200,
                    ..game(id, history::MAYHEM_QUEUE, 12)
                },
                _ if i % 3 == 0 => game(id, history::MAYHEM_QUEUE, 12),
                _ => game(id, if i % 2 == 0 { 420 } else { 450 }, 12),
            }
        })
        .collect()
}

#[tokio::test]
async fn turned_on_it_reads_the_whole_history_once_and_never_during_a_game() {
    let games = long_history();
    let shareable = |g: &Game| domain::is_mayhem_queue(g.queue_id) && g.duration > 300;
    let mayhem_games: Vec<String> = games
        .iter()
        .filter(|g| shareable(g))
        .map(|g| mayhem::game_key("EUW1", g.game_id))
        .collect();
    assert_eq!(mayhem_games.len(), 17, "16 matchmade and a custom one");
    let (mock, lcu) = client(&games).await;
    let (backend, state) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let data = MayhemClient::new(backend.clone(), dir.path());
    let Follow {
        settings,
        status,
        task,
        ..
    } = follow(lcu, backend, data, GameflowPhase::ChampSelect);

    // Yes during champion select: nothing is asked of the client until it's over.
    settings.send_modify(|s| s.share_mayhem_games = Some(true));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(mock.count("GET", history::LIST), 0);
    status.send_modify(|s| s.phase = GameflowPhase::InGame);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(mock.count("GET", history::LIST), 0, "nor during the game");

    // The game over: every page back to the history's end (20 + 20 + 7), each Mayhem game read
    // once, sent 20 at a time.
    status.send_modify(|s| s.phase = GameflowPhase::PostGame);
    eventually("the whole history", || {
        uploads(&state).iter().map(|u| u.games.len()).sum::<usize>() == 17
    })
    .await;
    let sent = uploads(&state);
    assert_eq!(
        sent.iter().map(|u| u.games.len()).collect::<Vec<_>>(),
        [17],
        "one upload (20 at most)"
    );
    let keys: Vec<String> = sent[0].games.iter().map(|g| g.game.clone()).collect();
    assert_eq!(keys, mayhem_games, "newest first, the remake left out");
    assert_eq!(mock.count("GET", history::LIST), 3, "three pages");
    for g in &games {
        let reads = mock.count("GET", &history::game_path(g.game_id));
        let wanted = usize::from(shareable(g));
        assert_eq!(reads, wanted, "game {} read once, if Mayhem", g.game_id);
    }

    // Read to its end: after the next game, only the last 20 games, and only the new one goes.
    let mut newer = games.clone();
    newer.insert(0, game(7_000_001_001, history::MAYHEM_QUEUE, 12));
    history::serve(&mock, &local(), &newer);
    status.send_modify(|s| s.phase = GameflowPhase::Lobby);
    tokio::time::sleep(Duration::from_millis(100)).await;
    status.send_modify(|s| s.phase = GameflowPhase::PostGame);
    eventually("the new game", || uploads(&state).len() == 2).await;
    assert_eq!(uploads(&state)[1].games.len(), 1);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        mock.count("GET", history::LIST),
        5,
        "one page after each scan (leaving the end-of-game screen, then the new game's)"
    );
    task.abort();
}

#[tokio::test]
async fn mayhem_data_is_cached_and_answers_offline() {
    let (backend, state) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let data = MayhemClient::new(backend.clone(), dir.path());
    let augments = data.augments(Language::Fr).await.unwrap().unwrap();
    assert_eq!(augments.patch, "16.19");
    let name = |list: &domain::MayhemAugments, id: u32| {
        list.augments
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.name.clone())
            .unwrap()
    };
    assert_eq!(
        name(&augments, 1028),
        "Spark Test",
        "no French name: English"
    );
    assert_eq!(name(&augments, 2137), "Verre test");
    assert!(
        augments.augments[1]
            .icon
            .starts_with("https://raw.communitydragon.org/")
    );
    let overview = data.overview().await;
    assert_eq!(overview.tiers.unwrap().tiers.s, vec![2137]);
    assert!(overview.popularity.is_none(), "no shared games yet");

    let champion = data.champion(222).await.unwrap();
    let gold = champion
        .priorities
        .iter()
        .find(|p| p.rarity == AugmentRarity::Gold)
        .unwrap();
    assert_eq!(gold.entries[0].id, 2137);
    assert!(!gold.by_pick_rate, "no games: the tiers alone");

    // Offline: a new start answers from the disk copies.
    state.down.store(true, Ordering::SeqCst);
    let offline = MayhemClient::new(backend, dir.path());
    let again = offline.augments(Language::En).await.unwrap().unwrap();
    assert_eq!(again.augments.len(), 2);
    assert_eq!(name(&again, 2137), "Glass Test");
    assert!(offline.tiers().await.unwrap().is_some());
}
