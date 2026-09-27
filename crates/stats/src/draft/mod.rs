//! Stats-only draft model (no machine learning): champion strengths plus shrunk pairwise
//! matchup and synergy deltas in log-odds, averaged over unknown enemy roles, with an
//! uncertainty on everything. Design and evidence: docs/research/D-draft-helpers.md §3–4.

mod model;
mod roles;
mod score;
mod tau;

pub use model::{
    Base, ChampRole, Delta, Evidence, PairPrior, PairType, Role, base_strength, shrunk_delta,
};
pub use roles::{Assignment, Pick, assignments, role_probabilities};
pub use score::{DraftData, Evaluation, Suggestion, Term, TermKind, evaluate, suggest};
pub use tau::{PairObservation, estimate_tau};

#[cfg(test)]
mod tests;
