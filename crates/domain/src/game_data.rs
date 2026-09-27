use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Static game data for one patch (names and asset ids), from Riot's Data Dragon.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GameData {
    /// Data Dragon version, e.g. `16.19.1` (public patch name `26.19`).
    pub version: String,
    /// Base URL for assets of this version (`…/cdn/16.19.1`).
    pub asset_base: String,
    pub champions: Vec<ChampionInfo>,
    pub items: Vec<ItemInfo>,
    pub summoner_spells: Vec<SpellInfo>,
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
