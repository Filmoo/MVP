//! The automatic import. At the first lock-in of a champion select, the parts whose "Auto
//! import" switch is on are imported, once (in ARAM the first champion the player is given is
//! the lock). MVP never imports again by itself in that champion select: when the player's
//! champion or role changes afterwards (a trade, an ARAM reroll or bench swap, a role swap),
//! Draft warns ([`ImportWarning`]) and the player imports for the new one in one click, or
//! doesn't. The warning goes once MVP imported for the new one, or when champion select ends.
//!
//! Hovers and pick intents are never a lock. The player's own rune pages, item sets and spells
//! are never watched: what they change themselves never warns nor imports. Spells locked in the
//! last seconds of a pick turn wait until the timer has time again (the next turn, or
//! finalization).

use domain::{ImportPart, ImportRequest, ImportResult, ImportWarning, Lock};
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::{Importer, LAST_SECONDS, now_ms, selection};
use crate::automation::CoreEvent;
use crate::champ_select;

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

/// One champion select's automatic import and what MVP's build is for since. No I/O: fed with
/// the client's sessions and with what MVP imported.
#[derive(Debug, Default)]
pub struct LockTracker {
    /// The player's lock now.
    current: Option<Lock>,
    /// The first lock-in was seen: the automatic import's moment is over.
    first_seen: bool,
    /// The parts imported by themselves at the first lock-in, each with the lock MVP last
    /// imported it for.
    built: Vec<(ImportPart, Lock)>,
    /// Parts to warn about. Only a change of lock adds to them (never an import, never the
    /// player's own changes); an import for the lock the player has now takes its parts off.
    stale: Vec<ImportPart>,
}

impl LockTracker {
    /// Follows `session`. Answers its lock the first time a lock is seen in this champion
    /// select: the moment of the automatic import. A later champion or role only changes what
    /// the player has now, and what to warn about.
    pub fn on_session(&mut self, session: &Value) -> Option<Lock> {
        let mut lock = locked(session)?;
        // Positions don't go away during a champion select: an empty one in a session the
        // client sends again keeps the role known so far (blind pick and ARAM have none).
        if lock.role.is_none() {
            lock.role = self.current.and_then(|current| current.role);
        }
        if self.current == Some(lock) {
            return None;
        }
        self.current = Some(lock);
        if !self.first_seen {
            self.first_seen = true;
            return Some(lock);
        }
        self.stale = self
            .built
            .iter()
            .filter(|(_, built_for)| *built_for != lock)
            .map(|(part, _)| *part)
            .collect();
        None
    }

    /// The player's lock now.
    pub const fn current(&self) -> Option<Lock> {
        self.current
    }

    /// `parts` are imported by themselves for `lock` (the first lock-in).
    pub fn automatic(&mut self, lock: Lock, parts: &[ImportPart]) {
        self.built = parts.iter().map(|&part| (part, lock)).collect();
        self.stale.clear();
    }

    /// MVP imported `parts` for `lock` (a click, the warning's click, the automatic import),
    /// whatever came of it: that's what its build is for now, and for the lock the player has
    /// now there's nothing to warn about any more (they asked, and were told how it went).
    pub fn imported(&mut self, lock: Lock, parts: &[ImportPart]) {
        for (part, built_for) in &mut self.built {
            if parts.contains(part) {
                *built_for = lock;
            }
        }
        if self.current == Some(lock) {
            self.stale.retain(|part| !parts.contains(part));
        }
    }

    /// Draft's warning, when the player's lock changed since the automatic import: the parts
    /// still for another lock whose switch is `on`.
    pub fn warning(&self, on: impl Fn(ImportPart) -> bool) -> Option<ImportWarning> {
        let now = self.current?;
        let parts: Vec<ImportPart> = ImportPart::ALL
            .into_iter()
            .filter(|&part| self.stale.contains(&part) && on(part))
            .collect();
        let first = *parts.first()?;
        let built_for = self
            .built
            .iter()
            .find(|(part, _)| *part == first)
            .map(|(_, built_for)| *built_for)?;
        Some(ImportWarning {
            built_for,
            now,
            parts,
        })
    }

