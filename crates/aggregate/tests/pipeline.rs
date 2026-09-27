//! The pipeline on hand-written synthetic games (no real Riot data).
#![allow(clippy::unwrap_used, reason = "tests")]

use aggregate::synthetic::{Game, buy, typical_build, undo};
use aggregate::{
    Dataset, GameFacts, ItemCatalog, Lane, Patch, Rec, SeedBracket, SkillOrder, Skip, extract,
    publish,
};
use domain::{Bracket, BuildsFile, ChampionsFile, MatchupsFile, Role, TierList};
use proptest::prelude::*;

const BLUE: [u16; 5] = [1, 2, 3, 4, 5];
const RED: [u16; 5] = [11, 12, 13, 14, 15];

fn teams(blue: [u16; 5], red: [u16; 5]) -> [u16; 10] {
    let mut all = [0; 10];
    all[..5].copy_from_slice(&blue);
    all[5..].copy_from_slice(&red);
    all
}

fn facts(game: &Game) -> GameFacts {
    extract(&game.match_json(), None).unwrap()
}

fn rec(games: u32, wins: u32) -> Rec {
    Rec { games, wins }
}

fn catalog() -> ItemCatalog {
    ItemCatalog::new([3031, 3072, 6672, 3036, 3033, 3026, 3071], [3006])
}

fn patch() -> Patch {
    "16.19".parse().unwrap()
}

#[test]
fn counts_roles_matchups_duos_and_bans() {
    let mut a = Game::ranked("EUW1_1", teams(BLUE, RED), true);
    a.bans = vec![7, 8, 7];
    let b = Game::ranked("EUW1_2", teams(BLUE, RED), false);
    let c = Game::ranked("EUW1_3", teams(BLUE, [21, 12, 13, 14, 15]), true);
    let mut ds = Dataset::default();
    for g in [&a, &b, &c] {
        ds.add(&facts(g), SeedBracket::Emerald, &catalog());
    }
    let s = ds.combined(patch(), 420, Bracket::EmeraldPlus);
    assert_eq!(s.games, 3);
    assert_eq!(s.champions[&(1, Some(Lane::Top))], rec(3, 2));
    assert_eq!(s.champions[&(11, Some(Lane::Top))], rec(2, 1));
    assert_eq!(
        s.bans[&7], 1,
        "a champion banned twice in one game counts once"
    );
    assert_eq!(s.bans[&8], 1);

    // Lane: both sides, each from its own point of view.
    assert_eq!(s.versus[&(1, Lane::Top, 11, Lane::Top)], rec(2, 1));
    assert_eq!(s.versus[&(11, Lane::Top, 1, Lane::Top)], rec(2, 1));
    assert_eq!(s.versus[&(1, Lane::Top, 21, Lane::Top)], rec(1, 1));
    // Laner vs enemy jungler, from the laner's side only.
    assert_eq!(s.versus[&(1, Lane::Top, 12, Lane::Jungle)], rec(3, 2));
    assert!(!s.versus.contains_key(&(12, Lane::Jungle, 1, Lane::Top)));
    // The 2v2 bot lane.
    assert_eq!(s.versus[&(4, Lane::Bottom, 15, Lane::Support)], rec(3, 2));
    assert_eq!(s.versus[&(15, Lane::Support, 4, Lane::Bottom)], rec(3, 1));
    // No cross-map opponents.
    assert!(!s.versus.contains_key(&(3, Lane::Middle, 11, Lane::Top)));

    // Duos: each same-team pair once, lower role first.
    assert_eq!(s.duos[&(4, Lane::Bottom, 5, Lane::Support)], rec(3, 2));
    assert_eq!(s.duos[&(2, Lane::Jungle, 3, Lane::Middle)], rec(3, 2));
    assert!(!s.duos.contains_key(&(5, Lane::Support, 4, Lane::Bottom)));
    assert_eq!(
        s.duos.len(),
        10 + 10 + 4,
        "blue pairs, red pairs, red pairs with 21"
    );
}

