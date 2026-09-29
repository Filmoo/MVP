//! App core: follows the League client and publishes the UI-facing [`ClientStatus`],
//! champion-select [`DraftView`] (with the draft helper's numbers) and loading-screen
//! [`LiveGame`], runs the client automations and build imports, owns the settings and talks to
//! our backend.
//!
//! Independent of Tauri so it runs in tests and could back other front ends (CLI, web).

pub mod automation;
pub mod backend;
pub mod champ_select;
pub mod crash;
pub mod draft;
pub mod imports;
pub mod live;
pub mod lp;
pub mod matches;
pub mod post_game;
pub mod profile;
pub mod remote;
pub mod settings;
pub mod stats;
pub mod updates;

use std::sync::Arc;

use automation::{Autopilot, CoreEvent};
use backend::BackendClient;
use domain::{
    ClientConnection, ClientStatus, DraftView, GameflowPhase, ImportResult, ImportWarning,
    Language, LiveGame, RemoteConfig, Settings,
};
use imports::{BuildSource, ChampionNames, Importer, LockIn, NoBuilds};
use lcu::{ConnectionState, ConnectorConfig, ConnectorUpdate, EventKind, LcuClient};
use live::{GameClient, GameIds, LiveConfig, NoGameIds};
use tokio::sync::{mpsc, watch};

use crate::stats::StatsClient;
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
        ConnectionState::NotAnswering => ClientConnection::NotAnswering,
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
    /// Draft's warning after the automatic import: the player's champion or role changed since
    /// (`None` otherwise, and outside of champion select).
    pub import_warning: watch::Receiver<Option<ImportWarning>>,
    /// Your profile, and every game's grades and details, read once and kept.
    pub matches: matches::MatchInsights,
    /// The summary of the game that just ended (until dismissed or the next game) and the LP of
    /// your tracked ranked games.
    pub post_game: post_game::PostGameHandle,
    pub task: JoinHandle<()>,
}

/// What the core uses besides the League client.
pub struct Services {
    /// Our backend, for the loading-screen scouting cards (`None`: no cards).
    pub backend: Option<BackendClient>,
    /// The server's remote config: kill switches and feature flags apply as soon as they
    /// change (default: everything on, for good).
    pub remote: watch::Receiver<RemoteConfig>,
    /// Published champion stats: the draft helper's numbers (without them the draft shows the
    /// teams only).
    pub stats: Option<StatsClient>,
    /// Builds for the imports: the published stats ([`NoBuilds`] until they are wired).
    pub builds: Arc<dyn BuildSource>,
    /// Champion names, for the names of MVP's rune page and item sets.
    pub names: ChampionNames,
    /// The UI's language (`auto` resolved by the UI), for the words MVP writes into the League
    /// client (its item set's block titles). English until the UI says.
    pub language: watch::Receiver<Language>,
    /// Where the players of a game are named when Riot's live game has none: the game's own
    /// API ([`LiveConfig::for_the_game`] in the app; never asked by default).
    pub live: LiveConfig,
    /// Champion and spell ids of the names the game uses (its player list).
    pub game_ids: Arc<dyn GameIds>,
    /// Where the LP of your ranked games is kept (`lp::FILE_NAME` in the app's data folder;
    /// `None`: in memory only).
    pub lp_file: Option<std::path::PathBuf>,
}

impl Default for Services {
    fn default() -> Self {
        Self {
            backend: None,
            remote: watch::channel(RemoteConfig::default()).1,
            stats: None,
            builds: Arc::new(NoBuilds),
            names: Arc::new(|_| None),
            language: watch::channel(Language::En).1,
            live: LiveConfig::default(),
            game_ids: Arc::new(NoGameIds),
            lp_file: None,
        }
    }
}

