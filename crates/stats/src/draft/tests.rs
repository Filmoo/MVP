//! Model-level tests on a small synthetic world.

use std::collections::HashMap;

use super::*;
use crate::sigmoid;

const MALPHITE: u32 = 54;
const IRELIA: u32 = 39;
const VAYNE: u32 = 67;
const SHEN: u32 = 98;
const LUCIAN: u32 = 236;
const YUUMI: u32 = 350;

fn cr(champion: u32, role: Role) -> ChampRole {
    ChampRole { champion, role }
}

#[derive(Default)]
struct World {
    base: HashMap<ChampRole, Base>,
    versus: HashMap<(ChampRole, ChampRole), Evidence>,
    duo: HashMap<(ChampRole, ChampRole), Evidence>,
}

impl World {
    /// A champion-role with 8,000 games at `wr` (unchanged since last patch).
    fn with_base(mut self, c: ChampRole, wr: f64) -> Self {
        self.base.insert(
            c,
            base_strength(Evidence::new(8_000.0, 8_000.0 * wr), wr, 0.0),
        );
        self
    }
    /// Stores both perspectives.
    fn with_versus(mut self, a: ChampRole, b: ChampRole, games: f64, a_wr: f64) -> Self {
        self.versus
            .insert((a, b), Evidence::new(games, games * a_wr));
        self.versus
            .insert((b, a), Evidence::new(games, games * (1.0 - a_wr)));
        self
    }
    fn with_duo(mut self, a: ChampRole, b: ChampRole, games: f64, wr: f64) -> Self {
        self.duo.insert((a, b), Evidence::new(games, games * wr));
        self.duo.insert((b, a), Evidence::new(games, games * wr));
        self
    }
}

impl DraftData for World {
    fn base(&self, c: ChampRole) -> Option<Base> {
        self.base.get(&c).copied()
    }
    fn versus(&self, a: ChampRole, b: ChampRole) -> Evidence {
        self.versus.get(&(a, b)).copied().unwrap_or_default()
    }
    fn duo(&self, a: ChampRole, b: ChampRole) -> Evidence {
        self.duo.get(&(a, b)).copied().unwrap_or_default()
    }
    fn prior(&self, pair: PairType) -> PairPrior {
        match pair {
            PairType::Versus(Role::Top, Role::Top) => PairPrior::from_tau(0.0209),
            PairType::Duo(Role::Bottom, Role::Support) => PairPrior::from_tau(0.0119),
            _ => PairPrior::from_tau(0.007),
        }
    }
}

fn world() -> World {
    World::default()
        .with_base(cr(MALPHITE, Role::Top), 0.5099)
        .with_base(cr(IRELIA, Role::Top), 0.5057)
        .with_base(cr(VAYNE, Role::Top), 0.4794)
        .with_base(cr(SHEN, Role::Top), 0.505)
        .with_base(cr(LUCIAN, Role::Bottom), 0.4867)
        .with_base(cr(YUUMI, Role::Support), 0.4702)
        .with_versus(
            cr(MALPHITE, Role::Top),
            cr(IRELIA, Role::Top),
            3244.0,
            0.5551,
        )
        .with_versus(cr(VAYNE, Role::Top), cr(MALPHITE, Role::Top), 1514.0, 0.375)
        .with_duo(
            cr(LUCIAN, Role::Bottom),
            cr(YUUMI, Role::Support),
            10_188.0,
            0.505,
        )
}

fn top_laner(champion: u32) -> Pick {
    Pick {
        champion,
        role_shares: [0.95, 0.02, 0.02, 0.005, 0.005],
        locked: None,
    }
}

#[test]
fn clear_differences_get_their_own_tier() {
    let w = world();
    // Vayne top (47.9%) is well below the others (~50.5–51%): a separate tier.
    let ranked = suggest(&w, Role::Top, &[], &[], &[MALPHITE, VAYNE, SHEN]);
    assert_eq!(ranked.last().map(|s| s.champion), Some(VAYNE));
    assert!(ranked.last().map(|s| s.tier) > ranked.first().map(|s| s.tier));
}

#[test]
fn empty_draft_is_a_coin_flip() {
    let e = evaluate(&world(), &[], &[]).expect("valid");
    assert!(e.score.abs() < 1e-12);
    assert!(e.sd.abs() < 1e-12);
}

