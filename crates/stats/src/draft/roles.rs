//! Enemy (and unassigned ally) roles are unknown until the game: enumerate every consistent
//! assignment of champions to open roles, weighted by how often each champion plays each role.

use super::model::Role;

/// A picked champion whose role may be unknown.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pick {
    pub champion: u32,
    /// Share of the champion's games in each role (index = `Role::index`).
    pub role_shares: [f64; 5],
    /// Known role (own team's assigned positions, or a role the user locked).
    pub locked: Option<Role>,
}

/// One way to seat every pick in a distinct role.
#[derive(Debug, Clone, PartialEq)]
pub struct Assignment {
    /// `(champion, role)` in the order of the input picks.
    pub seats: Vec<(u32, Role)>,
    pub probability: f64,
}

/// Floor so a champion never seen in a role can still be seated there (flex surprises).
const MIN_SHARE: f64 = 1e-3;

/// All assignments, most likely first, probabilities summing to 1.
/// Empty when the picks cannot be seated (e.g. two picks locked to the same role).
pub fn assignments(picks: &[Pick]) -> Vec<Assignment> {
    let mut out = Vec::new();
    let mut seats = Vec::with_capacity(picks.len());
    seat(picks, 0, [false; 5], 1.0, &mut seats, &mut out);
    let total: f64 = out.iter().map(|a| a.probability).sum();
    if total > 0.0 {
        for a in &mut out {
            a.probability /= total;
        }
    }
    out.sort_by(|a, b| b.probability.total_cmp(&a.probability));
    out
}

fn seat(
    picks: &[Pick],
    i: usize,
    used: [bool; 5],
    weight: f64,
    seats: &mut Vec<(u32, Role)>,
    out: &mut Vec<Assignment>,
) {
    let Some(pick) = picks.get(i) else {
        out.push(Assignment {
            seats: seats.clone(),
            probability: weight,
        });
        return;
    };
    let options: Vec<Role> = match pick.locked {
        Some(role) => vec![role],
        None => Role::ALL.to_vec(),
    };
    for role in options {
        if used[role.index()] {
            continue;
        }
        let share = if pick.locked.is_some() {
            1.0
        } else {
            pick.role_shares[role.index()].max(MIN_SHARE)
        };
        let mut next = used;
        next[role.index()] = true;
        seats.push((pick.champion, role));
        seat(picks, i + 1, next, weight * share, seats, out);
        seats.pop();
    }
}

/// Probability of each pick being in each role, for the role chips.
pub fn role_probabilities(picks: &[Pick], assignments: &[Assignment]) -> Vec<[f64; 5]> {
    let mut out = vec![[0.0; 5]; picks.len()];
    for a in assignments {
        for (slot, (_, role)) in a.seats.iter().enumerate() {
            if let Some(p) = out.get_mut(slot) {
                p[role.index()] += a.probability;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pick(champion: u32, shares: [f64; 5]) -> Pick {
        Pick {
            champion,
            role_shares: shares,
            locked: None,
        }
    }

    #[test]
    fn marginalizes_over_assignments_like_the_research_example() {
        // Research D §2.9: Pantheon, Sylas, Tahm Kench — the best single assignment is unlikely.
        let picks = [
            pick(80, [0.43, 0.10, 0.10, 0.04, 0.33]),
            pick(517, [0.03, 0.49, 0.46, 0.01, 0.01]),
            pick(223, [0.38, 0.02, 0.02, 0.08, 0.50]),
        ];
        let all = assignments(&picks);
        let total: f64 = all.iter().map(|a| a.probability).sum();
        assert!((total - 1.0).abs() < 1e-9);
        assert!(
            all[0].probability < 0.5,
            "argmax must not dominate: {}",
            all[0].probability
        );
        let marginals = role_probabilities(&picks, &all);
        for m in &marginals {
            assert!((m.iter().sum::<f64>() - 1.0).abs() < 1e-9);
        }
        // Sylas splits jungle/mid.
        assert!(
            marginals[1][Role::Jungle.index()] > 0.3 && marginals[1][Role::Middle.index()] > 0.3
        );
    }

    #[test]
    fn respects_locked_roles() {
        let mut a = pick(1, [0.2; 5]);
        a.locked = Some(Role::Middle);
        let b = pick(2, [0.0, 0.0, 1.0, 0.0, 0.0]); // a mid-only champion cannot take mid now
        let all = assignments(&[a, b]);
        assert!(
            all.iter()
                .all(|x| x.seats[0].1 == Role::Middle && x.seats[1].1 != Role::Middle)
        );
    }

    #[test]
    fn impossible_locks_yield_nothing() {
        let mut a = pick(1, [0.2; 5]);
        let mut b = pick(2, [0.2; 5]);
        a.locked = Some(Role::Top);
        b.locked = Some(Role::Top);
        assert!(assignments(&[a, b]).is_empty());
    }

    #[test]
    fn five_unknown_picks_stay_cheap() {
        let picks: Vec<Pick> = (0..5).map(|c| pick(c, [0.2; 5])).collect();
        assert_eq!(assignments(&picks).len(), 120);
    }
}
