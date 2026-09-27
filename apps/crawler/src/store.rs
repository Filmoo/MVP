//! Crawl state in `SQLite`: ladder players, queued match ids and every fetched match's facts.
//! A match id is stored once (primary key), so no game is ever counted twice, and a crawl can
//! stop at any time and resume where it left off.

use std::path::Path;

use aggregate::{GameFacts, Patch, SeedBracket};
use rusqlite::{Connection, OptionalExtension as _, params};

pub use rusqlite::Error as StoreError;

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS players (
    puuid TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    bracket TEXT NOT NULL,
    ids_fetched_at INTEGER
);
CREATE INDEX IF NOT EXISTS players_next ON players (bracket, ids_fetched_at);
CREATE TABLE IF NOT EXISTS ladder_pages (
    platform TEXT NOT NULL,
    tier TEXT NOT NULL,
    division TEXT NOT NULL,
    page INTEGER NOT NULL,
    PRIMARY KEY (platform, tier, division, page)
);
CREATE TABLE IF NOT EXISTS pending (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    bracket TEXT NOT NULL,
    queued_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    bracket TEXT NOT NULL,
    patch TEXT,
    queue INTEGER,
    facts TEXT,
    skip TEXT,
    fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_patch ON matches (patch);
";

#[derive(Debug)]
pub struct Store {
    db: Connection,
}

/// A match id waiting to be fetched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMatch {
    pub id: String,
    pub platform: String,
    pub bracket: SeedBracket,
}

/// A ladder player whose history to read next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextPlayer {
    pub puuid: String,
    pub platform: String,
    pub bracket: SeedBracket,
}

/// Row counts, for logs and tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub players: u64,
    pub pending: u64,
    pub matches: u64,
    pub counted: u64,
}

