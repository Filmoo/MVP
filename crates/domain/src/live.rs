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
    /// Whose builds fit this game, from its map (as imports decide): 420 (ranked data) on
    /// Summoner's Rift, whatever the queue (customs, co-op vs AI…), 450 on Howling Abyss;
    /// `None` for modes without published builds (Arena…).
    pub stats_queue: Option<u32>,
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

/// `GET /v1/live/{platform}/{gameName}/{tagLine}?gameId=`: the game a player is in, as Riot
/// shows it to apps (Spectator-V5, which keeps players in streamer mode anonymous), with the
/// cards of its visible players. The app asks it for the local player only, once their game
/// has started. 404 `notFound` when Riot lists no game for them (or another game than
/// `gameId`), 404 `filtered` when Riot doesn't share live games of that queue with apps.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ActiveGame {
    #[ts(type = "number")]
    pub game_id: u64,
    pub queue_id: u32,
    /// As Riot lists them (blue side first, usually).
    pub participants: Vec<ActiveParticipant>,
    /// Every visible player's card was asked for (those without one are unknown to our key);
    /// `false` when some weren't ready in time: ask `POST /v1/players/batch` for the rest.
    pub cards_complete: bool,
}

/// One player of an [`ActiveGame`]. Neither a Riot ID nor a bot: anonymous (streamer mode).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ActiveParticipant {
    /// 100 (blue side) or 200 (red side).
    pub team_id: u32,
    pub champion_id: u32,
    /// `None` for players Riot keeps anonymous (streamer mode) and for bots.
    pub riot_id: Option<RiotId>,
    pub bot: bool,
    /// Summoner spell ids, empty when unknown.
    pub spells: Vec<u32>,
    /// Scouting card of a visible player our key knows.
    pub card: Option<ScoutCard>,
}

impl ActiveParticipant {
    /// Riot keeps this player anonymous (streamer mode).
    pub const fn hidden(&self) -> bool {
        !self.bot && self.riot_id.is_none()
    }
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

    #[test]
    fn participants_without_a_name_are_hidden_unless_bots() {
        let participant = |riot_id: Option<RiotId>, bot| ActiveParticipant {
            team_id: 100,
            champion_id: 1,
            riot_id,
            bot,
            spells: Vec::new(),
            card: None,
        };
        let named = RiotId {
            game_name: "Quiet Storm".to_owned(),
            tag_line: "0412".to_owned(),
        };
        assert!(participant(None, false).hidden());
        assert!(!participant(None, true).hidden());
        assert!(!participant(Some(named), false).hidden());
    }
}
