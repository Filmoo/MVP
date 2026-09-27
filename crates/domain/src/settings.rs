use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// User preferences, owned and persisted by the core.
///
/// Every field has a default, so settings files from older versions (missing fields) still load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "independent on/off preferences, one per switch in the UI"
)]
pub struct Settings {
    /// Accept the match found pop-up automatically. Opt-in only (Riot policy gray area).
    pub auto_accept: bool,
    /// Seconds to wait before accepting, so the player still sees the pop-up
    /// (`0..=MAX_AUTO_ACCEPT_DELAY`).
    pub auto_accept_delay_seconds: u8,
    /// Show and focus the window when champion select starts.
    pub bring_to_front_on_champ_select: bool,
    /// Follow the game: Draft in champion select, Live in game, Home afterwards.
    pub auto_switch_view: bool,
    /// Start with Windows, in the tray.
    pub launch_at_startup: bool,
    /// Closing the window keeps the app running in the tray.
    pub close_to_tray: bool,
}

impl Settings {
    pub const MAX_AUTO_ACCEPT_DELAY: u8 = 8;

    /// Brings every field into its valid range.
    #[must_use]
    pub fn normalized(mut self) -> Self {
        self.auto_accept_delay_seconds = self
            .auto_accept_delay_seconds
            .min(Self::MAX_AUTO_ACCEPT_DELAY);
        self
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_accept: false,
            auto_accept_delay_seconds: 2,
            bring_to_front_on_champ_select: true,
            auto_switch_view: true,
            launch_at_startup: false,
            close_to_tray: true,
        }
    }
}

/// Views the core may send the UI to when the game moves on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ViewRoute {
    #[serde(rename = "/")]
    Home,
    #[serde(rename = "/draft")]
    Draft,
    #[serde(rename = "/live")]
    Live,
}

impl ViewRoute {
    /// The UI's route path (hash router).
    pub const fn path(self) -> &'static str {
        match self {
            Self::Home => "/",
            Self::Draft => "/draft",
            Self::Live => "/live",
        }
    }
}

/// Outcome of an automatic ready-check accept, for a toast in the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum AutoAcceptEvent {
    /// The match was accepted for the player.
    Accepted,
    /// The client refused the accept.
    Failed { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_take_their_defaults() {
        let settings: Settings =
            serde_json::from_str(r#"{"autoAccept":true}"#).expect("deserializable");
        assert_eq!(
            settings,
            Settings {
                auto_accept: true,
                ..Settings::default()
            }
        );
    }

    #[test]
    fn auto_accept_is_off_by_default() {
        assert!(!Settings::default().auto_accept);
    }

    #[test]
    fn clamps_the_delay() {
        let settings = Settings {
            auto_accept_delay_seconds: 60,
            ..Settings::default()
        }
        .normalized();
        assert_eq!(
            settings.auto_accept_delay_seconds,
            Settings::MAX_AUTO_ACCEPT_DELAY
        );
    }

    #[test]
    fn routes_serialize_as_paths() {
        let json = serde_json::to_string(&ViewRoute::Draft).expect("serializable");
        assert_eq!(json, r#""/draft""#);
        assert_eq!(ViewRoute::Live.path(), "/live");
    }

    #[test]
    fn auto_accept_events_are_tagged() {
        let json = serde_json::to_string(&AutoAcceptEvent::Accepted).expect("serializable");
        assert_eq!(json, r#"{"kind":"accepted"}"#);
    }
}
