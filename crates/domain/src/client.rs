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
    /// This installation's random id (`X-MVP-Install`): not linked to the Riot account, it
    /// files crash reports, so it is what a player quotes to have theirs deleted. `None`
    /// outside the app.
    #[serde(default)]
    pub install_id: Option<String>,
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
    /// Subscribed to its events, but the client doesn't answer requests (busy, or another app
    /// holds every connection it accepts). The core asks it again by itself, with a pause that
    /// grows, and the next answer makes it `connected` again.
    NotAnswering,
}

/// Why the League client couldn't answer a command (`current_profile`), as the UI words it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ClientError {
    /// It didn't answer at all (the connection status turns `notAnswering`): the core asks it
    /// again by itself, and the status says when it answers.
    NotAnswering,
    /// It answered with an error.
    Failed { message: String },
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAnswering => f.write_str("the League client isn't answering"),
            Self::Failed { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for ClientError {}

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
        let json = serde_json::to_string(&ClientConnection::NotAnswering).expect("serializable");
        assert_eq!(json, r#""notAnswering""#);
    }

    #[test]
    fn client_errors_are_tagged() {
        let json = serde_json::to_string(&ClientError::NotAnswering).expect("serializable");
        assert_eq!(json, r#"{"kind":"notAnswering"}"#);
        let failed = ClientError::Failed {
            message: "HTTP 503".into(),
        };
        let json = serde_json::to_string(&failed).expect("serializable");
        assert_eq!(json, r#"{"kind":"failed","message":"HTTP 503"}"#);
    }
}
