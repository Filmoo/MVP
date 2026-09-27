use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A Riot ID: `gameName#tagLine`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RiotId {
    pub game_name: String,
    pub tag_line: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Tier {
    Iron,
    Bronze,
    Silver,
    Gold,
    Platinum,
    Emerald,
    Diamond,
    Master,
    Grandmaster,
    Challenger,
}

impl Tier {
    /// Apex tiers have no divisions.
    pub const fn has_divisions(self) -> bool {
        !matches!(self, Self::Master | Self::Grandmaster | Self::Challenger)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Division {
    I,
    II,
    III,
    IV,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Role {
    Top,
    Jungle,
    Middle,
    Bottom,
    Support,
}

/// Ranked standing in one queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RankedEntry {
    pub tier: Tier,
    /// `None` for apex tiers.
    pub division: Option<Division>,
    pub league_points: u32,
    pub wins: u32,
    pub losses: u32,
}

/// One finished game from a player's point of view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchSummary {
    pub match_id: String,
    /// Queue id (420 = ranked solo/duo, 440 = flex, 450 = ARAM…).
    pub queue_id: u32,
    /// Numeric champion key (`championId` in match data).
    pub champion_id: u32,
    pub role: Option<Role>,
    pub win: bool,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    /// Lane minions + neutral monsters.
    pub creep_score: u32,
    pub duration_seconds: u32,
    /// Game end, Unix epoch milliseconds.
    #[ts(type = "number")]
    pub ended_at: i64,
    /// Final item ids, empty slots omitted.
    pub items: Vec<u32>,
}

/// The player shown on the home screen (the logged-in account by default).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerProfile {
    pub riot_id: RiotId,
    /// Platform, e.g. `EUW`.
    pub region: String,
    pub level: u32,
    pub profile_icon_id: u32,
    /// Ranked solo/duo standing, `None` when unranked.
    pub solo_queue: Option<RankedEntry>,
    pub recent_matches: Vec<MatchSummary>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apex_tiers_have_no_divisions() {
        assert!(Tier::Diamond.has_divisions());
        assert!(!Tier::Master.has_divisions());
        assert!(Tier::Iron < Tier::Challenger);
    }

    #[test]
    fn divisions_serialize_as_roman_numerals() {
        assert_eq!(serde_json::to_string(&Division::IV).expect("ok"), r#""IV""#);
        assert_eq!(
            serde_json::to_string(&Role::Middle).expect("ok"),
            r#""middle""#
        );
    }
}
