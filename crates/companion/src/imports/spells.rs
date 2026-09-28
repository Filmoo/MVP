//! Summoner spells, during champion select only. The owner's Flash rule: Flash goes on the key
//! the player keeps it on (from their recent games, or their setting), the player is told when
//! that differs from the build or had to be guessed, and spells never change in the last
//! seconds of the timer ([`LAST_SECONDS`]) — the game may start when it runs out.

use std::cmp::Ordering;

use domain::{BuildStats, FailReason, FlashKey, FlashNote, ImportOutcome, SkipReason, SpellKey};
use lcu::LcuClient;
use reqwest::Method;
use serde_json::{Value, json};

use super::{client_failure, now_ms};
use crate::champ_select::SESSION;
use crate::profile::MATCHES;

/// `PATCH { spell1Id, spell2Id }`: the local player's spells (D, F).
pub const MY_SELECTION: &str = "/lol-champ-select/v1/session/my-selection";
/// Flash's summoner spell id.
pub const FLASH: u32 = 4;
/// Spells never change with this many seconds or fewer left on the champion select timer.
pub const LAST_SECONDS: u32 = 5;
/// No habit and no Flash picked yet: where Flash goes (the player is told, see
/// [`FlashNote::Guessed`], and can choose in Settings).
const GUESS: SpellKey = SpellKey::F;

/// Where Flash should go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyChoice {
    /// The player's key: their setting, their recent games or their current selection.
    Known(SpellKey),
    /// Nothing to go by.
    Guessed(SpellKey),
}

/// Puts the build's two spells on D and F: Flash on the chosen key, the other spell on the
/// other key; with a note when the player should know where Flash went.
pub fn arrange(build: [u32; 2], choice: KeyChoice) -> ([u32; 2], Option<FlashNote>) {
    let [first, second] = build;
    let (listed_on, other) = if first == FLASH {
        (SpellKey::D, second)
    } else if second == FLASH {
        (SpellKey::F, first)
    } else {
        return (build, Some(FlashNote::NotInBuild));
    };
    let (key, note) = match choice {
        KeyChoice::Known(key) => (
            key,
            (key != listed_on).then_some(FlashNote::KeptOnYourKey { key }),
        ),
        KeyChoice::Guessed(key) => (key, Some(FlashNote::Guessed { key })),
    };
    let spells = match key {
        SpellKey::D => [FLASH, other],
        SpellKey::F => [other, FLASH],
    };
    (spells, note)
}

/// The key Flash sits on in `spells` (D, F), if it's there.
fn flash_key_of(spells: [u32; 2]) -> Option<SpellKey> {
    match spells {
        [FLASH, _] => Some(SpellKey::D),
        [_, FLASH] => Some(SpellKey::F),
        _ => None,
    }
}

/// The key the player keeps Flash on in `history` (the client's match history of the local
/// player): the key it sat on in most Summoner's Rift and ARAM games. `None` without Flash
/// games, or on a tie.
pub fn flash_habit(history: &Value) -> Option<SpellKey> {
    let games = history.pointer("/games/games")?.as_array()?;
    let (mut on_d, mut on_f) = (0_u32, 0_u32);
    for game in games {
        // Other modes (Arena…) don't let players choose.
        if !matches!(
            game.get("mapId").and_then(Value::as_u64),
            None | Some(11 | 12)
        ) {
            continue;
        }
        let Some(me) = game
            .get("participants")
            .and_then(Value::as_array)
            .and_then(|p| p.first())
        else {
            continue;
        };
        let spell = |key: &str| me.get(key).and_then(Value::as_u64);
        if spell("spell1Id") == Some(u64::from(FLASH)) {
            on_d += 1;
        } else if spell("spell2Id") == Some(u64::from(FLASH)) {
            on_f += 1;
        }
    }
    match on_d.cmp(&on_f) {
        Ordering::Greater => Some(SpellKey::D),
        Ordering::Less => Some(SpellKey::F),
        Ordering::Equal => None,
    }
}

/// The local player in a champion select session: spells and the timer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Selection {
    /// D, F (0 = none).
    pub spells: [u32; 2],
    /// Timer phase (`PLANNING`, `BAN_PICK`, `FINALIZATION`, `GAME_STARTING`).
    pub phase: String,
    /// Milliseconds left on the timer at `now` (`i64::MAX` for an endless timer).
    pub left_ms: i64,
}

#[allow(
    clippy::cast_possible_truncation,
    reason = "finite milliseconds, far below i64::MAX"
)]
fn millis(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|ms| ms.is_finite())
            .map(|ms| ms.round() as i64)
    })
}

