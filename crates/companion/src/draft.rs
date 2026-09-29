//! The draft helper: fills the champion-select view with the stats-only model's numbers — our
//! team's win chance, ranked picks for the player's role with their reasons, and the enemies'
//! likely roles (`stats::draft`, research D).
//!
//! - **Candidates, pool-first** (owner's call): what the player hovers or locked, their recent
//!   games in the role, their mastery on champions played in the role, then the role's best
//!   tier-list picks so the list is never empty. Only champions they can pick (not banned, not
//!   taken, `pickable-champion-ids`). No ban suggestions.
//! - **Team**: locked picks and allies' hovers; the player's own hover isn't a pick yet, so
//!   before they lock in, every suggestion's gain is measured against the team without them.
//! - **Compositions** (`companion::stats::comp`, informational): each team's damage mix,
//!   frontline, crowd control and game-length lean from its champions — locked picks and
//!   hovers, marked as such — and your team's with each suggestion in your seat.
//! - **ARAM** (no roles): your champion and the bench's, by the team's win chance with each
//!   (champions' ARAM strengths); nothing is ever swapped for you.
//! - **Data**: the game's queue (ranked data on Summoner's Rift, ARAM's own), the bracket of
//!   the player's settings (Emerald+ when that one isn't published), current patch
//!   (`StatsClient`); the matchups files of the champions in the draft are loaded as they
//!   appear (and the candidates' once an enemy is locked: only a laner's own file has its
//!   games against the enemy jungler).
//! - **Privacy**: only champion-level stats about the other players; the local player's own
//!   mastery, match history and pickable champions come from their client.
//!
//! Runs as its own task: the core's event loop only maps sessions (cheap); every change is
//! re-published at once when nothing the model reads changed, else after one evaluation (off
//! the async threads). Data arriving in bursts is coalesced.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use ::stats::draft::{
    Base, ChampRole, Evaluation, Pick, Role, TermKind, assignments, evaluate, role_probabilities,
    suggest,
};
use ::stats::{logit, sigmoid};
use domain::{
    BackendError, Bracket, ChampionsFile, Compositions, DataInfo, DraftView, Estimate, Mastery,
    MatchupsFile, PersonalRecord, Reason, ReasonKind, RemoteConfig, RoleOdds, Settings, StatsIndex,
    Suggestion, TierList,
};
use lcu::LcuClient;
use serde_json::Value;
use tokio::sync::{Semaphore, mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::imports::{GAMEFLOW_SESSION, stats_queue};
use crate::profile;
use crate::stats::comp::{CompStats, RoleMix, Seat};
use crate::stats::model::{domain_role, role};
use crate::stats::{ARAM, DataSet, DraftStats, RANKED, StatsClient};

/// The local player's champion mastery (their own data).
pub const MASTERY: &str = "/lol-champion-mastery/v1/local-player/champion-mastery";
/// Champions the local player owns or may play in this champion select.
pub const PICKABLE: &str = "/lol-champ-select/v1/pickable-champion-ids";

/// The bracket the draft falls back to when the player's isn't published (yet): the widest.
pub const FALLBACK_BRACKET: Bracket = Bracket::EmeraldPlus;
/// Picks shown.
const SUGGESTIONS: usize = 15;
/// Pool champions among the candidates, at most.
const POOL_SIZE: usize = 10;
/// Meta picks among the candidates, at least.
const META_MIN: usize = 5;
/// A mastered champion joins the pool for a role that holds at least this share of its games.
const POOL_MIN_SHARE: f64 = 0.1;
/// Summoner's Rift queues whose games count for the player's record.
const RIFT_QUEUES: [u32; 7] = [400, 420, 430, 440, 480, 490, 700];
/// Enemy roles shown from this probability.
const MIN_ODDS: f64 = 0.05;
/// Reasons listed per pick.
const REASONS: usize = 8;
/// A reason without games that moves less than this is left out.
const MIN_POINTS: f64 = 0.05;
/// Data arriving within this window is evaluated once.
const SETTLE: Duration = Duration::from_millis(30);
/// Matchups files fetched at once.
const PARALLEL_FETCHES: usize = 4;

/// What the local player brings: mastery, recent games and what they can pick.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Pool {
    /// Per champion, when mastered at all.
    pub mastery: HashMap<u32, Mastery>,
    /// Summoner's Rift games with a known role, most recent first.
    pub games: Vec<PoolGame>,
    /// What can be picked; `None` when the client didn't say (no restriction then).
    pub pickable: Option<HashSet<u32>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PoolGame {
    pub champion: u32,
    pub role: domain::Role,
    pub win: bool,
}

impl Pool {
    /// The player's games on `champion` in `role`.
    pub fn record(&self, champion: u32, role: domain::Role) -> Option<PersonalRecord> {
        let (games, wins) = self
            .games
            .iter()
            .filter(|g| g.champion == champion && g.role == role)
            .fold((0, 0), |(n, w), g| (n + 1, w + u32::from(g.win)));
        (games > 0).then_some(PersonalRecord { games, wins })
    }

    pub fn can_pick(&self, champion: u32) -> bool {
        self.pickable.as_ref().is_none_or(|p| p.contains(&champion))
    }
}

fn u32_at(v: &Value, key: &str) -> Option<u32> {
    v.get(key)
        .and_then(Value::as_u64)
        .map(|n| u32::try_from(n).unwrap_or(u32::MAX))
}

/// `/lol-champion-mastery/v1/local-player/champion-mastery` → mastery per champion.
pub fn map_mastery(value: &Value) -> HashMap<u32, Mastery> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let champion = u32_at(m, "championId").filter(|&c| c != 0)?;
            let mastery = Mastery {
                level: u32_at(m, "championLevel").unwrap_or(0),
                points: u32_at(m, "championPoints").unwrap_or(0),
            };
            (mastery.points > 0 || mastery.level > 0).then_some((champion, mastery))
        })
        .collect()
}

/// `/lol-champ-select/v1/pickable-champion-ids`; `None` when missing or empty (unknown).
pub fn map_pickable(value: &Value) -> Option<HashSet<u32>> {
    let ids: HashSet<u32> = value
        .as_array()?
        .iter()
        .filter_map(Value::as_u64)
        .filter_map(|n| u32::try_from(n).ok())
        .filter(|&n| n != 0)
        .collect();
    (!ids.is_empty()).then_some(ids)
}

/// Summoner's Rift games with a role, from the client's match history.
pub fn pool_games(history: &Value) -> Vec<PoolGame> {
    profile::map_matches(history, "LOCAL")
        .into_iter()
        .filter(|m| RIFT_QUEUES.contains(&m.queue_id) && m.champion_id != 0)
        .filter_map(|m| {
            Some(PoolGame {
                champion: m.champion_id,
                role: m.role?,
                win: m.win,
            })
        })
        .collect()
}

/// Reads the player's pool from their client. Missing pieces only shrink it.
pub async fn load_pool(lcu: &LcuClient) -> Pool {
    let (mastery, pickable, history) = tokio::join!(
        lcu.get::<Value>(MASTERY),
        lcu.get::<Value>(PICKABLE),
        lcu.get::<Value>(profile::MATCHES),
    );
    let read = |what: &str, answer: Result<Value, lcu::LcuError>| match answer {
        Ok(value) => Some(value),
        Err(error) => {
            tracing::debug!(%error, what, "draft pool: not available");
            None
        }
    };
    Pool {
        mastery: read("mastery", mastery)
            .map(|v| map_mastery(&v))
            .unwrap_or_default(),
        games: read("match history", history)
            .map(|v| pool_games(&v))
            .unwrap_or_default(),
        pickable: read("pickable champions", pickable).and_then(|v| map_pickable(&v)),
    }
}

/// The stats a champion select reads: which data set, its badge, its tier list (ranked) and
/// what each champion brings to a composition.
#[derive(Debug, Clone)]
pub struct SessionData {
    pub set: DataSet,
    pub info: DataInfo,
    pub tiers: Option<Arc<TierList>>,
    /// `None` when not published (games crawled before those numbers, an older server).
    pub comps: Option<Arc<CompStats>>,
}

/// Everything the model adds to a champion-select view.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Enrichment {
    pub team: Option<Estimate>,
    pub suggestions: Vec<Suggestion>,
    pub data: Option<DataInfo>,
    /// Per enemy seat: the likeliest role and the likely ones, most likely first.
    pub enemies: Vec<(Option<domain::Role>, Vec<RoleOdds>)>,
    pub comps: Option<Compositions>,
}