impl std::fmt::Debug for Services {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Services")
            .field("backend", &self.backend)
            .field("remote", &*self.remote.borrow())
            .field("stats", &self.stats)
            .field("language", &*self.language.borrow())
            .field("live", &self.live)
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

/// Follows the game from the loading screen to the end: one scouting task per game. Nothing
/// runs outside a game: the task (and its questions to the game's API) ends with it.
struct LiveFollower {
    tx: watch::Sender<Option<LiveGame>>,
    backend: Option<BackendClient>,
    /// The `scouting` feature flag can turn lookups off.
    remote: watch::Receiver<RemoteConfig>,
    /// The game's own API (`None`: not asked).
    game: Option<GameClient>,
    game_ids: Arc<dyn GameIds>,
    riot_retry: std::time::Duration,
    task: Option<JoinHandle<()>>,
}

impl LiveFollower {
    /// `tls`: the League client's, which the game's own API serves on too.
    fn new(
        tx: watch::Sender<Option<LiveGame>>,
        services: &Services,
        tls: &Arc<rustls::ClientConfig>,
    ) -> Self {
        let config = &services.live;
        let game = config.game_client.as_deref().and_then(|url| {
            GameClient::new(url, config.game_poll, Arc::clone(tls))
                .inspect_err(|error| tracing::error!(%error, "cannot build the game API client"))
                .ok()
        });
        Self {
            tx,
            backend: services.backend.clone(),
            remote: services.remote.clone(),
            game,
            game_ids: Arc::clone(&services.game_ids),
            riot_retry: config.riot_retry,
            task: None,
        }
    }

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
            self.spawn(client, None);
        }
    }

    /// Asks again for what's missing: the cards when the names are in, else everything.
    fn retry(&mut self, phase: GameflowPhase, client: &watch::Receiver<Option<LcuClient>>) {
        if Self::in_game(phase) {
            let previous = self.tx.borrow().clone();
            self.spawn(client, previous);
        }
    }

    fn spawn(&mut self, client: &watch::Receiver<Option<LcuClient>>, previous: Option<LiveGame>) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        let Some(lcu) = client.borrow().clone() else {
            return;
        };
        let lookups = self.remote.borrow().features.scouting;
        let sources = live::Sources {
            backend: self.backend.clone().filter(|_| lookups),
            game: self.game.clone(),
            ids: Arc::clone(&self.game_ids),
            riot_retry: self.riot_retry,
        };
        self.task = Some(tokio::spawn(live::scout_game(
            lcu,
            sources,
            self.tx.clone(),
            previous,
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
    fn new(
        client: &watch::Receiver<Option<LcuClient>>,
        settings: &watch::Receiver<Settings>,
        remote: &watch::Receiver<RemoteConfig>,
        events: &mpsc::Sender<CoreEvent>,
    ) -> Self {
        Self {
            client: client.clone(),
            settings: settings.clone(),
            remote: remote.clone(),
            events: events.clone(),
            pending: None,
        }
    }

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
    let (live_tx, live) = watch::channel(None);
    let mut game = LiveFollower::new(live_tx, &services, &config.tls);
    let Services {
        mut remote,
        stats,
        builds,
        names,
        language,
        lp_file,
        ..
    } = services;
    follow_paths(&mut config, &[champ_select::SESSION, post_game::RANKED]);
    let mut connector = lcu::spawn(config);
    let client = connector.client.clone();
    let (tx, status) = watch::channel(ClientStatus::not_running());
    // Your games' roles are worked out with the champions' published role shares.
    let insights = matches::MatchInsights::new(stats.clone());
    // Sessions as mapped (teams only) → the draft helper → the UI.
    let helper = draft::spawn(client.clone(), stats, remote.clone(), settings.clone());
    let draft = helper.views.clone();
    let (events_tx, events) = mpsc::channel(32);
    let (views_tx, mut views_rx) = mpsc::unbounded_channel::<String>();
    let (retry_tx, mut retry_rx) = mpsc::unbounded_channel::<()>();
    let lcu_client = client.clone();
    // Every import, whoever asked, reaches the automatic import's warning.
    let (reports_tx, mut import_reports) = mpsc::unbounded_channel::<ImportResult>();
    let importer = Importer::new(
        client.clone(),
        status.clone(),
        settings.clone(),
        remote.clone(),
        builds,
        names,
        language,
    )
    .reporting(reports_tx);
    let (warning_tx, import_warning) = watch::channel(None);
    let mut lock_in = LockIn::new(importer.clone(), events_tx.clone(), warning_tx);
    // The last game's summary and the LP of your ranked games.
    let mut post_games = post_game::PostGames::new(client.clone(), insights.clone(), lp_file);
    let post_game = post_games.handle();
    let task = tokio::spawn(async move {
        let mut autopilot = Autopilot::default();
        let mut accept = AutoAccept::new(&lcu_client, &settings, &remote, &events_tx);
        loop {
            tokio::select! {
                update = connector.updates.recv() => {
                    let Some(update) = update else { break };
                    let before = tx.borrow().phase;
                    tx.send_if_modified(|status| apply(status, &update));
                    post_games.on_update(&update);
                    if let Some(session) = follow_draft(&update, &tx, &helper.sessions, &lcu_client).await {
                        lock_in.on_session(&session);
                    }
                    let phase = tx.borrow().phase;
                    if phase == before {
                        continue;
                    }
                    if phase != GameflowPhase::ChampSelect {
                        lock_in.reset();
                    }
                    post_games.on_phase(phase);
                    game.on_phase(phase, &lcu_client);
                    accept.on_phase(phase);
                    let current = settings.borrow().clone();
                    if let Some(intent) = autopilot.on_phase(phase, &current) {
                        send(&events_tx, CoreEvent::Window(intent));
                    }
                }
                Some(path) = views_rx.recv() => autopilot.on_view(&path),
                Some(()) = retry_rx.recv() => game.retry(tx.borrow().phase, &lcu_client),
                Some(result) = import_reports.recv() => lock_in.on_imported(&result),
                Ok(()) = settings.changed() => {
                    settings.borrow_and_update();
                    accept.on_change(tx.borrow().phase);
                    lock_in.on_settings();
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
        helper.task.abort();
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
        import_warning,
        matches: insights,
        post_game,
        task,
    }
}

/// Subscribes the connector to `paths` too (the gameflow phase is always followed).
fn follow_paths(config: &mut ConnectorConfig, paths: &[&str]) {
    for &path in paths {
        if !config.paths.iter().any(|p| p == path) {
            config.paths.push(path.to_owned());
        }
    }
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
            // A client that doesn't answer requests still sends its events: the game goes on.
            if !matches!(
                state,
                ConnectionState::Connected | ConnectionState::NotAnswering
            ) {
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

    #[test]
    fn a_client_not_answering_keeps_its_phase() {
        let mut status = ClientStatus::not_running();
        apply(
            &mut status,
            &ConnectorUpdate::State(ConnectionState::Connected),
        );
        apply(&mut status, &ConnectorUpdate::Phase("InProgress".into()));
        assert!(apply(
            &mut status,
            &ConnectorUpdate::State(ConnectionState::NotAnswering)
        ));
        assert_eq!(
            status,
            ClientStatus {
                connection: ClientConnection::NotAnswering,
                phase: GameflowPhase::InGame,
            },
            "events still flow: the game goes on"
        );
        assert!(apply(
            &mut status,
            &ConnectorUpdate::State(ConnectionState::Connected)
        ));
        assert_eq!(status.phase, GameflowPhase::InGame);
    }
}
