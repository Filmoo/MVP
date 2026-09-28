//! App core: follows the League client and publishes the UI-facing [`ClientStatus`],
//! champion-select [`DraftView`] and loading-screen [`LiveGame`], runs the client automations
//! and build imports, owns the settings and talks to our backend.
//!
//! Independent of Tauri so it runs in tests and could back other front ends (CLI, web).

pub mod automation;
pub mod backend;
pub mod champ_select;
pub mod imports;
pub mod live;
pub mod profile;
pub mod settings;

use std::sync::Arc;

use automation::{Autopilot, CoreEvent};
use backend::BackendClient;
use domain::{ClientConnection, ClientStatus, DraftView, GameflowPhase, LiveGame, Settings};
use imports::{BuildSource, ChampionNames, Importer, LockIn, NoBuilds};
use lcu::{ConnectionState, ConnectorConfig, ConnectorUpdate, EventKind, LcuClient};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

/// Maps the client's gameflow phases onto the phases the UI distinguishes.
pub fn map_phase(raw: &str) -> GameflowPhase {
    match raw {
        "Lobby" => GameflowPhase::Lobby,
        "Matchmaking" | "CheckedIntoTournament" => GameflowPhase::Matchmaking,
        "ReadyCheck" => GameflowPhase::ReadyCheck,
        "ChampSelect" => GameflowPhase::ChampSelect,
        "GameStart" => GameflowPhase::Loading,
        "InProgress" | "Reconnect" => GameflowPhase::InGame,
        "WaitingForStats" | "PreEndOfGame" | "EndOfGame" => GameflowPhase::PostGame,
        // None, FailedToLaunch, TerminatedInError and anything new.
        _ => GameflowPhase::Idle,
    }
}

const fn map_connection(state: ConnectionState) -> ClientConnection {
    match state {
        ConnectionState::NotRunning => ClientConnection::NotRunning,
        ConnectionState::Connecting => ClientConnection::Connecting,
        ConnectionState::Connected => ClientConnection::Connected,
    }
}

/// A running core.
#[derive(Debug)]
pub struct Companion {
    /// Latest client status; `changed()` fires on every transition.
    pub status: watch::Receiver<ClientStatus>,
    /// Champion select while it lasts.
    pub draft: watch::Receiver<Option<DraftView>>,
    /// The game being loaded or played, with its scouting cards.
    pub live: watch::Receiver<Option<LiveGame>>,
    /// Asks for the scouting cards again (after a failure).
    pub scouting: ScoutingHandle,
    /// REST access to the client while connected.
    pub client: watch::Receiver<Option<LcuClient>>,
    /// Window intents and automation outcomes, for the shell.
    pub events: mpsc::Receiver<CoreEvent>,
    /// Where the UI reports the views it shows.
    pub views: ViewReporter,
    /// Imports builds into the client on request (`import_build`).
    pub imports: Importer,
    pub task: JoinHandle<()>,
}

/// What the core uses besides the League client.
pub struct Services {
    /// Our backend, for the loading-screen scouting cards (`None`: no cards).
    pub backend: Option<BackendClient>,
    /// Builds for the imports: the published stats ([`NoBuilds`] until they are wired).
    pub builds: Arc<dyn BuildSource>,
    /// Champion names, for the names of MVP's rune page and item sets.
    pub names: ChampionNames,
}

impl Default for Services {
    fn default() -> Self {
        Self {
            backend: None,
            builds: Arc::new(NoBuilds),
            names: Arc::new(|_| None),
        }
    }
}

impl std::fmt::Debug for Services {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Services")
            .field("backend", &self.backend)
            .finish_non_exhaustive()
    }
}

/// Tells the core which view the UI shows, so automatic view switches never fight the user.
#[derive(Debug, Clone)]
pub struct ViewReporter(mpsc::UnboundedSender<String>);

impl ViewReporter {
    pub fn report(&self, path: &str) {
        let _ = self.0.send(path.to_owned());
    }
}

/// Asks the core to scout the current game again.
#[derive(Debug, Clone)]
pub struct ScoutingHandle(mpsc::UnboundedSender<()>);

impl ScoutingHandle {
    pub fn retry(&self) {
        let _ = self.0.send(());
    }
}

/// Follows the game from the loading screen to the end: one scouting task per game.
struct LiveFollower {
    tx: watch::Sender<Option<LiveGame>>,
    backend: Option<BackendClient>,
    task: Option<JoinHandle<()>>,
}

impl LiveFollower {
    const fn in_game(phase: GameflowPhase) -> bool {
        matches!(phase, GameflowPhase::Loading | GameflowPhase::InGame)
    }

