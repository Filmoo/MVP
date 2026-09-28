//! Team compositions over the published `compositions.json`: what each champion usually brings
//! in its role — damage mix, frontline (its share of the team's damage taken and mitigated),
//! crowd control, and how its win rate moves with the game's length — summed up per team, with
//! short neutral readings the UI words. Informational only: none of it enters the win estimate.
//!
//! - **Roles**: allies count in their assigned role, enemies over their likely roles (weighted
//!   by probability), ARAM champions without one. A champion without numbers in those roles is
//!   listed but not counted.
//! - **Frontline** is compared with usual picks in the same roles (each role's average share in
//!   the file), so a team of three reads the same as a full one: 1 = usual.
//! - **Game length**: each bucket's record is shrunk toward the champion's own win rate with
//!   [`LENGTH_PRIOR_GAMES`], then the change is summed over the team, in points.
//! - **Readings** wait for [`READINGS_FROM`] counted champions and only describe (thresholds
//!   below): mostly one damage type, little or lots of frontline or crowd control, stronger in
//!   short or long games.

use std::collections::HashMap;

use domain::{
    CompMember, CompReading, CompositionStats, CompositionsFile, DamageMix, Role, TeamComp,
};

/// Pseudo-games at the champion's own win rate each game-length record is shrunk with.
pub const LENGTH_PRIOR_GAMES: f64 = 1_000.0;
/// A damage type with at least this share of the team's damage makes it "mostly" that type.
pub const MOSTLY: f64 = 0.7;
/// Frontline (1 = usual picks in these roles) under this reads as little…
pub const LITTLE_FRONTLINE: f64 = 0.85;
/// … and over this as lots.
pub const LOTS_OF_FRONTLINE: f64 = 1.15;
/// Crowd control under this share of the usual picks' reads as little…
pub const LITTLE_CC: f64 = 0.7;
/// … and over this as lots.
pub const LOTS_OF_CC: f64 = 1.3;
/// Points more won in long games than in short ones (or the reverse) that read as a lean.
pub const LEAN_POINTS: f64 = 3.0;
/// Readings wait for this many champions with numbers.
pub const READINGS_FROM: u32 = 3;

/// Where a champion plays: its role and the probability of it (one role at 1 for allies, the
/// likely roles for enemies, `None` in ARAM).
pub type RoleMix = Vec<(Option<Role>, f64)>;

/// A champion in a team, for its composition.
#[derive(Debug, Clone, PartialEq)]
pub struct Seat {
    pub champion: u32,
    pub hovering: bool,
    pub roles: RoleMix,
}

/// One champion in one role (or a whole role), as the model reads it.
#[derive(Debug, Clone, PartialEq, Default)]
struct Row {
    games: f64,
    /// Damage to champions per minute: physical, magic, true.
    dmg: [f64; 3],
    front: f64,
    cc: f64,
    /// Change of the win rate in each game-length bucket, points (shrunk).
    lengths: Vec<f64>,
}

impl Row {
    fn new(s: &CompositionStats, buckets: usize) -> Self {
        let (games, wins) = s.len.iter().fold((0u64, 0u64), |(g, w), &(bg, bw)| {
            (g + u64::from(bg), w + u64::from(bw))
        });
        let usual = if games > 0 {
            wins as f64 / games as f64
        } else {
            0.5
        };
        let lengths = (0..buckets)
            .map(|b| {
                let (g, w) = s.len.get(b).copied().unwrap_or_default();
                let shrunk = (f64::from(w.min(g)) + LENGTH_PRIOR_GAMES * usual)
                    / (f64::from(g) + LENGTH_PRIOR_GAMES);
                (shrunk - usual) * 100.0
            })
            .collect();
        Self {
            games: f64::from(s.n),
            dmg: s.dmg.map(|d| if d.is_finite() { d.max(0.0) } else { 0.0 }),
            front: s.front.clamp(0.0, 1.0),
            cc: s.cc.max(0.0),
            lengths,
        }
    }

    /// Adds `weight` × `other`.
    fn add(&mut self, other: &Self, weight: f64) {
        self.games += weight * other.games;
        for (a, b) in self.dmg.iter_mut().zip(other.dmg) {
            *a += weight * b;
        }
        self.front += weight * other.front;
        self.cc += weight * other.cc;
        if self.lengths.len() < other.lengths.len() {
            self.lengths.resize(other.lengths.len(), 0.0);
        }
        for (a, b) in self.lengths.iter_mut().zip(&other.lengths) {
            *a += weight * b;
        }
    }
}

