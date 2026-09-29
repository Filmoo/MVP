//! `cargo run -p mock-lcu` — a fake League client for developing the app without League.
//!
//! Writes `.cache/mock-lcu/{lockfile,ca.pem,game-client}` and loops through a whole game cycle
//! (lobby → queue → champ select → game → end of game), with a game session from the loading
//! screen on (loading-screen scouting) in the real client's shape: nobody named but the local
//! player (through `current-summoner`). The game's own Live Client Data API is played too, on
//! another port: it answers 6 s into the game with everyone's Riot ID, one enemy in streamer
//! mode. The local player has champion mastery, recent games and a pickable-champion list,
//! which the draft helper builds its pool-first picks from. Point a debug build of the app at it:
//! ```sh
//! SCOUT_LCU_LOCKFILE=.cache/mock-lcu/lockfile SCOUT_LCU_CA=.cache/mock-lcu/ca.pem \
//!   SCOUT_GAME_CLIENT=$(cat .cache/mock-lcu/game-client) pnpm app
//! ```
//!
//! The player has rune pages (two presets, two of their own, room for one more), item sets and
//! Flash on F in their recent games (each whole game served too: grades and match details); in champion select they lock in, then finalization runs,
//! so build imports (one click and on lock-in) can be tried. Every write is logged.
//!
//! `cargo run -p mock-lcu -- --aram` plays ARAM champion selects instead: no roles, a shared
//! bench, one reroll, then a swap with the bench.

use std::path::PathBuf;
use std::time::Duration;

use mock_lcu::MockLcu;
use mock_lcu::history::{self, Game, Local};
use serde_json::json;