#[test]
fn aram_has_no_roles_or_pairs() {
    let game = Game::aram("EUW1_9", teams(BLUE, RED), false);
    let f = facts(&game);
    assert!(f.players.iter().all(|p| p.role.is_none()));
    let mut ds = Dataset::default();
    ds.add(&f, SeedBracket::Diamond, &catalog());
    let s = ds.combined(patch(), 450, Bracket::DiamondPlus);
    assert_eq!(s.champions[&(11, None)], rec(1, 1));
    assert!(s.versus.is_empty() && s.duos.is_empty());
    assert_eq!(ds.combined(patch(), 450, Bracket::MasterPlus).games, 0);
}

#[test]
fn skips_remakes_other_queues_and_broken_roles() {
    let mut short = Game::ranked("EUW1_4", teams(BLUE, RED), true);
    short.duration = 299;
    assert_eq!(extract(&short.match_json(), None), Err(Skip::Remake));
    short.duration = 300;
    assert!(extract(&short.match_json(), None).is_ok());

    let mut surrender = Game::ranked("EUW1_5", teams(BLUE, RED), true);
    surrender.early_surrender = true;
    assert_eq!(extract(&surrender.match_json(), None), Err(Skip::Remake));

    let mut flex = Game::ranked("EUW1_6", teams(BLUE, RED), true);
    flex.queue = 440;
    assert_eq!(extract(&flex.match_json(), None), Err(Skip::Queue(440)));

    let mut no_role = Game::ranked("EUW1_7", teams(BLUE, RED), true).match_json();
    no_role["info"]["participants"][2]["teamPosition"] = "".into();
    assert_eq!(extract(&no_role, None), Err(Skip::Roles));

    let mut two_tops = Game::ranked("EUW1_8", teams(BLUE, RED), true).match_json();
    two_tops["info"]["participants"][2]["teamPosition"] = "TOP".into();
    assert_eq!(extract(&two_tops, None), Err(Skip::Roles));
}

#[test]
fn patch_comes_from_the_game_version() {
    let mut g = Game::ranked("EUW1_10", teams(BLUE, RED), true);
    g.version = "15.24.700.1".to_owned();
    assert_eq!(facts(&g).patch.to_string(), "15.24");
    g.version = "garbage".to_owned();
    assert_eq!(
        extract(&g.match_json(), None),
        Err(Skip::Malformed("gameVersion"))
    );
}

#[test]
fn extracts_builds_from_the_timeline() {
    let game = Game::ranked("EUW1_11", teams(BLUE, RED), true);
    let mut events = typical_build(1, &[3031, 3072, 6672, 3036, 3033, 3026]);
    // Bought then undone: never counted.
    events.push(buy(1, 3071, 500_000));
    events.push(undo(1, 3071, 501_000));
    let timeline = game.timeline_json(&events);
    let f = extract(&game.match_json(), Some(&timeline)).unwrap();
    assert!(f.timeline);
    assert!(f.players[0].purchases.iter().all(|p| p.item != 3071));

    let mut ds = Dataset::default();
    ds.add(&f, SeedBracket::Master, &catalog());
    let s = ds.combined(patch(), 420, Bracket::MasterPlus);
    let b = &s.builds[&(1, Some(Lane::Top))];
    assert_eq!(b.games, rec(1, 1));
    assert_eq!(b.skills.options[&SkillOrder([1, 3, 2])], rec(1, 1));
    assert_eq!(b.skill_start.options[&[1, 3, 2, 1]], rec(1, 1));
    assert_eq!(b.starts.options[&vec![1055, 2003]], rec(1, 1));
    assert_eq!(b.core.options[&[3031, 3072, 6672]], rec(1, 1));
    assert_eq!(b.boots.options[&3006], rec(1, 1));
    assert_eq!(b.later[0].options[&3036], rec(1, 1));
    assert_eq!(b.later[1].options[&3033], rec(1, 1));
    assert_eq!(b.later[2].options[&3026], rec(1, 1));
    assert_eq!(b.keystones.options[&8010], rec(1, 1));
    assert_eq!(b.spells.options[&[4, 14]], rec(1, 1));
    let page = b.runes.options.keys().next().unwrap();
    assert_eq!(
        page.ids(),
        vec![
            8000, 8400, 8010, 9111, 9104, 8014, 8444, 8453, 5005, 5008, 5011
        ]
    );

    // A participant without timeline events: runes and spells only.
    let quiet = &s.builds[&(2, Some(Lane::Jungle))];
    assert_eq!(quiet.spells.options[&[4, 11]], rec(1, 1));
    assert!(quiet.core.options.is_empty() && quiet.skills.options.is_empty());
}

