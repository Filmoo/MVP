//! The logged-in player's own profile, read from the League client.
//!
//! Only the local player's data, which the client already shows them; nothing about other
//! players is fetched here (lookups of others go through our backend and the Riot API).

use domain::{Division, MatchSummary, PlayerProfile, RankedEntry, RiotId, Role, Tier};
use lcu::{LcuClient, LcuError};
use serde_json::Value;

pub const CURRENT_SUMMONER: &str = "/lol-summoner/v1/current-summoner";
pub const RANKED: &str = "/lol-ranked/v1/current-ranked-stats";
pub const REGION: &str = "/riotclient/region-locale";
pub const MATCHES: &str =
    "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=20";

fn u32_at(v: &Value, key: &str) -> u32 {
    v.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0)
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// Solo/duo standing from `/lol-ranked/v1/current-ranked-stats`.
pub fn map_ranked(stats: &Value) -> Option<RankedEntry> {
    let solo = stats.get("queueMap")?.get("RANKED_SOLO_5x5")?;
    let tier = match str_at(solo, "tier")? {
        "IRON" => Tier::Iron,
        "BRONZE" => Tier::Bronze,
        "SILVER" => Tier::Silver,
        "GOLD" => Tier::Gold,
        "PLATINUM" => Tier::Platinum,
        "EMERALD" => Tier::Emerald,
        "DIAMOND" => Tier::Diamond,
        "MASTER" => Tier::Master,
        "GRANDMASTER" => Tier::Grandmaster,
        "CHALLENGER" => Tier::Challenger,
        _ => return None, // "NONE" or empty: unranked
    };
    let division = if tier.has_divisions() {
        match str_at(solo, "division") {
            Some("I") => Some(Division::I),
            Some("II") => Some(Division::II),
            Some("III") => Some(Division::III),
            Some("IV") => Some(Division::IV),
            _ => None,
        }
    } else {
        None
    };
    Some(RankedEntry {
        tier,
        division,
        league_points: u32_at(solo, "leaguePoints"),
        wins: u32_at(solo, "wins"),
        losses: u32_at(solo, "losses"),
    })
}

