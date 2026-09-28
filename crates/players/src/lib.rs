//! Player profiles from Riot API data, mapped to the UI's domain types.
//! Used by the stats backend (live lookups) and by the `capture-profile` dev tool.

mod matches;
mod scout;
mod source;

use domain::{Division, MatchSummary, PlayerProfile, RankedEntry, RiotId, Tier};
use futures_util::future::join_all;
use riot_api::{LeagueEntry, MatchQuery, Platform, RiotError};
use serde_json::Value;

pub use matches::{grade_of, grades, match_details};
pub use scout::{SCOUT_GAMES, fetch_scout_card, fetch_scout_card_for, scout_card};
pub use source::RiotSource;

/// Ranked solo/duo standing from League-V4 entries.
pub fn solo_queue(entries: &[LeagueEntry]) -> Option<RankedEntry> {
    let e = entries.iter().find(|e| e.queue_type == "RANKED_SOLO_5x5")?;
    let tier = match e.tier.as_deref()? {
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
        _ => return None,
    };
    let division = if tier.has_divisions() {
        match e.rank.as_deref() {
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
        league_points: e.league_points,
        wins: e.wins,
        losses: e.losses,
    })
}

fn u32_field(v: &Value, key: &str) -> u32 {
    v.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0)
}

/// One Match-V5 game from `puuid`'s point of view, with their grade when the document holds
/// the whole game (every participant's stats).
pub fn match_summary(game: &Value, puuid: &str) -> Option<MatchSummary> {
    let info = game.get("info")?;
    let me = info
        .get("participants")?
        .as_array()?
        .iter()
        .find(|p| p.get("puuid").and_then(Value::as_str) == Some(puuid))?;
    let role = matches::role(me.get("teamPosition").and_then(Value::as_str));
    let duration = u32_field(info, "gameDuration");
    let ended_at = info
        .get("gameEndTimestamp")
        .and_then(Value::as_i64)
        .or_else(|| Some(info.get("gameStartTimestamp")?.as_i64()? + i64::from(duration) * 1000))?;
    Some(MatchSummary {
        match_id: game.get("metadata")?.get("matchId")?.as_str()?.to_owned(),
        queue_id: u32_field(info, "queueId"),
        champion_id: u32_field(me, "championId"),
        role,
        win: me.get("win").and_then(Value::as_bool).unwrap_or(false),
        kills: u32_field(me, "kills"),
        deaths: u32_field(me, "deaths"),
        assists: u32_field(me, "assists"),
        creep_score: u32_field(me, "totalMinionsKilled") + u32_field(me, "neutralMinionsKilled"),
        duration_seconds: duration,
        ended_at,
        items: (0..6)
            .map(|i| u32_field(me, &format!("item{i}")))
            .filter(|&id| id != 0)
            .collect(),
        grade: grade_of(game, puuid),
    })
}

