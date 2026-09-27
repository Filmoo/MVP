use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Role;

/// What the draft helper shows during champion select. Computed by the core from the client's
/// champ-select session and the stats model; the UI only renders it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DraftView {
    pub phase: DraftPhase,
    /// Seconds left in the current phase, if known.
    pub seconds_left: Option<u32>,
    /// The local player's assigned role.
    pub my_role: Option<Role>,
    pub allies: Vec<DraftSlot>,
    pub enemies: Vec<DraftSlot>,
    pub ally_bans: Vec<u32>,
    pub enemy_bans: Vec<u32>,
    /// Our team's estimated win chance with the current picks (`None` without stats data).
    pub team: Option<Estimate>,
    /// Ranked picks for `my_role`, best first (empty without stats data).
    pub suggestions: Vec<Suggestion>,
    /// Where the stats come from (`None` until stats data is available).
    pub data: Option<DataInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DraftPhase {
    Planning,
    Banning,
    Picking,
    Finalizing,
}

/// One seat. Ranked solo/duo hides allies' identities: slots never carry player data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DraftSlot {
    /// Locked champion, or the hovered one when `hovering`.
    pub champion_id: Option<u32>,
    pub hovering: bool,
    /// Known role (allies), or the most likely one (enemies).
    pub role: Option<Role>,
    /// For enemies: probability of each likely role, most likely first (≥ 5 %).
    pub role_odds: Vec<RoleOdds>,
    pub is_me: bool,
    /// This seat is picking right now.
    pub picking: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoleOdds {
    pub role: Role,
    pub probability: f64,
}

/// A win probability with its uncertainty (one standard deviation), both in percent.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Estimate {
    pub percent: f64,
    pub plus_minus: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Suggestion {
    pub champion_id: u32,
    /// Team win chance if we pick it.
    pub estimate: Estimate,
    /// Change vs the current team, percentage points.
    pub gain: f64,
    /// Candidates in the same tier are statistically tied.
    pub tier: u32,
    /// Your own games on this champion in this role, when any.
    pub mine: Option<PersonalRecord>,
    /// Why: largest contributions first.
    pub reasons: Vec<Reason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PersonalRecord {
    pub games: u32,
    pub wins: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Reason {
    pub kind: ReasonKind,
    /// The other champion, for matchups and duos.
    pub champion_id: Option<u32>,
    /// Contribution in percentage points.
    pub points: f64,
    pub games: u32,
    /// Share of the observed effect kept after shrinkage (0–1). Low = mostly prior.
    pub kept: f64,
    /// For enemy terms: probability the enemy is in the role this term assumes.
    pub probability: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ReasonKind {
    Base,
    Lane,
    Jungle,
    Matchup,
    Duo,
}

/// Where the numbers come from, shown as a data badge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DataInfo {
    /// e.g. `Emerald+`.
    pub bracket: String,
    /// Public patch name, e.g. `26.19`.
    pub patch: String,
    pub games: u32,
    /// Unix epoch milliseconds.
    #[ts(type = "number")]
    pub updated_at: i64,
}