/// Reads the local player's selection; `None` for a spectator or a session without them.
/// The timer is a snapshot taken at `internalNowInEpochMs`: the time since is taken off.
pub fn selection(session: &Value, now_ms: i64) -> Option<Selection> {
    if session.get("isSpectating").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let cell = session.get("localPlayerCellId")?.as_i64()?;
    let me = session
        .get("myTeam")?
        .as_array()?
        .iter()
        .find(|m| m.get("cellId").and_then(Value::as_i64) == Some(cell))?;
    let spell = |key: &str| {
        me.get(key)
            .and_then(Value::as_u64)
            .and_then(|id| u32::try_from(id).ok())
            .unwrap_or(0)
    };
    let timer = session.get("timer");
    let field = |key: &str| timer.and_then(|t| t.get(key));
    let endless = field("isInfinite").and_then(Value::as_bool) == Some(true);
    let snapshot = millis(field("internalNowInEpochMs")).filter(|&at| at > 0);
    let elapsed = snapshot.map_or(0, |at| (now_ms - at).max(0));
    let left_ms = if endless {
        i64::MAX
    } else {
        millis(field("adjustedTimeLeftInPhase")).unwrap_or(0) - elapsed
    };
    Some(Selection {
        spells: [spell("spell1Id"), spell("spell2Id")],
        phase: field("phase")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        left_ms,
    })
}

/// Why spells can't change now: the game is starting, or [`LAST_SECONDS`] or less are left.
pub fn too_late(selection: &Selection) -> Option<SkipReason> {
    let seconds_left = u32::try_from(selection.left_ms.max(0) / 1000).unwrap_or(u32::MAX);
    let late =
        selection.phase == "GAME_STARTING" || selection.left_ms <= i64::from(LAST_SECONDS) * 1000;
    late.then_some(SkipReason::TooLate {
        seconds_left: if selection.phase == "GAME_STARTING" {
            0
        } else {
            seconds_left
        },
    })
}

/// The build's most played spell pair, if it's two different spells.
fn build_spells(build: &BuildStats) -> Option<[u32; 2]> {
    let ids = &build.spells.top.first()?.ids;
    match ids.as_slice() {
        [a, b] if a != b && *a != 0 && *b != 0 => Some([*a, *b]),
        _ => None,
    }
}

/// Where Flash goes: the setting, else the player's recent games, else where it is now.
async fn choose_key(client: &LcuClient, setting: FlashKey, current: [u32; 2]) -> KeyChoice {
    match setting {
        FlashKey::D => KeyChoice::Known(SpellKey::D),
        FlashKey::F => KeyChoice::Known(SpellKey::F),
        FlashKey::Auto => {
            let habit = match client.get::<Value>(MATCHES).await {
                Ok(history) => flash_habit(&history),
                Err(error) => {
                    tracing::debug!(%error, "no match history for the Flash key");
                    None
                }
            };
            habit
                .or_else(|| flash_key_of(current))
                .map_or(KeyChoice::Guessed(GUESS), KeyChoice::Known)
        }
    }
}

/// The current selection, or why spells can't change now.
async fn read(client: &LcuClient) -> Result<Selection, ImportOutcome> {
    let session = match client.get::<Value>(SESSION).await {
        Ok(session) => session,
        Err(error) if error.is_not_found() => {
            return Err(ImportOutcome::Skipped {
                reason: SkipReason::NotInChampSelect,
            });
        }
        Err(error) => return Err(client_failure(&error)),
    };
    let selection = selection(&session, now_ms()).ok_or(ImportOutcome::Skipped {
        reason: SkipReason::NotInChampSelect,
    })?;
    match too_late(&selection) {
        Some(reason) => Err(ImportOutcome::Skipped { reason }),
        None => Ok(selection),
    }
}

