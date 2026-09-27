//! Aggregates → the published JSON files (`stats/v1/…`, types from `domain::stats`).
//!
//! Layout, relative to the stats root:
//! ```text
//! v1/index.json                                       StatsIndex
//! v1/{patch}/{queue}/{bracket}/champions.json         ChampionsFile (records, role odds, priors)
//! v1/{patch}/{queue}/{bracket}/tierlist.json          TierList
//! v1/{patch}/{queue}/{bracket}/matchups/{id}.json     MatchupsFile (ranked only)
//! v1/{patch}/{queue}/{bracket}/builds/{id}.json       BuildsFile
//! ```
//! Everything the app needs is precomputed here, but raw games and wins always ship next to
//! derived numbers so the app can explain (and re-derive) every value.

use std::collections::{BTreeMap, HashMap};

use domain::{
    Bracket, BuildOption, BuildSection, BuildStats, BuildsFile, ChampionRoleStats, ChampionStats,
    ChampionsFile, DataSetIndex, DataSetInfo, GamesWins, MatchupEntry, MatchupsFile, PairKind,
    PairPrior, PatchIndex, RoleMatchups, STATS_SCHEMA, StatsIndex, TierEntry, TierGrade, TierList,
};
use stats::draft::{Evidence, PairObservation, estimate_tau, shrunk_delta};
use stats::{BetaPrior, Record, logit, sigmoid};

use crate::dataset::{Builds, Dataset, SliceStats};
use crate::facts::{ARAM, Lane, Patch, RANKED_SOLO};
use crate::tally::{Rec, Tally};

/// Queues we publish.
pub const QUEUES: [u16; 2] = [RANKED_SOLO, ARAM];

/// Publication thresholds and sizes.
#[derive(Debug, Clone)]
pub struct Options {
    /// A champion's role gets builds, matchups and a tier-list entry from this many games.
    pub min_role_games: u32,
    /// Matchups and duos with fewer games are left out.
    pub min_pair_games: u32,
    /// Strength (pseudo-games at 50 %) of the shrinkage of base win rates.
    pub base_prior_games: f64,
    /// Tier-list entries need this pick rate in their role (0–1).
    pub tier_min_pick_rate: f64,
    /// Options kept per build choice.
    pub top_options: usize,
    /// Emerald+ ranked games a patch needs to become `current` in the index.
    pub min_current_games: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            min_role_games: 50,
            min_pair_games: 10,
            base_prior_games: 1_000.0,
            tier_min_pick_rate: 0.005,
            top_options: 6,
            min_current_games: 20_000,
        }
    }
}

/// One file to write, `path` relative to the stats root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedFile {
    pub path: String,
    pub body: Vec<u8>,
}

/// Directory of one data set, relative to the stats root.
pub fn set_dir(patch: Patch, queue: u16, bracket: Bracket) -> String {
    format!("v{STATS_SCHEMA}/{patch}/{queue}/{}", bracket.slug())
}

pub const INDEX_PATH: &str = "v1/index.json";

fn round(x: f64, digits: i32) -> f64 {
    let f = 10f64.powi(digits);
    (x * f).round() / f
}

fn gw(r: Rec) -> (u32, u32) {
    (r.games, r.wins)
}

/// Kind of an opponent/teammate pair, with roles in canonical order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct PairKey(PairKindOrd, Lane, Lane);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum PairKindOrd {
    Lane,
    Jungle,
    Duo,
}

fn versus_key(a: Lane, b: Lane) -> PairKey {
    if b == Lane::Jungle && a != Lane::Jungle {
        PairKey(PairKindOrd::Jungle, a, b)
    } else {
        PairKey(PairKindOrd::Lane, a.min(b), a.max(b))
    }
}

fn duo_key(a: Lane, b: Lane) -> PairKey {
    PairKey(PairKindOrd::Duo, a.min(b), a.max(b))
}

/// The derived model of one data set: shrunk base win rates and fitted pair priors.
struct Model<'a> {
    s: &'a SliceStats,
    prior_games: f64,
    priors: BTreeMap<PairKey, (stats::draft::PairPrior, u32)>,
}

