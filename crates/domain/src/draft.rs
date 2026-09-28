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
    /// Seconds left in the current phase when the client took its timer snapshot, if known.
    pub seconds_left: Option<u32>,
    /// When the current phase's timer runs out, Unix epoch milliseconds on this PC's clock.
    /// The client sends its timer again only when the session changes, so the UI counts down
    /// to this. `None` when unknown or endless.
    #[ts(type = "number | null")]
    pub phase_ends_at: Option<i64>,
    /// The local player's assigned role.
    pub my_role: Option<Role>,
    pub allies: Vec<DraftSlot>,
    pub enemies: Vec<DraftSlot>,
    pub ally_bans: Vec<u32>,
    pub enemy_bans: Vec<u32>,
    /// Our team's estimated win chance with the current picks (`None` without stats data).
    pub team: Option<Estimate>,
    /// Ranked picks for `my_role`, best first (empty without stats data). In ARAM: your
    /// champion and the bench's, by the team's win chance with each (none is ever swapped for you).
    pub suggestions: Vec<Suggestion>,
    /// Where the stats come from (`None` until stats data is available).
    pub data: Option<DataInfo>,
    /// The stats queue of this champion select: 420 (Summoner's Rift, ranked data) or 450
    /// (ARAM); `None` until known, and for modes without stats.
    pub queue: Option<u32>,
    /// Champions on the bench, anyone on your team can take one (ARAM); `None` in modes
    /// without a bench.
    pub bench: Option<Vec<u32>>,
    /// Rerolls you have left, when the mode allows rerolling.
    pub rerolls: Option<u32>,
    /// Both teams' compositions (`None` without composition stats).
    pub comps: Option<Compositions>,
}

/// Each team's composition from its champions' usual numbers in their roles (informational:
/// not part of the win estimate).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Compositions {
    pub allies: TeamComp,
    pub enemies: TeamComp,
    /// Upper bounds of the game-length buckets of [`TeamComp::lengths`], in minutes (`[25, 35]`:
    /// under 25, 25 to 35, 35 and more).
    pub lengths: Vec<u32>,
}

/// A team's composition: what its champions usually bring, summed up, and short neutral
/// readings of it (the UI words them).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TeamComp {
    /// The champions counted, in seat order: locked picks and hovers (`hovering`). Empty in a
    /// suggestion's composition (the team's champions with the pick).
    pub members: Vec<CompMember>,
    /// Champions with composition stats: the numbers are theirs.
    pub counted: u32,
    /// Shares of the team's damage to champions.
    pub damage: DamageMix,
    /// Damage taken and mitigated: the champions' usual shares of their team's, summed, over
    /// what usual picks in their roles take (1 = usual).
    pub frontline: f64,
    /// Crowd control (`timeCCingOthers`) per game, summed, in seconds…
    pub cc: f64,
    /// … and what usual picks in their roles bring.
    pub cc_usual: f64,
    /// Per game-length bucket: how much more (or less) often the champions win games of that
    /// length than their usual win rate, summed, in points (shrunk when games are few).
    pub lengths: Vec<f64>,
    /// The fewest games behind a counted champion's numbers.
    pub games: u32,
    pub readings: Vec<CompReading>,
}

/// One champion of a composition, with its usual numbers (per game, in its role or likely roles).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CompMember {
    pub champion_id: u32,
    pub hovering: bool,
    /// Games behind its numbers (0: no composition stats for it yet).
    pub games: u32,
    /// Shares of its damage to champions.
    pub damage: DamageMix,
    /// Its share of its team's damage taken and mitigated (0–1).
    pub frontline: f64,
    /// Its crowd control per game, in seconds.
    pub cc: f64,
}

/// Shares of damage to champions by type (0–1, adding up to 1; all 0 without damage).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DamageMix {
    pub physical: f64,
    pub magic: f64,
    pub true_damage: f64,
}

/// A short neutral reading of a composition; the numbers behind it are in its [`TeamComp`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CompReading {
    /// Most of the damage is physical…
    MostlyPhysical,
    /// … or magic.
    MostlyMagic,
    /// Much less damage soaked than usual picks in these roles…
    LittleFrontline,
    /// … or much more.
    LotsOfFrontline,
    /// Much less crowd control than usual picks…
    LittleCc,
    /// … or much more.
    LotsOfCc,
    /// Its champions win more of their short games than of their long ones…
    Early,
    /// … or of their long games.
    Late,
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
    /// Your mastery of this champion, when you have any (the pool the list starts from).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mastery: Option<Mastery>,
    /// Why: largest contributions first.
    pub reasons: Vec<Reason>,
    /// Your team's composition with this pick (in your seat), when composition stats are there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comp: Option<TeamComp>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PersonalRecord {
    pub games: u32,
    pub wins: u32,
}

/// The local player's champion mastery, as the League client reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Mastery {
    pub level: u32,
    pub points: u32,
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
    /// 420 (ranked solo/duo data) or 450 (ARAM).
    pub queue: u32,
    /// e.g. `Emerald+`.
    pub bracket: String,
    /// Public patch name, e.g. `26.19`.
    pub patch: String,
    pub games: u32,
    /// Unix epoch milliseconds.
    #[ts(type = "number")]
    pub updated_at: i64,
}
