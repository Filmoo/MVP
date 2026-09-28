//! The grade on a hand-made game, and its properties on generated ones.

use domain::{GradeBadge, GradeFactorKind, GradeLetter, MatchGrade, Role};
use proptest::prelude::*;

use super::*;

const ROLES: [Role; 5] = [
    Role::Top,
    Role::Jungle,
    Role::Middle,
    Role::Bottom,
    Role::Support,
];

/// One player per row, lanes in `ROLES` order:
/// champion, kills, deaths, assists, cs, gold, damage, taken, vision, objectives.
type Row = [u32; 10];

fn team(id: u32, win: bool, rows: [Row; 5]) -> impl Iterator<Item = LobbyPlayer> {
    rows.into_iter()
        .zip(ROLES)
        .map(move |(row, role)| LobbyPlayer {
            team: id,
            win,
            role: Some(role),
            champion_id: row[0],
            kills: row[1],
            deaths: row[2],
            assists: row[3],
            creep_score: row[4],
            gold: row[5],
            damage_to_champions: row[6],
            damage_taken: row[7],
            vision_score: row[8],
            objective_damage: row[9],
        })
}

/// A 30-minute ranked game blue wins, led by its mid laner; red's jungler has a rough game.
fn ranked_game() -> Lobby {
    let blue: [Row; 5] = [
        [54, 3, 4, 10, 210, 11_200, 15_800, 38_000, 18, 6_500],
        [64, 6, 3, 12, 170, 12_000, 14_000, 30_000, 32, 25_000],
        [103, 11, 2, 9, 250, 14_800, 31_000, 16_000, 22, 4_000],
        [222, 9, 4, 8, 260, 14_200, 27_000, 14_000, 15, 9_000],
        [412, 1, 5, 21, 35, 8_300, 7_000, 22_000, 70, 1_000],
    ];
    let red: [Row; 5] = [
        [39, 5, 6, 4, 220, 11_500, 19_000, 27_000, 14, 7_000],
        [104, 2, 8, 6, 160, 9_800, 11_000, 24_000, 20, 6_000],
        [238, 7, 7, 3, 225, 11_700, 22_000, 15_000, 12, 2_500],
        [51, 3, 6, 5, 240, 11_300, 16_000, 11_000, 13, 5_000],
        [89, 1, 5, 9, 30, 7_100, 5_500, 26_000, 45, 500],
    ];
    Lobby {
        duration_seconds: 1_800,
        players: team(100, true, blue).chain(team(200, false, red)).collect(),
    }
}

fn factor(grade: &MatchGrade, kind: GradeFactorKind) -> Option<f64> {
    grade
        .factors
        .iter()
        .find(|f| f.kind == kind)
        .map(|f| f.value)
}

#[test]
fn the_carry_is_mvp_and_the_rough_game_grades_low() {
    let grades = grade(&ranked_game()).expect("a full ranked game");
    let ahri = &grades[2];
    assert_eq!(ahri.place, 1, "{grades:#?}");
    assert_eq!(ahri.badge, Some(GradeBadge::Mvp));
    assert!(ahri.letter <= GradeLetter::S, "{ahri:?}");
    // 31,000 of blue's 94,800 damage: a fact the player can check on the scoreboard.
    assert_eq!(factor(ahri, GradeFactorKind::DamageShare), Some(0.327));
    assert!(ahri.factors.iter().all(|f| f.points > 0.0), "{ahri:?}");

    let jungler = &grades[6];
    assert_eq!(jungler.letter, GradeLetter::C, "{jungler:?}");
    assert!(jungler.place >= 8);
    assert_eq!(jungler.factors[0].kind, GradeFactorKind::Kda);
    assert!(
        jungler.factors.iter().all(|f| f.points < 0.0),
        "{jungler:?}"
    );

    // One MVP (blue won), one ACE on red, and they're the best of their teams.
    let aces: Vec<usize> = (0..10)
        .filter(|&i| grades[i].badge == Some(GradeBadge::Ace))
        .collect();
    assert_eq!(aces.len(), 1);
    assert!(aces[0] >= 5);
    let best_red = (5..10).map(|i| grades[i].score).fold(f64::MIN, f64::max);
    assert!((grades[aces[0]].score - best_red).abs() < f64::EPSILON);
}

#[test]
fn a_support_is_graded_on_what_supports_do() {
    let grades = grade(&ranked_game()).expect("graded");
    let thresh = &grades[4];
    // 70 of blue's 157 vision score and 22 of 30 kills: vision is a support's biggest part.
    assert_eq!(factor(thresh, GradeFactorKind::VisionShare), Some(0.446));
    assert_eq!(thresh.factors[0].kind, GradeFactorKind::VisionShare);
    assert!(thresh.letter <= GradeLetter::A, "{thresh:?}");
    assert!(
        thresh
            .factors
            .iter()
            .all(|f| !matches!(f.kind, GradeFactorKind::CsLead)),
        "CS doesn't count for supports"
    );
}

