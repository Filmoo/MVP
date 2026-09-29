//! After a game, against the fake League client: the core notes the ranked standing when the
//! game loads, then sums the game up once the client lists it, with the LP it was worth as soon
//! as the client's ranked stats say so (their event, no waiting). And the match history further
//! back, a page at a time.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::time::Duration;

use companion::matches::MatchInsights;
use companion::{Companion, Services};
use domain::{ClientConnection, PostGame, RankedQueue, Settings};
use lcu::tls::pinned_client_config;
use lcu::{ConnectorConfig, LcuClient};
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

fn ranked(lp: u32, wins: u32, losses: u32) -> Value {
    json!({ "queueMap": {
        "RANKED_SOLO_5x5": { "tier": "EMERALD", "division": "II", "leaguePoints": lp, "wins": wins, "losses": losses },
        "RANKED_FLEX_SR": { "tier": "GOLD", "division": "I", "leaguePoints": 10, "wins": 3, "losses": 2 }
    } })
}

const GAME_ID: u64 = 7_100_000_001;

fn played() -> Game {
    Game {
        game_id: GAME_ID,
        queue_id: 420,
        map_id: 11,
        created: 1_790_500_000_000,
        duration: 1742,
        champion: 103,
        lane: "MIDDLE",
        spells: [14, 4],
        win: true,
    }
}

async fn start(mock: &MockLcu, lp_file: Option<std::path::PathBuf>) -> Companion {
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
    mock.set(companion::profile::RANKED, ranked(46, 10, 8));
    let settings = watch::channel(Settings::default()).1;
    let services = Services {
        lp_file,
        ..Services::default()
    };
    let companion = companion::start_with_services(config_for(mock), settings, services);
    let mut status = companion.status.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        status.wait_for(|s| s.connection == ClientConnection::Connected),
    )
    .await
    .unwrap()
    .unwrap();
    // Let the mock register the subscriptions.
    tokio::time::sleep(Duration::from_millis(50)).await;
    companion
}

async fn wait_for(
    rx: &mut watch::Receiver<Option<PostGame>>,
    what: impl Fn(&PostGame) -> bool,
) -> PostGame {
    tokio::time::timeout(
        Duration::from_secs(5),
        rx.wait_for(|p| p.as_ref().is_some_and(&what)),
    )
    .await
    .unwrap()
    .unwrap()
    .clone()
    .unwrap()
}

#[tokio::test]
async fn a_ranked_game_ends_on_its_summary_then_its_lp() {
    let mock = MockLcu::start().await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(companion::lp::FILE_NAME);
    let companion = start(&mock, Some(file.clone())).await;
    let mut summary = companion.post_game.subscribe();

    // The game loads: which game, and the standing before it.
    mock.set(
        companion::live::SESSION,
        json!({ "phase": "GameStart", "gameData": { "gameId": GAME_ID, "queue": { "id": 420 } } }),
    );
    mock.set(lcu::GAMEFLOW_PHASE, json!("GameStart"));
    tokio::time::sleep(Duration::from_millis(200)).await;
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    tokio::time::sleep(Duration::from_millis(100)).await;

    // It ends; the client lists it before it has counted it in the ranked stats.
    history::serve(&mock, &local(), &[played()]);
    mock.set(lcu::GAMEFLOW_PHASE, json!("EndOfGame"));
    let first = wait_for(&mut summary, |_| true).await;
    assert_eq!(first.match_id, "EUW1_7100000001");
    assert!(first.win && first.lp_pending && first.lp.is_none());
    assert!(first.me.is_me && first.me.grade.is_some());
    assert_eq!(first.opponent.as_ref().map(|p| p.role), Some(first.me.role));

    // The client counts it: its event brings the LP at once.
    mock.set(companion::profile::RANKED, ranked(67, 11, 8));
    let counted = wait_for(&mut summary, |p| !p.lp_pending).await;
    let lp = counted.lp.unwrap();
    assert_eq!(
        (lp.game_id, lp.queue, lp.delta),
        (GAME_ID, RankedQueue::Solo, 21)
    );
    assert_eq!(companion.post_game.lp_history(), vec![lp.clone()]);
    let kept = std::fs::read_to_string(&file).unwrap();
    assert!(kept.contains("7100000001"), "kept on disk: {kept}");

    // The whole game was read once, for the summary: the list's grade and details reuse it.
    let reads = mock.count("GET", &history::game_path(GAME_ID));
    assert_eq!(reads, 1);

    // Dismissed, it stays gone; a new champion select would hide it too.
    companion.post_game.dismiss(&counted.match_id);
    assert!(companion.post_game.current().is_none());
}

