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
//! - **Data**: ranked solo/duo, Emerald+, current patch (`StatsClient`); the matchups files of
//!   the champions in the draft are loaded as they appear (and the candidates' once an enemy
//!   is locked: only a laner's own file has its games against the enemy jungler).
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
    Assignment, ChampRole, Evaluation, Pick, Role, TermKind, assignments, evaluate,
    role_probabilities, suggest,
};
use ::stats::sigmoid;
use domain::{
    Bracket, ChampionsFile, DataInfo, DraftView, Estimate, Mastery, MatchupsFile, PersonalRecord,
    Reason, ReasonKind, RoleOdds, StatsIndex, Suggestion, TierList,
};
use lcu::LcuClient;
use serde_json::Value;
use tokio::sync::{Semaphore, mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::profile;
use crate::stats::model::{domain_role, role};
use crate::stats::{DataSet, DraftStats, RANKED, StatsClient};

/// The local player's champion mastery (their own data).
pub const MASTERY: &str = "/lol-champion-mastery/v1/local-player/champion-mastery";
/// Champions the local player owns or may play in this champion select.
pub const PICKABLE: &str = "/lol-champ-select/v1/pickable-champion-ids";

/// The draft reads Emerald+ ranked solo/duo.
pub const DRAFT_BRACKET: Bracket = Bracket::EmeraldPlus;
/// Picks shown.
const SUGGESTIONS: usize = 15;
/// Pool champions among the candidates, at most.
const POOL_SIZE: usize = 10;
/// Meta picks among the candidates, at least.
const META_MIN: usize = 5;
/// A mastered champion joins the pool for a role it plays this often (share of its games)…
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

/// The stats a champion select reads: which data set, its badge, and its tier list.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionData {
    pub set: DataSet,
    pub info: DataInfo,
    pub tiers: Option<Arc<TierList>>,
}

/// Everything the model adds to a champion-select view.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Enrichment {
    pub team: Option<Estimate>,
    pub suggestions: Vec<Suggestion>,
    pub data: Option<DataInfo>,
    /// Per enemy seat: the likeliest role and the likely ones, most likely first.
    pub enemies: Vec<(Option<domain::Role>, Vec<RoleOdds>)>,
}

impl Enrichment {
    pub fn apply(&self, view: &mut DraftView) {
        view.team = self.team;
        view.suggestions.clone_from(&self.suggestions);
        view.data.clone_from(&self.data);
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
/// consistent assignment.
fn enemy_roles(
    view: &DraftView,
    picks: &[Pick],
    seatings: &[Assignment],
) -> Vec<(Option<domain::Role>, Vec<RoleOdds>)> {
    let mut per_pick = role_probabilities(picks, seatings).into_iter();
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

/// Team odds, ranked picks and enemy roles for one champion-select view.
pub fn enrich(
    view: &DraftView,
    model: &DraftStats,
    data: &SessionData,
    pool: Option<&Pool>,
) -> Enrichment {
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
    let mut out = Enrichment {
        data: Some(data.info.clone()),
        enemies: enemy_roles(view, &enemies, &seatings),
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
            }
        })
        .collect();
    out
}

/// The stats a champion select reads, or `None` when there are none (logged).
async fn session_data(stats: &StatsClient) -> Option<(SessionData, Arc<ChampionsFile>)> {
    let set = match stats.data_set(RANKED, DRAFT_BRACKET).await {
        Ok(set) => set,
        Err(error) => {
            tracing::info!(%error, "draft: no stats data set");
            return None;
        }
    };
    let (champions, tiers) = tokio::join!(stats.champions(&set), stats.tier_list(&set));
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
        bracket: set.bracket.label().to_owned(),
        patch: name,
        games: champions.info.games,
        updated_at: champions.info.updated_at,
    };
    Some((SessionData { set, info, tiers }, champions))
}