#[test]
fn merge_is_commutative() {
    let mut left = Dataset::default();
    let mut right = Dataset::default();
    left.add(
        &facts(&Game::ranked("EUW1_12", teams(BLUE, RED), true)),
        SeedBracket::Emerald,
        &catalog(),
    );
    right.add(
        &facts(&Game::ranked("EUW1_13", teams(RED, BLUE), true)),
        SeedBracket::Diamond,
        &catalog(),
    );
    right.add(
        &facts(&Game::aram("EUW1_14", teams(BLUE, RED), true)),
        SeedBracket::Diamond,
        &catalog(),
    );
    let mut lr = left.clone();
    lr.merge(&right);
    let mut rl = right.clone();
    rl.merge(&left);
    assert_eq!(lr, rl);
    assert_eq!(
        lr.combined(patch(), 420, Bracket::EmeraldPlus).champions[&(1, Some(Lane::Top))],
        rec(2, 1),
        "Emerald+ holds the Diamond shard too"
    );
}

#[test]
fn publishes_the_files_the_app_reads() {
    let mut ds = Dataset::default();
    let mut games = Vec::new();
    for i in 0..6 {
        games.push(Game::ranked(
            &format!("EUW1_2{i}"),
            teams(BLUE, RED),
            i % 3 != 0,
        ));
    }
    games.push(Game::aram("EUW1_30", teams(BLUE, RED), true));
    for g in &games {
        let timeline = g.timeline_json(&typical_build(1, &[3031, 3072, 6672]));
        let f = extract(&g.match_json(), Some(&timeline)).unwrap();
        ds.add(&f, SeedBracket::Emerald, &catalog());
    }
    // The previous patch, for the base-strength prior.
    let mut old = Game::ranked("EUW1_40", teams(BLUE, RED), false);
    old.version = "16.18.1.1".to_owned();
    ds.add(&facts(&old), SeedBracket::Emerald, &catalog());

    let opts = publish::Options {
        min_role_games: 1,
        min_pair_games: 1,
        min_current_games: 1,
        ..publish::Options::default()
    };
    let (files, entry) = publish::publish_patch(&ds, patch(), &opts, 1_790_000_000_000).unwrap();
    let file = |path: &str| {
        files
            .iter()
            .find(|f| f.path == path)
            .unwrap_or_else(|| panic!("missing {path}"))
    };
    let dir = "v1/16.19/420/emeraldPlus";
    assert!(files.iter().all(|f| !f.path.contains("diamondPlus")));

    let champions: ChampionsFile =
        serde_json::from_slice(&file(&format!("{dir}/champions.json")).body).unwrap();
    assert_eq!(champions.info.games, 6);
    let top = champions.champions.iter().find(|c| c.id == 1).unwrap();
    assert_eq!((top.g, top.w), (6, 4));
    assert_eq!(top.roles[0].role, Some(Role::Top));
    assert_eq!(top.roles[0].prev.map(|p| (p.g, p.w)), Some((1, 0)));
    assert!(!champions.priors.is_empty());

    let tiers: TierList =
        serde_json::from_slice(&file(&format!("{dir}/tierlist.json")).body).unwrap();
    assert_eq!(tiers.entries.len(), 10);
    assert!(tiers.entries.windows(2).all(|w| w[0].score >= w[1].score));

    let matchups: MatchupsFile =
        serde_json::from_slice(&file(&format!("{dir}/matchups/1.json")).body).unwrap();
    let top = &matchups.roles[0];
    assert_eq!((top.lane[0].id, top.lane[0].g, top.lane[0].w), (11, 6, 4));
    assert_eq!(top.jungle[0].id, 12);
    assert_eq!(top.duos.len(), 4);

    let builds: BuildsFile =
        serde_json::from_slice(&file(&format!("{dir}/builds/1.json")).body).unwrap();
    let b = &builds.roles[0];
    assert_eq!(b.core.top[0].ids, vec![3031, 3072, 6672]);
    assert_eq!(b.skills.top[0].ids, vec![1, 3, 2]);
    assert_eq!(b.core.n, 6);

    // ARAM: builds, no matchups.
    assert!(
        files
            .iter()
            .any(|f| f.path == "v1/16.19/450/emeraldPlus/builds/1.json")
    );
    assert!(
        files
            .iter()
            .all(|f| !f.path.starts_with("v1/16.19/450/emeraldPlus/matchups"))
    );

    let entry = entry.unwrap();
    assert_eq!(entry.name, "26.19");
    let index = publish::build_index(None, vec![entry], &opts, 1);
    assert_eq!(index.current.as_deref(), Some("16.19"));
}

