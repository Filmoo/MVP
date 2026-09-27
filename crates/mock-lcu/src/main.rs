//! `cargo run -p mock-lcu` — a fake League client for developing the app without League.
//!
//! Writes `.cache/mock-lcu/{lockfile,ca.pem}` and loops through a whole game cycle
//! (lobby → queue → champ select → game → end of game). Point a debug build of the app at it:
//!   SCOUT_LCU_LOCKFILE=.cache/mock-lcu/lockfile SCOUT_LCU_CA=.cache/mock-lcu/ca.pem pnpm app

use std::path::PathBuf;
use std::time::Duration;

use mock_lcu::MockLcu;
use serde_json::json;

const CYCLE: &[(&str, u64)] = &[
    ("None", 4),
    ("Lobby", 4),
    ("Matchmaking", 5),
    ("ReadyCheck", 3),
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
    loop {
        for (phase, seconds) in CYCLE {
            tracing::info!(phase, "gameflow");
            mock.set(lcu_phase_path(), json!(phase));
            if *phase == "ChampSelect" {
                play_champ_select(&mock).await;
            } else if *phase == "GameStart" {
                mock.remove(CHAMP_SELECT);
            }
            tokio::time::sleep(Duration::from_secs(*seconds)).await;
        }
    }
}

const CHAMP_SELECT: &str = "/lol-champ-select/v1/session";

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
