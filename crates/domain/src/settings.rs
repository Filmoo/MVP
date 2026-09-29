use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

use crate::{Bracket, FlashKey, ImportMode};

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
    /// How much the window draws: glass, light and motion.
    #[serde(deserialize_with = "or_default")]
    pub effects: Effects,
    /// The app's language; `auto` follows the system's (the webview's) language.
    #[serde(deserialize_with = "or_default")]
    pub language: Language,
    /// Rune page import: off, one click, or also automatically on lock-in.
    #[serde(deserialize_with = "or_default")]
    pub import_runes: ImportMode,
    /// Item set import: off, one click, or also automatically on lock-in.
    #[serde(deserialize_with = "or_default")]
    pub import_item_set: ImportMode,
    /// Summoner spells import (champion select only): off, one click, or also on lock-in.
    #[serde(deserialize_with = "or_default")]
    pub import_spells: ImportMode,
    /// The key Flash goes on when spells are imported.
    #[serde(deserialize_with = "or_default")]
    pub flash_key: FlashKey,
    /// Whose games the stats count: the draft's picks and compositions, imported builds, and
    /// the Tier list and Champions pages until a bracket is picked there.
    #[serde(deserialize_with = "or_default")]
    pub stats_bracket: Bracket,
    /// Send crash reports (opt-in): a crash of the core or an error in the UI goes to our
    /// server, scrubbed of names, ids and paths first, and is kept 30 days.
    pub crash_reports: bool,
    /// Help build Mayhem stats (opt-in): after each ARAM: Mayhem game, and once for the recent
    /// ones when turned on, the champions, augments and final items of its ten players go to
    /// our server, with a one-way hash of the game. No names, ids of players or wins.
    pub share_mayhem_games: bool,
}

/// Visual effects level. The UI keeps a copy in `localStorage` so the first frame already
/// matches; this is the lasting choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Effects {
    /// The default: `Full`, unless Windows asks for less transparency (its "Transparency
    /// effects" switch off), then `Light`.
    #[default]
    Auto,
    /// Liquid glass that bends light, and the light shader, when the GPU draws them cheaply
    /// (else the same as `Light`), whatever Windows' transparency switch says: the player
    /// chose it.
    Full,
    /// Soft blur and static light only.
    Light,
    /// Flat background, no blur: the lightest.
    Off,
}

/// The app's language. The UI keeps a copy in `localStorage` so the first frame is already in
/// it; this is the lasting choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Language {
    /// The system's language: French when the webview's language is French, else English.
    #[default]
    Auto,
    En,
    Fr,
}

impl Language {
    /// Riot's locale for game data (Data Dragon names) in this language. `Auto` is resolved by
    /// the UI (the webview knows the system's language); unresolved, it reads as English.
    #[must_use]
    pub const fn data_dragon_locale(self) -> &'static str {
        match self {
            Self::Fr => "fr_FR",
            Self::Auto | Self::En => "en_US",
        }
    }
}