    /// Champion select is over.
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// Time wanted on the clock, beyond the last seconds, before deferred spells are tried: the
/// import checks again right before writing and must not land in the last seconds.
const RETRY_MARGIN_MS: i64 = 2_000;

/// Drives the automatic import from the core's champion select events, and Draft's warning
/// from them and from what MVP imports.
#[derive(Debug)]
pub(crate) struct LockIn {
    importer: Importer,
    events: mpsc::Sender<CoreEvent>,
    warning: watch::Sender<Option<ImportWarning>>,
    tracker: LockTracker,
    /// Spells of the first lock-in, waiting for time on the clock.
    deferred_spells: Option<Lock>,
    /// The automatic import, stopped if the player's champion or role changes meanwhile.
    tasks: Vec<JoinHandle<()>>,
}

impl LockIn {
    pub(crate) fn new(
        importer: Importer,
        events: mpsc::Sender<CoreEvent>,
        warning: watch::Sender<Option<ImportWarning>>,
    ) -> Self {
        Self {
            importer,
            events,
            warning,
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
        let before = self.tracker.current();
        if let Some(lock) = self.tracker.on_session(session) {
            // The first lock-in: the parts switched on, once. Parts the server paused aren't
            // tried (a click still says why).
            let mut parts: Vec<ImportPart> = ImportPart::ALL
                .into_iter()
                .filter(|&part| settings.auto_import(part) && self.importer.allowed(part))
                .collect();
            self.tracker.automatic(lock, &parts);
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
        } else if self.tracker.current() != before {
            // Another champion or role after the first lock-in: never imported by itself again.
            // What was still on its way for the previous one stops; Draft warns instead.
            for task in self.tasks.drain(..) {
                task.abort();
            }
            self.deferred_spells = None;
        } else if let Some(lock) = self.deferred_spells
            && has_time
        {
            self.deferred_spells = None;
            if settings.auto_import(ImportPart::Spells) && self.importer.allowed(ImportPart::Spells)
            {
                self.spawn(lock, vec![ImportPart::Spells]);
            }
        }
        self.publish();
    }

    /// MVP imported something, whoever asked (see [`Importer::reporting`]).
    pub(crate) fn on_imported(&mut self, result: &ImportResult) {
        let lock = Lock {
            champion_id: result.champion_id,
            role: result.role,
        };
        let parts: Vec<ImportPart> = result.parts.iter().map(|p| p.part).collect();
        self.tracker.imported(lock, &parts);
        self.publish();
    }

    /// The settings changed: a part switched off leaves the warning (and comes back with it).
    pub(crate) fn on_settings(&self) {
        self.publish();
    }

    /// Champion select is over: so is its warning. Imports already running finish on their
    /// own (they check champion select themselves).
    pub(crate) fn reset(&mut self) {
        self.tracker.reset();
        self.deferred_spells = None;
        self.tasks.clear();
        self.publish();
    }

    fn publish(&self) {
        let settings = self.importer.settings();
        let warning = self.tracker.warning(|part| settings.auto_import(part));
        self.warning.send_if_modified(|current| {
            if *current == warning {
                return false;
            }
            *current = warning;
            true
        });
    }

    fn spawn(&mut self, lock: Lock, parts: Vec<ImportPart>) {
        let importer = self.importer.clone();
        let events = self.events.clone();
        let request = ImportRequest {
            champion_id: lock.champion_id,
            role: lock.role,
            queue: None,
            bracket: None,
            parts,
            champ_select: true,
        };
        tracing::info!(champion = lock.champion_id, parts = ?request.parts, "automatic import at the first lock-in");
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
    use domain::Role;
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

    /// [`session`], locked, in `position`.
    fn at(champion: u32, position: &str) -> Value {
        let mut locked = session(champion, Some(true));
        locked["myTeam"][0]["assignedPosition"] = json!(position);
        locked
    }

    const fn lock(champion_id: u32, role: Option<Role>) -> Lock {
        Lock { champion_id, role }
    }

    const MID: Option<Role> = Some(Role::Middle);
    const ALL_ON: fn(ImportPart) -> bool = |_| true;

    #[test]
    fn a_hover_is_not_a_lock() {
        assert_eq!(locked(&session(0, Some(false))), None, "pick intent only");
        assert_eq!(
            locked(&session(103, Some(false))),
            None,
            "hovering during the turn"
        );
        assert_eq!(locked(&session(103, Some(true))), Some(lock(103, MID)));
    }

    #[test]
    fn modes_without_picks_lock_the_given_champion() {
        let mut aram = session(222, None);
        aram["myTeam"][0]["assignedPosition"] = json!("");
        assert_eq!(locked(&aram), Some(lock(222, None)));
        aram["isSpectating"] = json!(true);
        assert_eq!(locked(&aram), None);
    }

    #[test]
    fn only_the_first_lock_in_imports() {
        let mut tracker = LockTracker::default();
        assert_eq!(tracker.on_session(&session(103, Some(false))), None);
        assert_eq!(
            tracker.on_session(&session(103, Some(true))),
            Some(lock(103, MID))
        );
        tracker.automatic(lock(103, MID), &[ImportPart::Runes]);
        // Every later event of the same lock: nothing.
        assert_eq!(tracker.on_session(&session(103, Some(true))), None);
        // A trade gives another champion: not a moment to import, a warning.
        assert_eq!(tracker.on_session(&session(7, Some(true))), None);
        assert_eq!(tracker.current(), Some(lock(7, MID)));
        assert_eq!(
            tracker.warning(ALL_ON),
            Some(ImportWarning {
                built_for: lock(103, MID),
                now: lock(7, MID),
                parts: vec![ImportPart::Runes],
            })
        );
        // Next champion select: its first lock-in imports.
        tracker.reset();
        assert_eq!(tracker.warning(ALL_ON), None);
        assert!(tracker.on_session(&session(7, Some(true))).is_some());
    }

    #[test]
    fn without_an_automatic_import_nothing_warns() {
        let mut tracker = LockTracker::default();
        assert!(tracker.on_session(&session(103, Some(true))).is_some());
        // Every switch was off: nothing imported by itself.
        tracker.automatic(lock(103, MID), &[]);
        tracker.on_session(&session(7, Some(true)));
        assert_eq!(tracker.warning(ALL_ON), None);
    }

    #[test]
    fn a_role_swap_warns_and_trading_back_clears_it() {
        let mut tracker = LockTracker::default();
        tracker.on_session(&at(103, "middle"));
        tracker.automatic(lock(103, MID), &[ImportPart::Runes, ImportPart::ItemSet]);
        tracker.on_session(&at(103, "utility"));
        let warning = tracker.warning(ALL_ON).map(|w| (w.now, w.parts));
        assert_eq!(
            warning,
            Some((
                lock(103, Some(Role::Support)),
                vec![ImportPart::Runes, ImportPart::ItemSet]
            ))
        );
        // Back on what the build is for.
        tracker.on_session(&at(103, "middle"));
        assert_eq!(tracker.warning(ALL_ON), None);
    }

    #[test]
    fn an_empty_position_in_a_session_sent_again_is_no_role_swap() {
        let mut tracker = LockTracker::default();
        tracker.on_session(&at(103, "middle"));
        tracker.automatic(lock(103, MID), &[ImportPart::Runes]);
        assert_eq!(tracker.on_session(&at(103, "")), None);
        assert_eq!(tracker.current(), Some(lock(103, MID)));
        assert_eq!(tracker.warning(ALL_ON), None);
    }

    #[test]
    fn importing_for_the_new_lock_clears_the_warning_part_by_part() {
        let mut tracker = LockTracker::default();
        tracker.on_session(&session(103, Some(true)));
        tracker.automatic(lock(103, MID), &[ImportPart::Runes, ImportPart::ItemSet]);
        tracker.on_session(&session(7, Some(true)));
        // Runes by hand for the new champion: the item set is still the old one's.
        tracker.imported(lock(7, MID), &[ImportPart::Runes]);
        let warning = tracker.warning(ALL_ON).map(|w| (w.built_for, w.parts));
        assert_eq!(warning, Some((lock(103, MID), vec![ImportPart::ItemSet])));
        // An import for another champion (a champion page) raises nothing and clears nothing.
        tracker.imported(lock(99, None), &[ImportPart::Runes, ImportPart::ItemSet]);
        let warning = tracker.warning(ALL_ON).map(|w| (w.built_for, w.parts));
        assert_eq!(warning, Some((lock(99, None), vec![ImportPart::ItemSet])));
        tracker.imported(lock(7, MID), &[ImportPart::ItemSet]);
        assert_eq!(tracker.warning(ALL_ON), None);
        // Another trade: what isn't for the champion now warns again.
        tracker.on_session(&session(64, Some(true)));
        assert_eq!(
            tracker.warning(ALL_ON).map(|w| w.parts),
            Some(vec![ImportPart::Runes, ImportPart::ItemSet])
        );
    }

    #[test]
    fn parts_switched_off_leave_the_warning() {
        let mut tracker = LockTracker::default();
        tracker.on_session(&session(103, Some(true)));
        tracker.automatic(lock(103, MID), &[ImportPart::Runes, ImportPart::Spells]);
        tracker.on_session(&session(7, Some(true)));
        let spells_only = tracker.warning(|part| part == ImportPart::Spells);
        assert_eq!(spells_only.map(|w| w.parts), Some(vec![ImportPart::Spells]));
        assert_eq!(tracker.warning(|_| false), None);
    }
}
