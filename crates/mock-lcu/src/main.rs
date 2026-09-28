//! `cargo run -p mock-lcu` — a fake League client for developing the app without League.
//!
//! Writes `.cache/mock-lcu/{lockfile,ca.pem}` and loops through a whole game cycle
//! (lobby → queue → champ select → game → end of game), with a game session from the loading
//! screen on (loading-screen scouting). The local player has champion mastery, recent games and
//! a pickable-champion list, which the draft helper builds its pool-first picks from. Point a
//! debug build of the app at it:
//!   SCOUT_LCU_LOCKFILE=.cache/mock-lcu/lockfile SCOUT_LCU_CA=.cache/mock-lcu/ca.pem pnpm app

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
        json!({ "gameName": "Fillmo", "tagLine": "7272", "summonerLevel": 347, "profileIconId": 6311, "puuid": "00000000-mock-0000-0000-000000000000" }),
    );
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
            { "gameId": 7_000_000_003_u64, "queueId": 420, "gameCreation": 1_790_500_000_000_i64, "gameDuration": 1742,
              "participants": [{ "championId": 103, "timeline": { "lane": "MIDDLE", "role": "SOLO" },
                "stats": { "win": true, "kills": 9, "deaths": 2, "assists": 11, "totalMinionsKilled": 211, "neutralMinionsKilled": 20,
                           "item0": 6655, "item1": 3020, "item2": 4645, "item3": 3157, "item4": 3089 } }] },
            { "gameId": 7_000_000_002_u64, "queueId": 420, "gameCreation": 1_790_490_000_000_i64, "gameDuration": 1935,
              "participants": [{ "championId": 134, "timeline": { "lane": "MIDDLE", "role": "SOLO" },
                "stats": { "win": false, "kills": 3, "deaths": 6, "assists": 5, "totalMinionsKilled": 190, "neutralMinionsKilled": 8,
                           "item0": 6655, "item1": 3020, "item2": 3157 } }] },
            { "gameId": 7_000_000_001_u64, "queueId": 420, "gameCreation": 1_790_480_000_000_i64, "gameDuration": 1810,
              "participants": [{ "championId": 54, "timeline": { "lane": "TOP", "role": "SOLO" },
                "stats": { "win": true, "kills": 4, "deaths": 3, "assists": 14, "totalMinionsKilled": 201, "neutralMinionsKilled": 4,
                           "item0": 3068, "item1": 3047, "item2": 3075 } }] },
            { "gameId": 7_000_000_000_u64, "queueId": 440, "gameCreation": 1_790_470_000_000_i64, "gameDuration": 2011,
              "participants": [{ "championId": 516, "timeline": { "lane": "TOP", "role": "SOLO" },
                "stats": { "win": false, "kills": 1, "deaths": 5, "assists": 9, "totalMinionsKilled": 230, "neutralMinionsKilled": 0,
                           "item0": 3068, "item1": 3111 } }] }
        ] } }),
    );
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
                play_champ_select(&mock).await;
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

/// A short ranked draft: you (top) hover Malphite while picks come in on both sides.
async fn play_champ_select(mock: &MockLcu) {
    let session = |intent: u32, enemies: [u32; 5], phase: &str| {
        json!({
            "localPlayerCellId": 0,
            "myTeam": [
                { "cellId": 0, "assignedPosition": "top", "championId": 0, "championPickIntent": intent },
                { "cellId": 1, "assignedPosition": "jungle", "championId": 64 },
                { "cellId": 2, "assignedPosition": "middle", "championId": 103 },
                { "cellId": 3, "assignedPosition": "bottom", "championId": 0 },
                { "cellId": 4, "assignedPosition": "utility", "championId": 0, "championPickIntent": 412 }
            ],
            "theirTeam": enemies.iter().enumerate().map(|(i, c)| json!({ "cellId": 5 + i, "championId": c })).collect::<Vec<_>>(),
            "actions": [[{ "actorCellId": 0, "isInProgress": true, "type": "pick" }]],
            "bans": { "myTeamBans": [777, 238, 145, 799, 901], "theirTeamBans": [517, 266, 800, 111, 887] },
            "timer": { "phase": phase, "adjustedTimeLeftInPhase": 27_000 }
        })
    };
    mock.set(CHAMP_SELECT, session(0, [0; 5], "PLANNING"));
    tokio::time::sleep(Duration::from_secs(4)).await;
    mock.set(CHAMP_SELECT, session(54, [39, 0, 0, 0, 0], "BAN_PICK"));
    tokio::time::sleep(Duration::from_secs(4)).await;
    mock.set(CHAMP_SELECT, session(54, [39, 234, 910, 0, 0], "BAN_PICK"));
}

const fn lcu_phase_path() -> &'static str {
    "/lol-gameflow/v1/gameflow-phase"
}
