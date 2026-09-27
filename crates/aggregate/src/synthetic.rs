//! Hand-made Match-V5 documents for tests (no real Riot data): the fields [`crate::extract`]
//! reads, in Riot's shapes.

use serde_json::{Value, json};

use crate::facts::{ARAM, RANKED_SOLO};

/// Positions of participants 1–5 (blue) and 6–10 (red) in a ranked game.
pub const POSITIONS: [&str; 5] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

/// A synthetic game.
#[derive(Debug, Clone)]
pub struct Game {
    pub id: String,
    pub queue: u16,
    pub version: String,
    pub duration: u64,
    /// Blue top, jungle, mid, bottom, support, then red in the same order.
    pub champions: [u16; 10],
    pub blue_wins: bool,
    pub bans: Vec<u16>,
    pub early_surrender: bool,
}

impl Game {
    pub fn ranked(id: &str, champions: [u16; 10], blue_wins: bool) -> Self {
        Self {
            id: id.to_owned(),
            queue: RANKED_SOLO,
            version: "16.19.712.4321".to_owned(),
            duration: 1_800,
            champions,
            blue_wins,
            bans: Vec::new(),
            early_surrender: false,
        }
    }

    pub fn aram(id: &str, champions: [u16; 10], blue_wins: bool) -> Self {
        Self {
            queue: ARAM,
            ..Self::ranked(id, champions, blue_wins)
        }
    }

    /// Synthetic PUUID of participant `i` (0–9).
    pub fn puuid(&self, i: usize) -> String {
        format!("synthetic-{}-{i}", self.id)
    }

    /// The `/lol/match/v5/matches/{id}` document.
    pub fn match_json(&self) -> Value {
        let participants: Vec<Value> = self
            .champions
            .iter()
            .enumerate()
            .map(|(i, &champion)| {
                let blue = i < 5;
                let position = if self.queue == RANKED_SOLO {
                    POSITIONS[i % 5]
                } else {
                    ""
                };
                let keystone = if champion % 2 == 0 { 8005 } else { 8010 };
                let smite_or_ignite = if i % 5 == 1 { 11 } else { 14 };
                json!({
                    "participantId": i + 1,
                    "puuid": self.puuid(i),
                    "championId": champion,
                    "teamId": if blue { 100 } else { 200 },
                    "teamPosition": position,
                    "win": blue == self.blue_wins,
                    "summoner1Id": smite_or_ignite,
                    "summoner2Id": 4,
                    "gameEndedInEarlySurrender": self.early_surrender,
                    "perks": {
                        "statPerks": { "offense": 5005, "flex": 5008, "defense": 5011 },
                        "styles": [
                            { "description": "primaryStyle", "style": 8000, "selections": [
                                { "perk": keystone }, { "perk": 9111 }, { "perk": 9104 }, { "perk": 8014 }
                            ]},
                            { "description": "subStyle", "style": 8400, "selections": [
                                { "perk": 8444 }, { "perk": 8453 }
                            ]}
                        ]
                    }
                })
            })
            .collect();
        let bans: Vec<Value> = self
            .bans
            .iter()
            .map(|c| json!({ "championId": c, "pickTurn": 1 }))
            .collect();
        json!({
            "metadata": { "matchId": self.id, "dataVersion": "2" },
            "info": {
                "gameVersion": self.version,
                "gameDuration": self.duration,
                "queueId": self.queue,
                "participants": participants,
                "teams": [
                    { "teamId": 100, "win": self.blue_wins, "bans": bans },
                    { "teamId": 200, "win": !self.blue_wins, "bans": [{ "championId": -1, "pickTurn": 6 }] }
                ]
            }
        })
    }

    /// The `/lol/match/v5/matches/{id}/timeline` document with `events` in one frame.
    pub fn timeline_json(&self, events: &[Value]) -> Value {
        let participants: Vec<Value> = (0..10)
            .map(|i| json!({ "participantId": i + 1, "puuid": self.puuid(i) }))
            .collect();
        json!({
            "metadata": { "matchId": self.id },
            "info": {
                "participants": participants,
                "frames": [
                    { "timestamp": 0, "events": [] },
                    { "timestamp": 60_000, "events": events }
                ]
            }
        })
    }
}

/// A `SKILL_LEVEL_UP` event of participant `pid` (1–10).
pub fn skill_up(pid: usize, slot: u8, t: u32) -> Value {
    json!({ "type": "SKILL_LEVEL_UP", "participantId": pid, "skillSlot": slot, "levelUpType": "NORMAL", "timestamp": t })
}

/// An `ITEM_PURCHASED` event.
pub fn buy(pid: usize, item: u32, t: u32) -> Value {
    json!({ "type": "ITEM_PURCHASED", "participantId": pid, "itemId": item, "timestamp": t })
}

/// An `ITEM_UNDO` of a purchase.
pub fn undo(pid: usize, item: u32, t: u32) -> Value {
    json!({ "type": "ITEM_UNDO", "participantId": pid, "beforeId": item, "afterId": 0, "goldGain": 0, "timestamp": t })
}

/// A typical build for participant `pid`: skills Q > E > W, Doran's start, boots, and
/// `legendaries` in order (one every 5 minutes).
pub fn typical_build(pid: usize, legendaries: &[u32]) -> Vec<Value> {
    let mut events: Vec<Value> = [1, 3, 2, 1, 1, 4, 1, 3, 1, 3, 4, 3, 3, 2, 2, 4, 2, 2]
        .iter()
        .zip(0u32..)
        .map(|(&slot, i)| skill_up(pid, slot, 60_000 * (i + 1)))
        .collect();
    events.push(buy(pid, 1055, 5_000));
    events.push(buy(pid, 2003, 6_000));
    events.push(buy(pid, 3006, 400_000));
    for (item, i) in legendaries.iter().zip(1u32..) {
        events.push(buy(pid, *item, 300_000 * i + 200_000));
    }
    events
}
