//! Settings → About → "Copy diagnostics": what the app, the League client and MVP's data look
//! like right now, plus the end of the log, as plain text the player pastes into a bug report.
//! Personal data (Riot IDs, PUUIDs, IP addresses, user folders…) is scrubbed from the log; the
//! install id stays (random, and it finds this install's crash reports).

use std::fmt::Write as _;

use domain::{ClientStatus, Settings};

/// Log lines put in the report.
pub const LOG_LINES: usize = 200;

/// Everything the report says, gathered by the command.
#[derive(Debug)]
pub struct Facts<'a> {
    pub version: &'a str,
    /// OS and webview (`windows x86_64, webview 131.0.2903.70`).
    pub system: &'a str,
    pub install_id: Option<&'a str>,
    pub client: &'a ClientStatus,
    pub backend: Option<&'a str>,
    /// The published stats' current patch, if the index was read.
    pub stats_patch: Option<&'a str>,
    /// Data Dragon version and locale of the game data loaded.
    pub game_data: Option<(&'a str, &'a str)>,
    /// Tiers whose ranked emblem is on disk.
    pub emblems: usize,
    pub settings: &'a Settings,
    /// Where the log is, and its last lines (unscrubbed: the report scrubs them).
    pub log: Option<(&'a str, &'a [String])>,
}

/// The report, as plain text.
pub fn report(facts: &Facts<'_>) -> String {
    let mut out = String::new();
    let none = "none";
    // `write!` to a String can't fail.
    let _ = writeln!(out, "MVP {} · {}", facts.version, facts.system);
    let _ = writeln!(out, "Install: {}", facts.install_id.unwrap_or(none));
    let _ = writeln!(
        out,
        "League client: {:?}, phase {:?}",
        facts.client.connection, facts.client.phase
    );
    let _ = writeln!(out, "Backend: {}", facts.backend.unwrap_or(none));
    let _ = writeln!(out, "Stats: patch {}", facts.stats_patch.unwrap_or(none));
    match facts.game_data {
        Some((version, locale)) => {
            let _ = writeln!(out, "Game data: {version} ({locale})");
        }
        None => {
            let _ = writeln!(out, "Game data: {none}");
        }
    }
    let _ = writeln!(out, "Rank emblems: {} of 10", facts.emblems);
    let settings = serde_json::to_string(facts.settings).unwrap_or_default();
    let _ = writeln!(out, "Settings: {settings}");
    match facts.log {
        Some((path, lines)) => {
            let _ = writeln!(
                out,
                "\n--- {}: last {} lines, personal data removed ---",
                scrub::scrub(path),
                lines.len()
            );
            for line in lines {
                let _ = writeln!(out, "{}", scrub::scrub(line));
            }
        }
        None => {
            let _ = writeln!(out, "\n--- no log file ---");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use domain::{ClientConnection, GameflowPhase};

    use super::*;

    #[test]
    fn says_what_runs_and_scrubs_the_log() {
        let client = ClientStatus {
            connection: ClientConnection::Connected,
            phase: GameflowPhase::ChampSelect,
        };
        let settings = Settings::default();
        let lines = vec![
            "INFO scouting done".to_owned(),
            "WARN lookup failed for Fillmo%237272".to_owned(),
        ];
        let text = report(&Facts {
            version: "0.2.0",
            system: "windows x86_64, webview 131.0",
            install_id: Some("inst-1"),
            client: &client,
            backend: Some("https://api.mvp.gg/"),
            stats_patch: Some("26.19"),
            game_data: Some(("16.19.1", "fr_FR")),
            emblems: 10,
            settings: &settings,
            log: Some(("C:\\logs\\mvp.log", &lines)),
        });
        assert!(text.starts_with("MVP 0.2.0 · windows x86_64, webview 131.0\n"));
        assert!(text.contains("League client: Connected, phase ChampSelect"));
        assert!(text.contains("Stats: patch 26.19"));
        assert!(text.contains("Game data: 16.19.1 (fr_FR)"));
        assert!(text.contains("Rank emblems: 10 of 10"));
        assert!(text.contains("\"language\":\"auto\""));
        assert!(text.contains("INFO scouting done"));
        assert!(!text.contains("Fillmo"), "{text}");
    }

    #[test]
    fn says_so_when_there_is_no_log() {
        let client = ClientStatus::not_running();
        let settings = Settings::default();
        let text = report(&Facts {
            version: "0.2.0",
            system: "linux x86_64",
            install_id: None,
            client: &client,
            backend: None,
            stats_patch: None,
            game_data: None,
            emblems: 0,
            settings: &settings,
            log: None,
        });
        assert!(text.contains("Install: none"));
        assert!(text.contains("Game data: none"));
        assert!(text.ends_with("--- no log file ---\n"));
    }
}
