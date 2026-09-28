//! LP won or lost per ranked game. The League client never says what a game was worth, only the
//! standing (tier, division, LP, wins and losses per queue): MVP reads the standing when a
//! ranked game starts and again once the client has counted it, and keeps the difference per
//! game in a small file (`lp-history.json` in the app's data folder, bounded per queue).
//!
//! Two standings the player saw and their difference: no estimate of hidden ratings (policy.md,
//! no MMR). Solo/duo and flex are kept apart.

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use domain::{Division, LpGame, RankedEntry, RankedQueue, Tier};
use serde::{Deserialize, Serialize};

use crate::settings::write_atomic;

/// File name inside the app's data folder.
pub const FILE_NAME: &str = "lp-history.json";
/// Games kept per queue (a few hundred bytes each).
pub const KEPT_PER_QUEUE: usize = 100;

const LP_PER_DIVISION: i32 = 100;
/// Master 0 LP: Diamond I 100 LP on the same scale.
const APEX: i32 = 7 * 4 * LP_PER_DIVISION;

/// The standing on one scale: Iron IV 0 LP is 0 and each division 100 more (a tier is 400); the
/// apex tiers share one ladder from Master 0 LP (2800), counted in plain LP.
pub fn ladder(entry: &RankedEntry) -> i32 {
    let lp = i32::try_from(entry.league_points).unwrap_or(i32::MAX / 2);
    let tier = match entry.tier {
        Tier::Iron => 0,
        Tier::Bronze => 1,
        Tier::Silver => 2,
        Tier::Gold => 3,
        Tier::Platinum => 4,
        Tier::Emerald => 5,
        Tier::Diamond => 6,
        Tier::Master | Tier::Grandmaster | Tier::Challenger => return APEX + lp,
    };
    let division = match entry.division {
        Some(Division::IV) | None => 0,
        Some(Division::III) => 1,
        Some(Division::II) => 2,
        Some(Division::I) => 3,
    };
    (tier * 4 + division) * LP_PER_DIVISION + lp
}

fn played(entry: &RankedEntry) -> u32 {
    entry.wins.saturating_add(entry.losses)
}

/// What the standing read after a game says about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Counted {
    /// The client hasn't counted the game yet (same number of games): read again later.
    NotYet,
    /// Exactly one more game: its LP.
    Game(LpGame),
    /// Several games apart, or unranked on one side: the difference isn't this game's.
    Unknown,
}

/// The LP of `game_id` from the standing before it and one read after it (at `at`, Unix ms).
pub fn count(
    game_id: u64,
    queue: RankedQueue,
    before: &RankedEntry,
    after: Option<&RankedEntry>,
    at: i64,
) -> Counted {
    let Some(after) = after else {
        return Counted::Unknown;
    };
    match played(after).checked_sub(played(before)) {
        Some(0) => Counted::NotYet,
        Some(1) => Counted::Game(LpGame {
            game_id,
            queue,
            at,
            before: before.clone(),
            after: after.clone(),
            delta: ladder(after) - ladder(before),
            ladder: ladder(after),
        }),
        // More than one game, or fewer (a new season): not this game's difference.
        _ => Counted::Unknown,
    }
}

/// The ranked game being played: its queue and the standing before it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub game_id: u64,
    pub queue: RankedQueue,
    pub before: RankedEntry,
}

/// The file: the games (newest first, both queues) and the game being played, so a restart
/// in the middle of a game still gets its LP.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LpFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    pending: Option<Pending>,
    #[serde(default)]
    games: Vec<LpGame>,
}

const VERSION: u32 = 1;

/// The LP of each tracked ranked game, kept on disk (`path`; in memory only without one).
#[derive(Debug)]
pub struct LpStore {
    path: Option<PathBuf>,
    data: Mutex<LpFile>,
}

impl Default for LpStore {
    fn default() -> Self {
        Self::load(None)
    }
}