impl<'a> Model<'a> {
    fn new(s: &'a SliceStats, prior_games: f64) -> Self {
        let mut m = Self {
            s,
            prior_games,
            priors: BTreeMap::new(),
        };
        let mut observations: BTreeMap<PairKey, Vec<PairObservation>> = BTreeMap::new();
        for (&(a, ra, b, rb), &r) in &s.versus {
            // Each pair once: same-role pairs from the lower champion id, cross pairs from
            // the laner's (or the bottom laner's) side.
            let once = if ra == rb {
                a < b
            } else {
                rb == Lane::Jungle || ra == Lane::Bottom
            };
            if once && r.games > 0 {
                observations
                    .entry(versus_key(ra, rb))
                    .or_default()
                    .push(PairObservation {
                        observed: f64::from(r.wins) / f64::from(r.games),
                        games: f64::from(r.games),
                        expected: m.expected_versus(a, ra, b, rb),
                    });
            }
        }
        for (&(a, ra, b, rb), &r) in &s.duos {
            if r.games > 0 {
                observations
                    .entry(duo_key(ra, rb))
                    .or_default()
                    .push(PairObservation {
                        observed: f64::from(r.wins) / f64::from(r.games),
                        games: f64::from(r.games),
                        expected: m.expected_duo(a, ra, b, rb),
                    });
            }
        }
        m.priors = observations
            .into_iter()
            .map(|(k, obs)| {
                let prior = stats::draft::PairPrior::from_tau(estimate_tau(&obs));
                (k, (prior, u32::try_from(obs.len()).unwrap_or(u32::MAX)))
            })
            .collect();
        m
    }

    /// Base win rate shrunk toward 50 %.
    fn base(&self, champion: u16, role: Option<Lane>) -> f64 {
        let r = self
            .s
            .champions
            .get(&(champion, role))
            .copied()
            .unwrap_or_default();
        let record = Record::new(r.games, r.wins).unwrap_or_default();
        BetaPrior {
            mean: 0.5,
            strength: self.prior_games,
        }
        .posterior_mean(record)
    }

    fn expected_versus(&self, a: u16, ra: Lane, b: u16, rb: Lane) -> f64 {
        sigmoid(logit(self.base(a, Some(ra))) - logit(self.base(b, Some(rb))))
    }

    fn expected_duo(&self, a: u16, ra: Lane, b: u16, rb: Lane) -> f64 {
        sigmoid(logit(self.base(a, Some(ra))) + logit(self.base(b, Some(rb))))
    }

    fn prior(&self, key: PairKey) -> stats::draft::PairPrior {
        self.priors
            .get(&key)
            .map_or_else(|| stats::draft::PairPrior::from_tau(0.0), |p| p.0)
    }

    /// Shrunk pair effect in percentage points.
    fn delta(&self, r: Rec, expected: f64, key: PairKey) -> f64 {
        let e = Evidence::new(f64::from(r.games), f64::from(r.wins));
        round(shrunk_delta(e, expected, self.prior(key)).points(), 2)
    }

    fn published_priors(&self) -> Vec<PairPrior> {
        self.priors
            .iter()
            .map(|(PairKey(kind, a, b), (p, pairs))| PairPrior {
                kind: match kind {
                    PairKindOrd::Lane => PairKind::Lane,
                    PairKindOrd::Jungle => PairKind::Jungle,
                    PairKindOrd::Duo => PairKind::Duo,
                },
                roles: vec![a.domain(), b.domain()],
                tau: round(p.tau, 5),
                k: round(p.k, 1),
                pairs: *pairs,
            })
            .collect()
    }
}

fn to_json<T: serde::Serialize>(
    path: String,
    value: &T,
) -> Result<PublishedFile, serde_json::Error> {
    Ok(PublishedFile {
        path,
        body: serde_json::to_vec(value)?,
    })
}