    fn on_phase(&mut self, phase: GameflowPhase, client: &watch::Receiver<Option<LcuClient>>) {
        if !Self::in_game(phase) {
            if let Some(task) = self.task.take() {
                task.abort();
            }
            self.tx.send_if_modified(|live| live.take().is_some());
            return;
        }
        // Loading → in game: same game. Read again only if the first read found nothing.
        let running = self.task.as_ref().is_some_and(|t| !t.is_finished());
        if !running && self.tx.borrow().is_none() {
            self.spawn(client);
        }
    }

    fn retry(&mut self, phase: GameflowPhase, client: &watch::Receiver<Option<LcuClient>>) {
        if Self::in_game(phase) {
            self.spawn(client);
        }
    }

    fn spawn(&mut self, client: &watch::Receiver<Option<LcuClient>>) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        let Some(lcu) = client.borrow().clone() else {
            return;
        };
        self.task = Some(tokio::spawn(live::scout_game(
            lcu,
            self.backend.clone(),
            self.tx.clone(),
        )));
    }
}

/// Starts following the client with the player's `settings`, without a backend (no scouting
/// cards) nor builds. Must run inside a Tokio runtime.
pub fn start(config: ConnectorConfig, settings: watch::Receiver<Settings>) -> Companion {
    start_with_services(config, settings, Services::default())
}

/// Starts following the client with the player's `settings`; `backend` answers the scouting
/// batches. Must run inside a Tokio runtime.
pub fn start_with(
    config: ConnectorConfig,
    settings: watch::Receiver<Settings>,
    backend: Option<BackendClient>,
) -> Companion {
    start_with_services(
        config,
        settings,
        Services {
            backend,
            ..Services::default()
        },
    )
}

/// Starts following the client with the player's `settings` and the given `services`.
/// Must run inside a Tokio runtime.
pub fn start_with_services(
    mut config: ConnectorConfig,
    mut settings: watch::Receiver<Settings>,
    services: Services,
) -> Companion {
    let Services {
        backend,
        builds,
        names,
    } = services;
    if !config.paths.iter().any(|p| p == champ_select::SESSION) {
        config.paths.push(champ_select::SESSION.to_owned());
    }
    let mut connector = lcu::spawn(config);
    let client = connector.client.clone();
    let (tx, status) = watch::channel(ClientStatus::not_running());
    let (draft_tx, draft) = watch::channel(None);
    let (events_tx, events) = mpsc::channel(32);
    let (views_tx, mut views_rx) = mpsc::unbounded_channel::<String>();
    let (live_tx, live) = watch::channel(None);
    let (retry_tx, mut retry_rx) = mpsc::unbounded_channel::<()>();
    let lcu_client = client.clone();
    let importer = Importer::new(
        client.clone(),
        status.clone(),
        settings.clone(),
        builds,
        names,
    );
    let mut lock_in = LockIn::new(importer.clone(), events_tx.clone());
    let task = tokio::spawn(async move {
        let mut autopilot = Autopilot::default();
        let mut game = LiveFollower {
            tx: live_tx,
            backend,
            task: None,
        };
        // The auto-accept of the current ready check: at most one per ready check.
        let mut ready_check: Option<JoinHandle<()>> = None;
        loop {
            tokio::select! {
                update = connector.updates.recv() => {
                    let Some(update) = update else { break };
                    let before = tx.borrow().phase;
                    tx.send_if_modified(|status| apply(status, &update));
                    if let Some(session) = follow_draft(&update, &tx, &draft_tx, &lcu_client).await {
                        lock_in.on_session(&session);
                    }
                    let phase = tx.borrow().phase;
                    if phase == before {
                        continue;
                    }
                    if phase != GameflowPhase::ChampSelect {
                        lock_in.reset();
                    }
                    game.on_phase(phase, &lcu_client);
                    let current = settings.borrow().clone();
                    if phase == GameflowPhase::ReadyCheck {
                        if current.auto_accept {
                            ready_check = Some(spawn_accept(&lcu_client, &settings, &events_tx));
                        }
                    } else if let Some(pending) = ready_check.take() {
                        // Left the ready check (answered or timed out): never accept late.
                        pending.abort();
                    }
                    if let Some(intent) = autopilot.on_phase(phase, &current) {
                        send(&events_tx, CoreEvent::Window(intent));
                    }
                }
                Some(path) = views_rx.recv() => autopilot.on_view(&path),
                Some(()) = retry_rx.recv() => game.retry(tx.borrow().phase, &lcu_client),
                Ok(()) = settings.changed() => {
                    // Switched on while the pop-up is already up.
                    let enabled = settings.borrow_and_update().auto_accept;
                    if enabled
                        && ready_check.is_none()
                        && tx.borrow().phase == GameflowPhase::ReadyCheck
                    {
                        ready_check = Some(spawn_accept(&lcu_client, &settings, &events_tx));
                    }
                }
            }
        }
        if let Some(pending) = ready_check {
            pending.abort();
        }
        if let Some(scouting) = game.task {
            scouting.abort();
        }
    });
    Companion {
        status,
        draft,
        live,
        scouting: ScoutingHandle(retry_tx),
        client,
        events,
        views: ViewReporter(views_tx),
        imports: importer,
        task,
    }
}

