#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::Arc;
use std::time::Duration;

use companion::Companion;
use companion::automation::{CoreEvent, WindowIntent};
use domain::{
    AutoAcceptEvent, ClientConnection, ClientError, ClientStatus, GameflowPhase, Settings,
    ViewRoute,
};
use lcu::ConnectorConfig;
use lcu::tls::pinned_client_config;
use mock_lcu::MockLcu;
use serde_json::json;
use tokio::sync::watch;

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

async fn wait_for(status: &mut watch::Receiver<ClientStatus>, want: ClientStatus) {
    tokio::time::timeout(Duration::from_secs(5), status.wait_for(|s| *s == want))
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn publishes_status_from_the_client() {
    let mock = Arc::new(MockLcu::start().await.unwrap());
    let (_settings, settings_rx) = watch::channel(Settings::default());
    let companion = companion::start(config_for(&mock), settings_rx);
    let mut status = companion.status.clone();

    let connected = |phase| ClientStatus {
        connection: ClientConnection::Connected,
        phase,
    };
    wait_for(&mut status, connected(GameflowPhase::Idle)).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    wait_for(&mut status, connected(GameflowPhase::ChampSelect)).await;
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    wait_for(&mut status, connected(GameflowPhase::InGame)).await;
}

#[tokio::test]
async fn follows_champion_select() {
    let mock = Arc::new(MockLcu::start().await.unwrap());
    let (companion, _settings) = connected(&mock, Settings::default()).await;
    let mut draft = companion.draft.clone();

    // Session exists before the phase flips: read on entry.
    mock.set(
        companion::champ_select::SESSION,
        json!({ "localPlayerCellId": 2, "myTeam": [{ "cellId": 2, "assignedPosition": "middle", "championPickIntent": 103 }], "theirTeam": [], "timer": { "phase": "PLANNING" } }),
    );
    tokio::time::sleep(Duration::from_millis(50)).await;
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    let view = tokio::time::timeout(Duration::from_secs(5), draft.wait_for(Option::is_some))
        .await
        .unwrap()
        .unwrap()
        .clone()
        .unwrap();
    assert_eq!(view.my_role, Some(domain::Role::Middle));
    assert_eq!(view.allies[0].champion_id, Some(103));

    // Updates stream in; leaving champ select clears it.
    mock.set(
        companion::champ_select::SESSION,
        json!({ "localPlayerCellId": 2, "myTeam": [{ "cellId": 2, "assignedPosition": "middle", "championId": 103 }], "theirTeam": [], "timer": { "phase": "FINALIZATION" } }),
    );
    tokio::time::timeout(
        Duration::from_secs(5),
        draft.wait_for(|d| {
            d.as_ref()
                .is_some_and(|v| v.phase == domain::DraftPhase::Finalizing)
        }),
    )
    .await
    .unwrap()
    .unwrap();
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    tokio::time::timeout(Duration::from_secs(5), draft.wait_for(Option::is_none))
        .await
        .unwrap()
        .unwrap();
}

/// Another app holds every connection the League client accepts: the status says it doesn't
/// answer while the game goes on (events still flow), the profile's failure reads as such, and
/// the first answer brings "connected" back, by itself.
#[tokio::test]
async fn a_client_that_stops_answering_then_answers() {
    let mock = MockLcu::start().await.unwrap();
    mock.set(
        companion::profile::CURRENT_SUMMONER,
        json!({ "gameName": "Fillmo", "tagLine": "7272", "summonerLevel": 312 }),
    );
    let (companion, _settings) = connected(&mock, Settings::default()).await;
    let mut status = companion.status.clone();
    let at = |connection, phase| ClientStatus { connection, phase };
    mock.set(lcu::GAMEFLOW_PHASE, json!("Lobby"));
    wait_for(
        &mut status,
        at(ClientConnection::Connected, GameflowPhase::Lobby),
    )
    .await;

    mock.stop_answering();
    let client = companion.client.borrow().clone().unwrap();
    let error = companion.matches.profile(&client).await.unwrap_err();
    assert_eq!(
        companion::profile::client_error(&error),
        ClientError::NotAnswering,
        "{error}"
    );
    wait_for(
        &mut status,
        at(ClientConnection::NotAnswering, GameflowPhase::Lobby),
    )
    .await;
    mock.set(lcu::GAMEFLOW_PHASE, json!("Matchmaking"));
    wait_for(
        &mut status,
        at(ClientConnection::NotAnswering, GameflowPhase::Matchmaking),
    )
    .await;

    mock.answer_again();
    wait_for(
        &mut status,
        at(ClientConnection::Connected, GameflowPhase::Matchmaking),
    )
    .await;
    let profile = companion.matches.profile(&client).await.unwrap();
    assert_eq!(profile.riot_id.game_name, "Fillmo");
}

#[tokio::test]
async fn reads_the_local_profile() {
    let mock = MockLcu::start().await.unwrap();
    mock.set(
        companion::profile::CURRENT_SUMMONER,
        json!({ "gameName": "Fillmo", "tagLine": "7272", "summonerLevel": 312, "profileIconId": 29 }),
    );
    mock.set(
        companion::profile::REGION,
        json!({ "region": "EUW", "locale": "en_GB" }),
    );
    mock.set(
        companion::profile::RANKED,
        json!({ "queueMap": { "RANKED_SOLO_5x5": { "tier": "GOLD", "division": "I", "leaguePoints": 40, "wins": 30, "losses": 25 } } }),
    );
    // Match history left out on purpose: the profile still loads, with no games.
    let creds = lcu::Lockfile::parse(&mock.lockfile())
        .unwrap()
        .credentials();
    let client = lcu::LcuClient::new(
        &creds,
        pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap();
    let profile = companion::profile::local_profile(&client).await.unwrap();
    assert_eq!(profile.riot_id.game_name, "Fillmo");
    assert_eq!(profile.riot_id.tag_line, "7272");
    assert_eq!(profile.region, "EUW");
    assert_eq!(profile.solo_queue.unwrap().tier, domain::Tier::Gold);
    assert!(profile.recent_matches.is_empty());
}

// ── Automations ────────────────────────────────────────────────────────────────────────────

/// A core connected to `mock` (event subscriptions in place) with `settings`.
async fn connected(mock: &MockLcu, settings: Settings) -> (Companion, watch::Sender<Settings>) {
    let (settings_tx, settings_rx) = watch::channel(settings);
    let companion = companion::start(config_for(mock), settings_rx);
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
    (companion, settings_tx)
}

async fn next_event(companion: &mut Companion) -> CoreEvent {
    tokio::time::timeout(Duration::from_secs(5), companion.events.recv())
        .await
        .unwrap()
        .unwrap()
}

fn auto_accept(delay: u8) -> Settings {
    Settings {
        auto_accept: true,
        auto_accept_delay_seconds: delay,
        // Only the ready check matters in these tests.
        auto_switch_view: false,
        bring_to_front_on_champ_select: false,
        ..Settings::default()
    }
}

async fn accept_posts_after(mock: &MockLcu, wait: Duration) -> usize {
    tokio::time::sleep(wait).await;
    mock.count("POST", mock_lcu::READY_CHECK_ACCEPT)
}

#[tokio::test]
async fn accepts_the_ready_check_once() {
    let mock = MockLcu::start().await.unwrap();
    let (mut companion, _settings) = connected(&mock, auto_accept(0)).await;
    mock.start_ready_check();
    assert_eq!(
        next_event(&mut companion).await,
        CoreEvent::AutoAccept(AutoAcceptEvent::Accepted)
    );
    // The same ready check again (a repeated phase event): no second accept.
    mock.set(lcu::GAMEFLOW_PHASE, json!("ReadyCheck"));
    assert_eq!(
        accept_posts_after(&mock, Duration::from_millis(300)).await,
        1
    );
}

#[tokio::test]
async fn waits_the_delay_before_accepting() {
    let mock = MockLcu::start().await.unwrap();
    let (mut companion, _settings) = connected(&mock, auto_accept(1)).await;
    mock.start_ready_check();
    assert_eq!(
        accept_posts_after(&mock, Duration::from_millis(500)).await,
        0
    );
    assert_eq!(
        next_event(&mut companion).await,
        CoreEvent::AutoAccept(AutoAcceptEvent::Accepted)
    );
    assert_eq!(mock.count("POST", mock_lcu::READY_CHECK_ACCEPT), 1);
}

#[tokio::test]
async fn off_by_default() {
    let mock = MockLcu::start().await.unwrap();
    let (_companion, _settings) = connected(&mock, Settings::default()).await;
    mock.start_ready_check();
    assert_eq!(
        accept_posts_after(&mock, Duration::from_millis(500)).await,
        0
    );
}

#[tokio::test]
async fn never_overrides_the_players_answer() {
    let mock = MockLcu::start().await.unwrap();
    let (_companion, _settings) = connected(&mock, auto_accept(1)).await;
    mock.start_ready_check();
    mock.decline_ready_check();
    assert_eq!(
        accept_posts_after(&mock, Duration::from_millis(1_500)).await,
        0
    );
}

#[tokio::test]
async fn cancels_when_the_ready_check_ends() {
    let mock = MockLcu::start().await.unwrap();
    let (_companion, _settings) = connected(&mock, auto_accept(1)).await;
    mock.start_ready_check();
    tokio::time::sleep(Duration::from_millis(100)).await;
    mock.end_ready_check("Matchmaking");
    // A ready check document without the phase coming back must not be accepted either.
    mock.set(
        mock_lcu::READY_CHECK,
        json!({ "state": "InProgress", "playerResponse": "None" }),
    );
    assert_eq!(
        accept_posts_after(&mock, Duration::from_millis(1_500)).await,
        0
    );
}

#[tokio::test]
async fn switching_it_on_during_the_pop_up_accepts() {
    let mock = MockLcu::start().await.unwrap();
    let (mut companion, settings) = connected(
        &mock,
        Settings {
            auto_accept: false,
            ..auto_accept(0)
        },
    )
    .await;
    mock.start_ready_check();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(mock.count("POST", mock_lcu::READY_CHECK_ACCEPT), 0);
    settings.send_modify(|s| s.auto_accept = true);
    assert_eq!(
        next_event(&mut companion).await,
        CoreEvent::AutoAccept(AutoAcceptEvent::Accepted)
    );
}

#[tokio::test]
async fn follows_the_game_with_the_window() {
    let mock = MockLcu::start().await.unwrap();
    let (mut companion, _settings) = connected(&mock, Settings::default()).await;
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    assert_eq!(
        next_event(&mut companion).await,
        CoreEvent::Window(WindowIntent {
            focus: true,
            navigate: Some(ViewRoute::Draft)
        })
    );
    companion.views.report("/draft");
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    assert_eq!(
        next_event(&mut companion).await,
        CoreEvent::Window(WindowIntent {
            focus: false,
            navigate: Some(ViewRoute::Live)
        })
    );
    companion.views.report("/live");
    mock.set(lcu::GAMEFLOW_PHASE, json!("EndOfGame"));
    assert_eq!(
        next_event(&mut companion).await,
        CoreEvent::Window(WindowIntent {
            focus: false,
            navigate: Some(ViewRoute::Home)
        })
    );
}
