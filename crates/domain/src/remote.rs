//! What the backend pushes to every app: remote config (feature flags, kill switches, banners)
//! and the body of opt-in crash/diagnostic reports.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `GET /v1/config?version=…&channel=…`: settings the server pushes to every app.
///
/// Every field has a default, so an app can always fall back to `RemoteConfig::default()`
/// (all features on, no kill switch, no banner) when the server is unreachable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct RemoteConfig {
    pub features: FeatureFlags,
    pub kill_switches: KillSwitches,
    /// Oldest app version the server still supports, with the message to show below it.
    pub min_version: Option<MinVersion>,
    /// The requesting app (`?version=`) is below `minVersion`: block the UI behind the message
    /// and offer the update.
    pub update_required: bool,
    /// Banners active right now (already filtered by their start/end time), in display order.
    pub banners: Vec<Banner>,
    /// Where the published stats aggregates start (`index.json` on the CDN), if published.
    pub stats_index_url: Option<String>,
    /// Hint: fetch the config again after this many seconds (with `If-None-Match`).
    pub poll_after_secs: u32,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self {
            features: FeatureFlags::default(),
            kill_switches: KillSwitches::default(),
            min_version: None,
            update_required: false,
            banners: Vec::new(),
            stats_index_url: None,
            poll_after_secs: 6 * 60 * 60,
        }
    }
}

/// Which features the app shows. Used for staged launches and to hide a feature whose data is
/// broken (e.g. stats on patch day). `true` = available.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "a flat set of independent flags"
)]
pub struct FeatureFlags {
    pub scouting: bool,
    pub draft_helper: bool,
    pub player_search: bool,
    pub auto_accept: bool,
    pub rune_import: bool,
    pub item_sets: bool,
    pub summoner_spells: bool,
    /// Opted-in players' Mayhem games are sent (off: nothing is sent, whatever the setting).
    pub mayhem_sharing: bool,
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            scouting: true,
            draft_helper: true,
            player_search: true,
            auto_accept: true,
            rune_import: true,
            item_sets: true,
            summoner_spells: true,
            mayhem_sharing: true,
        }
    }
}

/// Emergency stops for automations that write to the League client. `true` = the automation
/// must not run, whatever the user's setting (e.g. an LCU change makes it misbehave). The app
/// honors a kill switch as soon as it sees it, even in the middle of a champ select.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "a flat set of independent flags"
)]
pub struct KillSwitches {
    pub auto_accept: bool,
    pub rune_import: bool,
    pub item_sets: bool,
    pub summoner_spells: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MinVersion {
    /// Semver, e.g. `0.3.0`.
    pub version: String,
    pub message: LocalizedText,
}

/// A text in every language the app ships (English and French).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LocalizedText {
    pub en: String,
    pub fr: String,
}

/// A dismissible notice at the top of the app: patch day, Riot service issues, maintenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Banner {
    /// Stable id: the app remembers dismissed banners by it.
    pub id: String,
    pub severity: BannerSeverity,
    pub text: LocalizedText,
    /// `https://` link for "more info".
    pub link: Option<String>,
    /// RFC 3339; the server only sends banners whose window contains "now".
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    /// The player may close it (remembered by `id`). Default `true`; `false` keeps it up
    /// while it lasts (e.g. an outage).
    #[serde(default = "yes")]
    pub dismissible: bool,
}

const fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BannerSeverity {
    Info,
    Warn,
}

/// Body of `POST /v1/reports` (opt-in only). The server scrubs Riot IDs, PUUIDs, e-mails and
/// user names in file paths before storing it, but the app should not put them in either.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CrashReport {
    /// Semver of the app, e.g. `0.2.1`.
    pub app_version: String,
    /// e.g. `Windows 11 23H2 (22631)`; ≤ 64 characters.
    pub os_version: String,
    pub kind: ReportKind,
    /// ≤ 2 KB.
    pub message: String,
    /// ≤ 16 KB.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stack: Option<String>,
    /// The random per-install id (also sent as `X-MVP-Install`); keys GDPR deletion.
    pub install_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ReportKind {
    /// A Rust panic in the core.
    Panic,
    /// An uncaught error or unhandled rejection in the UI.
    Js,
    /// A League client (LCU) integration failure.
    Lcu,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_fills_missing_fields_with_defaults() {
        let config: RemoteConfig =
            serde_json::from_str(r#"{"killSwitches":{"autoAccept":true}}"#).expect("parses");
        assert!(config.kill_switches.auto_accept);
        assert!(!config.kill_switches.rune_import);
        assert!(config.features.scouting);
        assert_eq!(config.poll_after_secs, 6 * 60 * 60);
    }

    #[test]
    fn banners_are_dismissible_unless_said_otherwise() {
        let banner: Banner = serde_json::from_str(
            r#"{"id":"a","severity":"info","text":{"en":"x","fr":"y"},"link":null,"startsAt":null,"endsAt":null}"#,
        )
        .expect("parses");
        assert!(banner.dismissible);
        let pinned: Banner = serde_json::from_str(
            r#"{"id":"b","severity":"warn","text":{"en":"x","fr":"y"},"link":null,"startsAt":null,"endsAt":null,"dismissible":false}"#,
        )
        .expect("parses");
        assert!(!pinned.dismissible);
    }

    #[test]
    fn report_is_camel_case() {
        let json = serde_json::to_string(&CrashReport {
            app_version: "0.2.0".into(),
            os_version: "Windows 11".into(),
            kind: ReportKind::Js,
            message: "boom".into(),
            stack: None,
            install_id: "abc".into(),
        })
        .expect("ok");
        assert_eq!(
            json,
            r#"{"appVersion":"0.2.0","osVersion":"Windows 11","kind":"js","message":"boom","installId":"abc"}"#
        );
    }
}