impl Enrichment {
    pub fn apply(&self, view: &mut DraftView) {
        view.team = self.team;
        view.suggestions.clone_from(&self.suggestions);
        view.data.clone_from(&self.data);
        view.comps.clone_from(&self.comps);
        for (slot, (role, odds)) in view.enemies.iter_mut().zip(&self.enemies) {
            slot.role = *role;
            slot.role_odds.clone_from(odds);
        }
    }
}

fn round(x: f64, digits: i32) -> f64 {
    let f = 10f64.powi(digits);
    (x * f).round() / f
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "rounded and clamped to u32's range first"
)]
fn count(x: f64) -> u32 {
    if x.is_finite() && x > 0.0 {
        x.round().min(f64::from(u32::MAX)) as u32
    } else {
        0
    }
}

fn estimate(e: &Evaluation) -> Estimate {
    let p = e.win_probability();
    Estimate {
        percent: round(p * 100.0, 2),
        // One SD of the score, mapped from log-odds to points around p.
        plus_minus: round(e.sd * p * (1.0 - p) * 100.0, 2),
    }
}

/// The likeliest roles of each enemy seat, from the champions' role shares over every
/// consistent assignment (`odds`: per enemy pick, in seat order).
fn enemy_roles(view: &DraftView, odds: &[[f64; 5]]) -> Vec<(Option<domain::Role>, Vec<RoleOdds>)> {
    let mut per_pick = odds.iter();
    view.enemies
        .iter()
        .map(|slot| {
            if slot.champion_id.is_none() {
                return (None, Vec::new());
            }
            let Some(p) = per_pick.next() else {
                return (None, Vec::new());
            };
            let mut odds: Vec<RoleOdds> = Role::ALL
                .iter()
                .map(|&r| RoleOdds {
                    role: domain_role(r),
                    probability: round(p[r.index()], 3),
                })
                .filter(|o| o.probability >= MIN_ODDS)
                .collect();
            odds.sort_by(|a, b| b.probability.total_cmp(&a.probability));
            (odds.first().map(|o| o.role), odds)
        })
        .collect()
}

/// Pool first (what the player hovers or locked, their games in the role, their mastery on
/// champions played in the role), then the role's best picks; only champions they can pick.
pub fn candidates(
    view: &DraftView,
    my_role: domain::Role,
    model: &DraftStats,
    tiers: Option<&TierList>,
    pool: Option<&Pool>,
) -> Vec<u32> {
    let r = role(my_role);
    let mut taken: HashSet<u32> = view
        .ally_bans
        .iter()
        .chain(&view.enemy_bans)
        .copied()
        .collect();
    taken.extend(
        view.allies
            .iter()
            .filter(|s| !s.is_me)
            .chain(&view.enemies)
            .filter_map(|s| s.champion_id),
    );
    let mut out: Vec<u32> = Vec::new();
    // Always explained: the player's own hover or pick (once locked it may leave the pickable list).
    if let Some(mine) = view
        .allies
        .iter()
        .find(|s| s.is_me)
        .and_then(|s| s.champion_id)
        && !taken.contains(&mine)
    {
        out.push(mine);
    }
    let allowed = |c: u32, out: &[u32]| {
        !taken.contains(&c) && !out.contains(&c) && pool.is_none_or(|p| p.can_pick(c))
    };
    if let Some(pool) = pool {
        let start = out.len();
        let mut played: Vec<(u32, usize, usize)> = Vec::new(); // champion, games, first seen
        for (at, g) in pool
            .games
            .iter()
            .enumerate()
            .filter(|(_, g)| g.role == my_role)
        {
            match played.iter_mut().find(|p| p.0 == g.champion) {
                Some(p) => p.1 += 1,
                None => played.push((g.champion, 1, at)),
            }
        }
        played.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)));
        let mut mastered: Vec<(u32, Mastery)> =
            pool.mastery.iter().map(|(&c, &m)| (c, m)).collect();
        mastered.sort_by(|a, b| b.1.points.cmp(&a.1.points).then(a.0.cmp(&b.0)));
        let pool_picks = played.iter().map(|p| p.0).chain(
            mastered
                .iter()
                .filter(|(c, _)| {
                    model.role_shares(*c)[r.index()] >= POOL_MIN_SHARE && model.knows(*c)
                })
                .map(|(c, _)| *c),
        );
        for c in pool_picks {
            if out.len() - start >= POOL_SIZE {
                break;
            }
            if allowed(c, &out) {
                out.push(c);
            }
        }
    }
    let wanted = (out.len() + META_MIN).max(SUGGESTIONS);
    let meta: Vec<u32> = match tiers {
        Some(t) => t
            .entries
            .iter()
            .filter(|e| e.role == Some(my_role))
            .map(|e| e.id)
            .collect(),
        None => model.most_played(r),
    };
    for c in meta {
        if out.len() >= wanted {
            break;
        }
        if allowed(c, &out) {
            out.push(c);
        }
    }
    out
}

/// Why pick `x`: the terms of `eval` that involve it, largest first.
fn reasons(eval: &Evaluation, x: ChampRole) -> Vec<Reason> {
    let mut out: Vec<Reason> = eval
        .terms
        .iter()
        .filter(|t| !t.enemy_side)
        .filter_map(|t| {
            let (kind, other) = match t.kind {
                TermKind::Base if t.subject == x => (ReasonKind::Base, None),
                TermKind::Duo if t.subject == x => (ReasonKind::Duo, t.other),
                TermKind::Duo if t.other == Some(x) => (ReasonKind::Duo, Some(t.subject)),
                TermKind::Lane if t.subject == x => (ReasonKind::Lane, t.other),
                TermKind::Jungle if t.subject == x => (ReasonKind::Jungle, t.other),
                TermKind::OtherMatchup if t.subject == x => (ReasonKind::Matchup, t.other),
                _ => return None,
            };
            // The term's share of the win chance, around a coin flip.
            let points = (sigmoid(t.value) - 0.5) * 100.0;
            if kind != ReasonKind::Base && t.games < 0.5 && points.abs() < MIN_POINTS {
                return None;
            }
            Some(Reason {
                kind,
                champion_id: other.map(|o| o.champion),
                points: round(points, 2),
                games: count(t.games),
                kept: round(t.kept.clamp(0.0, 1.0), 3),
                probability: round(t.probability.clamp(0.0, 1.0), 3),
            })
        })
        .collect();
    out.sort_by(|a, b| b.points.abs().total_cmp(&a.points.abs()));
    out.truncate(REASONS);
    out
}

/// Where a champion plays, for its composition numbers: its seat's role, else its usual roles.
fn role_mix(model: &DraftStats, champion: u32, role: Option<domain::Role>) -> RoleMix {
    match role {
        Some(role) => vec![(Some(role), 1.0)],
        None => Role::ALL
            .iter()
            .map(|&r| (Some(domain_role(r)), model.role_shares(champion)[r.index()]))
            .collect(),
    }
}

/// Our allies' seats (locked picks and hovers, as such), without the local player's when
/// `without_me`.
fn ally_seats(view: &DraftView, model: &DraftStats, without_me: bool) -> Vec<Seat> {
    view.allies
        .iter()
        .filter(|s| !(without_me && s.is_me))
        .filter_map(|s| {
            Some(Seat {
                champion: s.champion_id?,
                hovering: s.hovering,
                roles: role_mix(model, s.champion_id?, s.role),
            })
        })
        .collect()
}

/// Both teams' compositions: allies in their seats' roles, enemies over their likely roles.
fn compositions(
    view: &DraftView,
    model: &DraftStats,
    comps: &CompStats,
    enemy_odds: &[[f64; 5]],
) -> Compositions {
    let enemies: Vec<Seat> = view
        .enemies
        .iter()
        .filter_map(|s| s.champion_id)
        .zip(enemy_odds)
        .map(|(champion, odds)| Seat {
            champion,
            hovering: false,
            roles: Role::ALL
                .iter()
                .map(|&r| (Some(domain_role(r)), odds[r.index()]))
                .collect(),
        })
        .collect();
    Compositions {
        allies: comps.team(&ally_seats(view, model, false), true),
        enemies: comps.team(&enemies, true),
        lengths: comps.lengths().to_vec(),
    }
}

