use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Tier;

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
    /// 5001–5013) aren't in Data Dragon: the UI names them itself.
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
    /// One-line description as plain text (Data Dragon's markup removed).
    pub short_desc: String,
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
