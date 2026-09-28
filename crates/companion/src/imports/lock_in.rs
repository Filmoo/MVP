//! The lock-in automation: when the player locks in a champion, the parts they set to "on
//! lock-in" are imported once for that lock. A trade or an ARAM swap is a new lock; hovers,
//! pick intents and repeated session events never import. Spells locked in the last seconds of
//! a pick turn wait until the timer has time again (the next turn, or finalization).

use domain::{ImportMode, ImportPart, ImportRequest, Role};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::{Importer, LAST_SECONDS, mode, now_ms, selection};
use crate::automation::CoreEvent;
use crate::champ_select;

/// The local player's lock-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lock {
    pub champion_id: u32,
    /// Assigned position; `None` in blind pick and ARAM.
    pub role: Option<Role>,
}

/// The local player's locked champion in a champion select session: their pick is completed,
/// or the mode has no picks (ARAM gives the champion). `None` while hovering or spectating.
pub fn locked(session: &Value) -> Option<Lock> {
    if session.get("isSpectating").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let cell = session.get("localPlayerCellId")?.as_i64()?;
    let me = session
        .get("myTeam")?
        .as_array()?
        .iter()
        .find(|m| m.get("cellId").and_then(Value::as_i64) == Some(cell))?;
    let champion_id = me
        .get("championId")
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok())
        .filter(|&id| id != 0)?;
    let picked = session
        .get("actions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_array)
        .flatten()
        .filter(|action| {
            action.get("actorCellId").and_then(Value::as_i64) == Some(cell)
                && action.get("type").and_then(Value::as_str) == Some("pick")
        })
        .all(|action| action.get("completed").and_then(Value::as_bool) == Some(true));
    let position = me
        .get("assignedPosition")
        .and_then(Value::as_str)
        .unwrap_or_default();
    picked.then_some(Lock {
        champion_id,
        role: champ_select::role(position),
    })
}

/// Remembers the lock already handled, so each lock imports once.
#[derive(Debug, Default)]
pub struct LockTracker {
    handled: Option<u32>,
}

impl LockTracker {
    /// The lock in `session`, the first time it is seen.
    pub fn on_session(&mut self, session: &Value) -> Option<Lock> {
        let lock = locked(session)?;
        if self.handled == Some(lock.champion_id) {
            return None;
        }
        self.handled = Some(lock.champion_id);
        Some(lock)
    }

    /// Champion select is over.
    pub fn reset(&mut self) {
        self.handled = None;
    }
}

/// Time wanted on the clock, beyond the last seconds, before deferred spells are tried: the
/// import checks again right before writing and must not land in the last seconds.
const RETRY_MARGIN_MS: i64 = 2_000;

/// Drives the automatic imports from the core's champion select events.
#[derive(Debug)]
pub(crate) struct LockIn {
    importer: Importer,
    events: mpsc::Sender<CoreEvent>,
    tracker: LockTracker,
    /// Spells of this lock, waiting for time on the clock.
    deferred_spells: Option<Lock>,
    /// Imports of the current lock, stopped if another champion is locked.
    tasks: Vec<JoinHandle<()>>,
}

impl LockIn {
    pub(crate) fn new(importer: Importer, events: mpsc::Sender<CoreEvent>) -> Self {
        Self {
            importer,
            events,
            tracker: LockTracker::default(),
            deferred_spells: None,
            tasks: Vec::new(),
        }
    }

    /// A champion select session (every change).
    pub(crate) fn on_session(&mut self, session: &Value) {
        let settings = self.importer.settings();
        let timer = selection(session, now_ms()).map(|s| (s.phase, s.left_ms));
        let has_time = timer.as_ref().is_some_and(|(phase, left)| {
            phase != "GAME_STARTING" && *left > i64::from(LAST_SECONDS) * 1000 + RETRY_MARGIN_MS
        });
        if let Some(lock) = self.tracker.on_session(session) {
            // Another champion: what ran for the previous one stops.
            for task in self.tasks.drain(..) {
                task.abort();
            }
            self.deferred_spells = None;
            let mut parts: Vec<ImportPart> = ImportPart::ALL
                .into_iter()
                .filter(|&part| mode(&settings, part) == ImportMode::OnLockIn)
                .collect();
            // Nothing comes after finalization: spells locked there are tried (and refused in
            // its last seconds); earlier, they wait for the next turn.
            let last_phase = timer
                .as_ref()
                .is_some_and(|(phase, _)| phase == "FINALIZATION" || phase == "GAME_STARTING");
            if parts.contains(&ImportPart::Spells) && !has_time && !last_phase {
                parts.retain(|&part| part != ImportPart::Spells);
                self.deferred_spells = Some(lock);
            }
            if !parts.is_empty() {
                self.spawn(lock, parts);
            }
        } else if let Some(lock) = self.deferred_spells
            && has_time
        {
            self.deferred_spells = None;
            if mode(&settings, ImportPart::Spells) == ImportMode::OnLockIn {
                self.spawn(lock, vec![ImportPart::Spells]);
            }
        }
    }

