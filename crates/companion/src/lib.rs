//! App core: follows the League client and publishes the UI-facing [`ClientStatus`],
//! champion-select [`DraftView`] and loading-screen [`LiveGame`], runs the client automations,
//! owns the settings and talks to our backend.
//!
//! Independent of Tauri so it runs in tests and could back other front ends (CLI, web).

pub mod automation;
pub mod backend;
pub mod champ_select;
pub mod crash;
pub mod live;
pub mod profile;
pub mod remote;
pub mod settings;
pub mod updates;

use automation::{Autopilot, CoreEvent};
use backend::BackendClient;
use domain::{
    ClientConnection, ClientStatus, DraftView, GameflowPhase, LiveGame, RemoteConfig, Settings,
};
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
    pub task: JoinHandle<()>,
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
    /// The `scouting` feature flag can turn lookups off.
    remote: watch::Receiver<RemoteConfig>,
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
        let lookups = self.remote.borrow().features.scouting;
        self.task = Some(tokio::spawn(live::scout_game(
            lcu,
            self.backend.clone().filter(|_| lookups),
            self.tx.clone(),
        )));
    }
}

/// Auto-accept of the ready check: at most one per ready check, and only while both the
/// player's setting and the remote config (feature flag, kill switch) allow it. A kill switch
/// stops a pending accept at once.
struct AutoAccept {
    client: watch::Receiver<Option<LcuClient>>,
    settings: watch::Receiver<Settings>,
    remote: watch::Receiver<RemoteConfig>,
    events: mpsc::Sender<CoreEvent>,
    pending: Option<JoinHandle<()>>,
}

impl AutoAccept {
    fn allowed(&self) -> bool {
        self.settings.borrow().auto_accept && remote::auto_accept_allowed(&self.remote.borrow())
    }

    /// A new phase: starts on the ready check; leaving it (answered or timed out) cancels, so
    /// it never accepts late.
    fn on_phase(&mut self, phase: GameflowPhase) {
        if phase != GameflowPhase::ReadyCheck {
            self.stop();
        } else if self.allowed() {
            self.start();
        }
    }

    /// The setting or the remote config changed: switched on while the pop-up is up, accept;
    /// switched off or killed, stop.
    fn on_change(&mut self, phase: GameflowPhase) {
        if !self.allowed() {
            self.stop();
        } else if self.pending.is_none() && phase == GameflowPhase::ReadyCheck {
            self.start();
        }
    }

    fn start(&mut self) {
        self.pending = Some(tokio::spawn(automation::accept_after_delay(
            self.client.clone(),
            self.settings.clone(),
            self.remote.clone(),
            self.events.clone(),
        )));
    }

    fn stop(&mut self) {
        if let Some(pending) = self.pending.take() {
            pending.abort();
        }
    }
}

/// Starts following the client with the player's `settings`, without a backend (no scouting
/// cards). Must run inside a Tokio runtime.
pub fn start(config: ConnectorConfig, settings: watch::Receiver<Settings>) -> Companion {
    start_with(config, settings, None)
}

/// Starts following the client with the player's `settings`; `backend` answers the scouting
/// batches. Must run inside a Tokio runtime.
pub fn start_with(
    config: ConnectorConfig,
    settings: watch::Receiver<Settings>,
    backend: Option<BackendClient>,
) -> Companion {
    start_full(
        config,
        settings,
        backend,
        watch::channel(RemoteConfig::default()).1,
    )
}

/// Like [`start_with`], following the server's `remote` config: kill switches and feature
/// flags apply as soon as they change. Must run inside a Tokio runtime.
pub fn start_full(
    mut config: ConnectorConfig,
    mut settings: watch::Receiver<Settings>,
    backend: Option<BackendClient>,
    mut remote: watch::Receiver<RemoteConfig>,
) -> Companion {
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
    let task = tokio::spawn(async move {
        let mut autopilot = Autopilot::default();
        let mut game = LiveFollower {
            tx: live_tx,
            backend,
            remote: remote.clone(),
            task: None,
        };
        let mut accept = AutoAccept {
            client: lcu_client.clone(),
            settings: settings.clone(),
            remote: remote.clone(),
            events: events_tx.clone(),
            pending: None,
        };
        loop {
            tokio::select! {
                update = connector.updates.recv() => {
                    let Some(update) = update else { break };
                    let before = tx.borrow().phase;
                    tx.send_if_modified(|status| apply(status, &update));
                    follow_draft(&update, &tx, &draft_tx, &lcu_client).await;
                    let phase = tx.borrow().phase;
                    if phase == before {
                        continue;
                    }
                    game.on_phase(phase, &lcu_client);
                    accept.on_phase(phase);
                    let current = settings.borrow().clone();
                    if let Some(intent) = autopilot.on_phase(phase, &current) {
                        send(&events_tx, CoreEvent::Window(intent));
                    }
                }
                Some(path) = views_rx.recv() => autopilot.on_view(&path),
                Some(()) = retry_rx.recv() => game.retry(tx.borrow().phase, &lcu_client),
                Ok(()) = settings.changed() => {
                    settings.borrow_and_update();
                    accept.on_change(tx.borrow().phase);
                }
                Ok(()) = remote.changed() => {
                    remote.borrow_and_update();
                    accept.on_change(tx.borrow().phase);
                }
            }
        }
        accept.stop();
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
        task,
    }
}

/// Never blocks the core on a slow consumer: intents only matter right away.
fn send(events: &mpsc::Sender<CoreEvent>, event: CoreEvent) {
    if let Err(error) = events.try_send(event) {
        tracing::warn!(%error, "core event dropped");
    }
}

/// Keeps the champion-select view in step with the client.
async fn follow_draft(
    update: &ConnectorUpdate,
    status: &watch::Sender<ClientStatus>,
    draft_tx: &watch::Sender<Option<DraftView>>,
    lcu_client: &watch::Receiver<Option<LcuClient>>,
) {
    match update {
        ConnectorUpdate::Event(event) if event.uri == champ_select::SESSION => {
            let next = match event.kind {
                EventKind::Delete => None,
                EventKind::Create | EventKind::Update => champ_select::map_session(&event.data),
            };
            draft_tx.send_replace(next);
        }
        ConnectorUpdate::Phase(raw) if map_phase(raw) == GameflowPhase::ChampSelect => {
            // Entering champ select: read the session now instead of waiting for a change.
            let current = lcu_client.borrow().clone();
            if let Some(lcu) = current
                && let Ok(session) = lcu.get::<serde_json::Value>(champ_select::SESSION).await
            {
                draft_tx.send_replace(champ_select::map_session(&session));
            }
        }
        ConnectorUpdate::Phase(_) | ConnectorUpdate::State(_) => {
            if status.borrow().phase != GameflowPhase::ChampSelect {
                draft_tx.send_if_modified(|d| d.take().is_some());
            }
        }
        ConnectorUpdate::Event(_) => {}
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