#[test]
fn lane_parts_compare_with_the_lane_opponent() {
    let grades = grade(&ranked_game()).expect("graded");
    let (jinx, caitlyn) = (&grades[3], &grades[8]);
    let lead = |g: &MatchGrade| {
        factor(g, GradeFactorKind::GoldLead).or(factor(g, GradeFactorKind::CsLead))
    };
    if let Some(value) = lead(jinx) {
        assert!(value > 0.0, "Jinx is ahead of Caitlyn: {jinx:?}");
    }
    if let Some(value) = lead(caitlyn) {
        assert!(value < 0.0, "{caitlyn:?}");
    }
}

#[test]
fn aram_has_no_lane_parts() {
    let mut lobby = ranked_game();
    for p in &mut lobby.players {
        p.role = None;
    }
    let grades = grade(&lobby).expect("ARAM is graded too");
    for g in &grades {
        assert!(
            g.factors
                .iter()
                .all(|f| !matches!(f.kind, GradeFactorKind::CsLead | GradeFactorKind::GoldLead)),
            "{g:?}"
        );
    }
    assert_eq!(grades[2].badge, Some(GradeBadge::Mvp));
}

#[test]
fn remakes_and_odd_lobbies_get_no_grade() {
    let mut remake = ranked_game();
    remake.duration_seconds = REMAKE_MAX_SECONDS;
    assert!(grade(&remake).is_none(), "5 minutes or less is a remake");
    remake.duration_seconds = REMAKE_MAX_SECONDS + 1;
    assert!(grade(&remake).is_some());

    let mut nine = ranked_game();
    nine.players.pop();
    assert!(grade(&nine).is_none());

    let mut both_won = ranked_game();
    both_won.players[7].win = true;
    assert!(grade(&both_won).is_none(), "a team with two results");

    let mut three_teams = ranked_game();
    three_teams.players[9].team = 300;
    assert!(grade(&three_teams).is_none());

    assert!(grade(&Lobby::default()).is_none());
}

#[test]
fn letters_follow_the_cut_offs() {
    let cases = [
        (10.0, GradeLetter::SPlus),
        (8.5, GradeLetter::SPlus),
        (8.4, GradeLetter::S),
        (7.5, GradeLetter::S),
        (7.4, GradeLetter::A),
        (6.0, GradeLetter::A),
        (5.9, GradeLetter::B),
        (4.0, GradeLetter::B),
        (3.9, GradeLetter::C),
        (0.0, GradeLetter::C),
    ];
    for (score, expected) in cases {
        assert_eq!(letter(score), expected, "{score}");
    }
}

#[test]
fn a_game_without_kills_still_grades() {
    let mut lobby = ranked_game();
    for p in &mut lobby.players {
        (p.kills, p.deaths, p.assists) = (0, 0, 0);
        p.damage_to_champions = 0;
    }
    let grades = grade(&lobby).expect("graded");
    for g in &grades {
        assert!((0.0..=10.0).contains(&g.score));
        assert!(
            g.factors.iter().all(|f| !matches!(
                f.kind,
                GradeFactorKind::KillParticipation | GradeFactorKind::DamageShare
            )),
            "no team kills, no damage: those parts don't exist here"
        );
    }
}

// ---- Properties -------------------------------------------------------------------------------

fn stats() -> impl Strategy<Value = [u32; 10]> {
    (
        (0_u32..25, 0_u32..20, 0_u32..35),
        (0_u32..420, 400_u32..26_000),
        (0_u32..70_000, 0_u32..90_000),
        (0_u32..130, 0_u32..45_000),
    )
        .prop_map(|((k, d, a), (cs, gold), (dmg, taken), (vision, obj))| {
            [k, d, a, cs, gold, dmg, taken, vision, obj, 0]
        })
}

/// How roles are known in a generated game.
#[derive(Debug, Clone, Copy)]
enum Roles {
    /// One of each per team, in a shuffled order.
    Ranked,
    /// None (ARAM).
    None,
    /// Anything, repeats included (a client that guessed badly).
    Messy,
}

fn lobby() -> impl Strategy<Value = Lobby> {
    (
        301_u32..4_000,
        proptest::collection::vec(stats(), 10),
        any::<bool>(),
        prop_oneof![Just(Roles::Ranked), Just(Roles::None), Just(Roles::Messy)],
        Just(ROLES).prop_shuffle(),
        Just(ROLES).prop_shuffle(),
        proptest::collection::vec(proptest::option::of(0_usize..5), 10),
    )
        .prop_map(|(duration, stats, blue_wins, roles, blue, red, messy)| {
            let players = stats
                .into_iter()
                .enumerate()
                .map(|(i, s)| {
                    let blue_side = i < TEAM_SIZE;
                    let role = match roles {
                        Roles::Ranked => Some(if blue_side {
                            blue[i]
                        } else {
                            red[i - TEAM_SIZE]
                        }),
                        Roles::None => None,
                        Roles::Messy => messy[i].map(|r| ROLES[r]),
                    };
                    LobbyPlayer {
                        team: if blue_side { 100 } else { 200 },
                        win: blue_side == blue_wins,
                        role,
                        champion_id: u32::try_from(i).unwrap_or(0) + 1,
                        kills: s[0],
                        deaths: s[1],
                        assists: s[2],
                        creep_score: s[3],
                        gold: s[4],
                        damage_to_champions: s[5],
                        damage_taken: s[6],
                        vision_score: s[7],
                        objective_damage: s[8],
                    }
                })
                .collect();
            Lobby {
                duration_seconds: duration,
                players,
            }
        })
}