/// A value this version doesn't know (written by a newer one) falls back to the default
/// instead of failing the whole settings file.
fn or_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Known<T> {
        Value(T),
        Other(serde::de::IgnoredAny),
    }
    Ok(match Known::<T>::deserialize(deserializer)? {
        Known::Value(value) => value,
        Known::Other(_) => T::default(),
    })
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
            effects: Effects::Auto,
            language: Language::Auto,
            // One click is user-triggered; automatic imports are opt-in (docs/policy.md).
            import_runes: ImportMode::OneClick,
            import_item_set: ImportMode::OneClick,
            import_spells: ImportMode::OneClick,
            flash_key: FlashKey::Auto,
            stats_bracket: Bracket::EmeraldPlus,
            crash_reports: false,
            share_mayhem_games: false,
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
    fn effects_serialize_as_the_ui_names_them() {
        let json = serde_json::to_string(&Settings {
            effects: Effects::Light,
            ..Settings::default()
        })
        .expect("serializable");
        assert!(json.contains(r#""effects":"light""#), "{json}");
        let old: Settings = serde_json::from_str(r#"{"closeToTray":false}"#).expect("loads");
        assert_eq!(old.effects, Effects::Auto);
        let full: Settings = serde_json::from_str(r#"{"effects":"full"}"#).expect("loads");
        assert_eq!(full.effects, Effects::Full);
    }

    #[test]
    fn language_follows_the_system_until_chosen() {
        assert_eq!(Settings::default().language, Language::Auto);
        let old: Settings = serde_json::from_str(r#"{"closeToTray":false}"#).expect("loads");
        assert_eq!(
            old.language,
            Language::Auto,
            "files from before the setting"
        );
        let chosen: Settings = serde_json::from_str(r#"{"language":"fr"}"#).expect("loads");
        assert_eq!(chosen.language, Language::Fr);
        let newer: Settings = serde_json::from_str(r#"{"language":"de"}"#).expect("loads");
        assert_eq!(
            newer.language,
            Language::Auto,
            "a language this version lacks"
        );
        let json = serde_json::to_string(&chosen).expect("serializable");
        assert!(json.contains(r#""language":"fr""#), "{json}");
    }

    #[test]
    fn languages_map_to_data_dragon_locales() {
        assert_eq!(Language::Fr.data_dragon_locale(), "fr_FR");
        assert_eq!(Language::En.data_dragon_locale(), "en_US");
        assert_eq!(Language::Auto.data_dragon_locale(), "en_US");
    }

    #[test]
    fn opt_ins_are_off_by_default() {
        assert!(!Settings::default().auto_accept);
        assert!(!Settings::default().crash_reports);
        assert!(!Settings::default().share_mayhem_games);
        let older: Settings = serde_json::from_str(r#"{"closeToTray":false}"#).expect("loads");
        assert!(
            !older.crash_reports,
            "files from before the setting existed"
        );
        assert!(!older.share_mayhem_games);
        let json = serde_json::to_string(&Settings::default()).expect("serializable");
        assert!(json.contains(r#""shareMayhemGames":false"#), "{json}");
    }

    #[test]
    fn imports_are_one_click_by_default() {
        let settings = Settings::default();
        for mode in [
            settings.import_runes,
            settings.import_item_set,
            settings.import_spells,
        ] {
            assert_eq!(mode, ImportMode::OneClick);
        }
        assert_eq!(settings.flash_key, FlashKey::Auto);
    }

    #[test]
    fn unknown_values_fall_back_to_defaults() {
        let settings: Settings = serde_json::from_str(
            r#"{"autoAccept":true,"importRunes":"onLockIn","importSpells":"someFutureMode","flashKey":7}"#,
        )
        .expect("deserializable");
        assert!(settings.auto_accept);
        assert_eq!(settings.import_runes, ImportMode::OnLockIn);
        assert_eq!(settings.import_spells, ImportMode::OneClick);
        assert_eq!(settings.flash_key, FlashKey::Auto);
        let json = serde_json::to_string(&Settings {
            flash_key: FlashKey::F,
            ..Settings::default()
        })
        .expect("serializable");
        assert!(json.contains(r#""importItemSet":"oneClick""#), "{json}");
        assert!(json.contains(r#""flashKey":"f""#), "{json}");
    }

    #[test]
    fn stats_count_emerald_and_up_until_chosen() {
        assert_eq!(Settings::default().stats_bracket, Bracket::EmeraldPlus);
        let old: Settings = serde_json::from_str(r#"{"closeToTray":false}"#).expect("loads");
        assert_eq!(
            old.stats_bracket,
            Bracket::EmeraldPlus,
            "files from before the setting"
        );
        let chosen: Settings =
            serde_json::from_str(r#"{"statsBracket":"masterPlus"}"#).expect("loads");
        assert_eq!(chosen.stats_bracket, Bracket::MasterPlus);
        let newer: Settings =
            serde_json::from_str(r#"{"statsBracket":"grandmasterPlus"}"#).expect("loads");
        assert_eq!(
            newer.stats_bracket,
            Bracket::EmeraldPlus,
            "a bracket this version lacks"
        );
        let json = serde_json::to_string(&chosen).expect("serializable");
        assert!(json.contains(r#""statsBracket":"masterPlus""#), "{json}");
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