#[tokio::test]
async fn a_normal_game_has_a_summary_without_lp() {
    let mock = MockLcu::start().await.unwrap();
    let companion = start(&mock, None).await;
    let mut summary = companion.post_game.subscribe();
    mock.set(
        companion::live::SESSION,
        json!({ "gameData": { "gameId": GAME_ID, "queue": { "id": 400 } } }),
    );
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    tokio::time::sleep(Duration::from_millis(200)).await;
    let normal = Game {
        queue_id: 400,
        ..played()
    };
    history::serve(&mock, &local(), &[normal]);
    mock.set(lcu::GAMEFLOW_PHASE, json!("PreEndOfGame"));
    let done = wait_for(&mut summary, |_| true).await;
    assert!(done.lp.is_none() && !done.lp_pending);
    assert_eq!(done.queue_id, 400);
    assert!(companion.post_game.lp_history().is_empty());
    assert_eq!(
        mock.count("GET", companion::profile::RANKED),
        0,
        "not ranked: never read"
    );

    // The next champion select hides it.
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    tokio::time::timeout(Duration::from_secs(5), summary.wait_for(Option::is_none))
        .await
        .unwrap()
        .unwrap();
}

// ---- Further back in the match history ---------------------------------------------------------

fn client_for(mock: &MockLcu) -> LcuClient {
    let creds = lcu::Lockfile::parse(&mock.lockfile())
        .unwrap()
        .credentials();
    LcuClient::new(
        &creds,
        pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn older_games_come_a_page_at_a_time_and_grade_like_the_first() {
    let mock = MockLcu::start().await.unwrap();
    let me = local();
    mock.set(
        companion::profile::CURRENT_SUMMONER,
        json!({ "gameName": me.game_name, "tagLine": me.tag_line, "puuid": me.puuid, "summonerId": me.summoner_id }),
    );
    mock.set(
        companion::profile::REGION,
        json!({ "region": "EUW", "locale": "en_GB" }),
    );
    // 25 games, newest first.
    let games: Vec<Game> = (0..25_u64)
        .map(|i| Game {
            game_id: 7_000_000_100 - i,
            created: 1_790_500_000_000 - i64::try_from(i).unwrap() * 3_600_000,
            ..played()
        })
        .collect();
    history::serve(&mock, &me, &games);
    let client = client_for(&mock);
    let insights = MatchInsights::default();

    let profile = insights.profile(&client).await.unwrap();
    assert_eq!(profile.recent_matches.len(), 20, "0 to 19: 20 games");
    let older = insights.older(&client, 20).await.unwrap();
    let ids: Vec<&str> = older.iter().map(|m| m.match_id.as_str()).collect();
    assert_eq!(ids.first(), Some(&"EUW1_7000000080"));
    assert_eq!(older.len(), 5, "the end of the history");
    assert!(insights.older(&client, 40).await.unwrap().is_empty());

    // An older game grades and opens like the first page's.
    let graded = insights.grades(&client, &[older[0].match_id.clone()]).await;
    assert!(graded[0].grade.is_some());
    let details = insights
        .details(Some(&client), None, &older[0].match_id)
        .await
        .unwrap();
    assert_eq!(details.match_id, older[0].match_id);
    assert_eq!(mock.count("GET", &history::game_path(7_000_000_080)), 1);
}