/// Every file of one patch (all queues and brackets with games), plus its index entry
/// (`None` without any game). `previous` records come from `patch.previous()` in `ds`.
pub fn publish_patch(
    ds: &Dataset,
    patch: Patch,
    opts: &Options,
    updated_at: i64,
) -> Result<(Vec<PublishedFile>, Option<PatchIndex>), serde_json::Error> {
    let mut files = Vec::new();
    let mut sets = Vec::new();
    for queue in QUEUES {
        for bracket in Bracket::ALL {
            let s = ds.combined(patch, queue, bracket);
            if s.games == 0 {
                continue;
            }
            let prev = ds.combined(patch.previous(), queue, bracket);
            let info = DataSetInfo {
                schema: STATS_SCHEMA,
                patch: patch.to_string(),
                queue: u32::from(queue),
                bracket,
                games: s.games,
                updated_at,
            };
            files.extend(publish_set(&s, &prev, &info, opts)?);
            sets.push(DataSetIndex {
                queue: u32::from(queue),
                bracket,
                games: s.games,
            });
        }
    }
    let entry = (!sets.is_empty()).then(|| PatchIndex {
        patch: patch.to_string(),
        name: patch.public_name(),
        sets,
        updated_at,
    });
    Ok((files, entry))
}

/// (role, other champion, other's role, record) from one champion's side.
type Pairs = Vec<(Lane, u16, Lane, Rec)>;

/// The files of one data set (`s`), with `prev` = the same set on the previous patch.
pub fn publish_set(
    s: &SliceStats,
    prev: &SliceStats,
    info: &DataSetInfo,
    opts: &Options,
) -> Result<Vec<PublishedFile>, serde_json::Error> {
    let dir = format!(
        "v{STATS_SCHEMA}/{}/{}/{}",
        info.patch,
        info.queue,
        info.bracket.slug()
    );
    let model = Model::new(s, opts.base_prior_games);
    let ranked = info.queue == u32::from(RANKED_SOLO);

    let by_champion = roles_by_champion(s);
    let mut files = vec![
        to_json(
            format!("{dir}/champions.json"),
            &ChampionsFile {
                info: info.clone(),
                champions: champion_stats(s, prev, &by_champion),
                priors: if ranked {
                    model.published_priors()
                } else {
                    Vec::new()
                },
            },
        )?,
        to_json(
            format!("{dir}/tierlist.json"),
            &tier_list(s, &model, info, opts),
        )?,
    ];

    // Per champion: builds, and (ranked) matchups.
    let mut versus_of: HashMap<u16, Pairs> = HashMap::new();
    for (&(a, ra, b, rb), &r) in &s.versus {
        versus_of.entry(a).or_default().push((ra, b, rb, r));
    }
    let mut duos_of: HashMap<u16, Pairs> = HashMap::new();
    for (&(a, ra, b, rb), &r) in &s.duos {
        duos_of.entry(a).or_default().push((ra, b, rb, r));
        duos_of.entry(b).or_default().push((rb, a, ra, r));
    }
    let empty = Vec::new();
    for (&c, roles) in &by_champion {
        let qualified: Vec<(Option<Lane>, Rec)> = roles
            .iter()
            .copied()
            .filter(|(_, r)| r.games >= opts.min_role_games.max(1))
            .collect();
        if qualified.is_empty() {
            continue;
        }
        let builds: Vec<BuildStats> = qualified
            .iter()
            .filter_map(|&(role, _)| {
                s.builds
                    .get(&(c, role))
                    .map(|b| build_stats(b, role, opts.top_options))
            })
            .collect();
        files.push(to_json(
            format!("{dir}/builds/{c}.json"),
            &BuildsFile {
                info: info.clone(),
                id: u32::from(c),
                roles: builds,
            },
        )?);
        if !ranked {
            continue;
        }
        let versus = versus_of.get(&c).unwrap_or(&empty);
        let duos = duos_of.get(&c).unwrap_or(&empty);
        let roles: Vec<RoleMatchups> = qualified
            .iter()
            .filter_map(|&(role, r)| {
                Some(role_matchups(
                    &model,
                    c,
                    role?,
                    r,
                    versus,
                    duos,
                    opts.min_pair_games,
                ))
            })
            .collect();
        files.push(to_json(
            format!("{dir}/matchups/{c}.json"),
            &MatchupsFile {
                info: info.clone(),
                id: u32::from(c),
                roles,
            },
        )?);
    }
    Ok(files)
}

/// Each champion's roles, most played first (banned-only champions have none).
fn roles_by_champion(s: &SliceStats) -> BTreeMap<u16, Vec<(Option<Lane>, Rec)>> {
    let mut by_champion: BTreeMap<u16, Vec<(Option<Lane>, Rec)>> = BTreeMap::new();
    for (&(c, role), &r) in &s.champions {
        by_champion.entry(c).or_default().push((role, r));
    }
    for &c in s.bans.keys() {
        by_champion.entry(c).or_default();
    }
    for roles in by_champion.values_mut() {
        roles.sort_by(|a, b| b.1.games.cmp(&a.1.games).then(a.0.cmp(&b.0)));
    }
    by_champion
}

