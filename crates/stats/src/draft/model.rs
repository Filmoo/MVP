//! Building blocks: roles, evidence, and shrunk interaction deltas.

use crate::{logit, sigmoid};

/// The five positions, indexable (`as usize`) for compact tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Role {
    Top = 0,
    Jungle = 1,
    Middle = 2,
    Bottom = 3,
    Support = 4,
}

impl Role {
    pub const ALL: [Self; 5] = [
        Self::Top,
        Self::Jungle,
        Self::Middle,
        Self::Bottom,
        Self::Support,
    ];

    pub const fn index(self) -> usize {
        self as usize
    }
}

/// A champion in a role (stats are always role-specific).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ChampRole {
    pub champion: u32,
    pub role: Role,
}

/// Which kind of pair an interaction belongs to. Prior strength is fitted per pair type:
/// lane matchups interact strongly, most cross-map pairs barely at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PairType {
    /// Opponents; roles stored in canonical order (`a <= b`).
    Versus(Role, Role),
    /// Teammates; roles stored in canonical order (`a < b`).
    Duo(Role, Role),
}

impl PairType {
    pub fn versus(a: Role, b: Role) -> Self {
        Self::Versus(a.min(b), a.max(b))
    }

    pub fn duo(a: Role, b: Role) -> Self {
        Self::Duo(a.min(b), a.max(b))
    }
}

/// Observed games and wins (fractional: two perspectives may be averaged).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Evidence {
    pub games: f64,
    pub wins: f64,
}

impl Evidence {
    pub fn new(games: f64, wins: f64) -> Self {
        Self { games, wins }
    }

    /// Averages A's view of the pair with B's view (B's wins are A's losses in a matchup).
    pub fn average_perspectives(a_view: Self, b_view_as_a: Self) -> Self {
        Self {
            games: f64::midpoint(a_view.games, b_view_as_a.games),
            wins: f64::midpoint(a_view.wins, b_view_as_a.wins),
        }
    }

    pub fn win_rate(self) -> Option<f64> {
        (self.games > 0.0).then(|| self.wins / self.games)
    }
}

/// Prior of one pair type: between-pair spread of true effects `tau` (win-rate scale) and the
/// matching prior strength in pseudo-games `k ≈ 0.25 / tau²`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PairPrior {
    pub tau: f64,
    pub k: f64,
}

impl PairPrior {
    /// Prior strength cap: effects too small to measure count as none.
    pub const MAX_K: f64 = 20_000.0;

    pub fn from_tau(tau: f64) -> Self {
        let k = if tau <= 0.0 {
            Self::MAX_K
        } else {
            (0.25 / (tau * tau)).min(Self::MAX_K)
        };
        Self {
            tau: tau.max(0.0),
            k,
        }
    }
}

/// An interaction after shrinkage, in log-odds (0 = no effect beyond the base strengths).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Delta {
    pub logit: f64,
    /// Posterior variance, log-odds².
    pub variance: f64,
    /// Share of the observed effect kept after shrinkage, `n / (n + k)`.
    pub kept: f64,
    pub games: f64,
    /// What the base strengths alone predict, as a win rate.
    pub expected: f64,
}

impl Delta {
    pub const NONE: Self = Self {
        logit: 0.0,
        variance: 0.0,
        kept: 0.0,
        games: 0.0,
        expected: 0.5,
    };

    /// Change in win rate (percentage points) around the expectation.
    pub fn points(self) -> f64 {
        (sigmoid(logit(self.expected) + self.logit) - self.expected) * 100.0
    }
}

/// Beta-binomial posterior around `expected`: `p̃ = (w + k·e) / (n + k)`,
/// delta = `logit(p̃) − logit(e)`.
pub fn shrunk_delta(evidence: Evidence, expected: f64, prior: PairPrior) -> Delta {
    let expected = expected.clamp(1e-4, 1.0 - 1e-4);
    let n = evidence.games.max(0.0);
    let w = evidence.wins.clamp(0.0, n);
    let k = prior.k;
    let posterior = (w + k * expected) / (n + k);
    let slope = expected * (1.0 - expected); // d(win rate)/d(logit) at the expectation
    let variance_wr = prior.tau * prior.tau * k / (n + k);
    Delta {
        logit: logit(posterior) - logit(expected),
        variance: variance_wr / (slope * slope),
        kept: n / (n + k),
        games: n,
        expected,
    }
}

/// Champion strength in a role, log-odds, with its uncertainty.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Base {
    pub logit: f64,
    /// log-odds²
    pub variance: f64,
    pub games: f64,
}

/// This patch's record shrunk toward the previous window's win rate.
/// `k_base` is large for unchanged champions (~20k) and small for champions changed this
/// patch (~1–2k), so patch changes show up quickly without noise taking over.
pub fn base_strength(patch: Evidence, previous_win_rate: f64, k_base: f64) -> Base {
    let prior = previous_win_rate.clamp(1e-4, 1.0 - 1e-4);
    let games = patch.games.max(0.0);
    let p = ((patch.wins.clamp(0.0, games) + k_base * prior) / (games + k_base))
        .clamp(1e-4, 1.0 - 1e-4);
    Base {
        logit: logit(p),
        // Binomial variance of the effective sample, mapped to log-odds.
        variance: 1.0 / (p * (1.0 - p) * (games + k_base)),
        games,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn p(tau: f64, k: f64) -> PairPrior {
        PairPrior { tau, k }
    }

    #[test]
    fn reproduces_the_malphite_irelia_worked_example() {
        // Research D §3.1: base 50.99% vs 50.57%, observed 55.51% over 3,244 games, k = 573.
        let expected = sigmoid(logit(0.5099) - logit(0.5057));
        let d = shrunk_delta(
            Evidence::new(3244.0, 0.5551 * 3244.0),
            expected,
            p(0.0209, 573.0),
        );
        assert!((d.points() - 4.3).abs() < 0.05, "{}", d.points());
        assert!((d.kept - 0.85).abs() < 0.01);
        // ± of about 0.8 pp (posterior SD on the win-rate scale).
        let sd_points = d.variance.sqrt() * expected * (1.0 - expected) * 100.0;
        assert!((sd_points - 0.8).abs() < 0.1, "{sd_points}");
    }

    #[test]
    fn no_games_means_no_effect() {
        let d = shrunk_delta(Evidence::default(), 0.52, p(0.02, 600.0));
        assert!(d.logit.abs() < 1e-12);
        assert!(d.kept.abs() < 1e-12);
    }

    #[test]
    fn prior_strength_follows_spread() {
        assert!((PairPrior::from_tau(0.0209).k - 572.3).abs() < 1.0);
        assert!((PairPrior::from_tau(0.0).k - PairPrior::MAX_K).abs() < f64::EPSILON);
    }

    #[test]
    fn pair_types_are_canonical() {
        assert_eq!(
            PairType::versus(Role::Middle, Role::Top),
            PairType::versus(Role::Top, Role::Middle)
        );
        assert_eq!(
            PairType::duo(Role::Support, Role::Bottom),
            PairType::Duo(Role::Bottom, Role::Support)
        );
    }

    #[test]
    fn base_strength_trusts_patch_data_more_when_k_is_small() {
        let patch = Evidence::new(2000.0, 900.0); // 45% this patch
        let unchanged = base_strength(patch, 0.52, 20_000.0);
        let changed = base_strength(patch, 0.52, 1_000.0);
        assert!(sigmoid(unchanged.logit) > sigmoid(changed.logit) && sigmoid(changed.logit) > 0.45);
        assert!(changed.variance > unchanged.variance);
    }
}
