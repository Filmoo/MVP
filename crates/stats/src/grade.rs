//! MVP's own grade of one finished game (docs/architecture.md, "Match insights").
//!
//! Each of the ten players is scored against the others in that game and against their lane
//! opponent, with weights that depend on the role. Every part starts from a fact of the
//! post-game scoreboard that the player can check (31 % of the team's damage, 72 % kill
//! participation, 18 CS more than the lane opponent…), compared with a reference and scaled
//! to [−1, 1]:
//!
//! | Part | Fact | Reference | ±1 at |
//! | --- | --- | --- | --- |
//! | kill participation | (kills + assists) / team kills | the team's average, shifted by what the role usually does | ±25 points |
//! | KDA | (kills + assists) / deaths (at least one) | the other nine players' KDA together | ×4 or ÷4 |
//! | damage, damage taken, objectives, vision | share of the team's total | the role's typical share | ±10 points (objectives ±15) |
//! | CS, gold | difference with the lane opponent, per minute | even | ±1.5 CS, ±100 gold |
//!
//! The score is `5 + 5 ×` the weighted mean of the parts (0–10, 5 is an even game for the
//! role); a part that doesn't exist in a game (no lane opponent in ARAM, a team without kills)
//! leaves the mean. It rates one game, not a player: no MMR, no rank estimate.
//!
//! The references and letter cut-offs are first estimates (typical Emerald+ shares by role):
//! calibrate them on crawled games so that every role averages 5.

use std::cmp::Ordering;

use domain::{GradeBadge, GradeFactor, GradeFactorKind, GradeLetter, MatchGrade, Role};

/// Games this short or shorter are remakes: no grade (the UI's `REMAKE_MAX_SECONDS`).
pub const REMAKE_MAX_SECONDS: u32 = 300;

/// Players per team in a graded game.
pub const TEAM_SIZE: usize = 5;

/// One player's end-of-game numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LobbyPlayer {
    /// Riot's team id (100 blue side, 200 red side).
    pub team: u32,
    pub win: bool,
    /// `None` when the game has no roles (ARAM) or the role isn't known.
    pub role: Option<Role>,
    pub champion_id: u32,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    /// Lane minions + neutral monsters.
    pub creep_score: u32,
    pub gold: u32,
    pub damage_to_champions: u32,
    /// Damage taken plus damage self-mitigated.
    pub damage_taken: u32,
    pub vision_score: u32,
    /// Damage to buildings and epic monsters (Riot's "damage to objectives").
    pub objective_damage: u32,
}

/// One finished game: what both data sources (the League client's match history, Match-V5)
/// map into.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Lobby {
    pub duration_seconds: u32,
    pub players: Vec<LobbyPlayer>,
}

/// The parts, in the order of the weight and reference tables below.
const KINDS: [GradeFactorKind; 8] = [
    GradeFactorKind::KillParticipation,
    GradeFactorKind::Kda,
    GradeFactorKind::DamageShare,
    GradeFactorKind::DamageTakenShare,
    GradeFactorKind::ObjectiveShare,
    GradeFactorKind::VisionShare,
    GradeFactorKind::CsLead,
    GradeFactorKind::GoldLead,
];

/// Weight of each part (order of `KINDS`) by role; each row sums to 1. Vision counts most for
/// supports and CS not at all; kill participation, KDA and damage share count for everyone.
const fn weights(role: Option<Role>) -> [f64; 8] {
    match role {
        Some(Role::Top) => [0.15, 0.20, 0.20, 0.10, 0.10, 0.05, 0.10, 0.10],
        Some(Role::Jungle) => [0.20, 0.20, 0.15, 0.10, 0.15, 0.10, 0.05, 0.05],
        Some(Role::Middle) => [0.15, 0.20, 0.25, 0.00, 0.05, 0.05, 0.15, 0.15],
        Some(Role::Bottom) => [0.15, 0.20, 0.25, 0.00, 0.10, 0.05, 0.15, 0.10],
        Some(Role::Support) => [0.25, 0.20, 0.10, 0.10, 0.00, 0.30, 0.00, 0.05],
        // ARAM and unknown roles: no lane opponent, little vision.
        None => [0.25, 0.25, 0.30, 0.15, 0.05, 0.00, 0.00, 0.00],
    }
}

