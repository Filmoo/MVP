/// Games played and games won for any slice of data (champion, matchup, duo…).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Record {
    games: u32,
    wins: u32,
}

impl Record {
    /// Returns `None` when `wins > games`.
    pub const fn new(games: u32, wins: u32) -> Option<Self> {
        if wins > games {
            None
        } else {
            Some(Self { games, wins })
        }
    }

    pub const fn games(self) -> u32 {
        self.games
    }

    pub const fn wins(self) -> u32 {
        self.wins
    }

    /// Raw win rate, `None` without games.
    pub fn win_rate(self) -> Option<f64> {
        (self.games > 0).then(|| f64::from(self.wins) / f64::from(self.games))
    }

    /// Combines two disjoint samples.
    #[must_use]
    pub const fn merge(self, other: Self) -> Self {
        Self {
            games: self.games.saturating_add(other.games),
            wins: self.wins.saturating_add(other.wins),
        }
    }
}

/// A Beta prior expressed as a mean and a strength in pseudo-games.
///
/// Small samples are pulled toward `mean`; after `strength` real games the
/// data and the prior weigh the same.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BetaPrior {
    pub mean: f64,
    pub strength: f64,
}

impl BetaPrior {
    /// Posterior mean win rate (empirical-Bayes shrinkage).
    pub fn posterior_mean(self, record: Record) -> f64 {
        (f64::from(record.wins) + self.mean * self.strength)
            / (f64::from(record.games) + self.strength)
    }
}

/// Wilson score interval for a win rate; `z = 1.96` gives ~95 % coverage.
///
/// Returns `(0.0, 1.0)` without games.
pub fn wilson_interval(record: Record, z: f64) -> (f64, f64) {
    if record.games == 0 {
        return (0.0, 1.0);
    }
    let n = f64::from(record.games);
    let p = f64::from(record.wins) / n;
    let z2 = z * z;
    let denom = 1.0 + z2 / n;
    let center = (p + z2 / (2.0 * n)) / denom;
    let half = z * (p * (1.0 - p) / n + z2 / (4.0 * n * n)).sqrt() / denom;
    ((center - half).max(0.0), (center + half).min(1.0))
}

/// Log-odds of a probability, clamped away from 0 and 1.
pub fn logit(p: f64) -> f64 {
    let p = p.clamp(1e-6, 1.0 - 1e-6);
    (p / (1.0 - p)).ln()
}

/// Inverse of [`logit`].
pub fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const EPS: f64 = 1e-9;

    #[test]
    fn rejects_more_wins_than_games() {
        assert_eq!(Record::new(3, 4), None);
        assert_eq!(Record::new(0, 0).and_then(Record::win_rate), None);
    }

    #[test]
    fn shrinks_small_samples_toward_the_prior() {
        let prior = BetaPrior {
            mean: 0.5,
            strength: 100.0,
        };
        let lucky = Record::new(3, 3).expect("valid");
        let wr = prior.posterior_mean(lucky);
        assert!(
            wr > 0.5 && wr < 0.52,
            "3/3 must barely move a strong prior: {wr}"
        );

        let big = Record::new(100_000, 55_000).expect("valid");
        assert!((prior.posterior_mean(big) - 0.55).abs() < 1e-3);
    }

    #[test]
    fn wilson_matches_reference_values() {
        // Reference: 50 wins / 100 games, z = 1.96 → [0.4038, 0.5962]
        let (lo, hi) = wilson_interval(Record::new(100, 50).expect("valid"), 1.96);
        assert!((lo - 0.4038).abs() < 1e-4 && (hi - 0.5962).abs() < 1e-4);
    }

    /// Any valid record: `games` in range, `wins <= games`.
    fn records() -> impl Strategy<Value = Record> {
        (1u32..1_000_000).prop_flat_map(|games| {
            (0..=games).prop_map(move |wins| Record::new(games, wins).expect("wins <= games"))
        })
    }

    proptest! {
        #[test]
        fn posterior_lies_between_prior_and_observed(r in records(), mean in 0.01f64..0.99, strength in 0.1f64..10_000.0) {
            let observed = r.win_rate().expect("has games");
            let post = BetaPrior { mean, strength }.posterior_mean(r);
            prop_assert!(post >= observed.min(mean) - EPS && post <= observed.max(mean) + EPS);
        }

        #[test]
        fn wilson_contains_the_observed_rate(r in records()) {
            let (lo, hi) = wilson_interval(r, 1.96);
            let p = r.win_rate().expect("has games");
            prop_assert!((0.0..=1.0).contains(&lo) && (0.0..=1.0).contains(&hi));
            prop_assert!(lo <= p + EPS && p <= hi + EPS);
        }

        #[test]
        fn logit_and_sigmoid_are_inverse(p in 0.001f64..0.999) {
            prop_assert!((sigmoid(logit(p)) - p).abs() < 1e-9);
        }
    }
}