    /// Champion select is over. Imports already running finish on their own (spells check
    /// champion select themselves).
    pub(crate) fn reset(&mut self) {
        self.tracker.reset();
        self.deferred_spells = None;
        self.tasks.clear();
    }

    fn spawn(&mut self, lock: Lock, parts: Vec<ImportPart>) {
        let importer = self.importer.clone();
        let events = self.events.clone();
        let request = ImportRequest {
            champion_id: lock.champion_id,
            role: lock.role,
            queue: None,
            parts,
        };
        tracing::info!(champion = lock.champion_id, parts = ?request.parts, "automatic import on lock-in");
        self.tasks.retain(|task| !task.is_finished());
        self.tasks.push(tokio::spawn(async move {
            let result = importer.import(&request, true).await;
            if let Err(error) = events.try_send(CoreEvent::Import(result)) {
                tracing::warn!(%error, "import event dropped");
            }
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// You (cell 0, mid) on `champion`, your pick action `completed` or not.
    fn session(champion: u32, completed: Option<bool>) -> Value {
        let actions = completed.map_or_else(
            || json!([]),
            |done| json!([[{ "actorCellId": 3, "type": "pick", "completed": true, "championId": 64 }],
                          [{ "actorCellId": 0, "type": "ban", "completed": true, "championId": 238 },
                           { "actorCellId": 0, "type": "pick", "completed": done, "isInProgress": !done, "championId": champion }]]),
        );
        json!({
            "localPlayerCellId": 0,
            "myTeam": [
                { "cellId": 0, "assignedPosition": "middle", "championId": champion, "championPickIntent": 103 },
                { "cellId": 3, "assignedPosition": "jungle", "championId": 64 }
            ],
            "actions": actions,
            "timer": { "phase": "BAN_PICK", "adjustedTimeLeftInPhase": 20_000 }
        })
    }

    #[test]
    fn a_hover_is_not_a_lock() {
        assert_eq!(locked(&session(0, Some(false))), None, "pick intent only");
        assert_eq!(
            locked(&session(103, Some(false))),
            None,
            "hovering during the turn"
        );
        assert_eq!(
            locked(&session(103, Some(true))),
            Some(Lock {
                champion_id: 103,
                role: Some(Role::Middle)
            })
        );
    }

    #[test]
    fn modes_without_picks_lock_the_given_champion() {
        let mut aram = session(222, None);
        aram["myTeam"][0]["assignedPosition"] = json!("");
        assert_eq!(
            locked(&aram),
            Some(Lock {
                champion_id: 222,
                role: None
            })
        );
        aram["isSpectating"] = json!(true);
        assert_eq!(locked(&aram), None);
    }

    #[test]
    fn each_lock_is_handled_once() {
        let mut tracker = LockTracker::default();
        assert_eq!(tracker.on_session(&session(103, Some(false))), None);
        assert!(tracker.on_session(&session(103, Some(true))).is_some());
        // Every later event of the same lock: nothing.
        assert_eq!(tracker.on_session(&session(103, Some(true))), None);
        assert_eq!(tracker.on_session(&session(103, Some(true))), None);
        // A trade gives another champion: a new lock.
        assert_eq!(
            tracker
                .on_session(&session(7, Some(true)))
                .map(|l| l.champion_id),
            Some(7)
        );
        // Next champion select.
        tracker.reset();
        assert!(tracker.on_session(&session(7, Some(true))).is_some());
    }
}
