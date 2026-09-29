//! After a game and over time: the summary of the game that just ended, the LP each ranked game
//! was worth, and champion mastery. All of it the local player's own, from their League client.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{MatchPlayer, RankedEntry};

/// A ranked queue whose LP MVP follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RankedQueue {
    /// Ranked Solo/Duo (queue 420).
    Solo,
    /// Ranked Flex (queue 440).
    Flex,
}

impl RankedQueue {
    /// The queue of a game, `None` outside ranked solo/duo and flex.
    pub const fn from_queue_id(queue_id: u32) -> Option<Self> {
        match queue_id {
            420 => Some(Self::Solo),
            440 => Some(Self::Flex),
            _ => None,
        }
    }

    /// The key of this queue in the client's ranked stats (`queueMap`).
    pub const fn client_key(self) -> &'static str {
        match self {
            Self::Solo => "RANKED_SOLO_5x5",
            Self::Flex => "RANKED_FLEX_SR",
        }
    }
}

/// The LP one ranked game was worth: the League client only shows the standing, so MVP reads it
/// when the game starts and again once the client has counted the game. Never an estimate of
/// hidden ratings (no MMR): two standings the player saw, and their difference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LpGame {
    /// The game: the number of its match id (`EUW1_7000000001` → 7000000001).
    #[ts(type = "number")]
    pub game_id: u64,
    pub queue: RankedQueue,
    /// When the standing after the game was read, Unix epoch milliseconds.
    #[ts(type = "number")]
    pub at: i64,
    pub before: RankedEntry,
    pub after: RankedEntry,
    /// LP won (+) or lost (−), across divisions (100 LP each) and tiers; the apex tiers
    /// (Master and up) count plain LP.
    pub delta: i32,
    /// The standing after the game on one scale, for LP graphs: Iron IV 0 LP is 0, each division
    /// 100 more, Master 0 LP (Diamond I 100 LP) 2800 plus the LP.
    pub ladder: i32,
}

/// The game that just ended, summed up for Home until the player dismisses it or queues again.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PostGame {
    pub match_id: String,
    pub queue_id: u32,
    pub duration_seconds: u32,
    /// Game end, Unix epoch milliseconds.
    #[ts(type = "number")]
    pub ended_at: i64,
    /// Your team won.
    pub win: bool,
    /// Your line: numbers and grade (with the facts that moved it).
    pub me: MatchPlayer,
    /// Whom your numbers are set against: your lane opponent (your role on the other team), or
    /// in a mode without roles (ARAM) the enemy whose share of their team's damage is closest to
    /// yours; `None` when there is no such player.
    pub opponent: Option<MatchPlayer>,
    /// LP won or lost (ranked solo/duo and flex), once known.
    pub lp: Option<LpGame>,
    /// A ranked game whose standing the client hasn't updated yet: the LP follows.
    pub lp_pending: bool,
}

/// One champion's mastery as the League client reports it (your own).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionMastery {
    pub champion_id: u32,
    pub level: u32,
    pub points: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranked_queues_by_id_and_client_key() {
        assert_eq!(RankedQueue::from_queue_id(420), Some(RankedQueue::Solo));
        assert_eq!(RankedQueue::from_queue_id(440), Some(RankedQueue::Flex));
        assert_eq!(RankedQueue::from_queue_id(450), None);
        assert_eq!(RankedQueue::Flex.client_key(), "RANKED_FLEX_SR");
        assert_eq!(
            serde_json::to_string(&RankedQueue::Solo).expect("ok"),
            r#""solo""#
        );
    }
}
