//! The local player's match history as the League client serves it: the list, which holds only
//! the local player's side of each game, and whole games (`/lol-match-history/v1/games/{id}`:
//! ten participants with their identities, stats, spells and runes). Made-up players and
//! numbers, the same on every run.

use serde_json::{Value, json};

use crate::MockLcu;

/// The local player's recent games.
pub const LIST: &str = "/lol-match-history/v1/products/lol/current-summoner/matches";

/// One whole game.
pub fn game_path(game_id: u64) -> String {
    format!("/lol-match-history/v1/games/{game_id}")
}

/// Who plays: the account logged in to the client.
#[derive(Debug, Clone)]
pub struct Local {
    pub puuid: String,
    pub game_name: String,
    pub tag_line: String,
    pub summoner_id: u64,
}

/// One made-up game of the local player, who sits on blue side (team 100).
#[derive(Debug, Clone)]
pub struct Game {
    pub game_id: u64,
    pub queue_id: u32,
    /// 11 Summoner's Rift, 12 Howling Abyss.
    pub map_id: u32,
    /// Unix epoch milliseconds.
    pub created: i64,
    pub duration: u32,
    /// The local player's champion and lane (`TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`, `UTILITY`).
    pub champion: u32,
    pub lane: &'static str,
    /// The local player's summoner spells (D, F).
    pub spells: [u32; 2],
    /// The local player's team won.
    pub win: bool,
}

/// Lanes in seat order, with the client's timeline `lane` and `role`.
const SEATS: [(&str, &str, &str); 5] = [
    ("TOP", "TOP", "SOLO"),
    ("JUNGLE", "JUNGLE", "NONE"),
    ("MIDDLE", "MIDDLE", "SOLO"),
    ("BOTTOM", "BOTTOM", "DUO_CARRY"),
    ("UTILITY", "BOTTOM", "DUO_SUPPORT"),
];

/// Champions others play, per lane.
const POOL: [[u32; 4]; 5] = [
    [39, 516, 24, 122],
    [104, 234, 11, 121],
    [238, 61, 7, 1],
    [51, 67, 81, 145],
    [89, 53, 117, 267],
];

const NAMES: [&str; 9] = [
    "Treeline Tom#EUW",
    "Quiet Storm#0412",
    "Lane Kingdom#EUW",
    "Wardwalker#FR1",
    "Blade Dancer#IRE",
    "Zed Is Life#1v9",
    "Crit Happens#ADC",
    "Hook City#BLTZ",
    "Mid Or Feed#GG",
];

/// Per-minute numbers by lane: CS, gold, damage to champions, damage taken, vision, objectives.
const PACE: [[u32; 6]; 5] = [
    [7, 390, 720, 1_150, 1, 280],
    [6, 380, 560, 1_050, 1, 520],
    [8, 420, 880, 760, 1, 200],
    [8, 430, 920, 640, 1, 360],
    [1, 260, 300, 880, 3, 60],
];

/// End-of-game numbers by lane: damage to champions that is physical and magic (percent, the
/// rest is true damage), share of the damage to objectives dealt to turrets (percent), healing
/// per minute, wards placed and destroyed per 25 minutes, control wards bought, seconds of crowd
/// control per 30 minutes.
const END: [[u32; 8]; 5] = [
    [60, 30, 70, 120, 8, 2, 1, 25],
    [55, 35, 15, 150, 14, 5, 3, 30],
    [15, 80, 60, 60, 9, 3, 1, 20],
    [85, 5, 70, 90, 8, 2, 1, 8],
    [20, 70, 50, 250, 30, 8, 5, 45],
];

const FLASH: u32 = 4;
const SMITE: u32 = 11;
const IGNITE: u32 = 14;
const TELEPORT: u32 = 12;
const HEAL: u32 = 7;
const EXHAUST: u32 = 3;

impl Game {
    fn aram(&self) -> bool {
        self.map_id == 12
    }

    fn my_seat(&self) -> usize {
        SEATS
            .iter()
            .position(|&(lane, _, _)| lane == self.lane)
            .unwrap_or(2)
    }

