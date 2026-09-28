//! Team score (log-odds additive model) and pick ranking.
//!
//! `S = Σ β(ally) − Σ β(enemy) + Σ δ_vs(ally, enemy) + Σ δ_duo(ally pairs) − Σ δ_duo(enemy pairs)`,
//! `P(win) = σ(S)`, taken in expectation over the possible role assignments.

use std::collections::HashMap;
use std::collections::hash_map::Entry;

use super::model::{Base, ChampRole, Delta, Evidence, PairPrior, PairType, Role, shrunk_delta};
use super::roles::{Pick, assignments};
use crate::{logit, sigmoid};

/// Aggregated statistics the model reads. Implemented over downloaded stats tables.
pub trait DraftData {
    /// Champion strength in the role, `None` without data.
    fn base(&self, c: ChampRole) -> Option<Base>;
    /// `a`'s record against `b` (both perspectives averaged by the implementor).
    fn versus(&self, a: ChampRole, b: ChampRole) -> Evidence;
    /// Record of `a` and `b` on the same team.
    fn duo(&self, a: ChampRole, b: ChampRole) -> Evidence;
    fn prior(&self, pair: PairType) -> PairPrior;
    /// Strength assumed without data: off-role picks win ~47%, and we're unsure (±5 pp).
    fn fallback_base(&self) -> Base {
        Base {
            logit: logit(0.47),
            variance: 0.2 * 0.2,
            games: 0.0,
        }
    }
}

/// How a term is grouped in the explanation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TermKind {
    Base,
    /// Same lane, including the 2v2 bot lane (bot/support vs bot/support).
    Lane,
    /// Involves a jungler.
    Jungle,
    OtherMatchup,
    Duo,
}

/// One contribution to a score, averaged over role assignments.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Term {
    pub kind: TermKind,
    /// Our side's champion, or the enemy's for their own base/duo terms.
    pub subject: ChampRole,
    pub other: Option<ChampRole>,
    /// Signed contribution to our score (log-odds), weighted by `probability`.
    pub value: f64,
    pub variance: f64,
    pub games: f64,
    pub kept: f64,
    /// Probability of the role assignment(s) this term comes from.
    pub probability: f64,
    pub enemy_side: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    /// Expected score (log-odds).
    pub score: f64,
    /// Standard deviation of the score (log-odds): evidence uncertainty + role uncertainty.
    pub sd: f64,
    pub terms: Vec<Term>,
}

impl Evaluation {
    pub fn win_probability(&self) -> f64 {
        sigmoid(self.score)
    }
}

fn lane_kind(a: Role, b: Role) -> TermKind {
    use Role::{Bottom, Jungle, Support};
    if a == b || matches!((a, b), (Bottom, Support) | (Support, Bottom)) {
        TermKind::Lane
    } else if a == Jungle || b == Jungle {
        TermKind::Jungle
    } else {
        TermKind::OtherMatchup
    }
}

/// Scores `allies` (roles known) against `enemies` (roles possibly unknown).
/// Returns `None` when the enemy picks cannot be seated consistently.
pub fn evaluate(
    data: &impl DraftData,
    allies: &[ChampRole],
    enemies: &[Pick],
) -> Option<Evaluation> {
    let seatings = if enemies.is_empty() {
        vec![super::roles::Assignment {
            seats: Vec::new(),
            probability: 1.0,
        }]
    } else {
        assignments(enemies)
    };
    if seatings.is_empty() {
        return None;
    }
    let base = |c: ChampRole| data.base(c).unwrap_or_else(|| data.fallback_base());
    let base_delta = |b: Base| Delta {
        logit: b.logit,
        variance: b.variance,
        kept: 1.0,
        games: b.games,
        expected: 0.5,
    };

    let mut terms = Vec::new();
    // Ally-only terms don't depend on enemy roles.
    for &a in allies {
        let b = base(a);
        terms.push(term(
            TermKind::Base,
            a,
            None,
            b.logit,
            &base_delta(b),
            1.0,
            false,
        ));
    }
    for (i, &a) in allies.iter().enumerate() {
        for &b in &allies[i + 1..] {
            let d = duo_delta(data, a, b);
            terms.push(term(TermKind::Duo, a, Some(b), d.logit, &d, 1.0, false));
        }
    }

    let mut mean = terms.iter().map(|t| t.value).sum::<f64>();
    let fixed_variance: f64 = terms.iter().map(|t| t.variance).sum();
    let (mut expected_enemy, mut second_moment, mut enemy_variance) = (0.0, 0.0, 0.0);

    for seating in &seatings {
        let p = seating.probability;
        let seats: Vec<ChampRole> = seating
            .seats
            .iter()
            .map(|&(champion, role)| ChampRole { champion, role })
            .collect();
        let mut s = 0.0;
        let mut v = 0.0;
        for &e in &seats {
            let b = base(e);
            s -= b.logit;
            v += b.variance;
            terms.push(term(
                TermKind::Base,
                e,
                None,
                -b.logit * p,
                &base_delta(b),
                p,
                true,
            ));
        }
        for (i, &e) in seats.iter().enumerate() {
            for &f in &seats[i + 1..] {
                let d = duo_delta(data, e, f);
                s -= d.logit;
                v += d.variance;
                terms.push(term(TermKind::Duo, e, Some(f), -d.logit * p, &d, p, true));
            }
        }
        for &a in allies {
            for &e in &seats {
                let d = versus_delta(data, a, e);
                s += d.logit;
                v += d.variance;
                terms.push(term(
                    lane_kind(a.role, e.role),
                    a,
                    Some(e),
                    d.logit * p,
                    &d,
                    p,
                    false,
                ));
            }
        }
        expected_enemy += p * s;
        second_moment += p * s * s;
        enemy_variance += p * v;
    }
    mean += expected_enemy;
    let role_variance = (second_moment - expected_enemy * expected_enemy).max(0.0);
    Some(Evaluation {
        score: mean,
        sd: (fixed_variance + enemy_variance + role_variance).sqrt(),
        terms: merge(terms),
    })
}

