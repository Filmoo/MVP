//! The draft model's data (`stats::draft::DraftData`) over the published files: champion
//! strengths from `champions.json` (this patch shrunk toward the previous one), pair evidence
//! from the `matchups/{id}.json` files of the champions in the draft, and the pair priors fitted
//! by the publisher.
//!
//! **Base strength** (research D §3.13): `base_strength(this patch, p_prev, k_b)` where `p_prev`
//! is the previous patch's win rate in the role (itself shrunk toward 50 % with 1,000 games, or
//! 47 % for an off-meta role) and `k_b` combines how much we know about the previous patch with
//! how far a champion drifts in one patch: `k_b = n_prev·k_d / (n_prev + k_d)`, `k_d` = 20k
//! games for an unchanged champion, 1.5k when its win rate moved significantly (|z| > 3).
//!
//! **Pairs**: a matchups file lists its champion's games against lane opponents and the enemy
//! jungler, and with every teammate. Each pair is read from both champions' files when both are
//! loaded (averaging the two perspectives), else from the one that is.

use std::collections::{HashMap, HashSet};

use ::stats::draft::{
    Base, ChampRole, DraftData, Evidence, PairPrior, PairType, Role, base_strength,
};
use domain::{ChampionRoleStats, ChampionsFile, MatchupEntry, MatchupsFile, PairKind};

/// Games at 50 % the previous patch's record is shrunk with (the tier list's strength).
const PREV_PRIOR_GAMES: f64 = 1_000.0;
/// How much an unchanged champion's true win rate moves in one patch, as pseudo-games.
const STABLE_DRIFT_GAMES: f64 = 20_000.0;
/// … and one whose win rate moved significantly since the previous patch.
const CHANGED_DRIFT_GAMES: f64 = 1_500.0;
/// |z| of the change between patches beyond which a champion counts as changed.
const DRIFT_Z: f64 = 3.0;
/// A role under this share of a champion's games is off-meta…
const OFF_ROLE_SHARE: f64 = 0.05;
/// … and off-meta picks win about this often (research D §3.5).
const OFF_ROLE_WIN_RATE: f64 = 0.47;

pub fn role(r: domain::Role) -> Role {
    match r {
        domain::Role::Top => Role::Top,
        domain::Role::Jungle => Role::Jungle,
        domain::Role::Middle => Role::Middle,
        domain::Role::Bottom => Role::Bottom,
        domain::Role::Support => Role::Support,
    }
}

pub fn domain_role(r: Role) -> domain::Role {
    match r {
        Role::Top => domain::Role::Top,
        Role::Jungle => domain::Role::Jungle,
        Role::Middle => domain::Role::Middle,
        Role::Bottom => domain::Role::Bottom,
        Role::Support => domain::Role::Support,
    }
}

fn evidence(g: u32, w: u32) -> Evidence {
    Evidence::new(f64::from(g), f64::from(w.min(g)))
}

/// Whether the win rate moved beyond noise between the two patches.
fn drifted(now: Evidence, before: Evidence) -> bool {
    if now.games <= 0.0 || before.games <= 0.0 {
        return false;
    }
    let pooled = (now.wins + before.wins) / (now.games + before.games);
    let se = (pooled * (1.0 - pooled) * (1.0 / now.games + 1.0 / before.games)).sqrt();
    se > 0.0 && ((now.wins / now.games - before.wins / before.games) / se).abs() > DRIFT_Z
}

/// Strength of a champion in one role whose games are `share` of the champion's.
fn strength(r: &ChampionRoleStats, share: f64) -> Base {
    let centre = if share < OFF_ROLE_SHARE {
        OFF_ROLE_WIN_RATE
    } else {
        0.5
    };
    let now = evidence(r.g, r.w);
    let (prior, prior_games, changed) = match r.prev {
        Some(prev) if prev.g > 0 => {
            let before = evidence(prev.g, prev.w);
            (
                (before.wins + PREV_PRIOR_GAMES * centre) / (before.games + PREV_PRIOR_GAMES),
                before.games + PREV_PRIOR_GAMES,
                drifted(now, before),
            )
        }
        _ => (centre, PREV_PRIOR_GAMES, false),
    };
    let drift = if changed {
        CHANGED_DRIFT_GAMES
    } else {
        STABLE_DRIFT_GAMES
    };
    base_strength(now, prior, prior_games * drift / (prior_games + drift))
}

