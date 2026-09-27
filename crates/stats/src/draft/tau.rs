//! Empirical Bayes: how much do true pair effects vary within one pair type?
//! DerSimonian–Laird method-of-moments estimate of the between-pair spread τ.

/// One observed pair: `observed` win rate over `games`, vs the `expected` win rate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PairObservation {
    pub observed: f64,
    pub games: f64,
    pub expected: f64,
}

/// τ on the win-rate scale (0 when differences are explained by sampling noise alone).
pub fn estimate_tau(pairs: &[PairObservation]) -> f64 {
    let usable: Vec<(f64, f64)> = pairs
        .iter()
        .filter(|p| p.games > 0.0 && p.expected > 0.0 && p.expected < 1.0)
        .map(|p| {
            (
                p.observed - p.expected,
                p.games / (p.expected * (1.0 - p.expected)),
            )
        })
        .collect();
    if usable.len() < 2 {
        return 0.0;
    }
    let sum_w: f64 = usable.iter().map(|(_, w)| w).sum();
    let sum_w2: f64 = usable.iter().map(|(_, w)| w * w).sum();
    let mean = usable.iter().map(|(r, w)| w * r).sum::<f64>() / sum_w;
    let q: f64 = usable.iter().map(|(r, w)| w * (r - mean).powi(2)).sum();
    let df = (usable.len() - 1) as f64;
    let c = sum_w - sum_w2 / sum_w;
    if c <= 0.0 {
        return 0.0;
    }
    ((q - df) / c).max(0.0).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic pseudo-random numbers (no extra dependency).
    struct Lcg(u64);
    impl Lcg {
        fn unit(&mut self) -> f64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((self.0 >> 11) as f64) / ((1u64 << 53) as f64)
        }
        fn normal(&mut self) -> f64 {
            // Box–Muller
            let (u1, u2) = (self.unit().max(1e-12), self.unit());
            (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
        }
    }

    fn simulate(true_tau: f64, pairs: usize, games: f64, seed: u64) -> Vec<PairObservation> {
        let mut rng = Lcg(seed);
        (0..pairs)
            .map(|_| {
                let expected = 0.5;
                let truth = (expected + true_tau * rng.normal()).clamp(0.01, 0.99);
                // Sampling noise of `games` Bernoulli trials (normal approximation).
                let noise = (truth * (1.0 - truth) / games).sqrt() * rng.normal();
                PairObservation {
                    observed: truth + noise,
                    games,
                    expected,
                }
            })
            .collect()
    }

    #[test]
    fn recovers_the_true_spread() {
        let tau = estimate_tau(&simulate(0.02, 4_000, 2_000.0, 7));
        assert!((tau - 0.02).abs() < 0.002, "{tau}");
    }

    #[test]
    fn pure_noise_gives_zero() {
        let tau = estimate_tau(&simulate(0.0, 4_000, 500.0, 11));
        assert!(tau < 0.003, "{tau}");
    }

    #[test]
    fn needs_at_least_two_pairs() {
        assert!(estimate_tau(&[]).abs() < f64::EPSILON);
    }
}
