//! `cargo run -p mock-lcu` — a fake League client for developing the app without League.
//!
//! Writes `.cache/mock-lcu/{lockfile,ca.pem}` and loops through a whole game cycle
//! (lobby → queue → champ select → game → end of game), with a game session from the loading
//! screen on (loading-screen scouting). Point a debug build of the app at it:
//!   SCOUT_LCU_LOCKFILE=.cache/mock-lcu/lockfile SCOUT_LCU_CA=.cache/mock-lcu/ca.pem pnpm app
//!
//! The player has rune pages (two presets, two of their own, room for one more), item sets and
//! Flash on F in their recent games; in champion select they lock in, then finalization runs,
//! so build imports (one click and on lock-in) can be tried. Every write is logged.

use std::path::PathBuf;
use std::time::Duration;

use mock_lcu::MockLcu;
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
    let dir = PathBuf::from(".cache/mock-lcu");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("lockfile"), mock.lockfile())?;
    std::fs::write(dir.join("ca.pem"), mock.ca_pem())?;
    tracing::info!(port = mock.port(), dir = %dir.display(), "mock League client running (Ctrl+C to stop)");

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
    mock.set(
        "/lol-match-history/v1/products/lol/current-summoner/matches",
        json!({ "games": { "games": [
            { "gameId": 7_000_000_003_u64, "queueId": 420, "mapId": 11, "gameCreation": 1_790_500_000_000_i64, "gameDuration": 1742,
              "participants": [{ "championId": 103, "spell1Id": 14, "spell2Id": 4, "timeline": { "lane": "MIDDLE", "role": "SOLO" },
                "stats": { "win": true, "kills": 9, "deaths": 2, "assists": 11, "totalMinionsKilled": 211, "neutralMinionsKilled": 20,
                           "item0": 6655, "item1": 3020, "item2": 4645, "item3": 3157, "item4": 3089 } }] },
            { "gameId": 7_000_000_002_u64, "queueId": 420, "mapId": 11, "gameCreation": 1_790_490_000_000_i64, "gameDuration": 1935,
              "participants": [{ "championId": 134, "spell1Id": 12, "spell2Id": 4, "timeline": { "lane": "MIDDLE", "role": "SOLO" },
                "stats": { "win": false, "kills": 3, "deaths": 6, "assists": 5, "totalMinionsKilled": 190, "neutralMinionsKilled": 8,
                           "item0": 6655, "item1": 3020, "item2": 3157 } }] }
        ] } }),
    );
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
                play_champ_select(&mock, *seconds).await;
                log_writes(&mock);
            } else if *phase == "GameStart" {
                mock.remove(CHAMP_SELECT);
                mock.set(GAME_SESSION, game_session());
            } else if *phase == "None" {
                mock.remove(GAME_SESSION);
            }
            tokio::time::sleep(Duration::from_secs(*seconds)).await;
        }
    }
}

const CHAMP_SELECT: &str = "/lol-champ-select/v1/session";
const GAME_SESSION: &str = "/lol-gameflow/v1/session";

/// The game the draft led to, as the client shows it from the loading screen on: both teams
/// with champions, positions and spells. One enemy plays in streamer mode (identity hidden).
/// PUUIDs are made up, so a real backend answers without cards for them.
fn game_session() -> serde_json::Value {
    let member = |puuid: &str, name: &str, champion: u32, position: &str| {
        let (game_name, tag_line) = name.split_once('#').unwrap_or((name, ""));
        json!({ "puuid": puuid, "gameName": game_name, "tagLine": tag_line, "championId": champion, "selectedPosition": position })
    };
    let spells = |puuid: &str, champion: u32, spell1: u32, spell2: u32| json!({ "puuid": puuid, "championId": champion, "spell1Id": spell1, "spell2Id": spell2 });
    json!({
        "phase": "GameStart",
        "gameData": {
            "gameId": 7_100_000_001_u64,
            "queue": { "id": 420, "type": "RANKED_SOLO_5x5", "isRanked": true },
            "teamOne": [
                member("00000000-mock-0000-0000-000000000000", "Fillmo#7272", 54, "TOP"),
                member("mock-ally-2", "Treeline Tom#EUW", 64, "JUNGLE"),
                member("mock-ally-3", "Quiet Storm#0412", 103, "MIDDLE"),
                member("mock-ally-4", "Lane Kingdom#EUW", 222, "BOTTOM"),
                member("mock-ally-5", "Wardwalker#FR1", 412, "UTILITY")
            ],
            "teamTwo": [
                member("mock-enemy-1", "Blade Dancer#IRE", 39, "TOP"),
                { "puuid": "", "championId": 234, "selectedPosition": "JUNGLE", "nameVisibilityType": "HIDDEN" },
                member("mock-enemy-3", "Zed Is Life#1v9", 910, "MIDDLE"),
                member("mock-enemy-4", "Crit Happens#ADC", 51, "BOTTOM"),
                member("mock-enemy-5", "Hook City#BLTZ", 53, "UTILITY")
            ],
            "playerChampionSelections": [
                spells("00000000-mock-0000-0000-000000000000", 54, 4, 12),
                spells("mock-ally-2", 64, 11, 4),
                spells("mock-ally-3", 103, 4, 14),
                spells("mock-ally-4", 222, 4, 7),
                spells("mock-ally-5", 412, 4, 14),
                spells("mock-enemy-1", 39, 12, 4),
                spells("", 234, 11, 4),
                spells("mock-enemy-3", 910, 4, 14),
                spells("mock-enemy-4", 51, 4, 21),
                spells("mock-enemy-5", 53, 4, 14)
            ]
        }
    })
}

const SUMMONER_ID: u64 = 2_345_678;

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
