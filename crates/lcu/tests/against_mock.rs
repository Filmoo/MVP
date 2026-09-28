//! The connector against a fake client speaking the real protocol (TLS, basic auth, WAMP).
#![allow(clippy::unwrap_used, reason = "tests")]

use std::time::Duration;

use lcu::tls::pinned_client_config;
use lcu::{Credentials, EventKind, EventStream, LcuClient, Lockfile, topic_for};
use mock_lcu::MockLcu;
use serde_json::json;

const PHASE: &str = "/lol-gameflow/v1/gameflow-phase";

fn credentials(mock: &MockLcu) -> Credentials {
    Lockfile::parse(&mock.lockfile()).unwrap().credentials()
}

#[tokio::test]
async fn reads_documents_over_pinned_tls() {
    let mock = MockLcu::start().await.unwrap();
    let client = LcuClient::new(
        &credentials(&mock),
        pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap();
    let phase: String = client.get(PHASE).await.unwrap();
    assert_eq!(phase, "None");

    let missing = client
        .get::<serde_json::Value>("/lol-champ-select/v1/session")
        .await
        .unwrap_err();
    assert!(missing.is_not_found(), "{missing}");
}

#[tokio::test]
async fn rejects_servers_signed_by_another_root() {
    let mock = MockLcu::start().await.unwrap();
    let other = MockLcu::start().await.unwrap();
    let client = LcuClient::new(
        &credentials(&mock),
        pinned_client_config(other.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap();
    let err = client.get::<String>(PHASE).await.unwrap_err();
    assert!(matches!(err, lcu::LcuError::Transport(_)), "{err}");
}

#[tokio::test]
async fn wrong_password_is_an_http_error() {
    let mock = MockLcu::start().await.unwrap();
    let creds = Credentials {
        port: mock.port(),
        password: "wrong".into(),
    };
    let client = LcuClient::new(
        &creds,
        pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap();
    let err = client.get::<String>(PHASE).await.unwrap_err();
    assert!(
        matches!(err, lcu::LcuError::Http { status, .. } if status == 401),
        "{err}"
    );
}

#[tokio::test]
async fn streams_subscribed_events() {
    let mock = MockLcu::start().await.unwrap();
    let tls = pinned_client_config(mock.ca_pem().as_bytes()).unwrap();
    let mut events = EventStream::connect(&credentials(&mock), tls, &[topic_for(PHASE)])
        .await
        .unwrap();

    // Give the server a moment to register the subscription, then change the phase.
    tokio::time::sleep(Duration::from_millis(50)).await;
    mock.set(
        "/lol-summoner/v1/current-summoner",
        json!({"gameName": "x"}),
    ); // not subscribed
    mock.set(PHASE, json!("ChampSelect"));

    let event = tokio::time::timeout(Duration::from_secs(2), events.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(event.uri, PHASE);
    assert_eq!(event.kind, EventKind::Update);
    assert_eq!(event.data, json!("ChampSelect"));
}

mod connector {
    use std::sync::{Arc, Mutex};

    use lcu::{ConnectionState, ConnectorConfig, ConnectorUpdate, spawn};

    use super::*;

    async fn next(conn: &mut lcu::Connector) -> ConnectorUpdate {
        tokio::time::timeout(Duration::from_secs(5), conn.updates.recv())
            .await
            .unwrap()
            .unwrap()
    }

    fn config(mock: &MockLcu, creds: Arc<Mutex<Option<Credentials>>>) -> ConnectorConfig {
        ConnectorConfig {
            discover: Box::new(move || creds.lock().unwrap().clone()),
            tls: pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
            paths: vec!["/lol-champ-select/v1/session".into()],
            poll_interval: Duration::from_millis(50),
            startup_grace: Duration::from_secs(1),
        }
    }

    #[tokio::test]
    async fn follows_the_client_lifecycle() {
        let mock = MockLcu::start().await.unwrap();
        let discovered = Arc::new(Mutex::new(None));
        let mut conn = spawn(config(&mock, Arc::clone(&discovered)));

        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::NotRunning)
        );

        // Client appears.
        *discovered.lock().unwrap() = Some(credentials(&mock));
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::Connecting)
        );
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::Connected)
        );
        assert_eq!(next(&mut conn).await, ConnectorUpdate::Phase("None".into()));
        assert!(conn.client.borrow().is_some());

        // Phase changes and subscribed events stream through.
        tokio::time::sleep(Duration::from_millis(50)).await;
        mock.set(PHASE, json!("ChampSelect"));
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::Phase("ChampSelect".into())
        );
        mock.set(
            "/lol-champ-select/v1/session",
            json!({"localPlayerCellId": 2}),
        );
        let ConnectorUpdate::Event(event) = next(&mut conn).await else {
            panic!("expected an event")
        };
        assert_eq!(event.uri, "/lol-champ-select/v1/session");

        // Client closes.
        *discovered.lock().unwrap() = None;
        drop(mock);
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::NotRunning)
        );
        assert!(conn.client.borrow().is_none());
    }

    /// Another app holds every connection the client accepts: its events still flow, requests
    /// get no answer. The state says so, one cheap request asks again (with a growing pause),
    /// and the first answer brings it back; nothing is asked while it answers.
    #[tokio::test]
    async fn a_client_that_stops_answering_then_answers() {
        let mock = MockLcu::start().await.unwrap();
        let mut conn = spawn(config(
            &mock,
            Arc::new(Mutex::new(Some(credentials(&mock)))),
        ));
        for expected in [
            ConnectorUpdate::State(ConnectionState::NotRunning),
            ConnectorUpdate::State(ConnectionState::Connecting),
            ConnectorUpdate::State(ConnectionState::Connected),
            ConnectorUpdate::Phase("None".into()),
        ] {
            assert_eq!(next(&mut conn).await, expected);
        }
        let client = conn.client.borrow().clone().unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;

        mock.stop_answering();
        let err = client
            .get::<serde_json::Value>("/lol-summoner/v1/current-summoner")
            .await
            .unwrap_err();
        assert!(err.is_unanswered(), "{err}");
        assert!(!client.is_answering());
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::NotAnswering)
        );
        // Its events still flow; it is asked again after 50 ms, 100 ms, 200 ms… (not in a
        // loop), and failed checks don't repeat the state.
        let refused = mock.refused();
        mock.set(PHASE, json!("Lobby"));
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::Phase("Lobby".into())
        );
        tokio::time::sleep(Duration::from_millis(400)).await;
        let checks = mock.refused() - refused;
        assert!((1..=5).contains(&checks), "asked again {checks} times");
        assert!(conn.updates.try_recv().is_err());

        // It answers again: the next check brings it back.
        mock.answer_again();
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::Connected)
        );
        assert!(client.is_answering());
        assert!(
            conn.client.borrow().is_some(),
            "same client, still connected"
        );

        // Answering: nothing is polled.
        let asked = mock.count("GET", PHASE);
        let quiet = tokio::time::timeout(Duration::from_millis(400), conn.updates.recv()).await;
        assert!(quiet.is_err(), "unexpected update: {quiet:?}");
        assert_eq!(mock.count("GET", PHASE), asked);
    }

    #[tokio::test]
    async fn stale_lockfile_does_not_flicker() {
        let mock = MockLcu::start().await.unwrap();
        let stale = Credentials {
            port: 1, // nothing listens there
            password: "stale".into(),
        };
        let mut conn = spawn(config(&mock, Arc::new(Mutex::new(Some(stale)))));
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::NotRunning)
        );
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::Connecting)
        );
        assert_eq!(
            next(&mut conn).await,
            ConnectorUpdate::State(ConnectionState::NotRunning)
        );
        // Many polls later: no further updates for the same dead credentials.
        let quiet = tokio::time::timeout(Duration::from_millis(400), conn.updates.recv()).await;
        assert!(quiet.is_err(), "unexpected update: {quiet:?}");
    }
}
