use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

use crate::{Bracket, FlashKey, ImportPart};

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
    /// Auto import of MVP's rune page: by itself, once, at the first lock-in of a champion
    /// select. The Runes button works either way. (`importRunes` in files up to 0.2.)
    #[serde(alias = "importRunes", deserialize_with = "auto_import")]
    pub auto_import_runes: bool,
    /// Auto import of MVP's item set, like the rune page's. (`importItemSet` up to 0.2.)
    #[serde(alias = "importItemSet", deserialize_with = "auto_import")]
    pub auto_import_item_set: bool,
    /// Auto import of the summoner spells, like the rune page's (champion select only, never in
    /// its last seconds). (`importSpells` up to 0.2.)
    #[serde(alias = "importSpells", deserialize_with = "auto_import")]
    pub auto_import_spells: bool,
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

/// An "Auto import" switch: `true` / `false`, or the per-part mode files up to 0.2 kept
/// (`"onLockIn"` → on; `"oneClick"` and `"off"` → off: every part's button is always there now).
/// Anything else is off, the default, without failing the file.
fn auto_import<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Switch {
        On(bool),
        Mode(String),
        Other(serde::de::IgnoredAny),
    }
    Ok(match Switch::deserialize(deserializer)? {
        Switch::On(on) => on,
        Switch::Mode(mode) => mode == "onLockIn",
        Switch::Other(_) => false,
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

    /// Whether `part` is imported by itself at the first lock-in of a champion select.
    #[must_use]
    pub const fn auto_import(&self, part: ImportPart) -> bool {
        match part {
            ImportPart::Runes => self.auto_import_runes,
            ImportPart::ItemSet => self.auto_import_item_set,
            ImportPart::Spells => self.auto_import_spells,
        }
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
            // The buttons are user-triggered; automatic imports are opt-in (docs/policy.md).
            auto_import_runes: false,
            auto_import_item_set: false,
            auto_import_spells: false,
            flash_key: FlashKey::Auto,
            stats_bracket: Bracket::EmeraldPlus,
            crash_reports: false,
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
        let older: Settings = serde_json::from_str(r#"{"closeToTray":false}"#).expect("loads");
        assert!(
            !older.crash_reports,
            "files from before the setting existed"
        );
    }

    #[test]
    fn auto_import_is_off_by_default() {
        let settings = Settings::default();
        for part in ImportPart::ALL {
            assert!(!settings.auto_import(part), "{part:?}");
        }
        assert_eq!(settings.flash_key, FlashKey::Auto);
        let older: Settings = serde_json::from_str(r#"{"closeToTray":false}"#).expect("loads");
        assert!(ImportPart::ALL.into_iter().all(|p| !older.auto_import(p)));
    }

    /// A settings file as 0.2 wrote it (per-part modes): "on lock-in" turns the part's auto
    /// import on, "one click" and "off" leave it off (its button is always there now), and every
    /// other setting is kept.
    #[test]
    fn files_of_0_2_keep_everything_and_their_lock_in_imports() {
        let written_by_0_2 = r#"{
          "autoAccept": true,
          "autoAcceptDelaySeconds": 4,
          "bringToFrontOnChampSelect": false,
          "autoSwitchView": true,
          "launchAtStartup": true,
          "closeToTray": false,
          "effects": "light",
          "language": "fr",
          "importRunes": "onLockIn",
          "importItemSet": "oneClick",
          "importSpells": "off",
          "flashKey": "f",
          "statsBracket": "diamondPlus",
          "crashReports": true
        }"#;
        let settings: Settings = serde_json::from_str(written_by_0_2).expect("loads");
        assert_eq!(
            settings,
            Settings {
                auto_accept: true,
                auto_accept_delay_seconds: 4,
                bring_to_front_on_champ_select: false,
                auto_switch_view: true,
                launch_at_startup: true,
                close_to_tray: false,
                effects: Effects::Light,
                language: Language::Fr,
                auto_import_runes: true,
                auto_import_item_set: false,
                auto_import_spells: false,
                flash_key: FlashKey::F,
                stats_bracket: Bracket::DiamondPlus,
                crash_reports: true,
            }
        );
        let all_on: Settings = serde_json::from_str(
            r#"{"importRunes":"onLockIn","importItemSet":"onLockIn","importSpells":"onLockIn"}"#,
        )
        .expect("loads");
        assert!(ImportPart::ALL.into_iter().all(|p| all_on.auto_import(p)));
        // Written back in this version's words only.
        let json = serde_json::to_string(&settings).expect("serializable");
        assert!(json.contains(r#""autoImportRunes":true"#), "{json}");
        assert!(json.contains(r#""autoImportItemSet":false"#), "{json}");
        assert!(!json.contains("importRunes\""), "{json}");
        let again: Settings = serde_json::from_str(&json).expect("loads");
        assert_eq!(again, settings);
    }

    #[test]
    fn unknown_values_fall_back_to_defaults() {
        let settings: Settings = serde_json::from_str(
            r#"{"autoAccept":true,"autoImportRunes":true,"autoImportSpells":"someFutureMode","autoImportItemSet":3,"flashKey":7}"#,
        )
        .expect("deserializable");
        assert!(settings.auto_accept);
        assert!(settings.auto_import_runes);
        assert!(!settings.auto_import_spells);
        assert!(!settings.auto_import_item_set);
        assert_eq!(settings.flash_key, FlashKey::Auto);
        let json = serde_json::to_string(&Settings {
            flash_key: FlashKey::F,
            ..Settings::default()
        })
        .expect("serializable");
        assert!(json.contains(r#""autoImportItemSet":false"#), "{json}");
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
