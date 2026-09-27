use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Static information about the running app build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    /// `windows`, `macos`, `linux` or `web`.
    pub platform: String,
}

/// Connection state between the app and the local League client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ClientConnection {
    /// No League client process found.
    NotRunning,
    /// Client found, handshake in progress.
    Connecting,
    /// Authenticated and subscribed to client events.
    Connected,
}

/// Where the League client is in its lifecycle.
///
/// Mirrors the client's gameflow phases, collapsed to what the UI cares about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum GameflowPhase {
    Idle,
    Lobby,
    Matchmaking,
    ReadyCheck,
    ChampSelect,
    Loading,
    InGame,
    PostGame,
}

/// Snapshot of the local client state pushed to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClientStatus {
    pub connection: ClientConnection,
    pub phase: GameflowPhase,
}

impl ClientStatus {
    pub const fn not_running() -> Self {
        Self {
            connection: ClientConnection::NotRunning,
            phase: GameflowPhase::Idle,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_camel_case() {
        let status = ClientStatus {
            connection: ClientConnection::NotRunning,
            phase: GameflowPhase::ChampSelect,
        };
        let json = serde_json::to_string(&status).expect("serializable");
        assert_eq!(json, r#"{"connection":"notRunning","phase":"champSelect"}"#);
    }
}
