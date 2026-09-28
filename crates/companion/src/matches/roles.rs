//! Which role each player of one of your games played.
//!
//! The League client's match data only guesses (`participants[].timeline.lane/role`, Riot's
//! legacy algorithm): real games showed a mid Kennen called TOP, an Ezreal "in the jungle"
//! without Smite, supports called MIDDLE or JUNGLE after a roam. A wrong role grades a game
//! against another role's references, so each Summoner's Rift team gets one of each role: the
//! assignment of highest likelihood among all of them (120 for five players), the product over
//! its players of
//! - how often the champion plays the role ([`RoleShares`]: the published ranked stats shrunk
//!   toward a built-in prior of usual roles, the prior alone without published stats);
//! - the client's lane and role, weak evidence: ×3 for the lane it names, ×2 for the jungle
//!   and for both roles of the bottom lane, ×1.5 more for the bottom role it names;
//! - lane minions and jungle monsters per minute: laners take 4 lane minions a minute or more,
//!   supports 2.5 or fewer, junglers 3 monsters or more; each one short (or over) makes the role
//!   e times less likely;
//! - a support item (World Atlas and its upgrades): ×20 for the support.
//!
//! Smite is a rule, not evidence: when someone on the team holds it, the jungler does (the one
//! holder jungles).

use std::collections::HashMap;

use domain::{ChampionsFile, Role};
use serde_json::Value;

use super::{str_at, u32_at};

/// The roles, in index order.
pub(super) const ROLES: [Role; 5] = [
    Role::Top,
    Role::Jungle,
    Role::Middle,
    Role::Bottom,
    Role::Support,
];
const TOP: usize = 0;
const JUNGLE: usize = 1;
const MIDDLE: usize = 2;
const BOTTOM: usize = 3;
const SUPPORT: usize = 4;

const fn index(role: Role) -> usize {
    match role {
        Role::Top => TOP,
        Role::Jungle => JUNGLE,
        Role::Middle => MIDDLE,
        Role::Bottom => BOTTOM,
        Role::Support => SUPPORT,
    }
}

const SMITE: u32 = 11;

/// A champion's published games weigh against this many games of the built-in prior: one with
/// a handful of games leans on the prior.
const PRIOR_GAMES: f64 = 50.0;
/// The least share a role gets: a champion never seen there can still have played it.
const SHARE_FLOOR: f64 = 0.01;

/// How much likelier the client's lane makes the role it names…
const LANE_NAMED: f64 = 3.0;
/// … the jungle (roaming supports and mid laners get called JUNGLE too)…
const JUNGLE_NAMED: f64 = 2.0;
/// … each role of the bottom lane…
const BOTTOM_NAMED: f64 = 2.0;
/// … and, on top of that, the bottom role it names (`DUO_CARRY`, `DUO_SUPPORT`).
const BOTTOM_ROLE_NAMED: f64 = 1.5;

/// Lane minions a minute a laner takes at least, and a support at most.
const LANER_MINIONS: f64 = 4.0;
const SUPPORT_MINIONS: f64 = 2.5;
/// Jungle monsters a minute a jungler takes at least.
const JUNGLER_MONSTERS: f64 = 3.0;

/// How much likelier a support item makes the support.
const SUPPORT_ITEM: f64 = 20.0;
/// World Atlas, its upgrades, and the support items before it.
const SUPPORT_ITEMS: [u32; 20] = [
    3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877, // World Atlas and its upgrades
    3850, 3851, 3853, 3854, 3855, 3857, 3858, 3859, 3860, 3862, 3863, 3864, // before 2024
];

/// How often each champion plays each role: published ranked games shrunk toward a built-in
/// prior of usual roles; the prior alone without published stats.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoleShares {
    /// Published games in each role (index order), by champion.
    games: HashMap<u32, [u32; 5]>,
}

impl RoleShares {
    /// From a published `champions.json` (a ranked one: an ARAM file has no roles).
    pub fn published(file: &ChampionsFile) -> Self {
        let games = file
            .champions
            .iter()
            .filter_map(|c| {
                let mut games = [0_u32; 5];
                for r in &c.roles {
                    if let Some(role) = r.role {
                        games[index(role)] = games[index(role)].saturating_add(r.g);
                    }
                }
                games.iter().any(|&g| g > 0).then_some((c.id, games))
            })
            .collect();
        Self { games }
    }

    /// Whether published games are in (else the built-in prior alone).
    pub fn is_published(&self) -> bool {
        !self.games.is_empty()
    }