const CYCLE: &[(&str, u64)] = &[
    ("None", 4),
    ("Lobby", 4),
    ("Matchmaking", 5),
    ("ReadyCheck", 8),
    ("ChampSelect", 20),
    ("GameStart", 4),
    ("InProgress", 20),
    ("WaitingForStats", 3),
    ("EndOfGame", 6),
];

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let mock = MockLcu::start().await?;
    let game = mock.start_game().await?;
    let dir = PathBuf::from(".cache/mock-lcu");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("lockfile"), mock.lockfile())?;
    std::fs::write(dir.join("ca.pem"), mock.ca_pem())?;
    std::fs::write(dir.join("game-client"), game.url())?;
    tracing::info!(port = mock.port(), dir = %dir.display(), "mock League client running (Ctrl+C to stop)");
    tracing::info!(url = game.url(), "the game's API (SCOUT_GAME_CLIENT)");

    mock.set(
        "/lol-summoner/v1/current-summoner",
        json!({ "gameName": "Fillmo", "tagLine": "7272", "summonerLevel": 347, "profileIconId": 6311, "puuid": "00000000-mock-0000-0000-000000000000",
                "summonerId": SUMMONER_ID, "accountId": SUMMONER_ID }),
    );
    set_up_builds(&mock);
    mock.set(
        "/riotclient/region-locale",
        json!({ "region": "EUW", "locale": "en_GB" }),
    );
    mock.set(
        "/lol-ranked/v1/current-ranked-stats",
        json!({ "queueMap": { "RANKED_SOLO_5x5": { "tier": "EMERALD", "division": "II", "leaguePoints": 67, "wins": 142, "losses": 128 } } }),
    );
    // Recent games: the list and each whole game (grades and match details on Home).
    history::serve(&mock, &local(), &recent_games());
    // The local player's own mastery and what they can pick (the draft helper's pool).
    mock.set(
        "/lol-champion-mastery/v1/local-player/champion-mastery",
        json!([
            { "championId": 103, "championLevel": 12, "championPoints": 412_300, "lastPlayTime": 1_790_500_000_000_i64 },
            { "championId": 54, "championLevel": 9, "championPoints": 245_800, "lastPlayTime": 1_790_480_000_000_i64 },
            { "championId": 516, "championLevel": 7, "championPoints": 98_400, "lastPlayTime": 1_790_470_000_000_i64 },
            { "championId": 98, "championLevel": 5, "championPoints": 41_200, "lastPlayTime": 1_780_000_000_000_i64 },
            { "championId": 134, "championLevel": 5, "championPoints": 38_900, "lastPlayTime": 1_790_490_000_000_i64 },
            { "championId": 412, "championLevel": 4, "championPoints": 21_000, "lastPlayTime": 1_770_000_000_000_i64 }
        ]),
    );
    mock.set(
        "/lol-champ-select/v1/pickable-champion-ids",
        json!([
            1, 3, 12, 22, 24, 51, 53, 54, 57, 58, 64, 75, 78, 86, 98, 99, 103, 111, 122, 134, 145,
            157, 222, 234, 238, 266, 412, 516, 517, 555, 777, 799, 800, 887, 897, 901, 910
        ]),
    );
    let aram = std::env::args().any(|arg| arg == "--aram");
    loop {
        for (phase, seconds) in CYCLE {
            tracing::info!(phase, "gameflow");
            if *phase == "ReadyCheck" {
                // Accepted by the app when auto-accept is on (the POST is logged by the mock).
                mock.start_ready_check();
                tokio::time::sleep(Duration::from_secs(*seconds)).await;
                let accepted = mock.count("POST", mock_lcu::READY_CHECK_ACCEPT);
                tracing::info!(accepted, "ready check over (accept requests so far)");
                mock.remove(mock_lcu::READY_CHECK);
                continue;
            }
            mock.set(lcu_phase_path(), json!(phase));
            if *phase == "ChampSelect" {
                if aram {
                    play_aram_champ_select(&mock, *seconds).await;
                } else {
                    play_champ_select(&mock, *seconds).await;
                }
                log_writes(&mock);
            } else if *phase == "GameStart" {
                mock.remove(CHAMP_SELECT);
                mock.set(GAME_SESSION, game_session());
            } else if *phase == "InProgress" {
                // The loading screen: the game's API answers once the game has loaded.
                tokio::time::sleep(Duration::from_secs(GAME_LOADS_AFTER)).await;
                game.set_players(&game_players());
                tracing::info!("the game has loaded: its API lists the players");
                tokio::time::sleep(Duration::from_secs(
                    seconds.saturating_sub(GAME_LOADS_AFTER),
                ))
                .await;
                continue;
            } else if *phase == "WaitingForStats" {
                game.clear();
            } else if *phase == "None" {
                mock.remove(GAME_SESSION);
            }
            tokio::time::sleep(Duration::from_secs(*seconds)).await;
        }
    }
}

const CHAMP_SELECT: &str = "/lol-champ-select/v1/session";
const GAME_SESSION: &str = "/lol-gameflow/v1/session";
/// Seconds into `InProgress` before the game's API answers (the real one took 23 s).
const GAME_LOADS_AFTER: u64 = 6;