fn champion_stats(
    s: &SliceStats,
    prev: &SliceStats,
    by_champion: &BTreeMap<u16, Vec<(Option<Lane>, Rec)>>,
) -> Vec<ChampionStats> {
    by_champion
        .iter()
        .map(|(&c, roles)| {
            let mut total = Rec::default();
            for (_, r) in roles {
                total.merge(*r);
            }
            ChampionStats {
                id: u32::from(c),
                g: total.games,
                w: total.wins,
                bans: s.bans.get(&c).copied().unwrap_or(0),
                roles: roles
                    .iter()
                    .map(|&(role, r)| ChampionRoleStats {
                        role: role.map(Lane::domain),
                        g: r.games,
                        w: r.wins,
                        prev: prev
                            .champions
                            .get(&(c, role))
                            .filter(|p| p.games > 0)
                            .map(|p| GamesWins {
                                g: p.games,
                                w: p.wins,
                            }),
                    })
                    .collect(),
            }
        })
        .collect()
}

fn role_matchups(
    model: &Model<'_>,
    c: u16,
    role: Lane,
    r: Rec,
    versus: &Pairs,
    duos: &Pairs,
    min_games: u32,
) -> RoleMatchups {
    let entry = |b: u16, rb: Lane, rec: Rec, expected: f64, key: PairKey| {
        let (g, w) = gw(rec);
        MatchupEntry {
            id: u32::from(b),
            role: rb.domain(),
            g,
            w,
            d: model.delta(rec, expected, key),
        }
    };
    let mut lane = Vec::new();
    let mut jungle = Vec::new();
    for &(ra, b, rb, rec) in versus {
        if ra != role || rec.games < min_games {
            continue;
        }
        let e = entry(
            b,
            rb,
            rec,
            model.expected_versus(c, ra, b, rb),
            versus_key(ra, rb),
        );
        if rb == Lane::Jungle && ra != Lane::Jungle {
            jungle.push(e);
        } else {
            lane.push(e);
        }
    }
    let mut with = Vec::new();
    for &(ra, b, rb, rec) in duos {
        if ra == role && rec.games >= min_games {
            with.push(entry(
                b,
                rb,
                rec,
                model.expected_duo(c, ra, b, rb),
                duo_key(ra, rb),
            ));
        }
    }
    for list in [&mut lane, &mut jungle, &mut with] {
        list.sort_by(|x, y| y.g.cmp(&x.g).then(x.id.cmp(&y.id)));
    }
    RoleMatchups {
        role: role.domain(),
        g: r.games,
        w: r.wins,
        lane,
        jungle,
        duos: with,
    }
}

/// Grade of a tier-list score (shrunk win rate − 50 %, in points).
pub fn grade(score: f64) -> TierGrade {
    match score {
        s if s >= 2.0 => TierGrade::S,
        s if s >= 0.75 => TierGrade::A,
        s if s >= -0.75 => TierGrade::B,
        s if s >= -2.0 => TierGrade::C,
        _ => TierGrade::D,
    }
}

fn tier_list(s: &SliceStats, model: &Model<'_>, info: &DataSetInfo, opts: &Options) -> TierList {
    let matches = f64::from(s.games.max(1));
    let mut entries: Vec<TierEntry> = s
        .champions
        .iter()
        .filter(|(_, r)| r.games >= opts.min_role_games.max(1))
        .filter(|(_, r)| f64::from(r.games) / matches >= opts.tier_min_pick_rate)
        .map(|(&(c, role), &r)| {
            let wr = model.base(c, role);
            let score = round((wr - 0.5) * 100.0, 2);
            TierEntry {
                id: u32::from(c),
                role: role.map(Lane::domain),
                tier: grade(score),
                score,
                g: r.games,
                w: r.wins,
                win_rate: round(wr, 4),
                pick_rate: round(f64::from(r.games) / matches, 4),
                ban_rate: round(f64::from(s.bans.get(&c).copied().unwrap_or(0)) / matches, 4),
            }
        })
        .collect();
    entries.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then(b.g.cmp(&a.g))
            .then(a.id.cmp(&b.id))
    });
    TierList {
        info: info.clone(),
        entries,
    }
}

