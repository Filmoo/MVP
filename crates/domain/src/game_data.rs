use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Role, Tier};

/// Static game data for one patch (names and asset ids), from Riot's Data Dragon.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GameData {
    /// Data Dragon version, e.g. `16.19.1` (public patch name `26.19`).
    pub version: String,
    /// Base URL for assets of this version (`…/cdn/16.19.1`): icons.
    pub asset_base: String,
    /// Base URL for version-less art (`…/cdn`): `img/champion/centered/<key>_0.jpg`.
    pub art_base: String,
    pub champions: Vec<ChampionInfo>,
    pub items: Vec<ItemInfo>,
    pub summoner_spells: Vec<SpellInfo>,
    /// Rune trees (Precision, Domination…), from `runesReforged.json`. Stat shards (ids
    /// 5001–5013) aren't in Data Dragon: the UI names them itself. What each rune does comes
    /// apart, when a tooltip asks (`game_description`), not with the names.
    pub runes: Vec<RuneStyle>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionInfo {
    /// Numeric key, as in match data (`championId`).
    pub id: u32,
    /// Asset id, e.g. `Kaisa` → `img/champion/Kaisa.png`.
    pub key: String,
    pub name: String,
    /// Riot's classes: Assassin, Fighter, Mage, Marksman, Support, Tank.
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ItemInfo {
    pub id: u32,
    pub name: String,
    pub gold: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpellInfo {
    /// Numeric key, as in match data (`summoner1Id`).
    pub id: u32,
    /// Asset id, e.g. `SummonerFlash`.
    pub key: String,
    pub name: String,
}

/// A rune tree (a "path" in the client): its keystones and minor runes, row by row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RuneStyle {
    /// Numeric id, as in match data and rune pages (`8000` = Precision).
    pub id: u32,
    /// Asset id, e.g. `Precision`.
    pub key: String,
    pub name: String,
    /// Icon path under the version-less art base: `{art_base}/img/{icon}`.
    pub icon: String,
    /// Rows from top to bottom: the keystones, then the three rows of minor runes.
    pub slots: Vec<Vec<RuneInfo>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RuneInfo {
    /// Numeric id, as in match data (`perk`) and rune pages (`8005` = Press the Attack).
    pub id: u32,
    /// Asset id, e.g. `PressTheAttack`.
    pub key: String,
    pub name: String,
    /// Icon path under the version-less art base: `{art_base}/img/{icon}`.
    pub icon: String,
}

/// What `game_description` describes: a rune, a stat shard, a summoner spell or an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DescriptionKind {
    Rune,
    Shard,
    Spell,
    Item,
}

/// What a rune, a stat shard, a summoner spell or an item does, in the language of the loaded
/// `GameData` (`game_description`, asked when a tooltip shows: never with the names). From Data
/// Dragon, and for stat shards from the League client's own data (Data Dragon has none).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Description {
    /// A stat shard's name (shards aren't in `GameData`); the others are named there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    /// A summoner spell's cooldown, in seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cooldown: Option<u32>,
    /// The text, line by line; an empty line ends a paragraph. Riot's markup is gone: only
    /// text and a tone for what it stressed.
    pub text: Vec<Vec<TextSpan>>,
}

/// A run of text in one tone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TextSpan {
    pub text: String,
    /// Plain text when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tone: Option<TextTone>,
}

/// How a span reads: stressed (a stat's value, a passive's name), subtle (rules, flavour
/// text), or in a damage type's or healing's colour, as the game shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TextTone {
    Strong,
    Subtle,
    Physical,
    Magic,
    True,
    Heal,
}

/// Riot's ranked emblems as the core has them (`rank_emblems`, `rank-emblems` event): each tier's
/// art cropped to 4:3, as a data URL. Tiers not downloaded yet are missing: the UI draws its own
/// crest for them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RankEmblems {
    pub emblems: Vec<RankEmblem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RankEmblem {
    pub tier: Tier,
    /// `data:image/png;base64,…`
    pub url: String,
}

/// League's position icons as the core has them (`position_icons`, `position-icons` event): each
/// role's icon from the League client, as a data URL the UI tints. Roles not downloaded yet are
/// missing: the UI draws its own icons for them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PositionIcons {
    pub icons: Vec<PositionIcon>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PositionIcon {
    pub role: Role,
    /// `data:image/svg+xml;base64,…`
    pub url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptions_leave_out_what_they_lack() {
        let spell = Description {
            name: None,
            cooldown: Some(300),
            text: vec![
                vec![
                    TextSpan {
                        text: "Deals ".into(),
                        tone: None,
                    },
                    TextSpan {
                        text: "true damage".into(),
                        tone: Some(TextTone::True),
                    },
                ],
                vec![],
            ],
        };
        let json = serde_json::to_string(&spell).expect("serializable");
        assert_eq!(
            json,
            r#"{"cooldown":300,"text":[[{"text":"Deals "},{"text":"true damage","tone":"true"}],[]]}"#
        );
        assert_eq!(
            serde_json::from_str::<Description>(&json).expect("parses"),
            spell
        );
        assert_eq!(
            serde_json::to_string(&DescriptionKind::Shard).expect("serializable"),
            r#""shard""#
        );
    }
}