/// Team odds, ranked picks, enemy roles and both compositions for one champion-select view
/// (ARAM: [`enrich_aram`]).
pub fn enrich(
    view: &DraftView,
    model: &DraftStats,
    data: &SessionData,
    pool: Option<&Pool>,
) -> Enrichment {
    if data.set.queue == ARAM {
        return enrich_aram(view, model, data, pool);
    }
    let enemies: Vec<Pick> = view
        .enemies
        .iter()
        .filter_map(|s| s.champion_id)
        .map(|champion| Pick {
            champion,
            role_shares: model.role_shares(champion),
            locked: None,
        })
        .collect();
    let seatings = assignments(&enemies);
    let odds = role_probabilities(&enemies, &seatings);
    let mut out = Enrichment {
        data: Some(data.info.clone()),
        enemies: enemy_roles(view, &odds),
        comps: data
            .comps
            .as_deref()
            .map(|comps| compositions(view, model, comps, &odds)),
        ..Enrichment::default()
    };
    let Some(my_role) = view.my_role else {
        return out;
    };
    // Allies' picks and hovers, each in its assigned role (unknown roles: no estimate).
    let mut allies = Vec::new();
    for slot in view.allies.iter().filter(|s| !s.is_me) {
        let Some(champion) = slot.champion_id else {
            continue;
        };
        let Some(slot_role) = slot.role else {
            return out;
        };
        allies.push(ChampRole {
            champion,
            role: role(slot_role),
        });
    }
    let mut team = allies.clone();
    let me = view.allies.iter().find(|s| s.is_me);
    if let Some(locked) = me.filter(|s| !s.hovering).and_then(|s| s.champion_id) {
        team.push(ChampRole {
            champion: locked,
            role: role(my_role),
        });
    }
    let Some(now) = evaluate(model, &team, &enemies) else {
        return out;
    };
    let team_p = now.win_probability();
    out.team = Some(estimate(&now));
    let candidates = candidates(view, my_role, model, data.tiers.as_deref(), pool);
    // Your team with each pick in your seat (your hover or lock makes way for it).
    let teammates = ally_seats(view, model, true);
    let comp_with = |champion: u32| {
        let comps = data.comps.as_deref()?;
        let mut seats = teammates.clone();
        seats.push(Seat {
            champion,
            hovering: false,
            roles: vec![(Some(my_role), 1.0)],
        });
        Some(comps.team(&seats, false))
    };
    out.suggestions = suggest(model, role(my_role), &allies, &enemies, &candidates)
        .into_iter()
        .take(SUGGESTIONS)
        .map(|s| {
            let x = ChampRole {
                champion: s.champion,
                role: role(my_role),
            };
            Suggestion {
                champion_id: s.champion,
                estimate: estimate(&s.evaluation),
                gain: round((s.evaluation.win_probability() - team_p) * 100.0, 2),
                tier: u32::try_from(s.tier).unwrap_or(u32::MAX),
                mine: pool.and_then(|p| p.record(s.champion, my_role)),
                mastery: pool.and_then(|p| p.mastery.get(&s.champion).copied()),
                reasons: reasons(&s.evaluation, x),
                comp: comp_with(s.champion),
            }
        })
        .collect();
    out
}

/// Strength assumed for an ARAM champion without games: a coin flip, and unsure (±5 pp).
fn aram_fallback() -> Base {
    Base {
        logit: logit(0.5),
        variance: 0.2 * 0.2,
        games: 0.0,
    }
}

/// An ARAM team's score: its champions' strengths added up (the enemy team is unknown: an
/// average one).
fn aram_team(model: &DraftStats, champions: &[u32]) -> Evaluation {
    let (mut score, mut variance) = (0.0, 0.0);
    for &c in champions {
        let base = model.aram(c).map_or_else(aram_fallback, |(base, _)| base);
        score += base.logit;
        variance += base.variance;
    }
    Evaluation {
        score,
        sd: variance.sqrt(),
        terms: Vec::new(),
    }
}

/// ARAM: the team's win chance, your champion and the bench's by the team's chance with each
/// (tiers of statistically tied ones, as in ranked), each with its composition. No roles, the
/// enemy team hidden: its composition stays empty.
pub fn enrich_aram(
    view: &DraftView,
    model: &DraftStats,
    data: &SessionData,
    pool: Option<&Pool>,
) -> Enrichment {
    let aram_seat = |champion: u32, hovering: bool| Seat {
        champion,
        hovering,
        roles: vec![(None, 1.0)],
    };
    let mine = view
        .allies
        .iter()
        .find(|s| s.is_me)
        .and_then(|s| s.champion_id);
    let others: Vec<u32> = view
        .allies
        .iter()
        .filter(|s| !s.is_me)
        .filter_map(|s| s.champion_id)
        .collect();
    let team_with = |champion: Option<u32>| {
        let mut team = others.clone();
        team.extend(champion);
        team
    };
    let now = aram_team(model, &team_with(mine));
    let now_p = now.win_probability();
    let comps = data.comps.as_deref();
    let seats = |champion: Option<u32>| -> Vec<Seat> {
        view.allies
            .iter()
            .filter_map(|s| {
                let id = if s.is_me { champion } else { s.champion_id }?;
                Some(aram_seat(id, s.hovering && !s.is_me))
            })
            .collect()
    };
    let mut out = Enrichment {
        team: Some(estimate(&now)),
        data: Some(data.info.clone()),
        comps: comps.map(|comps| Compositions {
            allies: comps.team(&seats(mine), true),
            enemies: comps.team(&[], true),
            lengths: comps.lengths().to_vec(),
        }),
        ..Enrichment::default()
    };
    let Some(mine) = mine else {
        return out;
    };
    let bench = view.bench.as_deref().unwrap_or_default();
    let mut options: Vec<(u32, Evaluation)> = std::iter::once(mine)
        .chain(
            bench
                .iter()
                .copied()
                .filter(|c| *c != mine && !others.contains(c)),
        )
        .map(|c| (c, aram_team(model, &team_with(Some(c)))))
        .collect();
    options.sort_by(|a, b| b.1.score.total_cmp(&a.1.score).then(a.0.cmp(&b.0)));
    let tiers = tie_tiers(options.iter().map(|(_, e)| (e.score, e.sd)));
    out.suggestions = options
        .into_iter()
        .zip(tiers)
        .take(SUGGESTIONS)
        .map(|((champion, evaluation), tier)| {
            let (base, games) = model.aram(champion).unwrap_or((aram_fallback(), 0));
            Suggestion {
                champion_id: champion,
                estimate: estimate(&evaluation),
                gain: round((evaluation.win_probability() - now_p) * 100.0, 2),
                tier,
                mine: None,
                mastery: pool.and_then(|p| p.mastery.get(&champion).copied()),
                reasons: vec![Reason {
                    kind: ReasonKind::Base,
                    champion_id: None,
                    points: round((sigmoid(base.logit) - 0.5) * 100.0, 2),
                    games,
                    kept: 1.0,
                    probability: 1.0,
                }],
                comp: comps.map(|comps| comps.team(&seats(Some(champion)), false)),
            }
        })
        .collect();
    out
}

/// Tiers of scores sorted best first: one starts where a score is more than one SD (the tier
/// head's or its own) below the tier's first (as `stats::draft::suggest` does).
fn tie_tiers(sorted: impl IntoIterator<Item = (f64, f64)>) -> Vec<u32> {
    let mut tier = 0;
    let mut head: Option<(f64, f64)> = None;
    sorted
        .into_iter()
        .map(|(score, sd)| {
            match head {
                Some((first, first_sd)) if first - score <= first_sd.max(sd) => {}
                _ => {
                    if head.is_some() {
                        tier += 1;
                    }
                    head = Some((score, sd));
                }
            }
            tier
        })
        .collect()
}

/// The data set of `queue` at `bracket`, else at [`FALLBACK_BRACKET`] when that one isn't
/// published (yet): the data line then names the bracket really used.
async fn data_set(stats: &StatsClient, queue: u32, bracket: Bracket) -> Option<DataSet> {
    let answer = match stats.data_set(queue, bracket).await {
        Err(BackendError::NotFound) if bracket != FALLBACK_BRACKET => {
            tracing::info!(
                ?bracket,
                queue,
                "draft: bracket not published, using Emerald+"
            );
            stats.data_set(queue, FALLBACK_BRACKET).await
        }
        answer => answer,
    };
    answer
        .map_err(|error| tracing::info!(%error, queue, "draft: no stats data set"))
        .ok()
}

