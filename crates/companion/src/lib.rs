//! App core: follows the League client and publishes the UI-facing [`ClientStatus`] and
//! champion-select [`DraftView`].
//!
//! Independent of Tauri so it runs in tests and could back other front ends (CLI, web).

pub mod champ_select;

use domain::{ClientConnection, ClientStatus, DraftView, GameflowPhase};
use lcu::{ConnectionState, ConnectorConfig, ConnectorUpdate, EventKind, LcuClient};
use tokio::sync::watch;
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
    /// REST access to the client while connected.
    pub client: watch::Receiver<Option<LcuClient>>,
    pub task: JoinHandle<()>,
}

/// Starts following the client. Must run inside a Tokio runtime.
pub fn start(mut config: ConnectorConfig) -> Companion {
    if !config.paths.iter().any(|p| p == champ_select::SESSION) {
        config.paths.push(champ_select::SESSION.to_owned());
    }
    let mut connector = lcu::spawn(config);
    let client = connector.client.clone();
    let (tx, status) = watch::channel(ClientStatus::not_running());
    let (draft_tx, draft) = watch::channel(None);
    let lcu_client = client.clone();
    let task = tokio::spawn(async move {
        while let Some(update) = connector.updates.recv().await {
            tx.send_if_modified(|status| apply(status, &update));
            match &update {
                ConnectorUpdate::Event(event) if event.uri == champ_select::SESSION => {
                    let next = match event.kind {
                        EventKind::Delete => None,
                        EventKind::Create | EventKind::Update => {
                            champ_select::map_session(&event.data)
                        }
                    };
                    draft_tx.send_replace(next);
                }
                ConnectorUpdate::Phase(raw) if map_phase(raw) == GameflowPhase::ChampSelect => {
                    // Entering champ select: read the session now instead of waiting for a change.
                    let current = lcu_client.borrow().clone();
                    if let Some(lcu) = current
                        && let Ok(session) =
                            lcu.get::<serde_json::Value>(champ_select::SESSION).await
                    {
                        draft_tx.send_replace(champ_select::map_session(&session));
                    }
                }
                ConnectorUpdate::Phase(_) | ConnectorUpdate::State(_) => {
                    if tx.borrow().phase != GameflowPhase::ChampSelect {
                        draft_tx.send_if_modified(|d| d.take().is_some());
                    }
                }
                ConnectorUpdate::Event(_) => {}
            }
        }
    });
    Companion {
        status,
        draft,
        client,
        task,
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