fn spawn_accept(
    client: &watch::Receiver<Option<LcuClient>>,
    settings: &watch::Receiver<Settings>,
    events: &mpsc::Sender<CoreEvent>,
) -> JoinHandle<()> {
    tokio::spawn(automation::accept_after_delay(
        client.clone(),
        settings.clone(),
        events.clone(),
    ))
}

/// Never blocks the core on a slow consumer: intents only matter right away.
fn send(events: &mpsc::Sender<CoreEvent>, event: CoreEvent) {
    if let Err(error) = events.try_send(event) {
        tracing::warn!(%error, "core event dropped");
    }
}

/// Keeps the champion-select view in step with the client; answers the session it read, for
/// the lock-in automation.
async fn follow_draft(
    update: &ConnectorUpdate,
    status: &watch::Sender<ClientStatus>,
    draft_tx: &watch::Sender<Option<DraftView>>,
    lcu_client: &watch::Receiver<Option<LcuClient>>,
) -> Option<serde_json::Value> {
    match update {
        ConnectorUpdate::Event(event) if event.uri == champ_select::SESSION => {
            let (next, session) = match event.kind {
                EventKind::Delete => (None, None),
                EventKind::Create | EventKind::Update => (
                    champ_select::map_session(&event.data),
                    Some(event.data.clone()),
                ),
            };
            draft_tx.send_replace(next);
            session
        }
        ConnectorUpdate::Phase(raw) if map_phase(raw) == GameflowPhase::ChampSelect => {
            // Entering champ select: read the session now instead of waiting for a change.
            let current = lcu_client.borrow().clone();
            let lcu = current?;
            let session = lcu
                .get::<serde_json::Value>(champ_select::SESSION)
                .await
                .ok()?;
            draft_tx.send_replace(champ_select::map_session(&session));
            Some(session)
        }
        ConnectorUpdate::Phase(_) | ConnectorUpdate::State(_) => {
            if status.borrow().phase != GameflowPhase::ChampSelect {
                draft_tx.send_if_modified(|d| d.take().is_some());
            }
            None
        }
        ConnectorUpdate::Event(_) => None,
    }
}

/// Applies one connector update; returns whether the status changed.
fn apply(status: &mut ClientStatus, update: &ConnectorUpdate) -> bool {
    let before = status.clone();
    match update {
        ConnectorUpdate::State(state) => {
            status.connection = map_connection(*state);
            if *state != ConnectionState::Connected {
                status.phase = GameflowPhase::Idle;
            }
        }
        ConnectorUpdate::Phase(raw) => status.phase = map_phase(raw),
        ConnectorUpdate::Event(_) => {}
    }
    *status != before
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_known_phase() {
        let cases = [
            ("None", GameflowPhase::Idle),
            ("Lobby", GameflowPhase::Lobby),
            ("Matchmaking", GameflowPhase::Matchmaking),
            ("CheckedIntoTournament", GameflowPhase::Matchmaking),
            ("ReadyCheck", GameflowPhase::ReadyCheck),
            ("ChampSelect", GameflowPhase::ChampSelect),
            ("GameStart", GameflowPhase::Loading),
            ("InProgress", GameflowPhase::InGame),
            ("Reconnect", GameflowPhase::InGame),
            ("WaitingForStats", GameflowPhase::PostGame),
            ("PreEndOfGame", GameflowPhase::PostGame),
            ("EndOfGame", GameflowPhase::PostGame),
            ("FailedToLaunch", GameflowPhase::Idle),
            ("TerminatedInError", GameflowPhase::Idle),
            ("SomethingNew", GameflowPhase::Idle),
        ];
        for (raw, expected) in cases {
            assert_eq!(map_phase(raw), expected, "{raw}");
        }
    }

    #[test]
    fn disconnecting_resets_the_phase() {
        let mut status = ClientStatus::not_running();
        assert!(apply(
            &mut status,
            &ConnectorUpdate::State(ConnectionState::Connected)
        ));
        assert!(apply(
            &mut status,
            &ConnectorUpdate::Phase("InProgress".into())
        ));
        assert_eq!(status.phase, GameflowPhase::InGame);
        assert!(apply(
            &mut status,
            &ConnectorUpdate::State(ConnectionState::NotRunning)
        ));
        assert_eq!(status, ClientStatus::not_running());
        assert!(!apply(
            &mut status,
            &ConnectorUpdate::State(ConnectionState::NotRunning)
        ));
    }
}