/// Sets the build's spells with Flash on the player's key, unless it's too late.
pub(super) async fn import(
    client: &LcuClient,
    build: &BuildStats,
    setting: FlashKey,
) -> ImportOutcome {
    let Some(pair) = build_spells(build) else {
        return ImportOutcome::Failed {
            reason: FailReason::NoData,
        };
    };
    let before = match read(client).await {
        Ok(selection) => selection,
        Err(outcome) => return outcome,
    };
    let (spells, flash) = arrange(pair, choose_key(client, setting, before.spells).await);
    // Checked again right before writing: reading the history takes a moment.
    let now = match read(client).await {
        Ok(selection) => selection,
        Err(outcome) => return outcome,
    };
    if now.spells == spells {
        return ImportOutcome::SpellsSet {
            spell_ids: spells,
            changed: false,
            flash,
        };
    }
    let body = json!({ "spell1Id": spells[0], "spell2Id": spells[1] });
    match client
        .request(Method::PATCH, MY_SELECTION, Some(&body))
        .await
    {
        Ok(_) => {
            tracing::info!(?spells, "summoner spells imported");
            ImportOutcome::SpellsSet {
                spell_ids: spells,
                changed: true,
                flash,
            }
        }
        Err(error) if error.is_not_found() => ImportOutcome::Skipped {
            reason: SkipReason::NotInChampSelect,
        },
        Err(error) => client_failure(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IGNITE: u32 = 14;
    const EXHAUST: u32 = 3;
    const GHOST: u32 = 6;

    #[test]
    fn the_last_seconds_are_five() {
        assert_eq!(LAST_SECONDS, 5);
    }

    #[test]
    fn flash_stays_on_the_players_key() {
        // The build lists Flash first (lower id first): the player keeps it on F.
        assert_eq!(
            arrange([FLASH, IGNITE], KeyChoice::Known(SpellKey::F)),
            (
                [IGNITE, FLASH],
                Some(FlashNote::KeptOnYourKey { key: SpellKey::F })
            )
        );
        assert_eq!(
            arrange([FLASH, IGNITE], KeyChoice::Known(SpellKey::D)),
            ([FLASH, IGNITE], None)
        );
        // Exhaust (3) sorts before Flash: listed on F, the player's D wins.
        assert_eq!(
            arrange([EXHAUST, FLASH], KeyChoice::Known(SpellKey::D)),
            (
                [FLASH, EXHAUST],
                Some(FlashNote::KeptOnYourKey { key: SpellKey::D })
            )
        );
        assert_eq!(
            arrange([FLASH, IGNITE], KeyChoice::Guessed(SpellKey::F)),
            (
                [IGNITE, FLASH],
                Some(FlashNote::Guessed { key: SpellKey::F })
            )
        );
        assert_eq!(
            arrange([GHOST, IGNITE], KeyChoice::Known(SpellKey::D)),
            ([GHOST, IGNITE], Some(FlashNote::NotInBuild))
        );
    }

    fn history(games: &[(u64, u32, u32)]) -> Value {
        json!({ "games": { "games": games.iter().map(|(map, d, f)| json!({
            "mapId": map, "participants": [{ "spell1Id": d, "spell2Id": f }]
        })).collect::<Vec<_>>() } })
    }

    #[test]
    fn reads_the_flash_habit_from_recent_games() {
        let f = history(&[(11, IGNITE, FLASH), (11, IGNITE, FLASH), (12, FLASH, 32)]);
        assert_eq!(flash_habit(&f), Some(SpellKey::F));
        let d = history(&[(11, FLASH, IGNITE), (11, FLASH, 12), (11, GHOST, FLASH)]);
        assert_eq!(flash_habit(&d), Some(SpellKey::D));
        // Arena games don't count; a tie or no Flash says nothing.
        let arena = history(&[(30, FLASH, 2201), (30, FLASH, 2202), (11, IGNITE, FLASH)]);
        assert_eq!(flash_habit(&arena), Some(SpellKey::F));
        assert_eq!(
            flash_habit(&history(&[(11, FLASH, IGNITE), (11, IGNITE, FLASH)])),
            None
        );
        assert_eq!(flash_habit(&history(&[(11, GHOST, IGNITE)])), None);
        assert_eq!(flash_habit(&json!({})), None);
    }

    fn session(phase: &str, left_ms: i64, snapshot: i64) -> Value {
        json!({
            "localPlayerCellId": 2,
            "myTeam": [{ "cellId": 1, "spell1Id": 11, "spell2Id": 4 }, { "cellId": 2, "spell1Id": 4, "spell2Id": 14 }],
            "timer": { "phase": phase, "adjustedTimeLeftInPhase": left_ms, "internalNowInEpochMs": snapshot, "isInfinite": false }
        })
    }

    #[test]
    fn reads_the_local_selection_and_the_live_timer() {
        let now = 1_790_000_010_000;
        let selection =
            selection(&session("FINALIZATION", 20_000, now - 12_000), now).expect("seat");
        assert_eq!(selection.spells, [FLASH, IGNITE]);
        assert_eq!(selection.phase, "FINALIZATION");
        assert_eq!(selection.left_ms, 8_000, "the snapshot is 12 s old");
        let mut spectator = session("BAN_PICK", 20_000, now);
        spectator["isSpectating"] = json!(true);
        assert!(super::selection(&spectator, now).is_none());
    }

    #[test]
    fn never_in_the_last_seconds() {
        let now = 1_790_000_000_000;
        let at = |phase: &str, left: i64| {
            too_late(&selection(&session(phase, left, now), now).expect("seat"))
        };
        assert_eq!(at("FINALIZATION", 6_000), None);
        assert_eq!(at("FINALIZATION", 5_001), None);
        assert_eq!(
            at("FINALIZATION", 5_000),
            Some(SkipReason::TooLate { seconds_left: 5 })
        );
        assert_eq!(
            at("BAN_PICK", 2_400),
            Some(SkipReason::TooLate { seconds_left: 2 })
        );
        assert_eq!(
            at("GAME_STARTING", 30_000),
            Some(SkipReason::TooLate { seconds_left: 0 })
        );
        // The snapshot aged past the limit.
        let stale = selection(&session("FINALIZATION", 20_000, now - 16_000), now).expect("seat");
        assert_eq!(
            too_late(&stale),
            Some(SkipReason::TooLate { seconds_left: 4 })
        );
        // No timer at all: nothing says it's safe.
        let bare = json!({ "localPlayerCellId": 0, "myTeam": [{ "cellId": 0 }] });
        assert!(too_late(&selection(&bare, now).expect("seat")).is_some());
        // An endless timer (practice tool, customs) never runs out.
        let mut endless = session("FINALIZATION", 0, now);
        endless["timer"]["isInfinite"] = json!(true);
        assert_eq!(too_late(&selection(&endless, now).expect("seat")), None);
    }
}