/// The stats a champion select of `queue` reads at `bracket`, or `None` when there are none
/// (logged).
async fn session_data(
    stats: &StatsClient,
    queue: u32,
    bracket: Bracket,
) -> Option<(SessionData, Arc<ChampionsFile>)> {
    let set = data_set(stats, queue, bracket).await?;
    // ARAM picks no candidates from the tier list.
    let tiers = async {
        if queue == RANKED {
            stats.tier_list(&set).await
        } else {
            Ok(None)
        }
    };
    let (champions, tiers, comps) =
        tokio::join!(stats.champions(&set), tiers, stats.compositions(&set));
    let comps = comps.unwrap_or_else(|error| {
        tracing::info!(%error, "draft: composition stats unavailable");
        None
    });
    let champions = match champions {
        Ok(Some(champions)) => champions,
        Ok(None) => {
            tracing::info!(patch = set.patch, "draft: champion stats not published");
            return None;
        }
        Err(error) => {
            tracing::info!(%error, "draft: champion stats unavailable");
            return None;
        }
    };
    let tiers = tiers.unwrap_or_else(|error| {
        tracing::info!(%error, "draft: tier list unavailable");
        None
    });
    // The file may be the previous patch's (offline): name the patch it really is.
    let patch = &champions.info.patch;
    let name = stats
        .cached_index()
        .and_then(|i| {
            i.patches
                .iter()
                .find(|p| &p.patch == patch)
                .map(|p| p.name.clone())
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| patch.clone());
    let info = DataInfo {
        queue,
        bracket: set.bracket.label().to_owned(),
        patch: name,
        games: champions.info.games,
        updated_at: champions.info.updated_at,
    };
    let comps = comps.map(|file| Arc::new(CompStats::new(&file)));
    Some((
        SessionData {
            set,
            info,
            tiers,
            comps,
        },
        champions,
    ))
}

/// The stats queue of the game in champion select: from the client's gameflow session (`game`,
/// when it could be read), else ARAM for a champion select with a bench, ranked otherwise.
/// `None` for modes without published stats (Arena…).
pub fn queue_of(game: Option<&Value>, view: &DraftView) -> Option<u32> {
    match game {
        Some(game) => stats_queue(game),
        None if view.bench.is_some() => Some(ARAM),
        None => Some(RANKED),
    }
}

enum Loaded {
    Pool {
        session: u64,
        pool: Pool,
    },
    /// The client's gameflow session (`None`: unreadable), for the queue.
    Game {
        session: u64,
        game: Option<Value>,
    },
    Data {
        session: u64,
        /// Which data load of the session this answers: only the latest one counts.
        ticket: u64,
        data: Option<(SessionData, Arc<ChampionsFile>)>,
    },
    Matchups {
        session: u64,
        load: u64,
        file: Option<Arc<MatchupsFile>>,
    },
}

/// What an enrichment was computed from.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Key {
    version: u64,
    my_role: Option<domain::Role>,
    allies: Vec<(Option<u32>, bool, Option<domain::Role>, bool)>,
    enemies: Vec<Option<u32>>,
    bans: Vec<u32>,
    bench: Option<Vec<u32>>,
}

impl Key {
    fn of(view: &DraftView, version: u64) -> Self {
        Self {
            version,
            my_role: view.my_role,
            allies: view
                .allies
                .iter()
                .map(|s| (s.champion_id, s.hovering, s.role, s.is_me))
                .collect(),
            enemies: view.enemies.iter().map(|s| s.champion_id).collect(),
            bans: view
                .ally_bans
                .iter()
                .chain(&view.enemy_bans)
                .copied()
                .collect(),
            bench: view.bench.clone(),
        }
    }
}

struct Engine {
    out: watch::Sender<Option<DraftView>>,
    lcu: watch::Receiver<Option<LcuClient>>,
    stats: Option<StatsClient>,
    /// The server's `draftHelper` flag: off, the draft shows the teams without numbers.
    enabled: bool,
    /// The player's stats bracket (Settings).
    bracket: Bracket,
    tx: mpsc::UnboundedSender<Loaded>,
    fetches: Arc<Semaphore>,
    /// Counts champion selects: loads of an earlier one are ignored.
    session: u64,
    /// The stats queue of this champion select, once known (`None`: no stats for the mode).
    queue: Option<u32>,
    /// Counts data set loads asked for: only the latest one's answer is taken.
    ticket: u64,
    /// Counts data set loads within the session: matchups of an older one are ignored.
    load: u64,
    /// The latest view mapped from the client.
    view: Option<DraftView>,
    pool: Option<Arc<Pool>>,
    data: Option<Arc<SessionData>>,
    model: Option<Arc<DraftStats>>,
    /// Matchups files asked for in this data set.
    requested: HashSet<u32>,
    /// Bumped whenever pool, data or model change.
    version: u64,
    last: Option<(Key, Enrichment)>,
}

impl Engine {
    fn new(
        out: watch::Sender<Option<DraftView>>,
        lcu: watch::Receiver<Option<LcuClient>>,
        stats: Option<StatsClient>,
        tx: mpsc::UnboundedSender<Loaded>,
    ) -> Self {
        Self {
            out,
            lcu,
            stats,
            enabled: true,
            bracket: FALLBACK_BRACKET,
            tx,
            fetches: Arc::new(Semaphore::new(PARALLEL_FETCHES)),
            session: 0,
            queue: None,
            ticket: 0,
            load: 0,
            view: None,
            pool: None,
            data: None,
            model: None,
            requested: HashSet::new(),
            version: 0,
            last: None,
        }
    }

    async fn on_view(&mut self, view: Option<DraftView>) {
        let Some(view) = view else {
            if self.view.take().is_some() {
                // Loads still on their way belong to the champion select that just ended.
                self.session += 1;
                self.queue = None;
                self.pool = None;
                self.data = None;
                self.model = None;
                self.requested.clear();
                self.last = None;
            }
            self.out.send_if_modified(|d| d.take().is_some());
            return;
        };
        let started = self.view.is_none();
        self.view = Some(view);
        if started {
            self.start();
        }
        self.request_matchups();
        self.publish().await;
    }