/// The game the draft led to, as the client shows it from the loading screen on (the real
/// client's shape, 2026-09): champions, positions and spells, the client's PUUIDs, and no
/// names at all — only `current-summoner` names the local player.
fn game_session() -> serde_json::Value {
    let member = |participant: u32, puuid: &str, champion: u32, position: &str| {
        json!({ "championId": champion, "lastSelectedSkinIndex": 0, "profileIconId": 29, "puuid": puuid,
                "selectedPosition": position, "selectedRole": format!("{position}.PRIMARY.{position}.UNSELECTED"),
                "summonerId": 2_000_000 + participant, "summonerInternalName": "", "summonerName": "",
                "teamOwner": false, "teamParticipantId": participant })
    };
    let spells = |puuid: &str, champion: u32, spell1: u32, spell2: u32| json!({ "puuid": puuid, "championId": champion, "selectedSkinIndex": 0, "spell1Id": spell1, "spell2Id": spell2 });
    json!({
        "phase": "GameStart",
        "gameData": {
            "gameId": 7_100_000_001_u64,
            "queue": { "id": 420, "mapId": 11, "type": "RANKED_SOLO_5x5", "isRanked": true },
            "teamOne": [
                member(1, "00000000-mock-0000-0000-000000000000", 54, "TOP"),
                member(2, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a02", 64, "JUNGLE"),
                member(3, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a03", 103, "MIDDLE"),
                member(4, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a04", 222, "BOTTOM"),
                member(5, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a05", 412, "UTILITY")
            ],
            "teamTwo": [
                member(6, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a06", 39, "TOP"),
                member(7, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a07", 234, "JUNGLE"),
                member(8, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a08", 910, "MIDDLE"),
                member(9, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a09", 51, "BOTTOM"),
                member(10, "5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a10", 53, "UTILITY")
            ],
            "playerChampionSelections": [
                spells("00000000-mock-0000-0000-000000000000", 54, 4, 12),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a02", 64, 11, 4),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a03", 103, 4, 14),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a04", 222, 4, 7),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a05", 412, 4, 14),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a06", 39, 12, 4),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a07", 234, 11, 4),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a08", 910, 4, 14),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a09", 51, 4, 21),
                spells("5c1e0a52-2f0e-4c8e-9a41-7d1b3c9e0a10", 53, 4, 14)
            ]
        }
    })
}

/// The same game as the game's own API lists it once loaded: invented Riot IDs, and the enemy
/// jungler in streamer mode (the game shows their champion's name instead).
fn game_players() -> Vec<serde_json::Value> {
    use mock_lcu::game::player;
    vec![
        player(
            Some("Fillmo#7272"),
            "Malphite",
            "ORDER",
            "TOP",
            ["SummonerFlash", "SummonerTeleport"],
            false,
        ),
        player(
            Some("Treeline Tom#EUW"),
            "LeeSin",
            "ORDER",
            "JUNGLE",
            ["SummonerSmite", "SummonerFlash"],
            false,
        ),
        player(
            Some("Quiet Storm#0412"),
            "Ahri",
            "ORDER",
            "MIDDLE",
            ["SummonerFlash", "SummonerDot"],
            false,
        ),
        player(
            Some("Lane Kingdom#EUW"),
            "Jinx",
            "ORDER",
            "BOTTOM",
            ["SummonerFlash", "SummonerHeal"],
            false,
        ),
        player(
            Some("Wardwalker#FR1"),
            "Thresh",
            "ORDER",
            "UTILITY",
            ["SummonerFlash", "SummonerDot"],
            false,
        ),
        player(
            Some("Blade Dancer#IRE"),
            "Irelia",
            "CHAOS",
            "TOP",
            ["SummonerTeleport", "SummonerFlash"],
            false,
        ),
        player(
            None,
            "Viego",
            "CHAOS",
            "JUNGLE",
            ["SummonerSmite", "SummonerFlash"],
            false,
        ),
        player(
            Some("Zed Is Life#1v9"),
            "Hwei",
            "CHAOS",
            "MIDDLE",
            ["SummonerFlash", "SummonerDot"],
            false,
        ),
        player(
            Some("Crit Happens#ADC"),
            "Caitlyn",
            "CHAOS",
            "BOTTOM",
            ["SummonerFlash", "SummonerBarrier"],
            false,
        ),
        player(
            Some("Hook City#BLTZ"),
            "Blitzcrank",
            "CHAOS",
            "UTILITY",
            ["SummonerFlash", "SummonerDot"],
            false,
        ),
    ]
}

const SUMMONER_ID: u64 = 2_345_678;

/// The account logged in to the fake client.
fn local() -> Local {
    Local {
        puuid: "00000000-mock-0000-0000-000000000000".to_owned(),
        game_name: "Fillmo".to_owned(),
        tag_line: "7272".to_owned(),
        summoner_id: SUMMONER_ID,
    }
}

/// The local player's last games, newest first: mid and top, Flash on F.
fn recent_games() -> Vec<Game> {
    let game = |game_id, queue_id, created, duration, champion, lane, spells, win| Game {
        game_id,
        queue_id,
        map_id: 11,
        created,
        duration,
        champion,
        lane,
        spells,
        win,
    };
    vec![
        game(
            7_000_000_003,
            420,
            1_790_500_000_000,
            1742,
            103,
            "MIDDLE",
            [14, 4],
            true,
        ),
        game(
            7_000_000_002,
            420,
            1_790_490_000_000,
            1935,
            134,
            "MIDDLE",
            [12, 4],
            false,
        ),
        game(
            7_000_000_001,
            420,
            1_790_480_000_000,
            1810,
            54,
            "TOP",
            [12, 4],
            true,
        ),
        game(
            7_000_000_000,
            440,
            1_790_470_000_000,
            2011,
            516,
            "TOP",
            [12, 4],
            false,
        ),
    ]
}

/// What build imports read and write: rune pages with room for one more, item sets.
fn set_up_builds(mock: &MockLcu) {
    let page = |id: u64, name: &str, own: bool, current: bool| {
        json!({ "id": id, "name": name, "isDeletable": own, "isEditable": own, "current": current, "isActive": current,
                "primaryStyleId": 8000, "subStyleId": 8200, "selectedPerkIds": [8005, 9111, 9104, 8014, 8233, 8236, 5005, 5008, 5002] })
    };
    mock.set(
        "/lol-perks/v1/pages",
        json!([
            page(1, "Precision", false, false),
            page(2, "Domination", false, false),
            page(101, "Malphite top", true, true),
            page(102, "Jungle", true, false)
        ]),
    );
    mock.set(
        "/lol-perks/v1/inventory",
        json!({ "ownedPageCount": 3, "customPageCount": 2, "isCustomPageCreationUnlocked": true }),
    );
    mock.set(
        &format!("/lol-item-sets/v1/item-sets/{SUMMONER_ID}/sets"),
        json!({ "accountId": SUMMONER_ID, "timestamp": 1_790_000_000_000_i64, "itemSets": [
            { "uid": "player-set-1", "title": "My Malphite", "type": "custom", "map": "any", "mode": "any", "sortrank": 0, "startedFrom": "blank",
              "associatedChampions": [54], "associatedMaps": [11], "preferredItemSlots": [],
              "blocks": [{ "type": "Armor", "items": [{ "id": "3075", "count": 1 }], "hideIfSummonerSpell": "", "showIfSummonerSpell": "" }] }
        ] }),
    );
}

fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// A short ranked draft: you (top) hover Malphite while picks come in on both sides, lock it
/// in, then finalization runs for `finalization` seconds.
async fn play_champ_select(mock: &MockLcu, finalization: u64) {
    let session = |intent: u32, locked: bool, enemies: [u32; 5], phase: &str, left_ms: u64| {
        json!({
            "localPlayerCellId": 0,
            "myTeam": [
                { "cellId": 0, "assignedPosition": "top", "championId": if locked { intent } else { 0 }, "championPickIntent": intent, "spell1Id": 4, "spell2Id": 12 },
                { "cellId": 1, "assignedPosition": "jungle", "championId": 64 },
                { "cellId": 2, "assignedPosition": "middle", "championId": 103 },
                { "cellId": 3, "assignedPosition": "bottom", "championId": 0 },
                { "cellId": 4, "assignedPosition": "utility", "championId": 0, "championPickIntent": 412 }
            ],
            "theirTeam": enemies.iter().enumerate().map(|(i, c)| json!({ "cellId": 5 + i, "championId": c })).collect::<Vec<_>>(),
            "actions": [[{ "actorCellId": 0, "championId": intent, "completed": locked, "isInProgress": !locked, "type": "pick" }]],
            "bans": { "myTeamBans": [777, 238, 145, 799, 901], "theirTeamBans": [517, 266, 800, 111, 887] },
            "timer": { "phase": phase, "adjustedTimeLeftInPhase": left_ms, "internalNowInEpochMs": epoch_ms(), "isInfinite": false }
        })
    };
    mock.set(
        GAME_SESSION,
        json!({ "phase": "ChampSelect", "gameData": { "queue": { "id": 420, "mapId": 11, "type": "RANKED_SOLO_5x5" } } }),
    );
    mock.set(CHAMP_SELECT, session(0, false, [0; 5], "PLANNING", 27_000));
    tokio::time::sleep(Duration::from_secs(3)).await;
    mock.set(
        CHAMP_SELECT,
        session(54, false, [39, 0, 0, 0, 0], "BAN_PICK", 27_000),
    );
    tokio::time::sleep(Duration::from_secs(3)).await;
    mock.set(
        CHAMP_SELECT,
        session(54, false, [39, 234, 910, 0, 0], "BAN_PICK", 21_000),
    );
    tokio::time::sleep(Duration::from_secs(3)).await;
    // Locked in: imports set to "on lock-in" run now.
    mock.set(
        CHAMP_SELECT,
        session(54, true, [39, 234, 910, 0, 0], "BAN_PICK", 18_000),
    );
    tokio::time::sleep(Duration::from_secs(3)).await;
    mock.set(
        CHAMP_SELECT,
        session(
            54,
            true,
            [39, 234, 910, 51, 53],
            "FINALIZATION",
            finalization * 1000,
        ),
    );
}

/// An ARAM champion select: everyone gets a champion (you: Lux), the bench holds Brand and
/// Sion; you reroll (Karthus, Lux goes to the bench), then take Brand from the bench.
async fn play_aram_champ_select(mock: &MockLcu, finalization: u64) {
    let session = |mine: u32, bench: &[u32], rerolls: u32, left_ms: u64| {
        json!({
            "localPlayerCellId": 0,
            "myTeam": [
                { "cellId": 0, "assignedPosition": "", "championId": mine, "spell1Id": 4, "spell2Id": 32 },
                { "cellId": 1, "assignedPosition": "", "championId": 222 },
                { "cellId": 2, "assignedPosition": "", "championId": 54 },
                { "cellId": 3, "assignedPosition": "", "championId": 37 },
                { "cellId": 4, "assignedPosition": "", "championId": 115 }
            ],
            "theirTeam": [],
            "actions": [],
            "bans": { "myTeamBans": [], "theirTeamBans": [], "numBans": 0 },
            "benchEnabled": true,
            "benchChampions": bench.iter().map(|c| json!({ "championId": c, "isPriority": false })).collect::<Vec<_>>(),
            "allowRerolling": true,
            "rerollsRemaining": rerolls,
            "timer": { "phase": "FINALIZATION", "adjustedTimeLeftInPhase": left_ms, "internalNowInEpochMs": epoch_ms(), "isInfinite": false }
        })
    };
    mock.set(
        GAME_SESSION,
        json!({ "phase": "ChampSelect", "gameData": { "queue": { "id": 450, "mapId": 12, "type": "ARAM_UNRANKED_5x5" } } }),
    );
    let total = finalization * 1000;
    mock.set(CHAMP_SELECT, session(99, &[63, 14], 1, total));
    tokio::time::sleep(Duration::from_secs(4)).await;
    mock.set(
        CHAMP_SELECT,
        session(30, &[63, 14, 99], 0, total.saturating_sub(4_000)),
    );
    tokio::time::sleep(Duration::from_secs(4)).await;
    mock.set(
        CHAMP_SELECT,
        session(63, &[14, 99, 30], 0, total.saturating_sub(8_000)),
    );
}

/// What the app wrote into the client during champion select.
fn log_writes(mock: &MockLcu) {
    let writes: Vec<String> = mock
        .requests()
        .into_iter()
        .filter(|(method, _)| matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE"))
        .map(|(method, path)| format!("{method} {path}"))
        .collect();
    tracing::info!(?writes, "client writes so far");
}

const fn lcu_phase_path() -> &'static str {
    "/lol-gameflow/v1/gameflow-phase"
}
