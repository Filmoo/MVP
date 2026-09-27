#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::Arc;
use std::time::Duration;

use domain::{ClientConnection, ClientStatus, GameflowPhase};
use lcu::ConnectorConfig;
use lcu::tls::pinned_client_config;
use mock_lcu::MockLcu;
use serde_json::json;

async fn wait_for(status: &mut tokio::sync::watch::Receiver<ClientStatus>, want: ClientStatus) {
    tokio::time::timeout(Duration::from_secs(5), status.wait_for(|s| *s == want))
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn publishes_status_from_the_client() {
    let mock = Arc::new(MockLcu::start().await.unwrap());
    let lockfile = mock.lockfile();
    let companion = companion::start(ConnectorConfig {
        discover: Box::new(move || {
            lcu::Lockfile::parse(&lockfile)
                .ok()
                .map(|l| l.credentials())
        }),
        tls: pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
        paths: vec![],
        poll_interval: Duration::from_millis(50),
        startup_grace: Duration::from_secs(1),
    });
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
    let lockfile = mock.lockfile();
    let companion = companion::start(ConnectorConfig {
        discover: Box::new(move || {
            lcu::Lockfile::parse(&lockfile)
                .ok()
                .map(|l| l.credentials())
        }),
        tls: pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
        paths: vec![],
        poll_interval: Duration::from_millis(50),
        startup_grace: Duration::from_secs(1),
    });
    let mut draft = companion.draft.clone();
    let mut status = companion.status.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        status.wait_for(|s| s.connection == ClientConnection::Connected),
    )
    .await
    .unwrap()
    .unwrap();

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