#[derive(Debug, thiserror::Error)]
pub enum ProfileError {
    #[error("Riot ID must look like Name#TAG")]
    BadRiotId,
    #[error(transparent)]
    Riot(#[from] RiotError),
}

/// Splits `Name#TAG`.
pub fn parse_riot_id(input: &str) -> Result<RiotId, ProfileError> {
    let (name, tag) = input
        .trim()
        .rsplit_once('#')
        .ok_or(ProfileError::BadRiotId)?;
    if name.is_empty() || tag.is_empty() {
        return Err(ProfileError::BadRiotId);
    }
    Ok(RiotId {
        game_name: name.to_owned(),
        tag_line: tag.to_owned(),
    })
}

/// Fetches a full profile: account, level/icon, solo queue, last `games` games (all queues).
pub async fn fetch_profile<S: RiotSource>(
    client: &S,
    platform: Platform,
    riot_id: &RiotId,
    games: u32,
) -> Result<PlayerProfile, ProfileError> {
    let account = client
        .account_by_riot_id(platform, &riot_id.game_name, &riot_id.tag_line)
        .await?;
    let summoner = client.summoner_by_puuid(platform, &account.puuid).await?;
    let entries = client
        .league_entries_by_puuid(platform, &account.puuid)
        .await?;
    let ids = client
        .match_ids(
            platform,
            &account.puuid,
            &MatchQuery {
                count: games,
                ..MatchQuery::default()
            },
        )
        .await?;
    let recent = match_summaries(client, platform, &ids, &account.puuid).await?;
    Ok(PlayerProfile {
        riot_id: RiotId {
            game_name: account
                .game_name
                .unwrap_or_else(|| riot_id.game_name.clone()),
            tag_line: account.tag_line.unwrap_or_else(|| riot_id.tag_line.clone()),
        },
        region: platform
            .id()
            .trim_end_matches(char::is_numeric)
            .to_uppercase(),
        level: summoner.summoner_level,
        profile_icon_id: summoner.profile_icon_id,
        solo_queue: solo_queue(&entries),
        recent_matches: recent,
    })
}

/// Fetches games concurrently (the rate limiter paces them) and maps them, newest first.
/// Games the API withholds (404/403, e.g. some modes) are skipped.
pub(crate) async fn match_summaries<S: RiotSource>(
    client: &S,
    platform: Platform,
    ids: &[String],
    puuid: &str,
) -> Result<Vec<MatchSummary>, RiotError> {
    let games = join_all(ids.iter().map(|id| client.match_by_id(platform, id))).await;
    let mut out = Vec::with_capacity(games.len());
    for game in games {
        match game {
            Ok(game) => out.extend(match_summary(&game, puuid)),
            Err(RiotError::NotFound | RiotError::Forbidden(_)) => {}
            Err(e) => return Err(e),
        }
    }
    out.sort_by_key(|m| std::cmp::Reverse(m.ended_at));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use domain::Role;
    use serde_json::json;

    use super::*;

    fn game() -> Value {
        json!({
            "metadata": { "matchId": "EUW1_7000000001", "participants": ["me", "other"] },
            "info": {
                "gameDuration": 1742, "gameEndTimestamp": 1_790_000_000_000_i64, "queueId": 420,
                "participants": [
                    { "puuid": "other", "championId": 238, "win": false },
                    { "puuid": "me", "championId": 103, "teamPosition": "MIDDLE", "win": true, "kills": 9, "deaths": 2, "assists": 11,
                      "totalMinionsKilled": 211, "neutralMinionsKilled": 20,
                      "item0": 6655, "item1": 3020, "item2": 0, "item3": 4645, "item4": 3157, "item5": 3089, "item6": 3340 }
                ]
            }
        })
    }

    #[test]
    fn maps_a_match_from_the_players_view() {
        let m = match_summary(&game(), "me").expect("mapped");
        assert_eq!(m.match_id, "EUW1_7000000001");
        assert_eq!(
            (m.champion_id, m.role, m.win),
            (103, Some(Role::Middle), true)
        );
        assert_eq!(
            (m.kills, m.deaths, m.assists, m.creep_score),
            (9, 2, 11, 231)
        );
        assert_eq!(
            m.items,
            vec![6655, 3020, 4645, 3157, 3089],
            "empty slots and the trinket are dropped"
        );
        assert!(match_summary(&game(), "nobody").is_none());
        assert!(m.grade.is_none(), "two participants: no grade");
    }

    #[test]
    fn a_full_game_carries_the_players_grade() {
        let game = matches::tests::full_game("EUW1_7000000002", "me");
        let m = match_summary(&game, "me").expect("mapped");
        assert_eq!(m.grade, grade_of(&game, "me"));
        assert!(m.grade.is_some());
    }

    #[test]
    fn maps_ranked_entries() {
        let entry = |queue: &str, tier: &str, rank: &str| LeagueEntry {
            puuid: None,
            queue_type: queue.into(),
            tier: Some(tier.into()),
            rank: Some(rank.into()),
            league_points: 67,
            wins: 142,
            losses: 128,
            hot_streak: false,
            veteran: false,
            fresh_blood: false,
        };
        let solo = solo_queue(&[
            entry("RANKED_FLEX_SR", "GOLD", "I"),
            entry("RANKED_SOLO_5x5", "EMERALD", "II"),
        ])
        .expect("solo");
        assert_eq!(
            (solo.tier, solo.division, solo.league_points),
            (Tier::Emerald, Some(Division::II), 67)
        );
        let apex = solo_queue(&[entry("RANKED_SOLO_5x5", "MASTER", "I")]).expect("apex");
        assert_eq!(apex.division, None);
        assert!(solo_queue(&[]).is_none());
    }

    #[test]
    fn parses_riot_ids() {
        let id = parse_riot_id("Fillmo#7272").expect("valid");
        assert_eq!(
            (id.game_name.as_str(), id.tag_line.as_str()),
            ("Fillmo", "7272")
        );
        assert!(parse_riot_id("no tag").is_err());
        assert!(parse_riot_id("#7272").is_err());
    }
}