    /// A small number from the game and a seat, the same on every run.
    fn noise(&self, seat: usize, salt: u64) -> u32 {
        let seed = self
            .game_id
            .wrapping_mul(2_654_435_761)
            .wrapping_add((seat as u64 + 1) * 97 + salt * 31);
        u32::try_from(seed % 7).unwrap_or(0)
    }

    /// Seat `seat` (0–4 blue, 5–9 red): champion, lane index, stats.
    fn participant(&self, seat: usize) -> Value {
        let lane = seat % 5;
        let blue = seat < 5;
        let mine = blue && lane == self.my_seat();
        let won = blue == self.win;
        let minutes = self.duration / 60;
        let pace = PACE[lane];
        let bonus = |n: u32| if won { n + n / 6 } else { n - n / 8 };
        let n = |salt: u64| self.noise(seat, salt);
        let champion = if mine {
            self.champion
        } else {
            let options = POOL[lane];
            let pick = usize::try_from(self.game_id % 4).unwrap_or(0) + seat / 5;
            let candidate = options[pick % 4];
            if candidate == self.champion {
                options[(pick + 1) % 4]
            } else {
                candidate
            }
        };
        let (kills, deaths, assists) = match lane {
            4 => (n(1) / 3, 3 + n(2) / 2, 8 + n(3) * 2),
            _ if won => (4 + n(1), 2 + n(2) / 2, 5 + n(3)),
            _ => (1 + n(1) / 2, 4 + n(2) / 2, 3 + n(3)),
        };
        let spells = if mine {
            self.spells
        } else {
            match lane {
                1 => [SMITE, FLASH],
                0 => [TELEPORT, FLASH],
                3 => [HEAL, FLASH],
                4 => [EXHAUST, FLASH],
                _ => [IGNITE, FLASH],
            }
        };
        let (lane_name, role) = if self.aram() {
            ("MIDDLE", "DUO")
        } else {
            (SEATS[lane].1, SEATS[lane].2)
        };
        let minions = bonus(pace[0] * minutes) + n(4) * 3;
        // The support holds the support item (Dream Maker), as in real games.
        let items = [
            [3078, 3071, 6655, 6672, 3870][lane],
            [3047, 3047, 3020, 3006, 3158][lane],
            [3053, 3053, 4645, 3031, 3190][lane],
            if won { 3089 } else { 0 },
        ];
        let trinket = if lane == 4 { 3364 } else { 3340 };
        let (keystone, primary, secondary) = [
            (8010, 8000, 8400),
            (8005, 8000, 8100),
            (8112, 8100, 8300),
            (8008, 8000, 8200),
            (8214, 8200, 8300),
        ][lane];
        let gold = bonus(pace[1] * minutes) + n(7) * 150;
        let damage = bonus(pace[2] * minutes) + n(8) * 900;
        let objectives = bonus(pace[5] * minutes) + n(11) * 400;
        let end = END[lane];
        let (physical, magic) = (damage * end[0] / 100, damage * end[1] / 100);
        // No wards on Howling Abyss.
        let wards = |per_25: u32, salt: u64| {
            if self.aram() {
                0
            } else {
                per_25 * minutes / 25 + n(salt) / 2
            }
        };
        // First blood: one of the winners' laners.
        let first_blood =
            seat == usize::try_from(self.game_id % 4).unwrap_or(0) + if self.win { 0 } else { 5 };
        let mut stats = json!({
            "win": won, "kills": kills, "deaths": deaths, "assists": assists,
            "champLevel": 12 + minutes / 5 + n(5) / 3,
            "totalMinionsKilled": if lane == 1 { minions / 4 } else { minions },
            "neutralMinionsKilled": if lane == 1 { minions * 3 / 4 } else { n(6) },
            "goldEarned": gold,
            "totalDamageDealtToChampions": damage,
            "totalDamageTaken": pace[3] * minutes + n(9) * 700,
            "damageSelfMitigated": pace[3] * minutes / 2,
            "visionScore": pace[4] * minutes + n(10) * 2,
            "damageDealtToObjectives": objectives,
            "item0": items[0], "item1": items[1], "item2": items[2], "item3": 0,
            "item4": items[3], "item5": 0, "item6": trinket,
            "perk0": keystone, "perkPrimaryStyle": primary, "perkSubStyle": secondary
        });
        // The end-of-game numbers the client keeps with each game (its match history has no
        // healing or shielding done to teammates).
        let end_of_game = json!({
            "largestKillingSpree": kills.min(2 + n(12) / 2),
            "largestMultiKill": match kills { 0 => 0, 1..=5 => 1, _ => 2 + n(13) / 4 },
            "firstBloodKill": first_blood, "firstBloodAssist": false,
            "physicalDamageDealtToChampions": physical,
            "magicDamageDealtToChampions": magic,
            "trueDamageDealtToChampions": damage - physical - magic,
            "damageDealtToTurrets": objectives * end[2] / 100,
            "totalHeal": end[3] * minutes + n(14) * 100,
            "wardsPlaced": wards(end[4], 15), "wardsKilled": wards(end[5], 16),
            "visionWardsBoughtInGame": if self.aram() { 0 } else { end[6] + n(17) / 3 },
            "goldSpent": gold - gold / 12,
            "timeCCingOthers": end[7] * minutes / 30 + n(18) * 2,
            "turretKills": if won { [2, 0, 1, 2, 0][lane] } else { u32::from(lane == 0) },
            "inhibitorKills": u32::from(won && lane == 3)
        });
        if let (Some(stats), Value::Object(more)) = (stats.as_object_mut(), end_of_game) {
            stats.extend(more);
        }
        json!({
            "participantId": seat + 1,
            "teamId": if blue { 100 } else { 200 },
            "championId": champion,
            "spell1Id": spells[0],
            "spell2Id": spells[1],
            "timeline": { "lane": lane_name, "role": role },
            "stats": stats
        })
    }