/// Games from the client's own match history (the local player is `participants[0]`).
pub fn map_matches(history: &Value, platform: &str) -> Vec<MatchSummary> {
    let Some(games) = history
        .get("games")
        .and_then(|g| g.get("games"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    games
        .iter()
        .filter_map(|game| {
            let me = game.get("participants")?.as_array()?.first()?;
            let stats = me.get("stats")?;
            let duration = u32_at(game, "gameDuration");
            let started = game.get("gameCreation")?.as_i64()?;
            let lane = me.get("timeline").and_then(|t| str_at(t, "lane"));
            let role_hint = me.get("timeline").and_then(|t| str_at(t, "role"));
            let role = match (lane, role_hint) {
                (Some("TOP"), _) => Some(Role::Top),
                (Some("JUNGLE"), _) => Some(Role::Jungle),
                (Some("MIDDLE" | "MID"), _) => Some(Role::Middle),
                (Some("BOTTOM" | "BOT"), Some("SUPPORT" | "DUO_SUPPORT")) => Some(Role::Support),
                (Some("BOTTOM" | "BOT"), _) => Some(Role::Bottom),
                _ => None,
            };
            Some(MatchSummary {
                match_id: format!("{}_{}", platform, game.get("gameId")?.as_u64()?),
                queue_id: u32_at(game, "queueId"),
                champion_id: u32_at(me, "championId"),
                role,
                win: stats.get("win").and_then(Value::as_bool).unwrap_or(false),
                kills: u32_at(stats, "kills"),
                deaths: u32_at(stats, "deaths"),
                assists: u32_at(stats, "assists"),
                creep_score: u32_at(stats, "totalMinionsKilled")
                    + u32_at(stats, "neutralMinionsKilled"),
                duration_seconds: duration,
                ended_at: started + i64::from(duration) * 1000,
                items: (0..6)
                    .map(|i| u32_at(stats, &format!("item{i}")))
                    .filter(|&id| id != 0)
                    .collect(),
                // The list holds only the local player's side: the grade needs the whole game.
                grade: None,
            })
        })
        .collect()
}

/// Reads the whole profile. Missing pieces degrade gracefully (unranked, no games).
pub async fn local_profile(client: &LcuClient) -> Result<PlayerProfile, LcuError> {
    let summoner: Value = client.get(CURRENT_SUMMONER).await?;
    let ranked = client.get::<Value>(RANKED).await.ok();
    let region = client
        .get::<Value>(REGION)
        .await
        .ok()
        .and_then(|r| str_at(&r, "region").map(str::to_uppercase))
        .unwrap_or_default();
    let history = client.get::<Value>(MATCHES).await.ok();
    let platform = if region.is_empty() {
        "LOCAL".to_owned()
    } else {
        format!("{region}1")
    };
    Ok(PlayerProfile {
        riot_id: RiotId {
            game_name: str_at(&summoner, "gameName")
                .unwrap_or("Summoner")
                .to_owned(),
            tag_line: str_at(&summoner, "tagLine").unwrap_or_default().to_owned(),
        },
        region,
        level: u32_at(&summoner, "summonerLevel"),
        profile_icon_id: u32_at(&summoner, "profileIconId"),
        solo_queue: ranked.as_ref().and_then(map_ranked),
        recent_matches: history
            .as_ref()
            .map(|h| map_matches(h, &platform))
            .unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_ranked_stats() {
        let stats = json!({ "queueMap": { "RANKED_SOLO_5x5": { "tier": "EMERALD", "division": "II", "leaguePoints": 67, "wins": 142, "losses": 128 } } });
        let r = map_ranked(&stats).expect("ranked");
        assert_eq!(
            (r.tier, r.division, r.league_points, r.wins),
            (Tier::Emerald, Some(Division::II), 67, 142)
        );
        let unranked =
            json!({ "queueMap": { "RANKED_SOLO_5x5": { "tier": "NONE", "division": "NA" } } });
        assert!(map_ranked(&unranked).is_none());
        let master = json!({ "queueMap": { "RANKED_SOLO_5x5": { "tier": "MASTER", "division": "NA", "leaguePoints": 120 } } });
        assert_eq!(map_ranked(&master).expect("apex").division, None);
    }

    #[test]
    fn maps_client_match_history() {
        let history = json!({ "games": { "games": [{
            "gameId": 7_000_000_001_u64, "queueId": 420, "gameCreation": 1_790_000_000_000_i64, "gameDuration": 1742,
            "participants": [{ "championId": 103,
                "stats": { "win": true, "kills": 9, "deaths": 2, "assists": 11, "totalMinionsKilled": 211, "neutralMinionsKilled": 20,
                           "item0": 6655, "item1": 0, "item2": 3020, "item6": 3340 },
                "timeline": { "lane": "MIDDLE", "role": "SOLO" } }]
        }, {
            "gameId": 7_000_000_002_u64, "queueId": 420, "gameCreation": 1_790_000_100_000_i64, "gameDuration": 1600,
            "participants": [{ "championId": 412, "stats": { "win": false }, "timeline": { "lane": "BOTTOM", "role": "SUPPORT" } }]
        }] } });
        let games = map_matches(&history, "EUW1");
        assert_eq!(games.len(), 2);
        let g = &games[0];
        assert_eq!(g.match_id, "EUW1_7000000001");
        assert_eq!(
            (g.champion_id, g.role, g.win, g.creep_score),
            (103, Some(Role::Middle), true, 231)
        );
        assert_eq!(g.items, vec![6655, 3020]);
        assert_eq!(g.ended_at, 1_790_000_000_000 + 1_742_000);
        assert_eq!(games[1].role, Some(Role::Support));
        assert!(map_matches(&json!({}), "EUW1").is_empty());
    }
}