fn round(x: f64, digits: i32) -> f64 {
    let f = 10f64.powi(digits);
    (x * f).round() / f
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "rounded and clamped to u32's range first"
)]
fn count(x: f64) -> u32 {
    if x.is_finite() && x > 0.0 {
        x.round().min(f64::from(u32::MAX)) as u32
    } else {
        0
    }
}

fn mix(dmg: [f64; 3]) -> DamageMix {
    let total: f64 = dmg.iter().sum();
    if total <= 0.0 {
        return DamageMix::default();
    }
    DamageMix {
        physical: round(dmg[0] / total, 3),
        magic: round(dmg[1] / total, 3),
        true_damage: round(dmg[2] / total, 3),
    }
}

/// What each champion brings to a team composition, from one published file.
#[derive(Debug, Clone, Default)]
pub struct CompStats {
    rows: HashMap<(u32, Option<Role>), Row>,
    /// What a usual pick in each role brings.
    usual: HashMap<Option<Role>, Row>,
    /// Upper bounds of the game-length buckets, minutes.
    lengths: Vec<u32>,
}

impl CompStats {
    pub fn new(file: &CompositionsFile) -> Self {
        let buckets = file.lengths.len() + 1;
        Self {
            rows: file
                .champions
                .iter()
                .filter(|c| c.n > 0)
                .map(|c| ((c.id, c.role), Row::new(c, buckets)))
                .collect(),
            usual: file
                .roles
                .iter()
                .filter(|r| r.n > 0)
                .map(|r| (r.role, Row::new(r, buckets)))
                .collect(),
            lengths: file.lengths.clone(),
        }
    }

    /// Upper bounds of the game-length buckets, in minutes.
    pub fn lengths(&self) -> &[u32] {
        &self.lengths
    }

    /// Whether `champion` has numbers in any role.
    pub fn knows(&self, champion: u32) -> bool {
        self.rows.keys().any(|(c, _)| *c == champion)
    }

    /// A seat's numbers and those of usual picks in the same roles, weighted by the roles it
    /// has numbers in; `None` without any.
    fn seat(&self, seat: &Seat) -> Option<(Row, Row)> {
        let known: Vec<(&Row, Option<&Row>, f64)> = seat
            .roles
            .iter()
            .filter(|(_, p)| p.is_finite() && *p > 0.0)
            .filter_map(|(role, p)| {
                let row = self.rows.get(&(seat.champion, *role))?;
                Some((row, self.usual.get(role), *p))
            })
            .collect();
        let total: f64 = known.iter().map(|(_, _, p)| p).sum();
        if total <= 0.0 {
            return None;
        }
        let (mut mine, mut usual) = (Row::default(), Row::default());
        for (row, typical, p) in known {
            mine.add(row, p / total);
            if let Some(typical) = typical {
                usual.add(typical, p / total);
            }
        }
        Some((mine, usual))
    }

    /// The composition of `seats`, with each champion listed when `members` (a team shown as
    /// such), without them for a suggestion's team.
    pub fn team(&self, seats: &[Seat], members: bool) -> TeamComp {
        let buckets = self.lengths.len() + 1;
        let mut listed = Vec::new();
        let (mut total, mut usual) = (Row::default(), Row::default());
        total.lengths = vec![0.0; buckets];
        let mut counted = 0u32;
        let mut fewest: Option<f64> = None;
        for seat in seats {
            let numbers = self.seat(seat);
            if let Some((mine, typical)) = &numbers {
                counted += 1;
                total.add(mine, 1.0);
                usual.add(typical, 1.0);
                fewest = Some(fewest.map_or(mine.games, |f| f.min(mine.games)));
            }
            if members {
                let mine = numbers.map(|(mine, _)| mine).unwrap_or_default();
                listed.push(CompMember {
                    champion_id: seat.champion,
                    hovering: seat.hovering,
                    games: count(mine.games),
                    damage: mix(mine.dmg),
                    frontline: round(mine.front, 3),
                    cc: round(mine.cc, 1),
                });
            }
        }
        let frontline = if usual.front > 0.0 {
            total.front / usual.front
        } else {
            0.0
        };
        let mut comp = TeamComp {
            members: listed,
            counted,
            damage: mix(total.dmg),
            frontline: round(frontline, 3),
            cc: round(total.cc, 1),
            cc_usual: round(usual.cc, 1),
            lengths: total.lengths.iter().map(|l| round(*l, 2)).collect(),
            games: fewest.map_or(0, count),
            readings: Vec::new(),
        };
        comp.readings = readings(&comp);
        comp
    }
}