fn bracket(id: &str) -> SeedBracket {
    SeedBracket::from_id(id).unwrap_or(SeedBracket::Emerald)
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let db = Connection::open(path)?;
        db.execute_batch(SCHEMA)?;
        Ok(Self { db })
    }

    pub fn players_in(&self, platform: &str, b: SeedBracket) -> Result<u64, StoreError> {
        self.db
            .query_row(
                "SELECT COUNT(*) FROM players WHERE platform = ?1 AND bracket = ?2",
                params![platform, b.id()],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| u64::try_from(n).unwrap_or(0))
    }

    /// Adds ladder players (known ones keep their bracket).
    pub fn add_players(
        &mut self,
        platform: &str,
        b: SeedBracket,
        puuids: &[String],
    ) -> Result<usize, StoreError> {
        let tx = self.db.transaction()?;
        let mut added = 0;
        {
            let mut insert = tx.prepare_cached(
                "INSERT OR IGNORE INTO players (puuid, platform, bracket) VALUES (?1, ?2, ?3)",
            )?;
            for p in puuids {
                added += insert.execute(params![p, platform, b.id()])?;
            }
        }
        tx.commit()?;
        Ok(added)
    }

    pub fn ladder_page_done(
        &self,
        platform: &str,
        tier: &str,
        division: &str,
        page: u32,
    ) -> Result<bool, StoreError> {
        self.db
            .query_row(
                "SELECT 1 FROM ladder_pages WHERE platform = ?1 AND tier = ?2 AND division = ?3 AND page = ?4",
                params![platform, tier, division, page],
                |_| Ok(()),
            )
            .optional()
            .map(|r| r.is_some())
    }

    pub fn mark_ladder_page(
        &self,
        platform: &str,
        tier: &str,
        division: &str,
        page: u32,
    ) -> Result<(), StoreError> {
        self.db.execute(
            "INSERT OR IGNORE INTO ladder_pages (platform, tier, division, page) VALUES (?1, ?2, ?3, ?4)",
            params![platform, tier, division, page],
        )?;
        Ok(())
    }

    /// The player of `b` whose history was read longest ago (never read first), if it was
    /// read before `stale_before` (epoch seconds).
    pub fn next_player(
        &self,
        platform: &str,
        b: SeedBracket,
        stale_before: i64,
    ) -> Result<Option<NextPlayer>, StoreError> {
        self.db
            .query_row(
                "SELECT puuid FROM players
                 WHERE platform = ?1 AND bracket = ?2 AND COALESCE(ids_fetched_at, 0) < ?3
                 ORDER BY COALESCE(ids_fetched_at, 0), rowid LIMIT 1",
                params![platform, b.id(), stale_before],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map(|p| {
                p.map(|puuid| NextPlayer {
                    puuid,
                    platform: platform.to_owned(),
                    bracket: b,
                })
            })
    }

    /// Queues the ids not fetched or queued yet; marks the player's history as read.
    pub fn queue_matches(
        &mut self,
        player: &NextPlayer,
        ids: &[String],
        now: i64,
    ) -> Result<usize, StoreError> {
        let tx = self.db.transaction()?;
        let mut queued = 0;
        {
            let mut insert = tx.prepare_cached(
                "INSERT OR IGNORE INTO pending (id, platform, bracket, queued_at)
                 SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM matches WHERE id = ?1)",
            )?;
            for id in ids {
                queued += insert.execute(params![id, player.platform, player.bracket.id(), now])?;
            }
            tx.execute(
                "UPDATE players SET ids_fetched_at = ?2 WHERE puuid = ?1",
                params![player.puuid, now],
            )?;
        }
        tx.commit()?;
        Ok(queued)
    }

    /// Oldest queued ids first.
    pub fn pending(&self, limit: usize) -> Result<Vec<PendingMatch>, StoreError> {
        let mut stmt = self.db.prepare_cached(
            "SELECT id, platform, bracket FROM pending ORDER BY queued_at, rowid LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![i64::try_from(limit).unwrap_or(i64::MAX)], |r| {
            Ok(PendingMatch {
                id: r.get(0)?,
                platform: r.get(1)?,
                bracket: bracket(&r.get::<_, String>(2)?),
            })
        })?;
        rows.collect()
    }

    /// Stores a fetched match (its facts, or why it isn't counted) and unqueues it, atomically.
    /// Returns `false` when the match was already stored (nothing changes).
    pub fn store_match(
        &mut self,
        m: &PendingMatch,
        result: &Result<GameFacts, String>,
        now: i64,
    ) -> Result<bool, StoreError> {
        let tx = self.db.transaction()?;
        let inserted = match result {
            Ok(facts) => {
                let json = serde_json::to_string(facts)
                    .map_err(|e| StoreError::ToSqlConversionFailure(Box::new(e)))?;
                tx.execute(
                    "INSERT OR IGNORE INTO matches (id, bracket, patch, queue, facts, fetched_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        m.id,
                        m.bracket.id(),
                        facts.patch.to_string(),
                        facts.queue,
                        json,
                        now
                    ],
                )?
            }
            Err(skip) => tx.execute(
                "INSERT OR IGNORE INTO matches (id, bracket, skip, fetched_at) VALUES (?1, ?2, ?3, ?4)",
                params![m.id, m.bracket.id(), skip, now],
            )?,
        };
        tx.execute("DELETE FROM pending WHERE id = ?1", params![m.id])?;
        tx.commit()?;
        Ok(inserted > 0)
    }

    /// Patches with counted games, newest first.
    pub fn patches(&self) -> Result<Vec<Patch>, StoreError> {
        let mut stmt = self
            .db
            .prepare("SELECT DISTINCT patch FROM matches WHERE facts IS NOT NULL")?;
        let mut patches: Vec<Patch> = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .filter_map(|p| p.ok()?.parse().ok())
            .collect();
        patches.sort_unstable_by(|a, b| b.cmp(a));
        Ok(patches)
    }

    /// Calls `each` with every counted game of `patch` (streamed, not loaded at once).
    pub fn for_each_game(
        &self,
        patch: Patch,
        mut each: impl FnMut(GameFacts, SeedBracket),
    ) -> Result<u64, StoreError> {
        let mut stmt = self.db.prepare(
            "SELECT facts, bracket FROM matches WHERE patch = ?1 AND facts IS NOT NULL ORDER BY id",
        )?;
        let mut rows = stmt.query(params![patch.to_string()])?;
        let mut n = 0;
        while let Some(row) = rows.next()? {
            let facts: String = row.get(0)?;
            let b: String = row.get(1)?;
            match serde_json::from_str::<GameFacts>(&facts) {
                Ok(f) => {
                    each(f, bracket(&b));
                    n += 1;
                }
                Err(error) => tracing::warn!(%error, "unreadable stored facts, skipped"),
            }
        }
        Ok(n)
    }

    pub fn counts(&self) -> Result<Counts, StoreError> {
        let count = |sql: &str| {
            self.db
                .query_row(sql, [], |r| r.get::<_, i64>(0))
                .map(|n| u64::try_from(n).unwrap_or(0))
        };
        Ok(Counts {
            players: count("SELECT COUNT(*) FROM players")?,
            pending: count("SELECT COUNT(*) FROM pending")?,
            matches: count("SELECT COUNT(*) FROM matches")?,
            counted: count("SELECT COUNT(*) FROM matches WHERE facts IS NOT NULL")?,
        })
    }
}
