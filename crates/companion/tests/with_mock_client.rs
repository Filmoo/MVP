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