enum Loaded {
    Pool {
        session: u64,
        pool: Pool,
    },
    Data {
        session: u64,
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
        }
    }
}

struct Engine {
    out: watch::Sender<Option<DraftView>>,
    lcu: watch::Receiver<Option<LcuClient>>,
    stats: Option<StatsClient>,
    tx: mpsc::UnboundedSender<Loaded>,
    fetches: Arc<Semaphore>,
    /// Counts champion selects: loads of an earlier one are ignored.
    session: u64,
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
    async fn on_view(&mut self, view: Option<DraftView>) {
        let Some(view) = view else {
            if self.view.take().is_some() {
                // Loads still on their way belong to the champion select that just ended.
                self.session += 1;
                self.pool = None;
                self.data = None;
                self.model = None;
                self.requested.clear();
                self.last = None;
            }
            self.out.send_if_modified(|d| d.take().is_some());
            return;
        };
        if self.view.is_none() {
            self.start();
        }
        self.view = Some(view);
        self.request_matchups();
        self.publish().await;
    }

    /// A champion select starts: read the player's pool and the stats.
    fn start(&mut self) {
        self.session += 1;
        let session = self.session;
        let lcu = self.lcu.borrow().clone();
        if let Some(lcu) = lcu {
            let tx = self.tx.clone();
            tokio::spawn(async move {
                let pool = load_pool(&lcu).await;
                let _ = tx.send(Loaded::Pool { session, pool });
            });
        }
        self.load_data();
    }

    fn load_data(&self) {
        let Some(stats) = self.stats.clone() else {
            return;
        };
        let (tx, session) = (self.tx.clone(), self.session);
        tokio::spawn(async move {
            let data = session_data(&stats).await;
            let _ = tx.send(Loaded::Data { session, data });
        });
    }

    /// A newer stats index arrived: a running champion select switches to it.
    fn on_new_index(&self) {
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
            Loaded::Data {
                session,
                data: Some((data, champions)),
            } if session == self.session => {
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
            Some((last, enrichment)) if *last == key => enrichment.clone(),
            _ => {
                let enrichment = self.compute(&view).await;
                self.last = Some((key, enrichment.clone()));
                enrichment
            }
        };
        enrichment.apply(&mut view);
        self.out.send_if_modified(|current| {
            if current.as_ref() == Some(&view) {
                return false;
            }
            *current = Some(view);
            true
        });
    }
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

/// Runs the draft helper: takes the views mapped from the client (`raw`), adds the model's
/// numbers and publishes them on `out`, until `raw` closes.
pub(crate) fn spawn(
    mut raw: watch::Receiver<Option<DraftView>>,
    out: watch::Sender<Option<DraftView>>,
    lcu: watch::Receiver<Option<LcuClient>>,
    stats: Option<StatsClient>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut index = stats.as_ref().map(StatsClient::subscribe);
        let mut engine = Engine {
            out,
            lcu,
            stats,
            tx,
            fetches: Arc::new(Semaphore::new(PARALLEL_FETCHES)),
            session: 0,
            load: 0,
            view: None,
            pool: None,
            data: None,
            model: None,
            requested: HashSet::new(),
            version: 0,
            last: None,
        };
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
            }
        }
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use crate::champ_select;
    use domain::{
        ChampionRoleStats, ChampionStats, DataSetInfo, MatchupEntry, RoleMatchups, TierEntry,
        TierGrade,
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
                bracket: "Emerald+".into(),
                patch: "26.19".into(),
                games: 200_000,
                updated_at: 1_790_000_000_000,
            },
            tiers: Some(Arc::new(tiers())),
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
        let mut engine = Engine {
            out,
            lcu: watch::channel(None).1,
            stats: None,
            tx,
            fetches: Arc::new(Semaphore::new(1)),
            session: 0,
            load: 0,
            view: None,
            pool: None,
            data: None,
            model: None,
            requested: HashSet::new(),
            version: 0,
            last: None,
        };
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