#[test]
fn mirror_drafts_cancel_out() {
    let w = world();
    let allies = [cr(MALPHITE, Role::Top)];
    let enemies = [Pick {
        champion: MALPHITE,
        role_shares: [1.0, 0.0, 0.0, 0.0, 0.0],
        locked: Some(Role::Top),
    }];
    let e = evaluate(&w, &allies, &enemies).expect("valid");
    assert!(e.score.abs() < 1e-9, "{}", e.score);
}

#[test]
fn counterpick_ranks_first_and_explains_why() {
    let w = world();
    let enemies = [top_laner(IRELIA)];
    let ranked = suggest(&w, Role::Top, &[], &enemies, &[MALPHITE, VAYNE, SHEN]);
    assert_eq!(ranked[0].champion, MALPHITE);
    let lane = ranked[0]
        .evaluation
        .terms
        .iter()
        .find(|t| t.kind == TermKind::Lane && t.other.map(|o| o.champion) == Some(IRELIA))
        .expect("lane term");
    // Irelia is top 95% of the time: most of the +4.3 pp lane edge applies.
    let points = (sigmoid(lane.value) - 0.5) * 100.0;
    assert!(points > 3.5 && points < 4.5, "{points}");
    assert!(lane.games > 3000.0 && lane.kept > 0.8);
}

#[test]
fn strong_bot_lane_synergy_counts() {
    let w = world();
    let with_yuumi = evaluate(
        &w,
        &[cr(LUCIAN, Role::Bottom), cr(YUUMI, Role::Support)],
        &[],
    )
    .expect("valid");
    let duo = with_yuumi
        .terms
        .iter()
        .find(|t| t.kind == TermKind::Duo)
        .expect("duo term");
    let points = (sigmoid(duo.value) - 0.5) * 100.0;
    assert!(points > 3.5, "Lucian + Yuumi synergy {points}");
}

#[test]
fn unknown_matchups_add_uncertainty_not_score() {
    let w = world();
    // No recorded games between Shen and Irelia: the delta is 0 but the SD grows.
    let e = evaluate(&w, &[cr(SHEN, Role::Top)], &[top_laner(IRELIA)]).expect("valid");
    let lane = e
        .terms
        .iter()
        .find(|t| t.kind == TermKind::Lane)
        .expect("lane term");
    assert!(lane.value.abs() < 1e-12);
    assert!(e.sd > 0.05, "{}", e.sd);
}

#[test]
fn ties_share_a_tier() {
    let w = world();
    let ranked = suggest(&w, Role::Top, &[], &[], &[MALPHITE, IRELIA, SHEN]);
    // Blind (no enemy): base strengths within ~0.5 pp of each other are statistically tied.
    assert!(
        ranked.iter().all(|s| s.tier == 0),
        "{:?}",
        ranked.iter().map(|s| s.tier).collect::<Vec<_>>()
    );
}

#[test]
fn impossible_enemy_roles_produce_no_suggestions() {
    let w = world();
    let mut a = top_laner(IRELIA);
    let mut b = top_laner(VAYNE);
    a.locked = Some(Role::Top);
    b.locked = Some(Role::Top);
    assert!(suggest(&w, Role::Top, &[], &[a, b], &[MALPHITE]).is_empty());
}

#[test]
fn five_unknown_enemies_merge_into_one_row_per_term() {
    let w = world();
    let enemies: Vec<Pick> = [IRELIA, VAYNE, SHEN, LUCIAN, YUUMI]
        .iter()
        .map(|&champion| Pick {
            champion,
            role_shares: [0.2; 5],
            locked: None,
        })
        .collect();
    let e = evaluate(&w, &[cr(MALPHITE, Role::Top)], &enemies).expect("valid");
    let mut keys: Vec<_> = e
        .terms
        .iter()
        .map(|t| (t.kind, t.subject, t.other, t.enemy_side))
        .collect();
    let rows = keys.len();
    keys.sort();
    keys.dedup();
    assert_eq!(keys.len(), rows, "one row per term");
    // Every enemy sits in exactly one role per assignment: its base rows sum to probability 1.
    for pick in &enemies {
        let p: f64 = e
            .terms
            .iter()
            .filter(|t| t.kind == TermKind::Base && t.enemy_side)
            .filter(|t| t.subject.champion == pick.champion)
            .map(|t| t.probability)
            .sum();
        assert!((p - 1.0).abs() < 1e-9, "{}: {p}", pick.champion);
    }
}