// ---------------------------------------------------------------------------------------------
// Order independence

fn arb_game() -> impl Strategy<Value = (GameFacts, SeedBracket)> {
    (
        Just((1u16..=16).collect::<Vec<_>>()).prop_shuffle(),
        any::<bool>(),
        any::<bool>(),
        0usize..3,
        0u16..2,
        0u32..1_000_000,
    )
        .prop_map(|(pool, blue_wins, aram, bracket, minor, id)| {
            let champions: [u16; 10] = pool[..10].try_into().unwrap();
            let mut g = if aram {
                Game::aram(&format!("G{id}"), champions, blue_wins)
            } else {
                Game::ranked(&format!("G{id}"), champions, blue_wins)
            };
            g.version = format!("16.{}.1", 18 + minor);
            let legendaries = [3031, 3072, 6672, 3036][..usize::from(minor) + 2].to_vec();
            let timeline = g.timeline_json(&typical_build(1 + id as usize % 10, &legendaries));
            let f = extract(&g.match_json(), Some(&timeline)).unwrap();
            (f, SeedBracket::ALL[bracket])
        })
}

fn aggregate(games: &[(GameFacts, SeedBracket)]) -> Dataset {
    let mut ds = Dataset::default();
    for (f, b) in games {
        ds.add(f, *b, &catalog());
    }
    ds
}

proptest! {
    #[test]
    fn aggregates_do_not_depend_on_match_order(
        (games, order) in prop::collection::vec(arb_game(), 1..25)
            .prop_flat_map(|g| {
                let n = g.len();
                (Just(g), Just((0..n).collect::<Vec<_>>()).prop_shuffle())
            }),
        split in 0usize..25,
    ) {
        let reference = aggregate(&games);
        let shuffled: Vec<_> = order.iter().map(|&i| games[i].clone()).collect();
        prop_assert_eq!(&aggregate(&shuffled), &reference);

        // Shards merged in either order give the same result.
        let split = split.min(shuffled.len());
        let (a, b) = shuffled.split_at(split);
        let mut ab = aggregate(a);
        ab.merge(&aggregate(b));
        let mut ba = aggregate(b);
        ba.merge(&aggregate(a));
        prop_assert_eq!(&ab, &reference);
        prop_assert_eq!(&ba, &reference);
    }
}