    /// A champion select starts: read the player's pool and the game's queue, then the stats.
    fn start(&mut self) {
        self.session += 1;
        let session = self.session;
        let lcu = self.lcu.borrow().clone();
        let Some(lcu) = lcu else {
            // No client to ask (tests): the view says enough.
            self.on_game(None);
            return;
        };
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let (pool, game) = tokio::join!(load_pool(&lcu), lcu.get::<Value>(GAMEFLOW_SESSION));
            let _ = tx.send(Loaded::Game {
                session,
                game: game.ok(),
            });
            let _ = tx.send(Loaded::Pool { session, pool });
        });
    }

    /// The game's queue is known: its stats load.
    fn on_game(&mut self, game: Option<&Value>) {
        let Some(view) = &self.view else { return };
        self.queue = queue_of(game, view);
        self.load_data();
    }

    fn load_data(&mut self) {
        let (Some(stats), Some(queue)) = (self.stats.clone(), self.queue) else {
            return;
        };
        self.ticket += 1;
        let (tx, session, ticket, bracket) =
            (self.tx.clone(), self.session, self.ticket, self.bracket);
        tokio::spawn(async move {
            let data = session_data(&stats, queue, bracket).await;
            let _ = tx.send(Loaded::Data {
                session,
                ticket,
                data,
            });
        });
    }

    /// A newer stats index arrived: a running champion select switches to it.
    fn on_new_index(&mut self) {
        if self.view.is_some() {
            self.load_data();
        }
    }

    /// The player picked another stats bracket: a running champion select switches to it.
    fn on_bracket(&mut self, bracket: Bracket) {
        if bracket == self.bracket {
            return;
        }
        self.bracket = bracket;
        if self.view.is_some() {
            self.load_data();
        }
    }

    /// Whether the view needs evaluating again.
    fn on_loaded(&mut self, loaded: Loaded) -> bool {
        match loaded {
            Loaded::Pool { session, pool } if session == self.session => {
                self.pool = Some(Arc::new(pool));
                self.version += 1;
                self.request_matchups();
                true
            }
            Loaded::Game { session, game } if session == self.session => {
                self.on_game(game.as_ref());
                // The queue shows at once (the stats follow).
                true
            }
            Loaded::Data {
                session,
                ticket,
                data: Some((data, champions)),
            } if session == self.session && ticket == self.ticket => {
                if self.data.as_ref().is_some_and(|d| d.set == data.set) {
                    return false;
                }
                self.load += 1;
                self.model = Some(Arc::new(DraftStats::new(&champions)));
                self.data = Some(Arc::new(data));
                self.requested.clear();
                self.version += 1;
                self.request_matchups();
                true
            }
            Loaded::Matchups {
                session,
                load,
                file: Some(file),
            } if session == self.session && load == self.load => {
                let Some(model) = self.model.as_mut() else {
                    return false;
                };
                Arc::make_mut(model).add_matchups(&file);
                self.version += 1;
                true
            }
            _ => false,
        }
    }

    /// Loads the matchups of the champions in the draft (and of the candidates once an enemy
    /// is locked), each once.
    fn request_matchups(&mut self) {
        let (Some(stats), Some(data), Some(model), Some(view)) =
            (&self.stats, &self.data, &self.model, &self.view)
        else {
            return;
        };
        let mut wanted: Vec<u32> = view
            .allies
            .iter()
            .chain(&view.enemies)
            .filter_map(|s| s.champion_id)
            .collect();
        if view.enemies.iter().any(|s| s.champion_id.is_some())
            && let Some(my_role) = view.my_role
        {
            wanted.extend(candidates(
                view,
                my_role,
                model,
                data.tiers.as_deref(),
                self.pool.as_deref(),
            ));
        }
        wanted.retain(|&c| model.knows(c) && !model.has_matchups(c));
        let (stats, set) = (stats.clone(), data.set.clone());
        for champion in wanted {
            if !self.requested.insert(champion) {
                continue;
            }
            let (stats, set, tx) = (stats.clone(), set.clone(), self.tx.clone());
            let (fetches, session, load) = (Arc::clone(&self.fetches), self.session, self.load);
            tokio::spawn(async move {
                let _permit = fetches.acquire_owned().await.ok();
                let file = stats
                    .matchups(&set, champion)
                    .await
                    .unwrap_or_else(|error| {
                        tracing::debug!(%error, champion, "draft: matchups unavailable");
                        None
                    });
                let _ = tx.send(Loaded::Matchups {
                    session,
                    load,
                    file,
                });
            });
        }
    }

    async fn compute(&self, view: &DraftView) -> Enrichment {
        let (Some(model), Some(data)) = (self.model.clone(), self.data.clone()) else {
            return Enrichment::default();
        };
        let pool = self.pool.clone();
        let view = view.clone();
        tokio::task::spawn_blocking(move || enrich(&view, &model, &data, pool.as_deref()))
            .await
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "draft suggestions failed");
                Enrichment::default()
            })
    }

    /// Publishes the latest view with its numbers, evaluating it again only when something
    /// the model reads changed.
    async fn publish(&mut self) {
        let Some(mut view) = self.view.clone() else {
            return;
        };
        let key = Key::of(&view, self.version);
        let enrichment = match &self.last {
            _ if !self.enabled => Enrichment::default(),
            Some((last, enrichment)) if *last == key => enrichment.clone(),
            _ => {
                let enrichment = self.compute(&view).await;
                self.last = Some((key, enrichment.clone()));
                enrichment
            }
        };
        enrichment.apply(&mut view);
        view.queue = self.queue;
        self.out.send_if_modified(|current| {
            if current.as_ref() == Some(&view) {
                return false;
            }
            *current = Some(view);
            true
        });
    }
}

/// Waits for the `draftHelper` flag to change (never, once the config's sender is gone).
async fn flag_changed(remote: &mut watch::Receiver<RemoteConfig>) -> bool {
    if remote.changed().await.is_err() {
        return std::future::pending().await;
    }
    remote.borrow_and_update().features.draft_helper
}

/// Waits for the stats bracket of the settings to change (never, once they're gone).
async fn bracket_changed(settings: &mut watch::Receiver<Settings>) -> Bracket {
    if settings.changed().await.is_err() {
        return std::future::pending().await;
    }
    settings.borrow_and_update().stats_bracket
}

/// Waits for a different index (never, without stats).
async fn index_changed(rx: &mut Option<watch::Receiver<Option<Arc<StatsIndex>>>>) -> Option<()> {
    let Some(receiver) = rx.as_mut() else {
        return std::future::pending().await;
    };
    if receiver.changed().await.is_ok() {
        return Some(());
    }
    *rx = None;
    None
}

/// The running draft helper's ends.
pub(crate) struct Helper {
    /// Where the core sends the champion-select views it maps (teams only; `None` when it ends).
    pub sessions: watch::Sender<Option<DraftView>>,
    /// The same views with the model's numbers, for the UI.
    pub views: watch::Receiver<Option<DraftView>>,
    pub task: JoinHandle<()>,
}