fn section<K: Ord + Clone>(t: &Tally<K>, top: usize, ids: impl Fn(&K) -> Vec<u32>) -> BuildSection {
    BuildSection {
        n: t.total().games,
        top: t
            .ranked()
            .into_iter()
            .take(top)
            .map(|(k, r)| BuildOption {
                ids: ids(k),
                g: r.games,
                w: r.wins,
            })
            .collect(),
    }
}

fn build_stats(b: &Builds, role: Option<Lane>, top: usize) -> BuildStats {
    let one = |x: &u32| vec![*x];
    BuildStats {
        role: role.map(Lane::domain),
        g: b.games.games,
        w: b.games.wins,
        runes: section(&b.runes, top, crate::facts::RunePage::ids),
        keystones: section(&b.keystones, top, one),
        spells: section(&b.spells, top, |s| {
            s.iter().map(|&x| u32::from(x)).collect()
        }),
        skills: section(&b.skills, top, |o| {
            o.0.iter().map(|&x| u32::from(x)).collect()
        }),
        skill_start: section(&b.skill_start, top, |o| {
            o.iter().map(|&x| u32::from(x)).collect()
        }),
        starts: section(&b.starts, top, Clone::clone),
        core: section(&b.core, top, |c| c.to_vec()),
        boots: section(&b.boots, top, one),
        item4: section(&b.later[0], top, one),
        item5: section(&b.later[1], top, one),
        item6: section(&b.later[2], top, one),
    }
}

/// The index after publishing `fresh` patches over `previous` (older entries are kept).
pub fn build_index(
    previous: Option<StatsIndex>,
    fresh: Vec<PatchIndex>,
    opts: &Options,
    updated_at: i64,
) -> StatsIndex {
    let mut patches: Vec<PatchIndex> = previous
        .map(|i| i.patches)
        .unwrap_or_default()
        .into_iter()
        .filter(|old| fresh.iter().all(|f| f.patch != old.patch))
        .collect();
    patches.extend(fresh);
    let order = |p: &PatchIndex| Patch::from_game_version(&p.patch);
    patches.sort_by_key(|p| std::cmp::Reverse(order(p)));
    let ranked_games = |p: &PatchIndex| {
        p.sets
            .iter()
            .find(|s| s.queue == u32::from(RANKED_SOLO) && s.bracket == Bracket::EmeraldPlus)
            .map_or(0, |s| s.games)
    };
    let current = patches
        .iter()
        .find(|p| ranked_games(p) >= opts.min_current_games)
        .or_else(|| patches.first())
        .map(|p| p.patch.clone());
    StatsIndex {
        schema: STATS_SCHEMA,
        current,
        patches,
        updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch_entry(patch: &str, games: u32) -> PatchIndex {
        PatchIndex {
            patch: patch.to_owned(),
            name: String::new(),
            sets: vec![DataSetIndex {
                queue: 420,
                bracket: Bracket::EmeraldPlus,
                games,
            }],
            updated_at: 1,
        }
    }

    #[test]
    fn current_patch_falls_back_to_the_previous_one() {
        let opts = Options {
            min_current_games: 1_000,
            ..Options::default()
        };
        let old = build_index(None, vec![patch_entry("16.9", 50_000)], &opts, 1);
        let idx = build_index(Some(old), vec![patch_entry("16.10", 200)], &opts, 2);
        assert_eq!(
            idx.patches
                .iter()
                .map(|p| p.patch.as_str())
                .collect::<Vec<_>>(),
            ["16.10", "16.9"],
            "newest first, numerically"
        );
        assert_eq!(idx.current.as_deref(), Some("16.9"));
        let idx = build_index(Some(idx), vec![patch_entry("16.10", 5_000)], &opts, 3);
        assert_eq!(idx.current.as_deref(), Some("16.10"));
        assert_eq!(idx.patches.len(), 2, "republishing replaces the entry");
    }

    #[test]
    fn grades() {
        assert_eq!(grade(2.5), TierGrade::S);
        assert_eq!(grade(0.0), TierGrade::B);
        assert_eq!(grade(-3.0), TierGrade::D);
    }
}