    /// `champion`'s share of games in each role (index order).
    pub fn of(&self, champion: u32) -> [f64; 5] {
        let prior = usual(champion);
        let Some(games) = self.games.get(&champion) else {
            return prior;
        };
        let total = games.iter().map(|&g| u64::from(g)).sum::<u64>() as f64;
        std::array::from_fn(|r| {
            (f64::from(games[r]) + PRIOR_GAMES * prior[r]) / (total + PRIOR_GAMES)
        })
    }
}

/// What one player's line says about their role, besides their champion.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Seat {
    team: u32,
    champion: u32,
    smite: bool,
    /// Log-likelihood of each role (index order) from the client's lane, the minions and
    /// monsters taken and the items.
    evidence: [f64; 5],
}

impl Seat {
    /// One of `participants[]` of a game `minutes` long.
    fn read(p: &Value, minutes: f64) -> Self {
        let mut evidence = [0.0; 5];
        let timeline = p.get("timeline").unwrap_or(&Value::Null);
        match str_at(timeline, "lane") {
            Some("TOP") => evidence[TOP] += LANE_NAMED.ln(),
            Some("MIDDLE" | "MID") => evidence[MIDDLE] += LANE_NAMED.ln(),
            Some("JUNGLE") => evidence[JUNGLE] += JUNGLE_NAMED.ln(),
            Some("BOTTOM" | "BOT") => {
                evidence[BOTTOM] += BOTTOM_NAMED.ln();
                evidence[SUPPORT] += BOTTOM_NAMED.ln();
                match str_at(timeline, "role") {
                    Some("DUO_CARRY" | "CARRY") => evidence[BOTTOM] += BOTTOM_ROLE_NAMED.ln(),
                    Some("DUO_SUPPORT" | "SUPPORT") => {
                        evidence[SUPPORT] += BOTTOM_ROLE_NAMED.ln();
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        let stats = p.get("stats").unwrap_or(&Value::Null);
        let minions = f64::from(u32_at(stats, "totalMinionsKilled")) / minutes;
        let monsters = f64::from(u32_at(stats, "neutralMinionsKilled")) / minutes;
        for laner in [TOP, MIDDLE, BOTTOM] {
            evidence[laner] -= (LANER_MINIONS - minions).max(0.0);
        }
        evidence[SUPPORT] -= (minions - SUPPORT_MINIONS).max(0.0);
        evidence[JUNGLE] -= (JUNGLER_MONSTERS - monsters).max(0.0);
        let support_item =
            (0..6).any(|slot| SUPPORT_ITEMS.contains(&u32_at(stats, &format!("item{slot}"))));
        if support_item {
            evidence[SUPPORT] += SUPPORT_ITEM.ln();
        }
        Self {
            team: u32_at(p, "teamId"),
            champion: u32_at(p, "championId"),
            smite: [u32_at(p, "spell1Id"), u32_at(p, "spell2Id")].contains(&SMITE),
            evidence,
        }
    }
}

/// Each of `participants`' role, in their order: one of each per team (a team of more than five
/// gets none). `duration_seconds` turns the minions and monsters taken into rates.
pub fn assign(
    participants: &[Value],
    duration_seconds: u32,
    shares: &RoleShares,
) -> Vec<Option<Role>> {
    let minutes = (f64::from(duration_seconds) / 60.0).max(1.0);
    let seats: Vec<Seat> = participants
        .iter()
        .map(|p| Seat::read(p, minutes))
        .collect();
    let mut teams: Vec<u32> = seats.iter().map(|s| s.team).collect();
    teams.sort_unstable();
    teams.dedup();
    let mut roles = vec![None; seats.len()];
    for team in teams {
        let members: Vec<&Seat> = seats.iter().filter(|s| s.team == team).collect();
        if members.len() > ROLES.len() {
            continue;
        }
        let weights: Vec<[f64; 5]> = members
            .iter()
            .map(|seat| {
                let shares = shares.of(seat.champion);
                std::array::from_fn(|r| shares[r].max(SHARE_FLOOR).ln() + seat.evidence[r])
            })
            .collect();
        let smite: Vec<bool> = members.iter().map(|seat| seat.smite).collect();
        let best = best_assignment(&weights, &smite);
        let at = (0..seats.len()).filter(|&i| seats[i].team == team);
        for (i, role) in at.zip(best) {
            roles[i] = Some(ROLES[role]);
        }
    }
    roles
}

/// The role (index) of each player that maximizes the sum of their weights, every player in
/// another role; with Smite on the team, the jungler holds it and a lone holder jungles. Ties
/// go to the first assignment in role order.
fn best_assignment(weights: &[[f64; 5]], smite: &[bool]) -> Vec<usize> {
    let holders = smite.iter().filter(|&&s| s).count();
    let allowed = |player: usize, role: usize| match holders {
        0 => true,
        _ if role == JUNGLE => smite[player],
        1 => !smite[player],
        _ => true,
    };
    let mut best = Best::default();
    let mut current = Vec::with_capacity(weights.len());
    search(weights, &allowed, 0, 0.0, &mut current, &mut best);
    best.roles
}

#[derive(Default)]
struct Best {
    score: Option<f64>,
    roles: Vec<usize>,
}

/// Depth-first over the roles left for the next player (`used`: a bit per role taken).
fn search(
    weights: &[[f64; 5]],
    allowed: &dyn Fn(usize, usize) -> bool,
    used: u8,
    score: f64,
    current: &mut Vec<usize>,
    best: &mut Best,
) {
    let player = current.len();
    let Some(row) = weights.get(player) else {
        if best.score.is_none_or(|top| score > top) {
            best.score = Some(score);
            best.roles.clone_from(current);
        }
        return;
    };
    for (role, weight) in row.iter().enumerate() {
        if used & (1 << role) != 0 || !allowed(player, role) {
            continue;
        }
        current.push(role);
        search(
            weights,
            allowed,
            used | (1 << role),
            score + weight,
            current,
            best,
        );
        current.pop();
    }
}

/// The built-in prior's shares of `champion` (index order); equal shares for a champion it
/// doesn't know (one released since).
fn usual(champion: u32) -> [f64; 5] {
    let Ok(at) = USUAL.binary_search_by_key(&champion, |&(id, _)| id) else {
        return [0.2; 5];
    };
    let percent = USUAL[at].1;
    let total = f64::from(percent.iter().map(|&p| u16::from(p)).sum::<u16>().max(1));
    percent.map(|p| f64::from(p) / total)
}

/// Where each champion is usually played in ranked games: rounded percentages of its games in
/// top, jungle, mid, bot and support, as the meta stood in 2026 (Locke and Zaahen are guesses
/// from their kits). Only a stand-in for the published `champions.json`, which replaces it as
/// soon as it can be read. Sorted by champion id.
#[rustfmt::skip]
const USUAL: &[(u32, [u8; 5])] = &[
    (1, [0, 0, 75, 3, 22]),     // Annie
    (2, [55, 45, 0, 0, 0]),     // Olaf
    (3, [5, 0, 65, 0, 30]),     // Galio
    (4, [5, 0, 85, 10, 0]),     // Twisted Fate
    (5, [10, 90, 0, 0, 0]),     // Xin Zhao
    (6, [95, 0, 5, 0, 0]),      // Urgot
    (7, [0, 2, 90, 0, 8]),      // LeBlanc
    (8, [45, 0, 55, 0, 0]),     // Vladimir
    (9, [0, 85, 3, 0, 12]),     // Fiddlesticks
    (10, [75, 0, 25, 0, 0]),    // Kayle
    (11, [2, 97, 1, 0, 0]),     // Master Yi
    (12, [0, 0, 0, 0, 100]),    // Alistar
    (13, [30, 0, 70, 0, 0]),    // Ryze
    (14, [85, 0, 5, 0, 10]),    // Sion
    (15, [0, 0, 2, 98, 0]),     // Sivir
    (16, [5, 0, 0, 0, 95]),     // Soraka
    (17, [85, 2, 5, 0, 8]),     // Teemo
    (18, [0, 0, 25, 75, 0]),    // Tristana
    (19, [30, 70, 0, 0, 0]),    // Warwick
    (20, [0, 92, 4, 0, 4]),     // Nunu & Willump
    (21, [0, 0, 0, 97, 3]),     // Miss Fortune
    (22, [0, 0, 0, 80, 20]),    // Ashe
    (23, [85, 5, 10, 0, 0]),    // Tryndamere
    (24, [75, 25, 0, 0, 0]),    // Jax
    (25, [0, 10, 10, 0, 80]),   // Morgana
    (26, [0, 0, 25, 0, 75]),    // Zilean
    (27, [95, 0, 3, 0, 2]),     // Singed
    (28, [0, 100, 0, 0, 0]),    // Evelynn
    (29, [0, 12, 0, 80, 8]),    // Twitch
    (30, [0, 70, 20, 10, 0]),   // Karthus
    (31, [80, 0, 15, 0, 5]),    // Cho'Gath
    (32, [0, 75, 0, 0, 25]),    // Amumu
    (33, [3, 97, 0, 0, 0]),     // Rammus
    (34, [0, 0, 95, 0, 5]),     // Anivia
    (35, [0, 85, 0, 0, 15]),    // Shaco
    (36, [80, 20, 0, 0, 0]),    // Dr. Mundo
    (37, [0, 0, 0, 2, 98]),     // Sona
    (38, [3, 0, 97, 0, 0]),     // Kassadin
    (39, [70, 0, 30, 0, 0]),    // Irelia
    (40, [0, 0, 0, 0, 100]),    // Janna
    (41, [85, 0, 15, 0, 0]),    // Gangplank
    (42, [0, 0, 85, 15, 0]),    // Corki
    (43, [8, 0, 12, 0, 80]),    // Karma
    (44, [0, 3, 0, 0, 97]),     // Taric
    (45, [0, 0, 75, 10, 15]),   // Veigar
    (48, [45, 55, 0, 0, 0]),    // Trundle
    (50, [10, 0, 25, 25, 40]),  // Swain
    (51, [0, 0, 0, 100, 0]),    // Caitlyn
    (53, [0, 0, 0, 0, 100]),    // Blitzcrank
    (54, [80, 0, 8, 0, 12]),    // Malphite
    (55, [0, 0, 100, 0, 0]),    // Katarina
    (56, [5, 90, 5, 0, 0]),     // Nocturne
    (57, [20, 25, 0, 0, 55]),   // Maokai
    (58, [95, 0, 5, 0, 0]),     // Renekton
    (59, [5, 95, 0, 0, 0]),     // Jarvan IV
    (60, [0, 90, 0, 0, 10]),    // Elise
    (61, [0, 0, 97, 0, 3]),     // Orianna
    (62, [45, 55, 0, 0, 0]),    // Wukong
    (63, [0, 20, 15, 5, 60]),   // Brand
    (64, [5, 95, 0, 0, 0]),     // Lee Sin
    (67, [25, 0, 0, 75, 0]),    // Vayne
    (68, [70, 10, 20, 0, 0]),   // Rumble
    (69, [15, 0, 85, 0, 0]),    // Cassiopeia
    (72, [15, 80, 0, 0, 5]),    // Skarner
    (74, [30, 0, 40, 10, 20]),  // Heimerdinger
    (75, [95, 0, 5, 0, 0]),     // Nasus
    (76, [0, 95, 0, 0, 5]),     // Nidalee
    (77, [30, 70, 0, 0, 0]),    // Udyr
    (78, [35, 45, 0, 0, 20]),   // Poppy
    (79, [35, 50, 10, 0, 5]),   // Gragas
    (80, [30, 15, 20, 0, 35]),  // Pantheon
    (81, [0, 0, 5, 95, 0]),     // Ezreal
    (82, [90, 10, 0, 0, 0]),    // Mordekaiser
    (83, [97, 3, 0, 0, 0]),     // Yorick
    (84, [30, 0, 70, 0, 0]),    // Akali
    (85, [70, 0, 20, 5, 5]),    // Kennen
    (86, [90, 0, 10, 0, 0]),    // Garen
    (89, [0, 0, 0, 0, 100]),    // Leona
    (90, [0, 0, 95, 0, 5]),     // Malzahar
    (91, [0, 30, 70, 0, 0]),    // Talon
    (92, [97, 0, 3, 0, 0]),     // Riven
    (96, [0, 0, 5, 90, 5]),     // Kog'Maw
    (98, [80, 0, 0, 0, 20]),    // Shen
    (99, [0, 0, 30, 5, 65]),    // Lux
    (101, [0, 0, 40, 0, 60]),   // Xerath
    (102, [10, 90, 0, 0, 0]),   // Shyvana
    (103, [0, 0, 98, 0, 2]),    // Ahri
    (104, [5, 95, 0, 0, 0]),    // Graves
    (105, [5, 5, 90, 0, 0]),    // Fizz
    (106, [55, 45, 0, 0, 0]),   // Volibear
    (107, [15, 85, 0, 0, 0]),   // Rengar
    (110, [0, 0, 10, 90, 0]),   // Varus
    (111, [2, 3, 0, 0, 95]),    // Nautilus
    (112, [0, 0, 97, 3, 0]),    // Viktor
    (113, [3, 97, 0, 0, 0]),    // Sejuani
    (114, [100, 0, 0, 0, 0]),   // Fiora
    (115, [0, 0, 45, 50, 5]),   // Ziggs
    (117, [2, 0, 3, 0, 95]),    // Lulu
    (119, [0, 0, 0, 100, 0]),   // Draven
    (120, [3, 97, 0, 0, 0]),    // Hecarim
    (121, [0, 98, 2, 0, 0]),    // Kha'Zix
    (122, [95, 5, 0, 0, 0]),    // Darius
    (126, [60, 0, 40, 0, 0]),   // Jayce
    (127, [5, 0, 90, 0, 5]),    // Lissandra
    (131, [0, 75, 25, 0, 0]),   // Diana
    (133, [85, 0, 10, 5, 0]),   // Quinn
    (134, [0, 0, 98, 0, 2]),    // Syndra
    (136, [0, 0, 97, 3, 0]),    // Aurelion Sol
    (141, [2, 98, 0, 0, 0]),    // Kayn
    (142, [0, 0, 85, 0, 15]),   // Zoe
    (143, [0, 15, 5, 0, 80]),   // Zyra
    (145, [0, 0, 2, 98, 0]),    // Kai'Sa
    (147, [0, 0, 15, 30, 55]),  // Seraphine
    (150, [97, 0, 3, 0, 0]),    // Gnar
    (154, [10, 85, 0, 0, 5]),   // Zac
    (157, [30, 0, 60, 10, 0]),  // Yasuo
    (161, [0, 0, 30, 0, 70]),   // Vel'Koz
    (163, [0, 40, 55, 0, 5]),   // Taliyah
    (164, [90, 5, 0, 0, 5]),    // Camille
    (166, [20, 0, 70, 10, 0]),  // Akshan
    (200, [0, 100, 0, 0, 0]),   // Bel'Veth
    (201, [0, 0, 0, 0, 100]),   // Braum
    (202, [0, 0, 0, 97, 3]),    // Jhin
    (203, [0, 95, 0, 5, 0]),    // Kindred
    (221, [0, 0, 3, 97, 0]),    // Zeri
    (222, [0, 0, 0, 100, 0]),   // Jinx
    (223, [60, 0, 0, 0, 40]),   // Tahm Kench
    (233, [5, 95, 0, 0, 0]),    // Briar
    (234, [0, 95, 5, 0, 0]),    // Viego
    (235, [0, 0, 0, 20, 80]),   // Senna
    (236, [5, 0, 10, 85, 0]),   // Lucian
    (238, [0, 10, 90, 0, 0]),   // Zed
    (240, [95, 0, 5, 0, 0]),    // Kled
    (245, [0, 55, 45, 0, 0]),   // Ekko
    (246, [0, 45, 55, 0, 0]),   // Qiyana
    (254, [0, 100, 0, 0, 0]),   // Vi
    (266, [95, 5, 0, 0, 0]),    // Aatrox
    (267, [0, 0, 0, 0, 100]),   // Nami
    (268, [0, 0, 100, 0, 0]),   // Azir
    (350, [0, 0, 0, 0, 100]),   // Yuumi
    (360, [0, 0, 0, 100, 0]),   // Samira
    (412, [0, 0, 0, 0, 100]),   // Thresh
    (420, [100, 0, 0, 0, 0]),   // Illaoi
    (421, [0, 100, 0, 0, 0]),   // Rek'Sai
    (427, [0, 95, 0, 0, 5]),    // Ivern
    (429, [5, 0, 0, 95, 0]),    // Kalista
    (432, [0, 0, 0, 0, 100]),   // Bard
    (497, [0, 0, 0, 0, 100]),   // Rakan
    (498, [0, 0, 0, 100, 0]),   // Xayah
    (516, [95, 0, 0, 0, 5]),    // Ornn
    (517, [5, 40, 55, 0, 0]),   // Sylas
    (518, [5, 0, 55, 0, 40]),   // Neeko
    (523, [0, 0, 0, 100, 0]),   // Aphelios
    (526, [0, 5, 0, 0, 95]),    // Rell
    (555, [0, 0, 5, 0, 95]),    // Pyke
    (711, [0, 0, 95, 0, 5]),    // Vex
    (777, [40, 0, 60, 0, 0]),   // Yone
    (799, [80, 10, 10, 0, 0]),  // Ambessa
    (800, [0, 0, 70, 5, 25]),   // Mel
    (804, [0, 0, 0, 100, 0]),   // Yunara
    (805, [0, 30, 70, 0, 0]),   // Locke
    (875, [70, 5, 0, 0, 25]),   // Sett
    (876, [15, 85, 0, 0, 0]),   // Lillia
    (887, [85, 15, 0, 0, 0]),   // Gwen
    (888, [0, 0, 0, 0, 100]),   // Renata Glasc
    (893, [35, 0, 65, 0, 0]),   // Aurora
    (895, [0, 0, 0, 100, 0]),   // Nilah
    (897, [97, 0, 0, 0, 3]),    // K'Sante
    (901, [5, 0, 20, 75, 0]),   // Smolder
    (902, [0, 0, 0, 0, 100]),   // Milio
    (904, [70, 30, 0, 0, 0]),   // Zaahen
    (910, [0, 0, 65, 0, 35]),   // Hwei
    (950, [5, 15, 80, 0, 0]),   // Naafiri
];

#[cfg(test)]
mod tests {
    use domain::{Bracket, ChampionRoleStats, ChampionStats, DataSetInfo};
    use serde_json::json;

    use super::*;

    const FLASH: u32 = 4;
    const IGNITE: u32 = 14;
    const TELEPORT: u32 = 12;
    const HEAL: u32 = 7;
    const EXHAUST: u32 = 3;
    const BARRIER: u32 = 21;

    /// Half an hour.
    const GAME: u32 = 1800;

    /// One line of a whole game as the client answers it: `minions` lane minions and `monsters`
    /// jungle monsters over the game.
    struct Line {
        champion: u32,
        spells: [u32; 2],
        lane: &'static str,
        role: &'static str,
        minions: u32,
        monsters: u32,
        items: [u32; 3],
    }

    fn document(team: u32, line: &Line) -> Value {
        json!({
            "teamId": team, "championId": line.champion,
            "spell1Id": line.spells[0], "spell2Id": line.spells[1],
            "timeline": { "lane": line.lane, "role": line.role },
            "stats": { "totalMinionsKilled": line.minions, "neutralMinionsKilled": line.monsters,
                       "item0": line.items[0], "item1": line.items[1], "item2": line.items[2], "item6": 3340 }
        })
    }

    /// The roles of one team's lines (as team 100), with the built-in prior.
    fn roles_of(lines: &[Line]) -> Vec<Option<Role>> {
        roles_with(lines, &RoleShares::default())
    }

    fn roles_with(lines: &[Line], shares: &RoleShares) -> Vec<Option<Role>> {
        let game: Vec<Value> = lines.iter().map(|l| document(100, l)).collect();
        assign(&game, GAME, shares)
    }

    fn lee_sin() -> Line {
        Line {
            champion: 64,
            spells: [SMITE, FLASH],
            lane: "JUNGLE",
            role: "NONE",
            minions: 24,
            monsters: 168,
            items: [3071, 3047, 6333],
        }
    }

    fn jinx() -> Line {
        Line {
            champion: 222,
            spells: [HEAL, FLASH],
            lane: "BOTTOM",
            role: "DUO_CARRY",
            minions: 246,
            monsters: 8,
            items: [3031, 3006, 3094],
        }
    }

    fn thresh() -> Line {
        Line {
            champion: 412,
            spells: [FLASH, EXHAUST],
            lane: "BOTTOM",
            role: "DUO_SUPPORT",
            minions: 31,
            monsters: 0,
            items: [3877, 3117, 3190],
        }
    }

    /// A game where Riot's Match-V5 says MIDDLE for the Kennen the client calls TOP: the old
    /// fix-up graded him as a top laner (the top laner, called JUNGLE, got the mid lane left).
    #[test]
    fn a_mid_kennen_the_client_calls_top() {
        let team = [
            Line {
                champion: 85,
                spells: [FLASH, TELEPORT],
                lane: "TOP",
                role: "SOLO",
                minions: 214,
                monsters: 6,
                items: [3152, 3020, 4645],
            },
            Line {
                champion: 122,
                spells: [FLASH, TELEPORT],
                lane: "JUNGLE",
                role: "NONE",
                minions: 188,
                monsters: 14,
                items: [6631, 3047, 3053],
            },
            lee_sin(),
            jinx(),
            thresh(),
        ];
        assert_eq!(
            roles_of(&team),
            [
                Role::Middle,
                Role::Top,
                Role::Jungle,
                Role::Bottom,
                Role::Support
            ]
            .map(Some)
        );
    }

    /// The client puts an Ezreal (Flash + Barrier) in the jungle: without Smite he isn't the
    /// jungler, and the champion and his minions say he played bot.
    #[test]
    fn an_ezreal_in_the_jungle_without_smite() {
        let team = [
            Line {
                champion: 516,
                spells: [FLASH, TELEPORT],
                lane: "TOP",
                role: "SOLO",
                minions: 201,
                monsters: 4,
                items: [3068, 3047, 6665],
            },
            Line {
                champion: 234,
                spells: [SMITE, FLASH],
                lane: "JUNGLE",
                role: "NONE",
                minions: 30,
                monsters: 171,
                items: [3153, 3006, 6333],
            },
            Line {
                champion: 134,
                spells: [FLASH, IGNITE],
                lane: "MIDDLE",
                role: "SOLO",
                minions: 222,
                monsters: 8,
                items: [6655, 3020, 4645],
            },
            Line {
                champion: 81,
                spells: [FLASH, BARRIER],
                lane: "JUNGLE",
                role: "NONE",
                minions: 231,
                monsters: 6,
                items: [3078, 3158, 3042],
            },
            Line {
                champion: 117,
                spells: [FLASH, EXHAUST],
                lane: "BOTTOM",
                role: "DUO_SUPPORT",
                minions: 24,
                monsters: 0,
                items: [3869, 3222, 3107],
            },
        ];
        assert_eq!(
            roles_of(&team),
            [
                Role::Top,
                Role::Jungle,
                Role::Middle,
                Role::Bottom,
                Role::Support
            ]
            .map(Some)
        );
    }

    /// The client calls the Kai'Sa the support and the Nautilus, who roamed mid early, a mid
    /// laner: minions and the support item put them back in the bottom lane.
    #[test]
    fn a_nautilus_and_kaisa_bottom_pair() {
        let team = [
            Line {
                champion: 86,
                spells: [FLASH, IGNITE],
                lane: "TOP",
                role: "SOLO",
                minions: 198,
                monsters: 2,
                items: [3508, 3047, 6333],
            },
            Line {
                champion: 120,
                spells: [SMITE, FLASH],
                lane: "JUNGLE",
                role: "NONE",
                minions: 19,
                monsters: 152,
                items: [3071, 3111, 3742],
            },
            Line {
                champion: 103,
                spells: [FLASH, TELEPORT],
                lane: "MIDDLE",
                role: "SOLO",
                minions: 211,
                monsters: 4,
                items: [6655, 3020, 3157],
            },
            Line {
                champion: 145,
                spells: [HEAL, FLASH],
                lane: "BOTTOM",
                role: "DUO_SUPPORT",
                minions: 252,
                monsters: 10,
                items: [3124, 3006, 3115],
            },
            Line {
                champion: 111,
                spells: [FLASH, IGNITE],
                lane: "MIDDLE",
                role: "SOLO",
                minions: 36,
                monsters: 0,
                items: [3876, 3047, 3190],
            },
        ];
        assert_eq!(
            roles_of(&team),
            [
                Role::Top,
                Role::Jungle,
                Role::Middle,
                Role::Bottom,
                Role::Support
            ]
            .map(Some)
        );
    }

    /// A team the client names right keeps its roles, off-meta picks included.
    #[test]
    fn a_team_named_right_stays_as_it_is() {
        let team = [
            Line {
                champion: 67,
                spells: [FLASH, TELEPORT],
                lane: "TOP",
                role: "SOLO",
                minions: 205,
                monsters: 3,
                items: [3153, 3006, 3124],
            },
            lee_sin(),
            Line {
                champion: 86,
                spells: [FLASH, IGNITE],
                lane: "MIDDLE",
                role: "SOLO",
                minions: 219,
                monsters: 5,
                items: [3508, 3047, 3071],
            },
            jinx(),
            thresh(),
        ];
        assert_eq!(
            roles_of(&team),
            [
                Role::Top,
                Role::Jungle,
                Role::Middle,
                Role::Bottom,
                Role::Support
            ]
            .map(Some)
        );
    }

    /// Two junglers' Smite: the one with the jungle's monsters jungles.
    #[test]
    fn two_smites_and_no_smite() {
        let mut smite_support = thresh();
        smite_support.spells = [SMITE, FLASH];
        let team = [
            Line {
                champion: 516,
                spells: [FLASH, TELEPORT],
                lane: "TOP",
                role: "SOLO",
                minions: 201,
                monsters: 4,
                items: [3068, 3047, 6665],
            },
            lee_sin(),
            Line {
                champion: 103,
                spells: [FLASH, IGNITE],
                lane: "MIDDLE",
                role: "SOLO",
                minions: 211,
                monsters: 4,
                items: [6655, 3020, 3157],
            },
            jinx(),
            smite_support,
        ];
        let expected = [
            Role::Top,
            Role::Jungle,
            Role::Middle,
            Role::Bottom,
            Role::Support,
        ]
        .map(Some);
        assert_eq!(roles_of(&team), expected);
        // Nobody with Smite (a custom game): the monsters say who jungled.
        let mut no_smite = team;
        no_smite[1].spells = [FLASH, IGNITE];
        no_smite[1].lane = "NONE";
        no_smite[4].spells = [FLASH, EXHAUST];
        assert_eq!(roles_of(&no_smite), expected);
    }

    /// Both teams at once, each with one of each role; a team of six gets none.
    #[test]
    fn one_of_each_role_per_team() {
        let blue = [lee_sin(), jinx(), thresh()];
        let mut game: Vec<Value> = blue.iter().map(|l| document(100, l)).collect();
        game.extend(blue.iter().map(|l| document(200, l)));
        let roles = assign(&game, GAME, &RoleShares::default());
        let expected = [Role::Jungle, Role::Bottom, Role::Support].map(Some);
        assert_eq!(&roles[..3], &expected);
        assert_eq!(&roles[3..], &expected);

        let six: Vec<Value> = [lee_sin(), jinx(), thresh(), lee_sin(), jinx(), thresh()]
            .iter()
            .map(|l| document(100, l))
            .collect();
        assert!(
            assign(&six, GAME, &RoleShares::default())
                .iter()
                .all(Option::is_none)
        );
    }

    fn champions(rows: &[(u32, &[(Role, u32)])]) -> ChampionsFile {
        ChampionsFile {
            info: DataSetInfo {
                schema: 1,
                patch: "16.19".into(),
                queue: 420,
                bracket: Bracket::EmeraldPlus,
                games: 100_000,
                updated_at: 1,
            },
            champions: rows
                .iter()
                .map(|&(id, roles)| ChampionStats {
                    id,
                    g: roles.iter().map(|&(_, g)| g).sum(),
                    w: 0,
                    bans: 0,
                    roles: roles
                        .iter()
                        .map(|&(role, g)| ChampionRoleStats {
                            role: Some(role),
                            g,
                            w: g / 2,
                            prev: None,
                        })
                        .collect(),
                })
                .collect(),
            priors: Vec::new(),
        }
    }

    /// Two flex picks both called TOP: the built-in prior plays Yone mid, the published stats of
    /// this patch (Yone mostly top, Jayce mostly mid) decide otherwise.
    #[test]
    fn published_stats_decide_over_the_prior() {
        let flex = |champion: u32, spells: [u32; 2]| Line {
            champion,
            spells,
            lane: "TOP",
            role: "SOLO",
            minions: 210,
            monsters: 6,
            items: [3031, 3047, 6333],
        };
        let team = [
            flex(777, [FLASH, TELEPORT]),
            lee_sin(),
            flex(126, [FLASH, IGNITE]),
            jinx(),
            thresh(),
        ];
        assert_eq!(roles_of(&team)[0], Some(Role::Middle));
        let published = RoleShares::published(&champions(&[
            (777, &[(Role::Top, 9_000), (Role::Middle, 1_000)]),
            (126, &[(Role::Middle, 7_000), (Role::Top, 1_500)]),
        ]));
        assert!(published.is_published());
        let roles = roles_with(&team, &published);
        assert_eq!((roles[0], roles[2]), (Some(Role::Top), Some(Role::Middle)));
    }

    #[test]
    fn shares_lean_on_the_prior_with_few_games() {
        let published = RoleShares::published(&champions(&[
            // Kennen: many games, mostly mid this patch.
            (85, &[(Role::Middle, 8_000), (Role::Top, 2_000)]),
            // Ahri: a handful of games in the support role.
            (103, &[(Role::Support, 5)]),
        ]));
        let kennen = published.of(85);
        assert!(kennen[MIDDLE] > 0.78 && kennen[TOP] < 0.22, "{kennen:?}");
        let ahri = published.of(103);
        assert!(
            ahri[MIDDLE] > 0.85,
            "a handful of games moves little: {ahri:?}"
        );
        // Not in the published file: the prior; unknown to the prior too: anywhere.
        let close = |a: [f64; 5], b: [f64; 5]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-12);
        assert!(close(published.of(222), usual(222)));
        assert!(close(published.of(9_999), [0.2; 5]));
        for shares in [kennen, ahri, published.of(222)] {
            assert!(
                (shares.iter().sum::<f64>() - 1.0).abs() < 1e-9,
                "{shares:?}"
            );
        }
        let aram = RoleShares::published(&ChampionsFile {
            champions: vec![ChampionStats {
                id: 85,
                g: 10,
                w: 5,
                bans: 0,
                roles: vec![ChampionRoleStats {
                    role: None,
                    g: 10,
                    w: 5,
                    prev: None,
                }],
            }],
            ..champions(&[])
        });
        assert!(!aram.is_published(), "ARAM files have no roles");
    }

    #[test]
    fn the_prior_is_sorted_and_whole() {
        assert!(USUAL.windows(2).all(|w| w[0].0 < w[1].0), "sorted by id");
        for (id, percent) in USUAL {
            let total: u16 = percent.iter().map(|&p| u16::from(p)).sum();
            assert_eq!(total, 100, "champion {id}");
        }
    }
}
