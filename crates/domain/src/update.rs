use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where the app's own update stands (Settings → About, the "Update ready" prompt). Pushed to
/// the UI as the `app-update` event.
///
/// Updates never download or install during champion select or a game; a ready update installs
/// when the player restarts MVP, or else when MVP quits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "camelCase")]
#[ts(export)]
pub enum UpdateStatus {
    /// This build doesn't update itself; `reason` says why (development build, no update key,
    /// or an update server without HTTPS).
    Unavailable {
        reason: String,
    },
    /// Not checked yet (the first check runs shortly after start).
    Idle,
    Checking,
    UpToDate,
    /// A newer version is out; it downloads as soon as no champion select or game is running.
    Available {
        version: String,
        notes: Option<String>,
        /// The server says this one matters (the running version is pulled or too old).
        mandatory: bool,
    },
    /// Downloading `version` (`percent` when the size is known).
    Downloading {
        version: String,
        percent: Option<u8>,
    },
    /// Downloaded and verified: installs on restart, or when MVP quits.
    Ready {
        version: String,
        notes: Option<String>,
        mandatory: bool,
    },
    /// The last check or download failed; it is tried again later.
    Failed {
        message: String,
    },
}

impl UpdateStatus {
    /// The version on offer, when there is one.
    pub fn version(&self) -> Option<&str> {
        match self {
            Self::Available { version, .. }
            | Self::Downloading { version, .. }
            | Self::Ready { version, .. } => Some(version),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states_are_tagged() {
        let json = serde_json::to_string(&UpdateStatus::Ready {
            version: "0.3.0".into(),
            notes: None,
            mandatory: false,
        })
        .expect("serializable");
        assert_eq!(
            json,
            r#"{"state":"ready","version":"0.3.0","notes":null,"mandatory":false}"#
        );
        let json = serde_json::to_string(&UpdateStatus::UpToDate).expect("serializable");
        assert_eq!(json, r#"{"state":"upToDate"}"#);
        assert_eq!(
            UpdateStatus::Downloading {
                version: "0.3.0".into(),
                percent: Some(40)
            }
            .version(),
            Some("0.3.0")
        );
    }
}