/// Runs the draft helper: takes the views mapped from the client, adds the model's numbers and
/// publishes them, until the core stops sending. The player's `settings` choose the stats
/// bracket.
pub(crate) fn spawn(
    lcu: watch::Receiver<Option<LcuClient>>,
    stats: Option<StatsClient>,
    mut remote: watch::Receiver<RemoteConfig>,
    mut settings: watch::Receiver<Settings>,
) -> Helper {
    let (sessions, mut raw) = watch::channel(None);
    let (out, views) = watch::channel(None);
    let task = tokio::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut index = stats.as_ref().map(StatsClient::subscribe);
        let mut engine = Engine::new(out, lcu, stats, tx);
        engine.enabled = remote.borrow_and_update().features.draft_helper;
        engine.bracket = settings.borrow_and_update().stats_bracket;
        let mut due: Option<Instant> = None;
        loop {
            tokio::select! {
                changed = raw.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    let view = raw.borrow_and_update().clone();
                    engine.on_view(view).await;
                }
                Some(loaded) = rx.recv() => {
                    if engine.on_loaded(loaded) {
                        due.get_or_insert_with(|| Instant::now() + SETTLE);
                    }
                }
                () = tokio::time::sleep_until(due.unwrap_or_else(Instant::now)), if due.is_some() => {
                    due = None;
                    engine.publish().await;
                }
                Some(()) = index_changed(&mut index) => engine.on_new_index(),
                enabled = flag_changed(&mut remote) => {
                    if enabled != engine.enabled {
                        engine.enabled = enabled;
                        engine.publish().await;
                    }
                }
                bracket = bracket_changed(&mut settings) => engine.on_bracket(bracket),
            }
        }
    });
    Helper {
        sessions,
        views,
        task,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::champ_select;
    use domain::{
        ChampionRoleStats, ChampionStats, CompReading, CompositionStats, CompositionsFile,
        DataSetInfo, MatchupEntry, RoleMatchups, TierEntry, TierGrade,
    };
    use serde_json::json;

    const MALPHITE: u32 = 54;
    const ORNN: u32 = 516;
    const SHEN: u32 = 98;
    const GAREN: u32 = 86;
    const CAMILLE: u32 = 164;
    const JAX: u32 = 24;
    const IRELIA: u32 = 39;
    const LEE_SIN: u32 = 64;
    const AHRI: u32 = 103;
    const THRESH: u32 = 412;
    const YUUMI: u32 = 350;
    const VIEGO: u32 = 234;

    fn info() -> DataSetInfo {
        DataSetInfo {
            schema: 1,
            patch: "16.19".into(),
            queue: RANKED,
            bracket: Bracket::EmeraldPlus,
            games: 200_000,
            updated_at: 1_790_000_000_000,
        }
    }

    /// `(champion, [(role, games, win rate)])` rows of a champions file.
    type Rows<'a> = &'a [(u32, &'a [(domain::Role, u32, f64)])];

    fn champions(rows: Rows<'_>) -> ChampionsFile {
        let champions = rows
            .iter()
            .map(|(id, roles)| {
                let roles: Vec<ChampionRoleStats> = roles
                    .iter()
                    .map(|&(role, g, wr)| ChampionRoleStats {
                        role: Some(role),
                        g,
                        w: count(f64::from(g) * wr),
                        prev: None,
                    })
                    .collect();
                ChampionStats {
                    id: *id,
                    g: roles.iter().map(|r| r.g).sum(),
                    w: roles.iter().map(|r| r.w).sum(),
                    bans: 0,
                    roles,
                }
            })
            .collect();
        ChampionsFile {
            info: info(),
            champions,
            priors: vec![domain::PairPrior {
                kind: domain::PairKind::Lane,
                roles: vec![domain::Role::Top, domain::Role::Top],
                tau: 0.0209,
                k: 572.3,
                pairs: 900,
            }],
        }
    }

    fn world() -> ChampionsFile {
        use domain::Role::{Jungle, Middle, Support, Top};
        champions(&[
            (MALPHITE, &[(Top, 30_000, 0.51)]),
            (ORNN, &[(Top, 20_000, 0.505)]),
            (SHEN, &[(Top, 20_000, 0.50), (Support, 4_000, 0.50)]),
            (GAREN, &[(Top, 25_000, 0.503)]),
            (CAMILLE, &[(Top, 25_000, 0.52)]),
            (JAX, &[(Top, 20_000, 0.50), (Jungle, 15_000, 0.50)]),
            (IRELIA, &[(Top, 27_000, 0.49), (Middle, 3_000, 0.48)]),
            (LEE_SIN, &[(Jungle, 40_000, 0.49)]),
            (AHRI, &[(Middle, 35_000, 0.51)]),
            (THRESH, &[(Support, 30_000, 0.50)]),
            (YUUMI, &[(Support, 15_000, 0.48)]),
            (VIEGO, &[(Jungle, 30_000, 0.50)]),
        ])
    }

    fn tiers() -> TierList {
        let entry = |id, role, score| TierEntry {
            id,
            role: Some(role),
            tier: TierGrade::A,
            score,
            g: 1_000,
            w: 500,
            win_rate: 0.5,
            pick_rate: 0.1,
            ban_rate: 0.0,
            share: Some(1.0),
        };
        TierList {
            info: info(),
            entries: vec![
                entry(CAMILLE, domain::Role::Top, 2.0),
                entry(AHRI, domain::Role::Middle, 1.0),
                entry(MALPHITE, domain::Role::Top, 0.9),
                entry(GAREN, domain::Role::Top, 0.3),
                entry(ORNN, domain::Role::Top, 0.2),
                entry(JAX, domain::Role::Top, 0.0),
                entry(SHEN, domain::Role::Top, -0.1),
            ],
        }
    }

    fn session_data() -> SessionData {
        SessionData {
            set: DataSet {
                patch: "16.19".into(),
                name: "26.19".into(),
                queue: RANKED,
                bracket: Bracket::EmeraldPlus,
                games: 200_000,
                generation: 1_790_000_000_000,
                previous: None,
            },
            info: DataInfo {
                queue: RANKED,
                bracket: "Emerald+".into(),
                patch: "26.19".into(),
                games: 200_000,
                updated_at: 1_790_000_000_000,
            },
            tiers: Some(Arc::new(tiers())),
            comps: None,
        }
    }

    /// You're top (hovering `hover`), Lee Sin and Ahri are locked, Thresh hovered; the enemy
    /// locked `enemies`.
    fn view(hover: u32, locked: bool, enemies: &[u32]) -> DraftView {
        let (champion, intent) = if locked { (hover, 0) } else { (0, hover) };
        let their: Vec<Value> = (0..5)
            .map(|i| json!({ "cellId": 5 + i, "championId": enemies.get(i).copied().unwrap_or(0) }))
            .collect();
        champ_select::map_session(&json!({
            "localPlayerCellId": 0,
            "myTeam": [
                { "cellId": 0, "assignedPosition": "top", "championId": champion, "championPickIntent": intent },
                { "cellId": 1, "assignedPosition": "jungle", "championId": LEE_SIN },
                { "cellId": 2, "assignedPosition": "middle", "championId": AHRI },
                { "cellId": 3, "assignedPosition": "bottom", "championId": 0 },
                { "cellId": 4, "assignedPosition": "utility", "championId": 0, "championPickIntent": THRESH }
            ],
            "theirTeam": their,
            "actions": [],
            "bans": { "myTeamBans": [GAREN], "theirTeamBans": [] },
            "timer": { "phase": "BAN_PICK" }
        }))
        .unwrap()
    }

    fn pool() -> Pool {
        let game = |champion, role, win| PoolGame {
            champion,
            role,
            win,
        };
        Pool {
            mastery: [
                (YUUMI, 900_000),
                (ORNN, 250_000),
                (JAX, 120_000),
                (MALPHITE, 80_000),
            ]
            .into_iter()
            .map(|(c, points)| (c, Mastery { level: 7, points }))
            .collect(),
            games: vec![
                game(SHEN, domain::Role::Top, true),
                game(SHEN, domain::Role::Top, false),
                game(SHEN, domain::Role::Top, true),
                game(AHRI, domain::Role::Middle, true),
            ],
            // Camille isn't owned.
            pickable: Some(
                [
                    MALPHITE, ORNN, SHEN, GAREN, JAX, IRELIA, YUUMI, THRESH, AHRI,
                ]
                .into_iter()
                .collect(),
            ),
        }
    }

    #[test]
    fn reads_the_players_pool() {
        let mastery = map_mastery(&json!([
            { "championId": 54, "championLevel": 7, "championPoints": 123_456, "puuid": "me" },
            { "championId": 0, "championLevel": 1, "championPoints": 10 },
            { "championLevel": 3 },
            { "championId": 412, "championLevel": 12, "championPoints": 4_000_000 }
        ]));
        assert_eq!(mastery.len(), 2);
        assert_eq!(
            mastery.get(&54),
            Some(&Mastery {
                level: 7,
                points: 123_456
            })
        );
        assert_eq!(map_pickable(&json!([54, 0, 412])), Some([54, 412].into()));
        assert_eq!(map_pickable(&json!([])), None, "empty means unknown");
        assert_eq!(map_pickable(&json!({ "error": 1 })), None);
        let games = pool_games(&json!({ "games": { "games": [
            { "gameId": 1, "queueId": 420, "gameCreation": 1, "championId": 0,
              "participants": [{ "championId": 54, "stats": { "win": true }, "timeline": { "lane": "TOP" } }] },
            { "gameId": 2, "queueId": 450, "gameCreation": 2,
              "participants": [{ "championId": 22, "stats": { "win": true }, "timeline": { "lane": "MIDDLE" } }] },
            { "gameId": 3, "queueId": 440, "gameCreation": 3,
              "participants": [{ "championId": 412, "stats": { "win": false }, "timeline": { "lane": "BOTTOM", "role": "SUPPORT" } }] }
        ] } }));
        assert_eq!(
            games,
            vec![
                PoolGame {
                    champion: 54,
                    role: domain::Role::Top,
                    win: true
                },
                PoolGame {
                    champion: 412,
                    role: domain::Role::Support,
                    win: false
                }
            ],
            "ARAM left out"
        );
        let pool = Pool {
            games,
            ..Pool::default()
        };
        assert_eq!(
            pool.record(54, domain::Role::Top),
            Some(PersonalRecord { games: 1, wins: 1 })
        );
        assert_eq!(pool.record(54, domain::Role::Middle), None);
        assert!(pool.can_pick(1), "no list: no restriction");
    }

    #[test]
    fn candidates_start_from_the_pool() {
        let model = DraftStats::new(&world());
        let tiers = tiers();
        let pool = pool();
        let picks = candidates(
            &view(MALPHITE, false, &[IRELIA]),
            domain::Role::Top,
            &model,
            Some(&tiers),
            Some(&pool),
        );
        // Your hover, your games in the role, your mastery on top laners (Yuumi isn't one),
        // then the best top laners you own; Garen is banned, Irelia taken, Camille not owned.
        assert_eq!(picks, vec![MALPHITE, SHEN, ORNN, JAX]);
        // Without a pool (client not read yet): the role's best picks.
        let picks = candidates(
            &view(0, false, &[]),
            domain::Role::Top,
            &model,
            Some(&tiers),
            None,
        );
        assert_eq!(picks, vec![CAMILLE, MALPHITE, ORNN, JAX, SHEN]);
        // Without a tier list: the most played in the role.
        let picks = candidates(&view(0, false, &[]), domain::Role::Top, &model, None, None);
        assert_eq!(picks.first(), Some(&MALPHITE));
        assert!(!picks.contains(&GAREN) && picks.contains(&IRELIA));
    }

    fn lane_file(id: u32, opponent: u32, games: u32, wins: u32) -> MatchupsFile {
        MatchupsFile {
            info: info(),
            id,
            roles: vec![RoleMatchups {
                role: domain::Role::Top,
                g: 20_000,
                w: 10_000,
                lane: vec![MatchupEntry {
                    id: opponent,
                    role: domain::Role::Top,
                    g: games,
                    w: wins,
                    d: 0.0,
                }],
                jungle: vec![],
                duos: vec![],
            }],
        }
    }

    #[test]
    fn fills_team_picks_and_enemy_roles() {
        let mut model = DraftStats::new(&world());
        // Malphite crushes Irelia; Ornn loses to her.
        model.add_matchups(&lane_file(MALPHITE, IRELIA, 3_000, 1_700));
        model.add_matchups(&lane_file(ORNN, IRELIA, 2_000, 900));
        let pool = pool();
        let data = session_data();
        let view = view(MALPHITE, false, &[IRELIA, VIEGO]);
        let e = enrich(&view, &model, &data, Some(&pool));
        assert_eq!(e.data.as_ref().map(|d| d.patch.as_str()), Some("26.19"));
        // Irelia plays top 90 % of the time, mid otherwise; Viego only jungles.
        let (irelia_role, irelia_odds) = &e.enemies[0];
        assert_eq!(*irelia_role, Some(domain::Role::Top));
        assert_eq!(irelia_odds.len(), 2);
        assert!(
            (irelia_odds[0].probability - 0.9).abs() < 0.01,
            "{irelia_odds:?}"
        );
        assert_eq!(e.enemies[1].0, Some(domain::Role::Jungle));
        assert_eq!(e.enemies[2], (None, vec![]), "nobody picked yet");

        let team = e.team.unwrap();
        let first = &e.suggestions[0];
        assert_eq!(first.champion_id, MALPHITE, "{:?}", e.suggestions);
        assert!(first.gain > 3.0, "the lane edge counts: {}", first.gain);
        assert!(
            (first.estimate.percent - team.percent - first.gain).abs() < 0.02,
            "gain is measured against the team without you"
        );
        let lane = first
            .reasons
            .iter()
            .find(|r| r.kind == ReasonKind::Lane)
            .unwrap();
        assert_eq!(lane.champion_id, Some(IRELIA));
        assert_eq!(lane.games, 3_000);
        assert!(lane.probability > 0.85 && lane.probability < 0.95);
        assert!(lane.kept > 0.8);
        assert!(first.reasons.iter().any(|r| r.kind == ReasonKind::Base));
        assert_eq!(
            first.mastery,
            Some(Mastery {
                level: 7,
                points: 80_000
            })
        );
        let shen = e
            .suggestions
            .iter()
            .find(|s| s.champion_id == SHEN)
            .unwrap();
        assert_eq!(shen.mine, Some(PersonalRecord { games: 3, wins: 2 }));
        assert_eq!(shen.mastery, None);
        let ornn = e
            .suggestions
            .iter()
            .find(|s| s.champion_id == ORNN)
            .unwrap();
        assert!(ornn.gain < first.gain && ornn.tier > first.tier);
        // Ranked best first, tiers never go down.
        assert!(
            e.suggestions
                .windows(2)
                .all(|w| w[0].estimate.percent >= w[1].estimate.percent && w[0].tier <= w[1].tier)
        );
        for s in &e.suggestions {
            assert!(![GAREN, IRELIA, CAMILLE, YUUMI].contains(&s.champion_id));
        }
    }

    #[test]
    fn a_locked_pick_joins_the_team() {
        let model = DraftStats::new(&world());
        let data = session_data();
        let hovering = enrich(&view(MALPHITE, false, &[]), &model, &data, None);
        let locked = enrich(&view(MALPHITE, true, &[]), &model, &data, None);
        let malphite = |e: &Enrichment| {
            e.suggestions
                .iter()
                .find(|s| s.champion_id == MALPHITE)
                .cloned()
                .unwrap()
        };
        assert!(malphite(&hovering).gain > 0.5);
        assert!(
            malphite(&locked).gain.abs() < 0.01,
            "your pick is the team now"
        );
        assert!(locked.team.unwrap().percent > hovering.team.unwrap().percent);
    }

    /// `(champion, role, damage per minute, frontline share, crowd control)` rows of a
    /// compositions file, each over 4,000 games with an even record.
    type CompRows<'a> = &'a [(u32, Option<domain::Role>, [f64; 3], f64, f64)];

    fn comps_file(queue: u32, lengths: Vec<u32>, rows: CompRows<'_>) -> CompositionsFile {
        let stats = |id, role, dmg, front, cc, len: Vec<(u32, u32)>| CompositionStats {
            id,
            role,
            n: 4_000,
            dmg,
            front,
            cc,
            len,
        };
        let mut roles: Vec<Option<domain::Role>> = Vec::new();
        for row in rows {
            if !roles.contains(&row.1) {
                roles.push(row.1);
            }
        }
        CompositionsFile {
            info: DataSetInfo { queue, ..info() },
            lengths,
            // Usual picks: a fifth of the team each, 20 s of crowd control.
            roles: roles
                .into_iter()
                .map(|role| stats(0, role, [300.0, 300.0, 30.0], 0.2, 20.0, vec![]))
                .collect(),
            champions: rows
                .iter()
                .map(|&(id, role, dmg, front, cc)| {
                    let even = vec![(1_000, 500), (2_000, 1_000), (1_000, 500)];
                    stats(id, role, dmg, front, cc, even)
                })
                .collect(),
        }
    }

    fn ranked_comps() -> Arc<CompStats> {
        use domain::Role::{Jungle, Middle, Support, Top};
        Arc::new(CompStats::new(&comps_file(
            RANKED,
            vec![25, 35],
            &[
                (MALPHITE, Some(Top), [100.0, 500.0, 20.0], 0.34, 40.0),
                (SHEN, Some(Top), [300.0, 200.0, 100.0], 0.33, 30.0),
                (ORNN, Some(Top), [200.0, 300.0, 50.0], 0.36, 45.0),
                (LEE_SIN, Some(Jungle), [500.0, 50.0, 60.0], 0.22, 15.0),
                (AHRI, Some(Middle), [50.0, 700.0, 40.0], 0.15, 18.0),
                (THRESH, Some(Support), [100.0, 250.0, 30.0], 0.25, 35.0),
                (IRELIA, Some(Top), [700.0, 20.0, 60.0], 0.28, 12.0),
                (IRELIA, Some(Middle), [650.0, 20.0, 60.0], 0.22, 12.0),
                (VIEGO, Some(Jungle), [600.0, 30.0, 70.0], 0.2, 8.0),
            ],
        )))
    }

    #[test]
    fn composes_both_teams_hovers_as_such() {
        let model = DraftStats::new(&world());
        let data = SessionData {
            comps: Some(ranked_comps()),
            ..session_data()
        };
        let e = enrich(
            &view(MALPHITE, false, &[IRELIA, VIEGO]),
            &model,
            &data,
            None,
        );
        let comps = e.comps.unwrap();
        assert_eq!(comps.lengths, [25, 35]);
        // You hover Malphite, Lee Sin and Ahri are locked, Thresh is hovered.
        let allies: Vec<(u32, bool)> = comps
            .allies
            .members
            .iter()
            .map(|m| (m.champion_id, m.hovering))
            .collect();
        assert_eq!(
            allies,
            [
                (MALPHITE, true),
                (LEE_SIN, false),
                (AHRI, false),
                (THRESH, true)
            ]
        );
        assert_eq!(comps.allies.counted, 4);
        assert_eq!(comps.allies.games, 4_000);
        // Enemies over their likely roles: Irelia mostly top (0.28), a bit mid (0.22).
        assert_eq!(comps.enemies.counted, 2);
        let irelia = &comps.enemies.members[0];
        assert!(
            irelia.frontline > 0.27 && irelia.frontline < 0.28,
            "{irelia:?}"
        );
        assert!(irelia.damage.physical > 0.85);
        assert!(comps.enemies.readings.is_empty(), "two picks: too early");
        // Magic-heavy allies: Malphite, Ahri, Thresh.
        assert!(comps.allies.damage.magic > comps.allies.damage.physical);

        // Each pick's team: your hover makes way for it.
        let with = |c: u32| {
            e.suggestions
                .iter()
                .find(|s| s.champion_id == c)
                .and_then(|s| s.comp.clone())
                .unwrap()
        };
        let malphite = with(MALPHITE);
        assert!(malphite.members.is_empty(), "numbers only");
        assert_eq!(malphite.counted, 4);
        assert!((malphite.frontline - comps.allies.frontline).abs() < 1e-9);
        assert!(with(SHEN).damage.physical > malphite.damage.physical);

        // Without composition stats: no compositions, the rest as before.
        let bare = enrich(
            &view(MALPHITE, false, &[IRELIA]),
            &model,
            &session_data(),
            None,
        );
        assert!(bare.comps.is_none() && bare.suggestions.iter().all(|s| s.comp.is_none()));
        assert!(!bare.suggestions.is_empty());
    }

    const LUX: u32 = 99;
    const JINX: u32 = 222;
    const SONA: u32 = 37;
    const ZIGGS: u32 = 115;
    const BRAND: u32 = 63;
    const SION: u32 = 14;

    fn aram_data() -> (DraftStats, SessionData) {
        let row = |id, g: u32, wr: f64| ChampionStats {
            id,
            g,
            w: count(f64::from(g) * wr),
            bans: 0,
            roles: vec![ChampionRoleStats {
                role: None,
                g,
                w: count(f64::from(g) * wr),
                prev: None,
            }],
        };
        let champions = ChampionsFile {
            info: DataSetInfo {
                queue: ARAM,
                ..info()
            },
            champions: vec![
                row(LUX, 20_000, 0.52),
                row(JINX, 20_000, 0.50),
                row(MALPHITE, 20_000, 0.55),
                row(SONA, 20_000, 0.53),
                row(ZIGGS, 20_000, 0.51),
                row(BRAND, 20_000, 0.54),
                row(SION, 20_000, 0.49),
            ],
            priors: vec![],
        };
        let comps = comps_file(
            ARAM,
            vec![17, 22],
            &[
                (LUX, None, [50.0, 900.0, 10.0], 0.12, 30.0),
                (JINX, None, [700.0, 20.0, 30.0], 0.14, 10.0),
                (MALPHITE, None, [100.0, 500.0, 10.0], 0.32, 40.0),
                (SONA, None, [50.0, 400.0, 10.0], 0.13, 20.0),
                (ZIGGS, None, [30.0, 950.0, 10.0], 0.12, 5.0),
                (BRAND, None, [40.0, 1_000.0, 50.0], 0.13, 15.0),
                (SION, None, [500.0, 100.0, 20.0], 0.4, 35.0),
            ],
        );
        let data = SessionData {
            set: DataSet {
                queue: ARAM,
                ..session_data().set
            },
            info: DataInfo {
                queue: ARAM,
                ..session_data().info
            },
            tiers: None,
            comps: Some(Arc::new(CompStats::new(&comps))),
        };
        (DraftStats::new(&champions), data)
    }

    fn aram_view(bench: &[u32]) -> DraftView {
        champ_select::map_session(&json!({
            "localPlayerCellId": 0,
            "myTeam": [
                { "cellId": 0, "championId": LUX },
                { "cellId": 1, "championId": JINX },
                { "cellId": 2, "championId": MALPHITE },
                { "cellId": 3, "championId": SONA },
                { "cellId": 4, "championId": ZIGGS }
            ],
            "theirTeam": [],
            "benchEnabled": true,
            "benchChampions": bench.iter().map(|c| json!({ "championId": c })).collect::<Vec<_>>(),
            "allowRerolling": true,
            "rerollsRemaining": 1,
            "timer": { "phase": "FINALIZATION", "adjustedTimeLeftInPhase": 50_000 }
        }))
        .unwrap()
    }

    #[test]
    fn aram_ranks_your_champion_and_the_bench() {
        let (model, data) = aram_data();
        let pool = Pool {
            mastery: [(
                BRAND,
                Mastery {
                    level: 6,
                    points: 60_000,
                },
            )]
            .into(),
            ..Pool::default()
        };
        let e = enrich(&aram_view(&[SION, BRAND]), &model, &data, Some(&pool));
        assert_eq!(e.data.as_ref().map(|d| d.queue), Some(ARAM));
        let order: Vec<u32> = e.suggestions.iter().map(|s| s.champion_id).collect();
        assert_eq!(order, [BRAND, LUX, SION], "by the team's chance with each");
        let brand = &e.suggestions[0];
        let lux = &e.suggestions[1];
        assert!(lux.gain.abs() < 1e-9, "yours: the team as it is");
        assert!((lux.estimate.percent - e.team.unwrap().percent).abs() < 1e-9);
        assert!(brand.gain > 0.5 && e.suggestions[2].gain < -0.5);
        assert_eq!(brand.mastery.map(|m| m.level), Some(6));
        // Why: its own ARAM strength, over its games.
        let why = &brand.reasons[0];
        assert_eq!((why.kind, why.games), (ReasonKind::Base, 20_000));
        assert!(why.points > 3.0 && why.points < 4.0, "{why:?}");
        assert!(e.suggestions.windows(2).all(|w| w[0].tier <= w[1].tier));
        // Compositions: yours now, and the team with each.
        let comps = e.comps.unwrap();
        assert_eq!(comps.lengths, [17, 22]);
        assert_eq!(comps.allies.counted, 5);
        assert_eq!(comps.enemies.counted, 0, "the enemy team is hidden in ARAM");
        assert!(comps.allies.readings.contains(&CompReading::MostlyMagic));
        let sion = e.suggestions[2].comp.as_ref().unwrap();
        assert!(sion.frontline > comps.allies.frontline);
        assert!(sion.damage.physical > comps.allies.damage.physical);
        assert!(e.enemies.is_empty());
    }

    #[test]
    fn aram_without_a_champion_yet_shows_the_team_only() {
        let (model, data) = aram_data();
        let mut view = aram_view(&[BRAND]);
        view.allies[0].champion_id = None;
        let e = enrich(&view, &model, &data, None);
        assert!(e.suggestions.is_empty());
        assert!(e.team.is_some() && e.comps.is_some());
    }

    #[test]
    fn the_queue_comes_from_the_game_else_the_bench() {
        let ranked = view(MALPHITE, false, &[]);
        let aram = aram_view(&[]);
        let game =
            |id: u64, map: u64| json!({ "gameData": { "queue": { "id": id, "mapId": map } } });
        assert_eq!(queue_of(Some(&game(450, 12)), &ranked), Some(ARAM));
        assert_eq!(queue_of(Some(&game(420, 11)), &aram), Some(RANKED));
        assert_eq!(queue_of(Some(&game(1_700, 30)), &ranked), None, "Arena");
        assert_eq!(queue_of(None, &ranked), Some(RANKED));
        assert_eq!(queue_of(None, &aram), Some(ARAM));
    }

    #[test]
    fn ties_share_a_tier() {
        let scores = [
            (1.0, 0.1),
            (0.95, 0.1),
            (0.5, 0.1),
            (0.45, 0.2),
            (0.1, 0.05),
        ];
        assert_eq!(tie_tiers(scores), [0, 0, 1, 1, 2]);
    }

    #[test]
    fn roles_unknown_means_no_suggestions() {
        let model = DraftStats::new(&world());
        let data = session_data();
        let mut blind = view(MALPHITE, false, &[IRELIA]);
        blind.my_role = None;
        let e = enrich(&blind, &model, &data, None);
        assert!(e.suggestions.is_empty() && e.team.is_none());
        assert!(e.data.is_some(), "the data is there, the role isn't");
        assert_eq!(e.enemies[0].0, Some(domain::Role::Top));
        let mut view = view(0, false, &[]);
        e.apply(&mut view);
        assert_eq!(view.enemies[0].role, Some(domain::Role::Top));
    }

    #[tokio::test]
    async fn loads_of_an_ended_champion_select_are_dropped() {
        let (out, published) = watch::channel(None);
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut engine = Engine::new(out, watch::channel(None).1, None, tx);
        engine.on_view(Some(view(MALPHITE, false, &[]))).await;
        let started = engine.session;
        assert!(published.borrow().is_some(), "teams show at once");
        engine.on_view(None).await;
        assert!(published.borrow().is_none());
        let late = Loaded::Pool {
            session: started,
            pool: pool(),
        };
        assert!(!engine.on_loaded(late));
        assert!(engine.pool.is_none());
        // The next champion select takes its own loads.
        engine.on_view(Some(view(MALPHITE, false, &[]))).await;
        let fresh = Loaded::Pool {
            session: engine.session,
            pool: pool(),
        };
        assert!(engine.on_loaded(fresh));
        assert!(engine.pool.is_some());
    }
}