    /// The identity of seat `seat`: the local player's, made-up ones, and one enemy in streamer
    /// mode (the client leaves their name out).
    fn identity(&self, seat: usize, me: &Local) -> Value {
        let lane = seat % 5;
        let player = if seat < 5 && lane == self.my_seat() {
            json!({ "puuid": me.puuid, "summonerId": me.summoner_id, "gameName": me.game_name, "tagLine": me.tag_line })
        } else if seat == 6 {
            json!({ "puuid": "", "summonerId": 0, "gameName": "", "tagLine": "", "nameVisibilityType": "HIDDEN" })
        } else {
            let (name, tag) = NAMES[(seat + usize::try_from(self.game_id % 9).unwrap_or(0)) % 9]
                .split_once('#')
                .unwrap_or(("Player", "EUW"));
            json!({ "puuid": format!("mock-{}-{seat}", self.game_id), "summonerId": 1_000 + seat, "gameName": name, "tagLine": tag })
        };
        json!({ "participantId": seat + 1, "player": player })
    }

    /// The whole game, as `/lol-match-history/v1/games/{id}` answers it.
    pub fn document(&self, me: &Local) -> Value {
        json!({
            "gameId": self.game_id, "platformId": "EUW1", "queueId": self.queue_id, "mapId": self.map_id,
            "gameCreation": self.created, "gameDuration": self.duration, "gameMode": if self.aram() { "ARAM" } else { "CLASSIC" },
            "participantIdentities": (0..10).map(|seat| self.identity(seat, me)).collect::<Vec<_>>(),
            "participants": (0..10).map(|seat| self.participant(seat)).collect::<Vec<_>>(),
            "teams": [{ "teamId": 100, "win": if self.win { "Win" } else { "Fail" } },
                      { "teamId": 200, "win": if self.win { "Fail" } else { "Win" } }]
        })
    }

    /// The list's entry: the local player's side only.
    pub fn summary(&self, me: &Local) -> Value {
        let mut entry = self.document(me);
        let seat = self.my_seat();
        entry["participantIdentities"] = json!([self.identity(seat, me)]);
        entry["participants"] = json!([self.participant(seat)]);
        if let Some(map) = entry.as_object_mut() {
            map.remove("teams");
        }
        entry
    }
}

/// Serves `games` (newest first) as the client does: the list and every whole game.
pub fn serve(mock: &MockLcu, me: &Local, games: &[Game]) {
    mock.set(
        LIST,
        json!({ "games": { "games": games.iter().map(|g| g.summary(me)).collect::<Vec<_>>() } }),
    );
    for game in games {
        mock.set(&game_path(game.game_id), game.document(me));
    }
}
