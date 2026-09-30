//! Whole Match-V5 games: every player's grade (`stats::grade`) and the match details view.
//!
//! Names come from the game document only: a player it doesn't name (hidden by Riot) stays
//! unnamed, and nothing here ever looks a player up.

use domain::{EndOfGameStats, MatchDetails, MatchGrade, MatchPlayer, MatchTeam, RiotId, Role};
use serde_json::Value;
use stats::grade::{Lobby, LobbyPlayer, grade};

/// Match-V5's PUUID for bots.
const BOT_PUUID: &str = "BOT";

fn u32_at(v: &Value, key: &str) -> u32 {
    v.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0)
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Match-V5's `teamPosition` (empty in modes without roles).
pub fn role(position: Option<&str>) -> Option<Role> {
    match position? {
        "TOP" => Some(Role::Top),
        "JUNGLE" => Some(Role::Jungle),
        "MIDDLE" => Some(Role::Middle),
        "BOTTOM" => Some(Role::Bottom),
        "UTILITY" => Some(Role::Support),
        _ => None,
    }
}

fn participants(game: &Value) -> &[Value] {
    game.pointer("/info/participants")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn duration(game: &Value) -> u32 {
    game.get("info")
        .map_or(0, |info| u32_at(info, "gameDuration"))
}

fn lobby_player(p: &Value) -> LobbyPlayer {
    LobbyPlayer {
        team: u32_at(p, "teamId"),
        win: p.get("win").and_then(Value::as_bool).unwrap_or(false),
        role: role(str_at(p, "teamPosition")),
        champion_id: u32_at(p, "championId"),
        kills: u32_at(p, "kills"),
        deaths: u32_at(p, "deaths"),
        assists: u32_at(p, "assists"),
        creep_score: u32_at(p, "totalMinionsKilled")
            .saturating_add(u32_at(p, "neutralMinionsKilled")),
        gold: u32_at(p, "goldEarned"),
        damage_to_champions: u32_at(p, "totalDamageDealtToChampions"),
        damage_taken: u32_at(p, "totalDamageTaken")
            .saturating_add(u32_at(p, "damageSelfMitigated")),
        vision_score: u32_at(p, "visionScore"),
        objective_damage: u32_at(p, "damageDealtToObjectives"),
    }
}

/// Every player's grade, in the document's order; `None` when the game has none (a remake,
/// a mode without two teams of five).
pub fn grades(game: &Value) -> Option<Vec<MatchGrade>> {
    let lobby = Lobby {
        duration_seconds: duration(game),
        players: participants(game).iter().map(lobby_player).collect(),
    };
    grade(&lobby)
}

/// `puuid`'s grade in the game.
pub fn grade_of(game: &Value, puuid: &str) -> Option<MatchGrade> {
    let index = participants(game)
        .iter()
        .position(|p| p.get("puuid").and_then(Value::as_str) == Some(puuid))?;
    grades(game)?.into_iter().nth(index)
}

/// The participant's end-of-game numbers (absent fields stay `None`).
fn end_of_game(p: &Value) -> EndOfGameStats {
    EndOfGameStats::read(
        |key| {
            p.get(key)
                .and_then(Value::as_u64)
                .and_then(|n| u32::try_from(n).ok())
        },
        |key| p.get(key).and_then(Value::as_bool),
    )
}

fn items(p: &Value) -> Vec<u32> {
    (0..6)
        .map(|i| u32_at(p, &format!("item{i}")))
        .filter(|&id| id != 0)
        .collect()
}

fn match_player(p: &Value, grade: Option<MatchGrade>) -> MatchPlayer {
    let stats = lobby_player(p);
    let riot_id = str_at(p, "riotIdGameName").map(|game_name| RiotId {
        game_name: game_name.to_owned(),
        tag_line: str_at(p, "riotIdTagline").unwrap_or_default().to_owned(),
    });
    let bot = str_at(p, "puuid") == Some(BOT_PUUID);
    let perk = |pointer: &str| {
        p.pointer(pointer)
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .filter(|&id| id != 0)
    };
    MatchPlayer {
        // A player the game doesn't name is hidden (streamer mode), unless it's a bot.
        hidden: riot_id.is_none() && !bot,
        riot_id,
        is_me: false,
        champion_id: stats.champion_id,
        champion_level: u32_at(p, "champLevel"),
        role: stats.role,
        kills: stats.kills,
        deaths: stats.deaths,
        assists: stats.assists,
        creep_score: stats.creep_score,
        gold: stats.gold,
        damage_to_champions: stats.damage_to_champions,
        vision_score: stats.vision_score,
        items: items(p),
        trinket: Some(u32_at(p, "item6")).filter(|&id| id != 0),
        spells: [u32_at(p, "summoner1Id"), u32_at(p, "summoner2Id")]
            .into_iter()
            .filter(|&id| id != 0)
            .collect(),
        keystone: perk("/perks/styles/0/selections/0/perk"),
        secondary_tree: perk("/perks/styles/1/style"),
        grade,
        stats: end_of_game(p),
    }
}

/// The whole game for the match details view (every player's grade included).
pub fn match_details(game: &Value) -> Option<MatchDetails> {
    let info = game.get("info")?;
    let list = participants(game);
    if list.is_empty() {
        return None;
    }
    let duration = duration(game);
    let ended_at = info
        .get("gameEndTimestamp")
        .and_then(Value::as_i64)
        .or_else(|| Some(info.get("gameStartTimestamp")?.as_i64()? + i64::from(duration) * 1000))?;
    let mut grades = grades(game).map(Vec::into_iter);
    let players = list.iter().map(|p| {
        let grade = grades.as_mut().and_then(Iterator::next);
        let stats = lobby_player(p);
        (stats.team, stats.win, match_player(p, grade))
    });
    Some(MatchDetails {
        match_id: game.pointer("/metadata/matchId")?.as_str()?.to_owned(),
        queue_id: u32_at(info, "queueId"),
        duration_seconds: duration,
        ended_at,
        teams: MatchTeam::group(players),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use domain::GradeBadge;
    use serde_json::json;

    use super::*;

    /// A full 30-minute ranked game (blue wins) in Match-V5's shape, one participant per role
    /// and team; `me` plays blue's mid. Red's jungler is in streamer mode, red's support a bot.
    pub(crate) fn full_game(match_id: &str, me: &str) -> Value {
        let positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
        let participants: Vec<Value> = (0..10_u32)
            .map(|i| {
                let blue = i < 5;
                let lane = usize::try_from(i % 5).unwrap_or(0);
                let carry = i == 2;
                let (name, tag, puuid) = match i {
                    2 => ("Fillmo", "7272", me.to_owned()),
                    6 => ("", "", format!("puuid-{i}")),
                    9 => ("", "", BOT_PUUID.to_owned()),
                    _ => ("Player", "EUW", format!("puuid-{i}")),
                };
                let mut player = json!({
                    "puuid": puuid, "riotIdGameName": name, "riotIdTagline": tag,
                    "teamId": if blue { 100 } else { 200 }, "win": blue,
                    "teamPosition": positions[lane], "championId": 100 + i, "champLevel": 16,
                    "kills": if carry { 12 } else { 4 }, "deaths": if carry { 1 } else { 5 },
                    "assists": 6, "totalMinionsKilled": 180, "neutralMinionsKilled": 10,
                    "goldEarned": if carry { 15_000 } else { 11_000 },
                    "totalDamageDealtToChampions": if carry { 34_000 } else { 16_000 },
                    "totalDamageTaken": 20_000, "damageSelfMitigated": 8_000,
                    "visionScore": 25, "damageDealtToObjectives": 5_000,
                    "item0": 6655, "item1": 0, "item2": 3020, "item6": 3340,
                    "summoner1Id": 4, "summoner2Id": 14,
                    "perks": { "styles": [
                        { "style": 8100, "selections": [{ "perk": 8112 }, { "perk": 8139 }] },
                        { "style": 8200, "selections": [{ "perk": 8233 }] }
                    ] }
                });
                // The end-of-game stats (one `json!` would be too deep for the macro).
                let end_of_game = json!({
                    "largestKillingSpree": if carry { 8 } else { 2 },
                    "largestMultiKill": if carry { 3 } else { 1 }, "firstBloodKill": carry,
                    "physicalDamageDealtToChampions": if carry { 4_000 } else { 9_000 },
                    "magicDamageDealtToChampions": if carry { 28_000 } else { 6_000 },
                    "trueDamageDealtToChampions": if carry { 2_000 } else { 1_000 },
                    "damageDealtToTurrets": 3_000, "totalHeal": 2_500,
                    "totalHealsOnTeammates": if lane == 4 { 4_000 } else { 0 },
                    "totalDamageShieldedOnTeammates": if lane == 4 { 6_000 } else { 0 },
                    "wardsPlaced": 10, "wardsKilled": 3, "visionWardsBoughtInGame": 2,
                    "goldSpent": if carry { 14_100 } else { 10_500 }, "timeCCingOthers": 21,
                    "turretKills": u32::from(blue), "inhibitorKills": 0
                });
                if let (Some(player), Value::Object(more)) = (player.as_object_mut(), end_of_game) {
                    player.extend(more);
                }
                player
            })
            .collect();
        json!({
            "metadata": { "matchId": match_id },
            "info": { "gameDuration": 1800, "gameEndTimestamp": 1_790_000_000_000_i64, "queueId": 420,
                      "participants": participants }
        })
    }

    #[test]
    fn grades_every_player_of_a_full_game() {
        let game = full_game("EUW1_1", "me");
        let all = grades(&game).expect("a full game");
        assert_eq!(all.len(), 10);
        let mine = grade_of(&game, "me").expect("my grade");
        assert_eq!(mine, all[2]);
        assert_eq!(mine.badge, Some(GradeBadge::Mvp));
        assert!(grade_of(&game, "nobody").is_none());

        let mut remake = game.clone();
        remake["info"]["gameDuration"] = json!(290);
        assert!(grades(&remake).is_none());
    }

    #[test]
    fn details_hold_both_teams_in_lane_order() {
        let details = match_details(&full_game("EUW1_1", "me")).expect("details");
        assert_eq!(details.match_id, "EUW1_1");
        assert_eq!((details.queue_id, details.duration_seconds), (420, 1800));
        assert_eq!(details.teams.len(), 2);
        let (blue, red) = (&details.teams[0], &details.teams[1]);
        assert_eq!((blue.team_id, blue.win, red.win), (100, true, false));
        let roles: Vec<Option<Role>> = blue.players.iter().map(|p| p.role).collect();
        assert_eq!(
            roles,
            [
                Role::Top,
                Role::Jungle,
                Role::Middle,
                Role::Bottom,
                Role::Support
            ]
            .map(Some)
        );
        let mid = &blue.players[2];
        assert_eq!(
            mid.riot_id,
            Some(RiotId {
                game_name: "Fillmo".into(),
                tag_line: "7272".into()
            })
        );
        assert_eq!((mid.kills, mid.creep_score, mid.gold), (12, 190, 15_000));
        assert_eq!(mid.items, vec![6655, 3020]);
        assert_eq!(mid.trinket, Some(3340));
        assert_eq!(mid.spells, vec![4, 14]);
        assert_eq!((mid.keystone, mid.secondary_tree), (Some(8112), Some(8200)));
        assert!(mid.grade.is_some() && !mid.is_me && !mid.hidden);
        // The end-of-game stats, as Riot counts them.
        let stats = &mid.stats;
        assert_eq!(
            (stats.largest_killing_spree, stats.largest_multi_kill),
            (Some(8), Some(3))
        );
        assert_eq!(stats.first_blood, Some(true));
        assert_eq!(
            (
                stats.physical_damage_to_champions,
                stats.magic_damage_to_champions,
                stats.true_damage_to_champions
            ),
            (Some(4_000), Some(28_000), Some(2_000))
        );
        assert_eq!(
            (stats.damage_taken, stats.damage_self_mitigated),
            (Some(20_000), Some(8_000))
        );
        assert_eq!((stats.minions, stats.monsters), (Some(180), Some(10)));
        assert_eq!(
            (stats.gold_spent, stats.crowd_control_seconds),
            (Some(14_100), Some(21))
        );
        assert_eq!(
            (stats.turrets_destroyed, stats.inhibitors_destroyed),
            (Some(1), Some(0))
        );
        let support = &blue.players[4].stats;
        assert_eq!(
            (support.healing_on_teammates, support.shielding_on_teammates),
            (Some(4_000), Some(6_000))
        );
        assert_eq!(red.players[0].stats.first_blood, Some(false));

        // Unnamed players stay unnamed: hidden (streamer mode), or a bot.
        let jungler = &red.players[1];
        assert!(jungler.riot_id.is_none() && jungler.hidden);
        let bot = &red.players[4];
        assert!(bot.riot_id.is_none() && !bot.hidden);
    }

    #[test]
    fn details_without_grades_still_show() {
        let mut arena = full_game("EUW1_2", "me");
        if let Some(list) = arena["info"]["participants"].as_array_mut() {
            list.truncate(8);
        }
        let details = match_details(&arena).expect("details");
        assert!(
            details
                .teams
                .iter()
                .flat_map(|t| &t.players)
                .all(|p| p.grade.is_none())
        );
        assert!(match_details(&json!({ "info": {} })).is_none());
    }
}
