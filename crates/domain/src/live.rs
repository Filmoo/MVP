use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{BackendError, RiotId, Role, ScoutCard};

/// The game being loaded or played, with a scouting card per player (loading-screen scouting).
///
/// Built from the League client's gameflow session once the game starts (never in champion
/// select). Players hidden by Riot (streamer mode) stay hidden: no Riot ID, no lookup, no card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveGame {
    #[ts(type = "number")]
    pub game_id: u64,
    /// Queue id (420 = ranked solo/duo, 440 = flex, 450 = ARAM…).
    pub queue_id: u32,
    /// Platform id of the game, e.g. `euw1`.
    pub platform: String,
    /// The local player's team, then the other one.
    pub allies: Vec<LivePlayer>,
    pub enemies: Vec<LivePlayer>,
    pub scouting: Scouting,
}

/// Where the scouting cards are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "camelCase")]
#[ts(export)]
pub enum Scouting {
    /// Asked the backend, waiting for the answer.
    Loading,
    /// Cards are in (players the backend doesn't know have none).
    Done,
    /// The backend couldn't answer; the rest of the view still shows.
    Failed { error: BackendError },
}

/// One seat of the game.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LivePlayer {
    /// `None` while the client doesn't say yet.
    pub champion_id: Option<u32>,
    /// Summoner spell ids (`spell1Id`, `spell2Id`), empty when unknown.
    pub spells: Vec<u32>,
    /// Position assigned by matchmaking, when the queue has positions.
    pub role: Option<Role>,
    pub is_me: bool,
    /// Identity hidden by Riot (streamer mode): never looked up, never shown.
    pub hidden: bool,
    /// Riot ID from the client or the card; `None` when hidden or unknown.
    pub riot_id: Option<RiotId>,
    /// Scouting card, once the backend answered (`None` when hidden, pending or unknown).
    pub card: Option<ScoutCard>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scouting_state_is_tagged() {
        let json = serde_json::to_string(&Scouting::Failed {
            error: BackendError::NotFound,
        })
        .expect("serializable");
        assert_eq!(json, r#"{"state":"failed","error":{"kind":"notFound"}}"#);
    }
}