/// What the draft model knows: one champions file plus the matchups files added so far.
#[derive(Debug, Clone, Default)]
pub struct DraftStats {
    base: HashMap<ChampRole, Base>,
    /// ARAM strengths (the file's rows without a role), with this patch's games.
    aram: HashMap<u32, (Base, u32)>,
    /// Games per champion in each role (index = `Role::index`).
    games: HashMap<u32, [u32; 5]>,
    /// Each file's own view: `(a, b)` → a's games and wins against b.
    versus: HashMap<(ChampRole, ChampRole), Evidence>,
    /// `(a, b)` → games and wins of a and b together, as a's file lists them.
    duos: HashMap<(ChampRole, ChampRole), Evidence>,
    priors: HashMap<PairType, PairPrior>,
    /// Champions whose matchups file was added.
    added: HashSet<u32>,
}

impl DraftStats {
    pub fn new(file: &ChampionsFile) -> Self {
        let mut out = Self::default();
        for c in &file.champions {
            let mut games = [0u32; 5];
            for r in &c.roles {
                if let Some(domain_role) = r.role {
                    games[role(domain_role).index()] = r.g;
                }
            }
            let total: u32 = games.iter().sum();
            for r in c.roles.iter().filter(|r| r.role.is_none()) {
                if r.g > 0 || r.prev.is_some() {
                    out.aram.insert(c.id, (strength(r, 1.0), r.g));
                }
            }
            for r in &c.roles {
                let Some(domain_role) = r.role else { continue };
                if r.g == 0 && r.prev.is_none() {
                    continue;
                }
                let share = if total > 0 {
                    f64::from(r.g) / f64::from(total)
                } else {
                    0.0
                };
                let key = ChampRole {
                    champion: c.id,
                    role: role(domain_role),
                };
                out.base.insert(key, strength(r, share));
            }
            out.games.insert(c.id, games);
        }
        for p in &file.priors {
            let [a, b] = p.roles.as_slice() else { continue };
            let (a, b) = (role(*a), role(*b));
            let pair = match p.kind {
                PairKind::Lane | PairKind::Jungle => PairType::versus(a, b),
                PairKind::Duo => PairType::duo(a, b),
            };
            let prior = if p.k.is_finite() && p.k > 0.0 && p.tau.is_finite() {
                PairPrior {
                    tau: p.tau.max(0.0),
                    k: p.k,
                }
            } else {
                PairPrior::from_tau(p.tau)
            };
            out.priors.insert(pair, prior);
        }
        out
    }

    /// Adds one champion's matchups and duos.
    pub fn add_matchups(&mut self, file: &MatchupsFile) {
        let other = |e: &MatchupEntry| ChampRole {
            champion: e.id,
            role: role(e.role),
        };
        for r in &file.roles {
            let me = ChampRole {
                champion: file.id,
                role: role(r.role),
            };
            for e in r.lane.iter().chain(&r.jungle) {
                self.versus.insert((me, other(e)), evidence(e.g, e.w));
            }
            for e in &r.duos {
                self.duos.insert((me, other(e)), evidence(e.g, e.w));
            }
        }
        self.added.insert(file.id);
    }

    /// `champion`'s ARAM strength (this patch shrunk toward the previous one) and this patch's
    /// games, when the file is an ARAM one.
    pub fn aram(&self, champion: u32) -> Option<(Base, u32)> {
        self.aram.get(&champion).copied()
    }

    /// Whether `champion`'s matchups file was added.
    pub fn has_matchups(&self, champion: u32) -> bool {
        self.added.contains(&champion)
    }