impl LpStore {
    /// Reads `path`. Missing means nothing tracked yet; an unreadable file is set aside
    /// (`lp-history.json.bad`) and started over, never a crash.
    pub fn load(path: Option<PathBuf>) -> Self {
        let data = path
            .as_deref()
            .and_then(|path| match std::fs::read(path) {
                Ok(bytes) => match serde_json::from_slice::<LpFile>(&bytes) {
                    Ok(file) => Some(file),
                    Err(error) => {
                        tracing::warn!(%error, path = %path.display(), "LP history unreadable, starting over");
                        let _ = std::fs::rename(path, path.with_extension("json.bad"));
                        None
                    }
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => {
                    tracing::warn!(%error, path = %path.display(), "cannot read the LP history");
                    None
                }
            })
            .unwrap_or_default();
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    fn data(&self) -> std::sync::MutexGuard<'_, LpFile> {
        self.data.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn save(&self, data: &LpFile) {
        let Some(path) = &self.path else { return };
        let written = serde_json::to_vec(data)
            .map_err(std::io::Error::other)
            .and_then(|json| write_atomic(path, &json));
        if let Err(error) = written {
            tracing::warn!(%error, path = %path.display(), "cannot save the LP history");
        }
    }

    /// Every tracked game, newest first.
    pub fn history(&self) -> Vec<LpGame> {
        self.data().games.clone()
    }

    /// The LP of one game, if tracked.
    pub fn game(&self, game_id: u64) -> Option<LpGame> {
        self.data()
            .games
            .iter()
            .find(|g| g.game_id == game_id)
            .cloned()
    }

    /// The ranked game being played, if one started.
    pub fn pending(&self) -> Option<Pending> {
        self.data().pending.clone()
    }

    /// A ranked game starts: its standing before (kept on disk until the game is counted).
    pub fn start(&self, pending: Pending) {
        let mut data = self.data();
        if data.pending.as_ref() == Some(&pending) {
            return;
        }
        data.pending = Some(pending);
        data.version = VERSION;
        self.save(&data);
    }

    /// Forgets the pending game if it is `game_id` (its LP can't be known).
    pub fn drop_pending(&self, game_id: u64) {
        let mut data = self.data();
        if data.pending.as_ref().is_some_and(|p| p.game_id == game_id) {
            data.pending = None;
            self.save(&data);
        }
    }

    /// Keeps a game's LP (replacing the same game's), the newest first, at most
    /// [`KEPT_PER_QUEUE`] per queue; the game is no longer pending.
    pub fn record(&self, game: LpGame) {
        let mut data = self.data();
        if data
            .pending
            .as_ref()
            .is_some_and(|p| p.game_id == game.game_id)
        {
            data.pending = None;
        }
        data.games.retain(|g| g.game_id != game.game_id);
        data.games.push(game);
        data.games
            .sort_by(|a, b| b.at.cmp(&a.at).then(b.game_id.cmp(&a.game_id)));
        for queue in [RankedQueue::Solo, RankedQueue::Flex] {
            let mut seen = 0;
            data.games.retain(|g| {
                if g.queue != queue {
                    return true;
                }
                seen += 1;
                seen <= KEPT_PER_QUEUE
            });
        }
        data.version = VERSION;
        self.save(&data);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    fn entry(tier: Tier, division: Option<Division>, lp: u32, games: u32) -> RankedEntry {
        RankedEntry {
            tier,
            division,
            league_points: lp,
            wins: games / 2,
            losses: games - games / 2,
        }
    }

    fn delta(before: &RankedEntry, after: &RankedEntry) -> i32 {
        match count(1, RankedQueue::Solo, before, Some(after), 0) {
            Counted::Game(game) => game.delta,
            other => panic!("not counted: {other:?}"),
        }
    }

    #[test]
    fn ladder_counts_100_per_division_and_plain_lp_at_the_apex() {
        assert_eq!(ladder(&entry(Tier::Iron, Some(Division::IV), 0, 0)), 0);
        assert_eq!(ladder(&entry(Tier::Iron, Some(Division::I), 50, 0)), 350);
        assert_eq!(
            ladder(&entry(Tier::Emerald, Some(Division::II), 67, 0)),
            2267
        );
        assert_eq!(
            ladder(&entry(Tier::Diamond, Some(Division::I), 99, 0)),
            2799
        );
        assert_eq!(ladder(&entry(Tier::Master, None, 0, 0)), 2800);
        // Grandmaster and Challenger are LP thresholds on the same ladder.
        assert_eq!(ladder(&entry(Tier::Grandmaster, None, 450, 0)), 3250);
        assert_eq!(ladder(&entry(Tier::Challenger, None, 1200, 0)), 4000);
    }

    #[test]
    fn a_win_and_a_loss_within_a_division() {
        let before = entry(Tier::Gold, Some(Division::II), 46, 20);
        assert_eq!(
            delta(&before, &entry(Tier::Gold, Some(Division::II), 67, 21)),
            21
        );
        assert_eq!(
            delta(&before, &entry(Tier::Gold, Some(Division::II), 29, 21)),
            -17
        );
    }

    #[test]
    fn promotions_and_demotions_cross_divisions_and_tiers() {
        // Gold I 88 LP, +24: Platinum IV 12 LP.
        let promoted = delta(
            &entry(Tier::Gold, Some(Division::I), 88, 30),
            &entry(Tier::Platinum, Some(Division::IV), 12, 31),
        );
        assert_eq!(promoted, 24);
        // Emerald IV 10 LP, a loss: Platinum I 75 LP is 35 below.
        let demoted = delta(
            &entry(Tier::Emerald, Some(Division::IV), 10, 30),
            &entry(Tier::Platinum, Some(Division::I), 75, 31),
        );
        assert_eq!(demoted, -35);
        // Silver III → Silver II.
        let division = delta(
            &entry(Tier::Silver, Some(Division::III), 95, 8),
            &entry(Tier::Silver, Some(Division::II), 15, 9),
        );
        assert_eq!(division, 20);
        // Into Master and back out: plain LP on the apex ladder.
        let master = delta(
            &entry(Tier::Diamond, Some(Division::I), 85, 50),
            &entry(Tier::Master, None, 6, 51),
        );
        assert_eq!(master, 21);
        let out = delta(
            &entry(Tier::Master, None, 5, 51),
            &entry(Tier::Diamond, Some(Division::I), 82, 52),
        );
        assert_eq!(out, -23);
        let apex = delta(
            &entry(Tier::Grandmaster, None, 480, 80),
            &entry(Tier::Challenger, None, 505, 81),
        );
        assert_eq!(apex, 25);
    }

    #[test]
    fn only_the_game_itself_counts() {
        let before = entry(Tier::Gold, Some(Division::II), 46, 20);
        let same = entry(Tier::Gold, Some(Division::II), 46, 20);
        assert_eq!(
            count(1, RankedQueue::Solo, &before, Some(&same), 0),
            Counted::NotYet
        );
        let two_later = entry(Tier::Gold, Some(Division::I), 20, 22);
        assert_eq!(
            count(1, RankedQueue::Solo, &before, Some(&two_later), 0),
            Counted::Unknown
        );
        let new_season = entry(Tier::Gold, Some(Division::IV), 0, 0);
        assert_eq!(
            count(1, RankedQueue::Solo, &before, Some(&new_season), 0),
            Counted::Unknown
        );
        assert_eq!(
            count(1, RankedQueue::Solo, &before, None, 0),
            Counted::Unknown,
            "unranked after"
        );
        let Counted::Game(game) = count(
            7,
            RankedQueue::Flex,
            &before,
            Some(&entry(Tier::Gold, Some(Division::II), 67, 21)),
            99,
        ) else {
            panic!("counted")
        };
        assert_eq!(
            (game.game_id, game.queue, game.at, game.ladder),
            (7, RankedQueue::Flex, 99, 1467)
        );
    }

    fn game(game_id: u64, queue: RankedQueue, at: i64) -> LpGame {
        let before = entry(Tier::Gold, Some(Division::II), 40, 10);
        let after = entry(Tier::Gold, Some(Division::II), 60, 11);
        LpGame {
            game_id,
            queue,
            at,
            delta: 20,
            ladder: ladder(&after),
            before,
            after,
        }
    }

    #[test]
    fn keeps_games_newest_first_bounded_per_queue_and_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join(FILE_NAME);
        let store = LpStore::load(Some(path.clone()));
        store.start(Pending {
            game_id: 5,
            queue: RankedQueue::Solo,
            before: entry(Tier::Gold, Some(Division::II), 40, 10),
        });
        assert_eq!(store.pending().map(|p| p.game_id), Some(5));
        for i in 0..105_u64 {
            store.record(game(100 + i, RankedQueue::Solo, i64::try_from(i).unwrap()));
        }
        store.record(game(5, RankedQueue::Flex, 1_000));
        assert!(store.pending().is_none(), "counted: no longer pending");
        let history = store.history();
        assert_eq!(history.len(), KEPT_PER_QUEUE + 1);
        assert_eq!(history[0].game_id, 5, "newest first");
        assert_eq!(
            history
                .iter()
                .filter(|g| g.queue == RankedQueue::Solo)
                .count(),
            KEPT_PER_QUEUE
        );
        assert!(store.game(100).is_none(), "the oldest solo games went");
        // The same game again replaces it.
        store.record(LpGame {
            delta: 21,
            ..game(5, RankedQueue::Flex, 1_000)
        });
        assert_eq!(store.game(5).map(|g| g.delta), Some(21));

        let reloaded = LpStore::load(Some(path));
        assert_eq!(reloaded.history(), store.history());
    }

    #[test]
    fn a_pending_game_survives_a_restart_and_can_be_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let pending = Pending {
            game_id: 9,
            queue: RankedQueue::Flex,
            before: entry(Tier::Silver, Some(Division::I), 90, 4),
        };
        LpStore::load(Some(path.clone())).start(pending.clone());
        let store = LpStore::load(Some(path.clone()));
        assert_eq!(store.pending(), Some(pending));
        store.drop_pending(8);
        assert!(store.pending().is_some(), "another game");
        store.drop_pending(9);
        assert!(LpStore::load(Some(path)).pending().is_none());
    }

    #[test]
    fn an_unreadable_file_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, b"{ not json").unwrap();
        let store = LpStore::load(Some(path.clone()));
        assert!(store.history().is_empty());
        assert!(path.with_extension("json.bad").exists());
    }
}