/// The role's typical share of its team's damage, damage taken, objective damage and vision
/// score (each column sums to 1 over the five roles).
const fn typical_shares(role: Option<Role>) -> [f64; 4] {
    match role {
        Some(Role::Top) => [0.22, 0.24, 0.20, 0.14],
        Some(Role::Jungle) => [0.17, 0.23, 0.32, 0.20],
        Some(Role::Middle) => [0.25, 0.17, 0.15, 0.14],
        Some(Role::Bottom) => [0.27, 0.15, 0.25, 0.16],
        Some(Role::Support) => [0.09, 0.21, 0.08, 0.36],
        None => [0.2; 4],
    }
}

/// How far the role's kill participation usually sits from its team's average.
const fn kill_participation_offset(role: Option<Role>) -> f64 {
    match role {
        Some(Role::Top) => -0.08,
        Some(Role::Jungle | Role::Support) => 0.05,
        Some(Role::Bottom) => -0.01,
        Some(Role::Middle) | None => 0.0,
    }
}

/// Kill participation this far from the reference is worth ±1.
const KILL_PARTICIPATION_SCALE: f64 = 0.25;
/// A KDA 2² = 4 times (or a quarter of) the others' is worth ±1.
const KDA_SCALE_LOG2: f64 = 2.0;
/// KDAs below this count as this (a game without kills or assists isn't infinitely bad).
const KDA_FLOOR: f64 = 0.25;
/// Shares this far from the role's typical share are worth ±1: damage, damage taken,
/// objectives, vision.
const SHARE_SCALES: [f64; 4] = [0.10, 0.10, 0.15, 0.10];
/// Creeps and gold per minute ahead of (or behind) the lane opponent worth ±1.
const CS_PER_MINUTE_SCALE: f64 = 1.5;
const GOLD_PER_MINUTE_SCALE: f64 = 100.0;

/// Letter cut-offs on the shown score.
const LETTERS: [(f64, GradeLetter); 4] = [
    (8.5, GradeLetter::SPlus),
    (7.5, GradeLetter::S),
    (6.0, GradeLetter::A),
    (4.0, GradeLetter::B),
];

/// A third factor is shown only when it moved the score at least this much.
const THIRD_FACTOR_MIN_POINTS: f64 = 0.15;

/// The letter of a (shown) score.
pub fn letter(score: f64) -> GradeLetter {
    LETTERS
        .iter()
        .find(|(cut, _)| score >= *cut)
        .map_or(GradeLetter::C, |&(_, letter)| letter)
}

/// One part of one player's grade: the checkable fact and where it stands in [−1, 1].
#[derive(Debug, Clone, Copy)]
struct Part {
    fact: f64,
    level: f64,
}

fn clamp_unit(x: f64) -> f64 {
    x.clamp(-1.0, 1.0)
}

fn ratio(part: u64, whole: u64) -> Option<f64> {
    (whole > 0).then(|| part as f64 / whole as f64)
}

fn takedowns(p: &LobbyPlayer) -> u64 {
    u64::from(p.kills) + u64::from(p.assists)
}

fn kda(p: &LobbyPlayer) -> f64 {
    takedowns(p) as f64 / f64::from(p.deaths.max(1))
}