fn scores(lobby: &Lobby) -> Vec<f64> {
    grade(lobby)
        .expect("a valid lobby is graded")
        .iter()
        .map(|g| g.score)
        .collect()
}

/// A player's stat, to change it.
type Field = fn(&mut LobbyPlayer) -> &mut u32;

/// The stats a player can do more of, and whether more is better.
const STATS: [(&str, Field, bool); 9] = [
    ("kills", |p| &mut p.kills, true),
    ("assists", |p| &mut p.assists, true),
    ("deaths", |p| &mut p.deaths, false),
    ("cs", |p| &mut p.creep_score, true),
    ("gold", |p| &mut p.gold, true),
    ("damage", |p| &mut p.damage_to_champions, true),
    ("taken", |p| &mut p.damage_taken, true),
    ("vision", |p| &mut p.vision_score, true),
    ("objectives", |p| &mut p.objective_damage, true),
];

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn grades_are_well_formed(lobby in lobby()) {
        let grades = grade(&lobby).expect("graded");
        prop_assert_eq!(grades.len(), 10);
        let mut places: Vec<u32> = grades.iter().map(|g| g.place).collect();
        places.sort_unstable();
        prop_assert_eq!(places, (1..=10).collect::<Vec<u32>>());
        for (i, g) in grades.iter().enumerate() {
            prop_assert!((0.0..=10.0).contains(&g.score), "{:?}", g);
            prop_assert_eq!(g.letter, letter(g.score));
            prop_assert!(g.factors.len() <= 3);
            for pair in g.factors.windows(2) {
                prop_assert!(pair[0].points.abs() >= pair[1].points.abs(), "largest first: {:?}", g.factors);
                prop_assert!(pair[0].kind != pair[1].kind);
            }
            // A better place never has a lower score.
            for other in &grades {
                if other.place < g.place {
                    prop_assert!(other.score >= g.score, "{} {:?} vs {:?}", i, other, g);
                }
            }
        }
        for (badge, win) in [(GradeBadge::Mvp, true), (GradeBadge::Ace, false)] {
            let holders: Vec<usize> = (0..10).filter(|&i| grades[i].badge == Some(badge)).collect();
            prop_assert_eq!(holders.len(), 1, "one {:?}", badge);
            let holder = holders[0];
            prop_assert_eq!(lobby.players[holder].win, win);
            for (i, p) in lobby.players.iter().enumerate() {
                if p.win == win {
                    prop_assert!(grades[i].place >= grades[holder].place);
                }
            }
        }
    }

    #[test]
    fn the_order_of_players_changes_nothing(lobby in lobby(), seed in any::<u64>()) {
        let before = scores(&lobby);
        let mut order: Vec<usize> = (0..10).collect();
        // A seeded shuffle (Fisher–Yates with a simple LCG).
        let mut state = seed;
        for i in (1..order.len()).rev() {
            state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            let j = usize::try_from((state >> 33) % (i as u64 + 1)).unwrap_or(0);
            order.swap(i, j);
        }
        let shuffled = Lobby {
            duration_seconds: lobby.duration_seconds,
            players: order.iter().map(|&i| lobby.players[i]).collect(),
        };
        let after = scores(&shuffled);
        for (k, &i) in order.iter().enumerate() {
            prop_assert!((after[k] - before[i]).abs() < 1e-9);
        }
    }

    #[test]
    fn doing_more_never_hurts(lobby in lobby(), who in 0_usize..10, stat in 0_usize..9, more in 1_u32..5_000) {
        let (name, field, good) = STATS[stat];
        let before = scores(&lobby)[who];
        let mut better = lobby.clone();
        let value = field(&mut better.players[who]);
        *value = value.saturating_add(more);
        let after = scores(&better)[who];
        if good {
            prop_assert!(after >= before, "more {} lowered {} → {}", name, before, after);
        } else {
            prop_assert!(after <= before, "more {} raised {} → {}", name, before, after);
        }
    }

    #[test]
    fn a_bloodier_game_for_everyone_changes_no_share(lobby in lobby(), factor in 2_u32..4) {
        let mut scaled = lobby.clone();
        for p in &mut scaled.players {
            p.damage_to_champions *= factor;
            p.damage_taken *= factor;
            p.vision_score *= factor;
            p.objective_damage *= factor;
        }
        prop_assert_eq!(scores(&lobby), scores(&scaled));
    }

    #[test]
    fn remakes_never_grade(mut lobby in lobby(), duration in 0_u32..=REMAKE_MAX_SECONDS) {
        lobby.duration_seconds = duration;
        prop_assert!(grade(&lobby).is_none());
    }
}