    /// Whether the champions file has any games of `champion`.
    pub fn knows(&self, champion: u32) -> bool {
        self.games
            .get(&champion)
            .is_some_and(|g| g.iter().any(|&n| n > 0))
    }

    /// Games of `champion` in `role`.
    pub fn games(&self, champion: u32, role: Role) -> u32 {
        self.games.get(&champion).map_or(0, |g| g[role.index()])
    }

    /// Share of `champion`'s games in each role (index = `Role::index`); equal shares when it
    /// has no games (a new champion can play anywhere).
    pub fn role_shares(&self, champion: u32) -> [f64; 5] {
        let games = self.games.get(&champion).copied().unwrap_or_default();
        let total: u32 = games.iter().sum();
        if total == 0 {
            return [0.2; 5];
        }
        games.map(|g| f64::from(g) / f64::from(total))
    }

    /// Champions by games in `role`, most played first.
    pub fn most_played(&self, role: Role) -> Vec<u32> {
        let mut out: Vec<(u32, u32)> = self
            .games
            .iter()
            .map(|(&c, g)| (c, g[role.index()]))
            .filter(|&(_, g)| g > 0)
            .collect();
        out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        out.into_iter().map(|(c, _)| c).collect()
    }
}

/// One perspective, both, or none.
fn combine(mine: Option<Evidence>, theirs: Option<Evidence>) -> Evidence {
    match (mine, theirs) {
        (Some(a), Some(b)) => Evidence::average_perspectives(a, b),
        (Some(one), None) | (None, Some(one)) => one,
        (None, None) => Evidence::default(),
    }
}

impl DraftData for DraftStats {
    fn base(&self, c: ChampRole) -> Option<Base> {
        self.base.get(&c).copied()
    }

    fn versus(&self, a: ChampRole, b: ChampRole) -> Evidence {
        // b's wins against a are a's losses.
        let theirs = self
            .versus
            .get(&(b, a))
            .map(|e| Evidence::new(e.games, e.games - e.wins));
        combine(self.versus.get(&(a, b)).copied(), theirs)
    }

    fn duo(&self, a: ChampRole, b: ChampRole) -> Evidence {
        combine(
            self.duos.get(&(a, b)).copied(),
            self.duos.get(&(b, a)).copied(),
        )
    }