/// The grades of a finished game, in the lobby's order; `None` for remakes and anything but
/// two teams of five where exactly one team won.
pub fn grade(lobby: &Lobby) -> Option<Vec<MatchGrade>> {
    let players = &lobby.players;
    if lobby.duration_seconds <= REMAKE_MAX_SECONDS || !two_teams(players) {
        return None;
    }
    let minutes = f64::from(lobby.duration_seconds) / 60.0;
    let scored: Vec<Scored> = (0..players.len())
        .map(|i| score(players, i, minutes))
        .collect();

    // Best first; exact ties go to more kills + assists, more damage, then list order.
    let mut order: Vec<usize> = (0..players.len()).collect();
    order.sort_by(|&a, &b| better(players, &scored, a, b));
    let mut place = vec![0_u32; players.len()];
    for (rank, &i) in (1_u32..).zip(&order) {
        place[i] = rank;
    }
    let best_of = |win: bool| order.iter().copied().find(|&i| players[i].win == win);
    let (mvp, ace) = (best_of(true), best_of(false));

    Some(
        scored
            .into_iter()
            .enumerate()
            .map(|(i, s)| {
                let shown = (s.score * 10.0).round() / 10.0;
                MatchGrade {
                    score: shown,
                    letter: letter(shown),
                    place: place[i],
                    badge: if Some(i) == mvp {
                        Some(GradeBadge::Mvp)
                    } else if Some(i) == ace {
                        Some(GradeBadge::Ace)
                    } else {
                        None
                    },
                    factors: s.factors,
                }
            })
            .collect(),
    )
}

/// Two teams of five, one of which won.
fn two_teams(players: &[LobbyPlayer]) -> bool {
    let Some(first) = players.first() else {
        return false;
    };
    let (ours, theirs): (Vec<&LobbyPlayer>, Vec<&LobbyPlayer>) =
        players.iter().partition(|p| p.team == first.team);
    let one_result = |team: &[&LobbyPlayer], win: bool| team.iter().all(|p| p.win == win);
    ours.len() == TEAM_SIZE
        && theirs.len() == TEAM_SIZE
        && theirs.iter().all(|p| p.team == theirs[0].team)
        && one_result(&ours, first.win)
        && one_result(&theirs, !first.win)
}

fn better(players: &[LobbyPlayer], scored: &[Scored], a: usize, b: usize) -> Ordering {
    let (pa, pb) = (&players[a], &players[b]);
    scored[b]
        .score
        .total_cmp(&scored[a].score)
        .then_with(|| takedowns(pb).cmp(&takedowns(pa)))
        .then(pb.damage_to_champions.cmp(&pa.damage_to_champions))
        .then(a.cmp(&b))
}

struct Scored {
    /// Unrounded, for the order of places.
    score: f64,
    factors: Vec<GradeFactor>,
}

fn score(players: &[LobbyPlayer], i: usize, minutes: f64) -> Scored {
    let me = &players[i];
    let parts = parts(players, i, minutes);
    let weights = weights(me.role);
    let used: Vec<(usize, Part)> = parts
        .iter()
        .enumerate()
        .filter(|&(k, _)| weights[k] > 0.0)
        .filter_map(|(k, part)| part.map(|p| (k, p)))
        .collect();
    let total: f64 = used.iter().map(|&(k, _)| weights[k]).sum();
    if total <= 0.0 {
        return Scored {
            score: 5.0,
            factors: Vec::new(),
        };
    }
    // Points on the 0–10 scale: they add up to `score − 5`.
    let mut points: Vec<(usize, Part, f64)> = used
        .into_iter()
        .map(|(k, part)| (k, part, 5.0 * weights[k] * part.level / total))
        .collect();
    let score = (5.0 + points.iter().map(|&(_, _, p)| p).sum::<f64>()).clamp(0.0, 10.0);
    points.sort_by(|a, b| b.2.abs().total_cmp(&a.2.abs()).then(a.0.cmp(&b.0)));
    let shown = match points.get(2) {
        Some(third) if third.2.abs() >= THIRD_FACTOR_MIN_POINTS => 3,
        _ => 2,
    };
    let factors = points
        .into_iter()
        .take(shown)
        .map(|(k, part, p)| GradeFactor {
            kind: KINDS[k],
            value: round_fact(KINDS[k], part.fact),
            points: (p * 100.0).round() / 100.0,
        })
        .collect();
    Scored { score, factors }
}

