//! Keeps a connection to the League client alive: discovers it, connects, streams events,
//! and starts over when the client closes. Cheap while idle: one file read per poll.

use std::sync::Arc;
use std::time::Duration;

use rustls::ClientConfig;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::{Credentials, EventStream, LcuClient, LcuEvent, topic_for};

pub const GAMEFLOW_PHASE: &str = "/lol-gameflow/v1/gameflow-phase";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    NotRunning,
    Connecting,
    Connected,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConnectorUpdate {
    State(ConnectionState),
    /// Raw gameflow phase (`"ChampSelect"`…), sent on connect and on every change.
    Phase(String),
    /// Any other event from the subscribed paths.
    Event(LcuEvent),
}

type Discover = Box<dyn Fn() -> Option<Credentials> + Send + Sync>;

pub struct ConnectorConfig {
    pub discover: Discover,
    pub tls: Arc<ClientConfig>,
    /// Paths to receive events for, besides the gameflow phase.
    pub paths: Vec<String>,
    /// Pause between discovery attempts while no client is reachable.
    pub poll_interval: Duration,
    /// How long a freshly started client may take before its API answers.
    pub startup_grace: Duration,
}

impl std::fmt::Debug for ConnectorConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectorConfig")
            .field("paths", &self.paths)
            .field("poll_interval", &self.poll_interval)
            .finish_non_exhaustive()
    }
}

impl ConnectorConfig {
    /// Real client: lockfile discovery and Riot's pinned root.
    pub fn for_league_client(paths: Vec<String>) -> Result<Self, crate::tls::TlsError> {
        Ok(Self {
            discover: Box::new(crate::discovery::find_credentials),
            tls: crate::tls::riot_client_config()?,
            paths,
            poll_interval: Duration::from_secs(2),
            startup_grace: Duration::from_secs(20),
        })
    }
}

/// Handle to a running connector.
#[derive(Debug)]
pub struct Connector {
    pub updates: mpsc::Receiver<ConnectorUpdate>,
    /// The REST client while connected, for on-demand requests.
    pub client: watch::Receiver<Option<LcuClient>>,
    pub task: JoinHandle<()>,
}

pub fn spawn(config: ConnectorConfig) -> Connector {
    let (tx, updates) = mpsc::channel(64);
    let (client_tx, client) = watch::channel(None);
    let task = tokio::spawn(run(config, tx, client_tx));
    Connector {
        updates,
        client,
        task,
    }
}

async fn run(
    config: ConnectorConfig,
    tx: mpsc::Sender<ConnectorUpdate>,
    client_tx: watch::Sender<Option<LcuClient>>,
) {
    let mut topics: Vec<String> = config.paths.iter().map(|p| topic_for(p)).collect();
    topics.push(topic_for(GAMEFLOW_PHASE));
    let mut state = ConnectionState::NotRunning;
    // Credentials that already failed: retried quietly so a stale lockfile doesn't flicker the UI.
    let mut failed: Option<Credentials> = None;

    let _ = tx.send(ConnectorUpdate::State(state)).await;
    loop {
        let Some(creds) = (config.discover)() else {
            failed = None;
            set_state(&tx, &mut state, ConnectionState::NotRunning).await;
            tokio::time::sleep(config.poll_interval).await;
            continue;
        };
        if failed.as_ref() != Some(&creds) {
            set_state(&tx, &mut state, ConnectionState::Connecting).await;
        }
        let Some((client, phase, mut events)) = connect(&config, &creds, &topics).await else {
            failed = Some(creds);
            set_state(&tx, &mut state, ConnectionState::NotRunning).await;
            tokio::time::sleep(config.poll_interval).await;
            continue;
        };
        failed = None;
        client_tx.send_replace(Some(client));
        set_state(&tx, &mut state, ConnectionState::Connected).await;
        if tx.send(ConnectorUpdate::Phase(phase)).await.is_err() {
            return;
        }
        while let Some(Ok(event)) = events.next().await {
            let update = if event.uri == GAMEFLOW_PHASE {
                match event.data.as_str() {
                    Some(phase) => ConnectorUpdate::Phase(phase.to_owned()),
                    None => continue,
                }
            } else {
                ConnectorUpdate::Event(event)
            };
            if tx.send(update).await.is_err() {
                return;
            }
        }
        tracing::info!("league client disconnected");
        client_tx.send_replace(None);
        set_state(&tx, &mut state, ConnectionState::NotRunning).await;
        if tx.is_closed() {
            return;
        }
        tokio::time::sleep(config.poll_interval).await;
    }
}

async fn set_state(
    tx: &mpsc::Sender<ConnectorUpdate>,
    state: &mut ConnectionState,
    next: ConnectionState,
) {
    if *state != next {
        *state = next;
        let _ = tx.send(ConnectorUpdate::State(next)).await;
    }
}

/// Connects once the client's API answers (it 404s/refuses for a while during startup).
async fn connect(
    config: &ConnectorConfig,
    creds: &Credentials,
    topics: &[String],
) -> Option<(LcuClient, String, EventStream)> {
    let client = LcuClient::new(creds, Arc::clone(&config.tls)).ok()?;
    let deadline = tokio::time::Instant::now() + config.startup_grace;
    let phase = loop {
        match client.get::<String>(GAMEFLOW_PHASE).await {
            Ok(phase) => break phase,
            Err(e)
                if tokio::time::Instant::now() < deadline
                    && !matches!(e, crate::LcuError::Transport(_)) =>
            {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(e) => {
                tracing::debug!(error = %e, "league client not ready");
                return None;
            }
        }
    };
    let events = EventStream::connect(creds, Arc::clone(&config.tls), topics)
        .await
        .ok()?;
    Some((client, phase, events))
}