/// Short neutral readings of a composition (none before [`READINGS_FROM`] counted champions).
pub fn readings(comp: &TeamComp) -> Vec<CompReading> {
    let mut out = Vec::new();
    if comp.counted < READINGS_FROM {
        return out;
    }
    if comp.damage.physical >= MOSTLY {
        out.push(CompReading::MostlyPhysical);
    } else if comp.damage.magic >= MOSTLY {
        out.push(CompReading::MostlyMagic);
    }
    if comp.frontline > 0.0 && comp.frontline < LITTLE_FRONTLINE {
        out.push(CompReading::LittleFrontline);
    } else if comp.frontline > LOTS_OF_FRONTLINE {
        out.push(CompReading::LotsOfFrontline);
    }
    if comp.cc_usual > 0.0 {
        let cc = comp.cc / comp.cc_usual;
        if cc < LITTLE_CC {
            out.push(CompReading::LittleCc);
        } else if cc > LOTS_OF_CC {
            out.push(CompReading::LotsOfCc);
        }
    }
    if let (Some(short), Some(long)) = (comp.lengths.first(), comp.lengths.last())
        && comp.lengths.len() > 1
    {
        let lean = long - short;
        if lean >= LEAN_POINTS {
            out.push(CompReading::Late);
        } else if lean <= -LEAN_POINTS {
            out.push(CompReading::Early);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;
    use domain::{Bracket, DataSetInfo};

    const TANK: u32 = 1;
    const MAGE: u32 = 2;
    const MARKSMAN: u32 = 3;
    const FLEX: u32 = 4;
    const SCALER: u32 = 5;

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

    fn row(
        id: u32,
        role: Option<Role>,
        dmg: [f64; 3],
        front: f64,
        cc: f64,
        len: Vec<(u32, u32)>,
    ) -> CompositionStats {
        CompositionStats {
            id,
            role,
            n: len.iter().map(|l| l.0).sum::<u32>().max(1_000),
            dmg,
            front,
            cc,
            len,
        }
    }

    fn even() -> Vec<(u32, u32)> {
        vec![(1_000, 500), (2_000, 1_000), (1_000, 500)]
    }

    fn file() -> CompositionsFile {
        use Role::{Bottom, Jungle, Middle, Support, Top};
        CompositionsFile {
            info: info(),
            lengths: vec![25, 35],
            roles: vec![
                row(0, Some(Top), [500.0, 200.0, 30.0], 0.26, 20.0, vec![]),
                row(0, Some(Jungle), [400.0, 250.0, 60.0], 0.22, 18.0, vec![]),
                row(0, Some(Middle), [250.0, 550.0, 20.0], 0.17, 16.0, vec![]),
                row(0, Some(Bottom), [650.0, 50.0, 30.0], 0.14, 8.0, vec![]),
                row(0, Some(Support), [150.0, 250.0, 10.0], 0.21, 24.0, vec![]),
            ],
            champions: vec![
                row(TANK, Some(Top), [150.0, 350.0, 20.0], 0.36, 40.0, even()),
                row(MAGE, Some(Middle), [30.0, 800.0, 10.0], 0.12, 20.0, even()),
                row(
                    MARKSMAN,
                    Some(Bottom),
                    [700.0, 20.0, 40.0],
                    0.12,
                    4.0,
                    even(),
                ),
                row(FLEX, Some(Top), [600.0, 0.0, 100.0], 0.28, 10.0, even()),
                row(FLEX, Some(Middle), [0.0, 600.0, 0.0], 0.16, 10.0, even()),
                // Loses short games, wins long ones.
                row(
                    SCALER,
                    Some(Middle),
                    [100.0, 700.0, 0.0],
                    0.15,
                    12.0,
                    vec![(4_000, 1_600), (4_000, 2_000), (4_000, 2_400)],
                ),
            ],
        }
    }

    fn seat(champion: u32, role: Role) -> Seat {
        Seat {
            champion,
            hovering: false,
            roles: vec![(Some(role), 1.0)],
        }
    }

    #[test]
    fn sums_the_team_and_compares_with_usual_picks() {
        let comps = CompStats::new(&file());
        let team = comps.team(
            &[
                seat(TANK, Role::Top),
                seat(MAGE, Role::Middle),
                Seat {
                    hovering: true,
                    ..seat(MARKSMAN, Role::Bottom)
                },
            ],
            true,
        );
        assert_eq!(team.counted, 3);
        // Damage per minute summed: 880 physical, 1170 magic, 70 true.
        assert!(
            (team.damage.physical - 880.0 / 2120.0).abs() < 0.001,
            "{team:?}"
        );
        assert!((team.damage.magic - 1170.0 / 2120.0).abs() < 0.001);
        // 0.60 of a team soaked, where usual top, mid and bot picks soak 0.57.
        assert!((team.frontline - 0.60 / 0.57).abs() < 0.001);
        assert!((team.cc - 64.0).abs() < 1e-9 && (team.cc_usual - 44.0).abs() < 1e-9);
        assert_eq!(team.games, 4_000);
        assert_eq!(team.members.len(), 3);
        assert!(team.members[2].hovering, "hovers shown as such");
        assert!((team.members[1].damage.magic - 800.0 / 840.0).abs() < 0.001);
        assert!(team.lengths.iter().all(|l| l.abs() < 1e-9), "even records");
        assert_eq!(team.readings, vec![CompReading::LotsOfCc]);
        // A suggestion's team: the same numbers, without the list.
        let bare = comps.team(&[seat(TANK, Role::Top)], false);
        assert!(bare.members.is_empty() && bare.counted == 1);
    }

    #[test]
    fn enemies_count_over_their_likely_roles() {
        let comps = CompStats::new(&file());
        let flex = Seat {
            champion: FLEX,
            hovering: false,
            roles: vec![
                (Some(Role::Top), 0.5),
                (Some(Role::Middle), 0.3),
                // No numbers as a jungler: the other roles share its weight.
                (Some(Role::Jungle), 0.2),
            ],
        };
        let team = comps.team(&[flex], true);
        assert_eq!(team.counted, 1);
        let m = &team.members[0];
        // 5/8 top (600 physical, 100 true), 3/8 mid (600 magic): 375, 225 and 62.5 a minute.
        assert!((m.damage.physical - 375.0 / 662.5).abs() < 0.001, "{m:?}");
        assert!((m.frontline - (0.625 * 0.28 + 0.375 * 0.16)).abs() < 0.001);
        assert!(team.readings.is_empty(), "too early for readings");
        // Nobody knows a champion in no role with numbers: listed, not counted.
        let unknown = comps.team(&[seat(99, Role::Top)], true);
        assert_eq!((unknown.counted, unknown.games), (0, 0));
        assert_eq!(unknown.members[0].games, 0);
        assert!(unknown.frontline.abs() < f64::EPSILON);
    }

    #[test]
    fn reads_one_damage_type_frontline_and_game_length() {
        let comps = CompStats::new(&file());
        let magic = comps.team(
            &[
                seat(MAGE, Role::Middle),
                seat(SCALER, Role::Middle),
                seat(FLEX, Role::Middle),
            ],
            false,
        );
        assert!(magic.damage.magic > MOSTLY, "{magic:?}");
        // Three mids soak 0.43 of a team where three usual mids soak 0.51.
        assert!(magic.frontline < LITTLE_FRONTLINE);
        // The scaler wins 40 % of short games, 60 % of long ones (4k games each, shrunk).
        let lean = magic.lengths[2] - magic.lengths[0];
        assert!(lean > 10.0 && lean < 20.0, "{:?}", magic.lengths);
        assert_eq!(
            magic.readings,
            vec![
                CompReading::MostlyMagic,
                CompReading::LittleFrontline,
                CompReading::Late
            ]
        );
    }

    #[test]
    fn aram_champions_have_no_role() {
        let mut aram = file();
        aram.lengths = vec![17, 22];
        aram.roles = vec![row(0, None, [400.0, 400.0, 30.0], 0.2, 20.0, vec![])];
        aram.champions = vec![row(TANK, None, [100.0, 300.0, 0.0], 0.3, 30.0, even())];
        let comps = CompStats::new(&aram);
        assert_eq!(comps.lengths(), [17, 22]);
        let seat = Seat {
            champion: TANK,
            hovering: false,
            roles: vec![(None, 1.0)],
        };
        let team = comps.team(&[seat], true);
        assert_eq!(team.counted, 1);
        assert!((team.frontline - 1.5).abs() < 1e-9);
        assert!(comps.knows(TANK) && !comps.knows(MAGE));
    }
}