    fn prior(&self, pair: PairType) -> PairPrior {
        // Pair types the publisher didn't fit (cross-map pairs, too few pairs): no effect.
        self.priors
            .get(&pair)
            .copied()
            .unwrap_or_else(|| PairPrior::from_tau(0.0))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use ::stats::sigmoid;
    use domain::{
        Bracket, ChampionStats, DataSetInfo, GamesWins, PairPrior as Published, RoleMatchups,
    };

    const MALPHITE: u32 = 54;
    const IRELIA: u32 = 39;
    const LEE_SIN: u32 = 64;
    const THRESH: u32 = 412;

    fn info() -> DataSetInfo {
        DataSetInfo {
            schema: 1,
            patch: "16.19".into(),
            queue: 420,
            bracket: Bracket::EmeraldPlus,
            games: 100_000,
            updated_at: 1,
        }
    }

    fn role_stats(
        role: domain::Role,
        g: u32,
        w: u32,
        prev: Option<(u32, u32)>,
    ) -> ChampionRoleStats {
        ChampionRoleStats {
            role: Some(role),
            g,
            w,
            prev: prev.map(|(g, w)| GamesWins { g, w }),
        }
    }

    fn champion(id: u32, roles: Vec<ChampionRoleStats>) -> ChampionStats {
        ChampionStats {
            id,
            g: roles.iter().map(|r| r.g).sum(),
            w: roles.iter().map(|r| r.w).sum(),
            bans: 0,
            roles,
        }
    }

    fn champions() -> ChampionsFile {
        use domain::Role::{Jungle, Middle, Top};
        ChampionsFile {
            info: info(),
            champions: vec![
                champion(
                    MALPHITE,
                    vec![role_stats(Top, 10_000, 5_100, Some((20_000, 10_200)))],
                ),
                champion(
                    IRELIA,
                    vec![
                        role_stats(Top, 9_000, 4_500, None),
                        role_stats(Middle, 1_000, 480, None),
                        role_stats(Jungle, 10, 2, None),
                    ],
                ),
                champion(LEE_SIN, vec![role_stats(Jungle, 12_000, 5_900, None)]),
            ],
            priors: vec![
                Published {
                    kind: PairKind::Lane,
                    roles: vec![Top, Top],
                    tau: 0.0209,
                    k: 572.3,
                    pairs: 900,
                },
                Published {
                    kind: PairKind::Jungle,
                    roles: vec![Top, Jungle],
                    tau: 0.01,
                    k: 2_500.0,
                    pairs: 800,
                },
                Published {
                    kind: PairKind::Duo,
                    roles: vec![domain::Role::Bottom, domain::Role::Support],
                    tau: 0.012,
                    k: 1_736.1,
                    pairs: 700,
                },
            ],
        }
    }

    fn entry(id: u32, role: domain::Role, g: u32, w: u32) -> MatchupEntry {
        MatchupEntry {
            id,
            role,
            g,
            w,
            d: 0.0,
        }
    }

    fn matchups(
        id: u32,
        role: domain::Role,
        lane: Vec<MatchupEntry>,
        jungle: Vec<MatchupEntry>,
        duos: Vec<MatchupEntry>,
    ) -> MatchupsFile {
        MatchupsFile {
            info: info(),
            id,
            roles: vec![RoleMatchups {
                role,
                g: 1_000,
                w: 500,
                lane,
                jungle,
                duos,
            }],
        }
    }

    fn cr(champion: u32, role: Role) -> ChampRole {
        ChampRole { champion, role }
    }

    #[test]
    fn base_strength_leans_on_the_previous_patch() {
        let data = DraftStats::new(&champions());
        let malphite = sigmoid(data.base(cr(MALPHITE, Role::Top)).unwrap().logit);
        // 51 % both patches: stays at 51 %.
        assert!((malphite - 0.51).abs() < 0.002, "{malphite}");
        // Irelia jungle: 10 games at 20 %, off-meta: pulled to about 47 %, not 20 %.
        let jungle = sigmoid(data.base(cr(IRELIA, Role::Jungle)).unwrap().logit);
        assert!((jungle - 0.47).abs() < 0.01, "{jungle}");
        assert!(data.base(cr(LEE_SIN, Role::Top)).is_none());
    }

    #[test]
    fn a_changed_champion_follows_this_patch() {
        use domain::Role::Top;
        let file = |prev| ChampionsFile {
            champions: vec![champion(
                MALPHITE,
                vec![role_stats(Top, 20_000, 9_000, prev)],
            )],
            ..champions()
        };
        // Last patch 55 % over 40k games, now 45 % over 20k: a significant change.
        let changed = DraftStats::new(&file(Some((40_000, 22_000))));
        let wr = sigmoid(changed.base(cr(MALPHITE, Role::Top)).unwrap().logit);
        assert!(wr < 0.47, "follows the new patch: {wr}");
        // The same games with the same rate last patch: nothing moves.
        let stable = DraftStats::new(&file(Some((40_000, 18_000))));
        let wr = sigmoid(stable.base(cr(MALPHITE, Role::Top)).unwrap().logit);
        assert!((wr - 0.45).abs() < 0.002, "{wr}");
    }

    #[test]
    fn aram_rows_have_no_role() {
        let aram = ChampionsFile {
            champions: vec![champion(
                MALPHITE,
                vec![ChampionRoleStats {
                    role: None,
                    g: 5_000,
                    w: 2_700,
                    prev: None,
                }],
            )],
            priors: vec![],
            ..champions()
        };
        let data = DraftStats::new(&aram);
        let (base, games) = data.aram(MALPHITE).unwrap();
        assert_eq!(games, 5_000);
        // 54 % over 5k games, pulled toward 50 % by about a thousand pseudo-games.
        let wr = sigmoid(base.logit);
        assert!(wr > 0.53 && wr < 0.54, "{wr}");
        assert!(data.base(cr(MALPHITE, Role::Top)).is_none());
        assert!(DraftStats::new(&champions()).aram(MALPHITE).is_none());
    }

    #[test]
    fn role_shares_come_from_games() {
        let data = DraftStats::new(&champions());
        let shares = data.role_shares(IRELIA);
        assert!((shares[Role::Top.index()] - 9_000.0 / 10_010.0).abs() < 1e-9);
        assert!((shares.iter().sum::<f64>() - 1.0).abs() < 1e-9);
        assert!(
            data.role_shares(999)
                .iter()
                .all(|s| (s - 0.2).abs() < f64::EPSILON),
            "unknown champion: any role"
        );
        assert_eq!(data.most_played(Role::Top), vec![MALPHITE, IRELIA]);
        assert!(data.knows(LEE_SIN) && !data.knows(999));
    }

    #[test]
    fn pairs_read_both_perspectives() {
        use domain::Role::{Jungle, Top};
        let mut data = DraftStats::new(&champions());
        // Only Malphite's file: its view, and Irelia's view is its mirror.
        data.add_matchups(&matchups(
            MALPHITE,
            Top,
            vec![entry(IRELIA, Top, 3_000, 1_650)],
            vec![entry(LEE_SIN, Jungle, 800, 400)],
            vec![],
        ));
        let m = cr(MALPHITE, Role::Top);
        let i = cr(IRELIA, Role::Top);
        assert_eq!(data.versus(m, i), Evidence::new(3_000.0, 1_650.0));
        assert_eq!(data.versus(i, m), Evidence::new(3_000.0, 1_350.0));
        // Irelia's file too (a slightly different count): the two views are averaged.
        data.add_matchups(&matchups(
            IRELIA,
            Top,
            vec![entry(MALPHITE, Top, 3_100, 1_400)],
            vec![],
            vec![],
        ));
        assert_eq!(data.versus(m, i), Evidence::new(3_050.0, 1_675.0));
        // The laner's file is the only one with laner-vs-jungler pairs: found from either side.
        let lee = cr(LEE_SIN, Role::Jungle);
        assert_eq!(data.versus(lee, m), Evidence::new(800.0, 400.0));
        assert_eq!(data.versus(m, cr(LEE_SIN, Role::Top)), Evidence::default());
        assert!(data.has_matchups(IRELIA) && !data.has_matchups(LEE_SIN));
    }

    #[test]
    fn duos_from_either_file() {
        use domain::Role::{Jungle, Support};
        let mut data = DraftStats::new(&champions());
        data.add_matchups(&matchups(
            LEE_SIN,
            Jungle,
            vec![],
            vec![],
            vec![entry(THRESH, Support, 500, 270)],
        ));
        let lee = cr(LEE_SIN, Role::Jungle);
        let thresh = cr(THRESH, Role::Support);
        assert_eq!(data.duo(lee, thresh), Evidence::new(500.0, 270.0));
        assert_eq!(data.duo(thresh, lee), Evidence::new(500.0, 270.0));
    }

    #[test]
    fn priors_map_to_pair_types() {
        let data = DraftStats::new(&champions());
        let top = data.prior(PairType::versus(Role::Top, Role::Top));
        assert!((top.k - 572.3).abs() < 1e-9 && (top.tau - 0.0209).abs() < 1e-12);
        let jungle = data.prior(PairType::versus(Role::Jungle, Role::Top));
        assert!((jungle.k - 2_500.0).abs() < 1e-9);
        let duo = data.prior(PairType::duo(Role::Support, Role::Bottom));
        assert!((duo.k - 1_736.1).abs() < 1e-9);
        // Not fitted: no effect at all.
        let other = data.prior(PairType::versus(Role::Top, Role::Middle));
        assert!(other.tau.abs() < f64::EPSILON && (other.k - PairPrior::MAX_K).abs() < 1e-9);
    }
}
