//! Build imports: MVP writes a champion's build into the League client — a rune page, an item
//! set and the summoner spells — on a click, or once on lock-in when the player opted in.
//! Policy (docs/policy.md): these are client writes, so they are user-triggered or opted-in,
//! and never touch the player's own pages and sets.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Role;

/// A part of a build MVP can write into the League client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ImportPart {
    /// MVP's own rune page, made current.
    Runes,
    /// MVP's own item set for the champion (in-game shop).
    ItemSet,
    /// Summoner spells, during champion select only (Flash stays on the player's key).
    Spells,
}

impl ImportPart {
    pub const ALL: [Self; 3] = [Self::Runes, Self::ItemSet, Self::Spells];
}

/// When a part of the build is imported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ImportMode {
    /// Never: no button, no automation.
    Off,
    /// When the player clicks its button.
    #[default]
    OneClick,
    /// Also automatically, once, when the player locks in a champion.
    OnLockIn,
}

/// The key the player keeps Flash on: D (first summoner spell) or F (second).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FlashKey {
    /// The key Flash is on in the player's recent games.
    #[default]
    Auto,
    D,
    F,
}

/// A summoner spell key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SpellKey {
    D,
    F,
}

impl SpellKey {
    /// The other key.
    #[must_use]
    pub const fn other(self) -> Self {
        match self {
            Self::D => Self::F,
            Self::F => Self::D,
        }
    }
}

/// Asks the core to import (parts of) a build into the League client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportRequest {
    pub champion_id: u32,
    /// The role to take the build from; `None` when unknown (blind pick, ARAM): the champion's
    /// most played role.
    pub role: Option<Role>,
    /// Stats queue: 420 (ranked data, used for every Summoner's Rift mode) or 450 (ARAM).
    /// `None`: the current game's, ranked outside of a game.
    pub queue: Option<u32>,
    pub parts: Vec<ImportPart>,
}

/// What an import did, part by part: the answer to `import_build`, and the `import` event of
/// the lock-in automation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportResult {
    pub champion_id: u32,
    pub role: Option<Role>,
    /// Stats queue the build came from (420 or 450).
    pub queue: u32,
    /// Made by the lock-in automation rather than a click.
    pub automatic: bool,
    /// One entry per requested part, in request order.
    pub parts: Vec<PartResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PartResult {
    pub part: ImportPart,
    pub outcome: ImportOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ImportOutcome {
    /// The rune page or item set was written under `name` (e.g. `MVP · Ahri Mid`).
    Saved { name: String },
    /// Summoner spells as they now are, D then F; `changed: false` when they already were.
    #[serde(rename_all = "camelCase")]
    SpellsSet {
        spell_ids: [u32; 2],
        changed: bool,
        /// Where Flash went, when the player should know.
        flash: Option<FlashNote>,
    },
    /// Nothing was written, and why.
    Skipped { reason: SkipReason },
    /// The import failed, and why.
    Failed { reason: FailReason },
}

impl ImportOutcome {
    pub const fn is_failure(&self) -> bool {
        matches!(self, Self::Failed { .. })
    }
}

/// Why a part wasn't imported (nothing is wrong).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum SkipReason {
    /// Turned off in Settings.
    Off,
    /// Summoner spells can only change during champion select.
    NotInChampSelect,
    /// Too close to the end of the champion select timer to change spells safely.
    #[serde(rename_all = "camelCase")]
    TooLate { seconds_left: u32 },
}

/// Why a part couldn't be imported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum FailReason {
    /// The League client isn't connected.
    NoClient,
    /// No published build for this champion, role and queue (or no stats at all yet).
    NoBuild,
    /// The build has no data for this part yet.
    NoData,
    /// No builds for the current game mode (e.g. Arena).
    UnsupportedMode,
    /// Every rune page is the player's own: MVP needs a free one, or one named "MVP".
    NoFreePage,
    /// The League client refused the change.
    Client { message: String },
}

/// Where Flash went during a spells import, when the player should know.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum FlashNote {
    /// The build lists Flash on the other key: it stays on `key`, the player's.
    KeptOnYourKey { key: SpellKey },
    /// The player's key isn't known (no Flash in recent games): Flash went on `key`.
    Guessed { key: SpellKey },
    /// The build doesn't take Flash.
    NotInBuild,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcomes_are_tagged_in_camel_case() {
        let set = ImportOutcome::SpellsSet {
            spell_ids: [14, 4],
            changed: true,
            flash: Some(FlashNote::KeptOnYourKey { key: SpellKey::F }),
        };
        assert_eq!(
            serde_json::to_string(&set).expect("serializable"),
            r#"{"kind":"spellsSet","spellIds":[14,4],"changed":true,"flash":{"kind":"keptOnYourKey","key":"f"}}"#
        );
        let late = ImportOutcome::Skipped {
            reason: SkipReason::TooLate { seconds_left: 3 },
        };
        assert_eq!(
            serde_json::to_string(&late).expect("serializable"),
            r#"{"kind":"skipped","reason":{"kind":"tooLate","secondsLeft":3}}"#
        );
    }

    #[test]
    fn requests_read_from_the_ui() {
        let request: ImportRequest = serde_json::from_str(
            r#"{"championId":103,"role":"middle","queue":null,"parts":["runes","itemSet","spells"]}"#,
        )
        .expect("deserializable");
        assert_eq!(request.parts, ImportPart::ALL.to_vec());
        assert_eq!(request.role, Some(Role::Middle));
    }

    #[test]
    fn one_click_by_default_never_automatic() {
        assert_eq!(ImportMode::default(), ImportMode::OneClick);
        assert_eq!(FlashKey::default(), FlashKey::Auto);
        assert_eq!(SpellKey::D.other(), SpellKey::F);
    }
}
