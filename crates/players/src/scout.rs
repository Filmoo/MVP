//! Loading-screen scouting: a compact card per player from recent ranked solo/duo games.
//!
//! Tags are positive or neutral only (docs/policy.md): no negative labels, no "first time".

use domain::{ChampionRecord, MatchSummary, RankedEntry, RiotId, Role, ScoutCard, ScoutTag};
use riot_api::{Account, LeagueEntry, MatchQuery, Platform, RiotError};

use crate::{RiotSource, match_summaries, solo_queue};

/// Ranked games a card is built from.
pub const SCOUT_GAMES: u32 = 20;
const RANKED_SOLO_QUEUE: u32 = 420;
const TOP_CHAMPIONS: usize = 3;
const RECENT_RESULTS: usize = 10;

const OTP_MIN_GAMES: usize = 10;
const OTP_MIN_PERCENT: usize = 70;
const MAIN_ROLE_MIN_GAMES: usize = 5;
const MAIN_ROLE_MIN_PERCENT: usize = 60;
const LISTED_ROLE_MIN_PERCENT: usize = 25;
const HOT_STREAK_MIN_WINS: usize = 4;
const VETERAN_MIN_GAMES: u32 = 100;

const ROLES: [Role; 5] = [
    Role::Top,
    Role::Jungle,
    Role::Middle,
    Role::Bottom,
    Role::Support,
];

/// Fetches what a card needs for a PUUID (as our key sees it): account (Riot ID), league
/// entries, last ranked games.
pub async fn fetch_scout_card<S: RiotSource>(
    source: &S,
    platform: Platform,
    puuid: &str,
) -> Result<ScoutCard, RiotError> {
    let (account, (entries, games)) = tokio::try_join!(
        source.account_by_puuid(platform, puuid),
        ranked_sample(source, platform, puuid),
    )?;
    Ok(scout_card(
        puuid,
        riot_id(account),
        solo_queue(&entries),
        &games,
    ))
}

/// Like [`fetch_scout_card`] for an account already looked up (by Riot ID): no second
/// account call, and the card carries that account's Riot ID.
pub async fn fetch_scout_card_for<S: RiotSource>(
    source: &S,
    platform: Platform,
    account: Account,
) -> Result<ScoutCard, RiotError> {
    let (entries, games) = ranked_sample(source, platform, &account.puuid).await?;
    let puuid = account.puuid.clone();
    Ok(scout_card(
        &puuid,
        riot_id(account),
        solo_queue(&entries),
        &games,
    ))
}

/// League entries and the last ranked solo/duo games, newest first.
async fn ranked_sample<S: RiotSource>(
    source: &S,
    platform: Platform,
    puuid: &str,
) -> Result<(Vec<LeagueEntry>, Vec<MatchSummary>), RiotError> {
    let query = MatchQuery {
        queue: Some(RANKED_SOLO_QUEUE),
        count: SCOUT_GAMES,
        ..MatchQuery::default()
    };
    let (entries, ids) = tokio::try_join!(
        source.league_entries_by_puuid(platform, puuid),
        source.match_ids(platform, puuid, &query),
    )?;
    let games = match_summaries(source, platform, &ids, puuid).await?;
    Ok((entries, games))
}

fn riot_id(account: Account) -> Option<RiotId> {
    match (account.game_name, account.tag_line) {
        (Some(game_name), Some(tag_line)) => Some(RiotId {
            game_name,
            tag_line,
        }),
        _ => None,
    }
}