fn term(
    kind: TermKind,
    subject: ChampRole,
    other: Option<ChampRole>,
    value: f64,
    d: &Delta,
    probability: f64,
    enemy_side: bool,
) -> Term {
    Term {
        kind,
        subject,
        other,
        value,
        variance: d.variance * probability,
        games: d.games,
        kept: d.kept,
        probability,
        enemy_side,
    }
}

/// Same term from several role assignments → one row with summed weight, in first-seen order.
/// Hashed: five enemies with unknown roles give thousands of terms per evaluation.
fn merge(terms: Vec<Term>) -> Vec<Term> {
    let mut out: Vec<Term> = Vec::with_capacity(terms.len() / 8);
    let mut at: HashMap<(TermKind, ChampRole, Option<ChampRole>, bool), usize> = HashMap::new();
    for t in terms {
        match at.entry((t.kind, t.subject, t.other, t.enemy_side)) {
            Entry::Occupied(slot) => {
                if let Some(existing) = out.get_mut(*slot.get()) {
                    existing.value += t.value;
                    existing.variance += t.variance;
                    existing.probability += t.probability;
                }
            }
            Entry::Vacant(slot) => {
                slot.insert(out.len());
                out.push(t);
            }
        }
    }
    out
}

fn versus_delta(data: &impl DraftData, a: ChampRole, b: ChampRole) -> Delta {
    let base = |c| data.base(c).unwrap_or_else(|| data.fallback_base()).logit;
    let expected = sigmoid(base(a) - base(b));
    shrunk_delta(
        data.versus(a, b),
        expected,
        data.prior(PairType::versus(a.role, b.role)),
    )
}

fn duo_delta(data: &impl DraftData, a: ChampRole, b: ChampRole) -> Delta {
    let base = |c| data.base(c).unwrap_or_else(|| data.fallback_base()).logit;
    let expected = sigmoid(base(a) + base(b));
    shrunk_delta(
        data.duo(a, b),
        expected,
        data.prior(PairType::duo(a.role, b.role)),
    )
}

/// A ranked suggestion for the local player's role.
#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    pub champion: u32,
    pub evaluation: Evaluation,
    /// Change in win probability (percentage points) vs the team without this pick.
    pub gain_points: f64,
    /// Candidates whose score is within one SD of their tier's first candidate share a tier.
    pub tier: usize,
}

/// Ranks `candidates` for `my_role`, given the current allies and enemies.
pub fn suggest(
    data: &impl DraftData,
    my_role: Role,
    allies: &[ChampRole],
    enemies: &[Pick],
    candidates: &[u32],
) -> Vec<Suggestion> {
    let Some(current) = evaluate(data, allies, enemies) else {
        return Vec::new();
    };
    let current_p = current.win_probability();
    let mut out: Vec<Suggestion> = candidates
        .iter()
        .filter_map(|&champion| {
            let mut team = allies.to_vec();
            team.push(ChampRole {
                champion,
                role: my_role,
            });
            let evaluation = evaluate(data, &team, enemies)?;
            Some(Suggestion {
                champion,
                gain_points: (evaluation.win_probability() - current_p) * 100.0,
                evaluation,
                tier: 0,
            })
        })
        .collect();
    out.sort_by(|a, b| b.evaluation.score.total_cmp(&a.evaluation.score));
    let mut tier = 0;
    let mut head: Option<(f64, f64)> = None;
    for s in &mut out {
        match head {
            Some((score, sd)) if score - s.evaluation.score <= sd.max(s.evaluation.sd) => {}
            _ => {
                if head.is_some() {
                    tier += 1;
                }
                head = Some((s.evaluation.score, s.evaluation.sd));
            }
        }
        s.tier = tier;
    }
    out
}
