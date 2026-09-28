use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{RankedEntry, RiotId, Role};

/// A compact player card for loading-screen scouting (one per player of the lobby).
///
/// Built from ranked solo/duo data only. Tags are positive or neutral by policy: no negative
/// or shaming labels, no "first time" tag, no MMR estimates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScoutCard {
    pub puuid: String,
    /// Current Riot ID, stored next to the PUUID (policy). `None` if Riot has no name for it.
    pub riot_id: Option<RiotId>,
    /// Ranked solo/duo standing, `None` when unranked.
    pub solo_queue: Option<RankedEntry>,
    /// Ranked solo/duo games the card was built from (the most recent ones, up to ~20).
    pub games_sampled: u32,
    /// Most played champions in the sample, most games first (up to 3).
    pub top_champions: Vec<ChampionRecord>,
    /// Results of the last ranked games, newest first (up to 10). `true` = win.
    pub recent_results: Vec<bool>,
    /// Roles played in the sample, most games first (up to 2, each ≥ 25 % of the games).
    pub main_roles: Vec<Role>,
    pub tags: Vec<ScoutTag>,
}

/// A player's results on one champion within the sample.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionRecord {
    /// Numeric champion key.
    pub champion_id: u32,
    pub games: u32,
    pub wins: u32,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    /// (kills + assists) / max(deaths, 1), two decimals.
    pub kda: f64,
}

/// Positive or neutral labels only (see docs/policy.md). The UI words and translates them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ScoutTag {
    /// ≥ 70 % of the sampled games (at least 10) on one champion.
    #[serde(rename_all = "camelCase")]
    Otp { champion_id: u32, share: f64 },
    /// ≥ 60 % of the sampled games (at least 5) in one role.
    MainRole { role: Role },
    /// The last `wins` ranked games (≥ 4) were all wins.
    HotStreak { wins: u32 },
    /// ≥ 100 ranked solo/duo games this season.
    Veteran { games: u32 },
}

/// Body of `POST /v1/players/batch`: the players of one game, 1–10 in all.
///
/// The app names players by **Riot ID**: the League client's PUUIDs are not the ones our API
/// key sees (Riot encrypts PUUIDs per key), so the server resolves each Riot ID itself. The
/// answer lists cards in request order (`players`, then `puuids`); players the server can't
/// find get none, and a card for a Riot ID carries the account's current Riot ID in `riotId`,
/// to match back case-insensitively. Hidden (streamer mode) players are never sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScoutRequest {
    /// Platform id, e.g. `euw1`.
    pub platform: String,
    /// Players by Riot ID, as the League client shows them.
    #[serde(default)]
    pub players: Vec<RiotId>,
    /// Players by PUUID as seen by our API key: what apps up to 0.1.0 sent, still accepted.
    #[serde(default)]
    pub puuids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_tagged_camel_case() {
        let json = serde_json::to_string(&ScoutTag::Otp {
            champion_id: 103,
            share: 0.8,
        })
        .expect("ok");
        assert_eq!(json, r#"{"kind":"otp","championId":103,"share":0.8}"#);
        let json = serde_json::to_string(&ScoutTag::MainRole { role: Role::Jungle }).expect("ok");
        assert_eq!(json, r#"{"kind":"mainRole","role":"jungle"}"#);
    }

    #[test]
    fn requests_take_riot_ids_or_the_older_puuids() {
        let legacy: ScoutRequest =
            serde_json::from_str(r#"{"platform":"euw1","puuids":["p1"]}"#).expect("parses");
        assert!(legacy.players.is_empty());
        assert_eq!(legacy.puuids, vec!["p1"]);
        let current: ScoutRequest = serde_json::from_str(
            r#"{"platform":"euw1","players":[{"gameName":"Fillmo","tagLine":"7272"}]}"#,
        )
        .expect("parses");
        assert_eq!(current.players[0].game_name, "Fillmo");
        assert!(current.puuids.is_empty());
    }
}