fn percent_at_least(part: usize, whole: usize, percent: usize) -> bool {
    whole > 0 && part * 100 >= whole * percent
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Builds a card from ranked games, newest first.
pub fn scout_card(
    puuid: &str,
    riot_id: Option<RiotId>,
    solo_queue: Option<RankedEntry>,
    games: &[MatchSummary],
) -> ScoutCard {
    let n = games.len();

    // Champions, most games first (ties: more wins, then lower id for a stable order).
    let mut champions: Vec<ChampionRecord> = Vec::new();
    for g in games {
        let rec = if let Some(i) = champions
            .iter()
            .position(|c| c.champion_id == g.champion_id)
        {
            &mut champions[i]
        } else {
            champions.push(ChampionRecord {
                champion_id: g.champion_id,
                games: 0,
                wins: 0,
                kills: 0,
                deaths: 0,
                assists: 0,
                kda: 0.0,
            });
            let last = champions.len() - 1;
            &mut champions[last]
        };
        rec.games += 1;
        rec.wins += u32::from(g.win);
        rec.kills += g.kills;
        rec.deaths += g.deaths;
        rec.assists += g.assists;
    }
    for c in &mut champions {
        c.kda = round2(f64::from(c.kills + c.assists) / f64::from(c.deaths.max(1)));
    }
    champions.sort_by(|a, b| {
        b.games
            .cmp(&a.games)
            .then(b.wins.cmp(&a.wins))
            .then(a.champion_id.cmp(&b.champion_id))
    });

    // Roles, most games first (ties keep the lane order).
    let mut roles: Vec<(Role, usize)> = ROLES
        .iter()
        .map(|&r| (r, games.iter().filter(|g| g.role == Some(r)).count()))
        .filter(|&(_, games)| games > 0)
        .collect();
    roles.sort_by_key(|&(_, games)| std::cmp::Reverse(games));

    let mut tags = Vec::new();
    if let Some(top) = champions.first()
        && n >= OTP_MIN_GAMES
        && percent_at_least(
            usize::try_from(top.games).unwrap_or(usize::MAX),
            n,
            OTP_MIN_PERCENT,
        )
    {
        tags.push(ScoutTag::Otp {
            champion_id: top.champion_id,
            share: round2(f64::from(top.games) / n as f64),
        });
    }
    if let Some(&(role, role_games)) = roles.first()
        && n >= MAIN_ROLE_MIN_GAMES
        && percent_at_least(role_games, n, MAIN_ROLE_MIN_PERCENT)
    {
        tags.push(ScoutTag::MainRole { role });
    }
    let streak = games.iter().take_while(|g| g.win).count();
    if streak >= HOT_STREAK_MIN_WINS {
        tags.push(ScoutTag::HotStreak {
            wins: count(streak),
        });
    }
    if let Some(solo) = &solo_queue {
        let season = solo.wins + solo.losses;
        if season >= VETERAN_MIN_GAMES {
            tags.push(ScoutTag::Veteran { games: season });
        }
    }

    ScoutCard {
        puuid: puuid.to_owned(),
        riot_id,
        solo_queue,
        games_sampled: count(n),
        top_champions: champions.into_iter().take(TOP_CHAMPIONS).collect(),
        recent_results: games.iter().take(RECENT_RESULTS).map(|g| g.win).collect(),
        main_roles: roles
            .into_iter()
            .filter(|&(_, g)| percent_at_least(g, n, LISTED_ROLE_MIN_PERCENT))
            .take(2)
            .map(|(r, _)| r)
            .collect(),
        tags,
    }
}

#[cfg(test)]
mod tests {
    use domain::Tier;

    use super::*;

    fn game(champion_id: u32, role: Role, win: bool) -> MatchSummary {
        MatchSummary {
            match_id: String::new(),
            queue_id: RANKED_SOLO_QUEUE,
            champion_id,
            role: Some(role),
            win,
            kills: 5,
            deaths: 2,
            assists: 6,
            creep_score: 180,
            duration_seconds: 1800,
            ended_at: 0,
            items: vec![],
        }
    }

    fn solo(wins: u32, losses: u32) -> RankedEntry {
        RankedEntry {
            tier: Tier::Emerald,
            division: None,
            league_points: 10,
            wins,
            losses,
        }
    }

    #[test]
    fn one_trick_main_role_streak_and_veteran() {
        // 14 of 20 on champion 103 (70 %), all mid; newest 5 are wins.
        let mut games: Vec<MatchSummary> = (0..20)
            .map(|i| game(if i < 14 { 103 } else { 238 }, Role::Middle, i % 2 == 0))
            .collect();
        for g in games.iter_mut().take(5) {
            g.win = true;
        }
        let card = scout_card("p", None, Some(solo(60, 50)), &games);
        assert_eq!(
            card.tags,
            vec![
                ScoutTag::Otp {
                    champion_id: 103,
                    share: 0.7
                },
                ScoutTag::MainRole { role: Role::Middle },
                ScoutTag::HotStreak { wins: 5 },
                ScoutTag::Veteran { games: 110 },
            ]
        );
        assert_eq!(card.games_sampled, 20);
        assert_eq!(card.recent_results.len(), 10);
        assert_eq!(card.main_roles, vec![Role::Middle]);
        let top = &card.top_champions[0];
        assert_eq!((top.champion_id, top.games), (103, 14));
        assert!((top.kda - 5.5).abs() < f64::EPSILON);
    }

    #[test]
    fn no_tags_below_thresholds() {
        // 13 of 20 (65 %) on one champion, split roles, a loss on top, 99 season games.
        let games: Vec<MatchSummary> = (0..20)
            .map(|i| {
                let role = if i % 2 == 0 { Role::Top } else { Role::Jungle };
                game(if i < 13 { 1 } else { 2 }, role, i != 0)
            })
            .collect();
        let card = scout_card("p", None, Some(solo(50, 49)), &games);
        assert!(card.tags.is_empty(), "{:?}", card.tags);
        assert_eq!(card.main_roles, vec![Role::Top, Role::Jungle]);

        // Small samples never earn OTP / main role tags.
        let few: Vec<MatchSummary> = (0..4).map(|_| game(1, Role::Top, false)).collect();
        assert!(scout_card("p", None, None, &few).tags.is_empty());
        let empty = scout_card("p", None, None, &[]);
        assert!(empty.tags.is_empty() && empty.top_champions.is_empty());
    }
}