/// Shares to 0.1 %, KDA to two decimals, leads are whole numbers already.
fn round_fact(kind: GradeFactorKind, fact: f64) -> f64 {
    let scale = match kind {
        GradeFactorKind::Kda => 100.0,
        GradeFactorKind::CsLead | GradeFactorKind::GoldLead => 1.0,
        _ => 1000.0,
    };
    (fact * scale).round() / scale
}

/// Player `i`'s parts in the order of `KINDS`; `None` where the game has no such part.
fn parts(players: &[LobbyPlayer], i: usize, minutes: f64) -> [Option<Part>; 8] {
    let me = &players[i];
    let team: Vec<&LobbyPlayer> = players.iter().filter(|p| p.team == me.team).collect();
    let typical = typical_shares(me.role);
    let share = |value: fn(&LobbyPlayer) -> u32, column: usize| -> Option<Part> {
        let total = team.iter().map(|p| u64::from(value(p))).sum::<u64>();
        let fact = ratio(u64::from(value(me)), total)?;
        Some(Part {
            fact,
            level: clamp_unit((fact - typical[column]) / SHARE_SCALES[column]),
        })
    };
    let opponent = lane_opponent(players, i);
    let lead = |value: fn(&LobbyPlayer) -> u32, scale: f64| -> Option<Part> {
        let them = opponent?;
        let fact = f64::from(value(me)) - f64::from(value(them));
        Some(Part {
            fact,
            level: clamp_unit(fact / minutes / scale),
        })
    };
    [
        kill_participation(&team, me),
        Some(kda_part(players, i)),
        share(|p| p.damage_to_champions, 0),
        share(|p| p.damage_taken, 1),
        share(|p| p.objective_damage, 2),
        share(|p| p.vision_score, 3),
        lead(|p| p.creep_score, CS_PER_MINUTE_SCALE),
        lead(|p| p.gold, GOLD_PER_MINUTE_SCALE),
    ]
}

/// (Kills + assists) over the team's kills, against the team's average (shifted by what the
/// role usually does).
fn kill_participation(team: &[&LobbyPlayer], me: &LobbyPlayer) -> Option<Part> {
    let team_kills = team.iter().map(|p| u64::from(p.kills)).sum::<u64>();
    let of = |p: &LobbyPlayer| ratio(takedowns(p), team_kills).map(|r| r.min(1.0));
    let fact = of(me)?;
    let average = team.iter().filter_map(|p| of(p)).sum::<f64>() / team.len() as f64;
    Some(Part {
        fact,
        level: clamp_unit(
            (fact - average - kill_participation_offset(me.role)) / KILL_PARTICIPATION_SCALE,
        ),
    })
}

/// KDA against the other nine players' together (kills + assists over deaths).
fn kda_part(players: &[LobbyPlayer], i: usize) -> Part {
    let me = &players[i];
    let (others_takedowns, others_deaths) = players
        .iter()
        .enumerate()
        .filter(|&(j, _)| j != i)
        .fold((0_u64, 0_u64), |(t, d), (_, p)| {
            (t + takedowns(p), d + u64::from(p.deaths))
        });
    let others = others_takedowns as f64 / others_deaths.max(1) as f64;
    let fact = kda(me);
    Part {
        fact,
        level: clamp_unit((fact.max(KDA_FLOOR) / others.max(KDA_FLOOR)).log2() / KDA_SCALE_LOG2),
    }
}

/// The enemy in the same role, when each team has exactly one player in it.
fn lane_opponent(players: &[LobbyPlayer], i: usize) -> Option<&LobbyPlayer> {
    let me = &players[i];
    let role = me.role?;
    let same = |team: u32| {
        players
            .iter()
            .filter(move |p| p.team == team && p.role == Some(role))
    };
    if same(me.team).count() != 1 {
        return None;
    }
    let mut theirs = players
        .iter()
        .filter(|p| p.team != me.team && p.role == Some(role));
    match (theirs.next(), theirs.next()) {
        (Some(them), None) => Some(them),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
