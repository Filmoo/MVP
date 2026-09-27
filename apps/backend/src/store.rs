//! Keeps the Riot caches across restarts: a JSON snapshot of the account and match caches,
//! written on graceful shutdown and read at startup, so a deploy doesn't burn Riot calls.
//!
//! Deliberately not a database: the caches are bounded (≤ 50,000 accounts per index and
//! 20,000 compacted matches, a few tens of MB), accounts keep their age (they still expire a
//! day after they were fetched) and finished matches never change. A crash only loses what
//! was fetched since the last clean stop.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use riot_api::Account;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::source::CachedRiot;
use crate::watched::write_atomic;

pub const SNAPSHOT_FILE: &str = "cache/riot-cache.json";
const FORMAT: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct Snapshot {
    format: u32,
    /// Unix seconds.
    saved_at: u64,
    by_riot_id: Vec<StoredAccount>,
    by_puuid: Vec<StoredAccount>,
    matches: Vec<(String, Value)>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredAccount {
    /// Lower-cased `(gameName, tagLine)` for the Riot ID index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    key: Option<(String, String)>,
    puuid: String,
    game_name: Option<String>,
    tag_line: Option<String>,
    age_secs: u64,
}

impl StoredAccount {
    fn new(key: Option<(String, String)>, a: Account, age: Duration) -> Self {
        Self {
            key,
            puuid: a.puuid,
            game_name: a.game_name,
            tag_line: a.tag_line,
            age_secs: age.as_secs(),
        }
    }

    fn account(&self) -> Account {
        Account {
            puuid: self.puuid.clone(),
            game_name: self.game_name.clone(),
            tag_line: self.tag_line.clone(),
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Writes the snapshot atomically. Returns the number of entries saved.
pub fn save(riot: &CachedRiot, path: &Path) -> std::io::Result<usize> {
    let (by_riot_id, by_puuid, matches) = riot.caches();
    let snapshot = Snapshot {
        format: FORMAT,
        saved_at: unix_now(),
        by_riot_id: by_riot_id
            .entries()
            .into_iter()
            .map(|(k, a, age)| StoredAccount::new(Some(k), a, age))
            .collect(),
        by_puuid: by_puuid
            .entries()
            .into_iter()
            .map(|(_, a, age)| StoredAccount::new(None, a, age))
            .collect(),
        matches: matches
            .entries()
            .into_iter()
            .map(|(id, game, _)| (id, Value::clone(&game)))
            .collect(),
    };
    let count = snapshot.by_riot_id.len() + snapshot.by_puuid.len() + snapshot.matches.len();
    let bytes = serde_json::to_vec(&snapshot).map_err(std::io::Error::other)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    write_atomic(path, &bytes)?;
    Ok(count)
}

/// Fills the caches from a snapshot (a missing file is not an error). Returns the number of
/// entries read (expired ones are skipped by the caches).
pub fn load(riot: &CachedRiot, path: &Path) -> std::io::Result<usize> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let snapshot: Snapshot = serde_json::from_slice(&bytes).map_err(std::io::Error::other)?;
    if snapshot.format != FORMAT {
        return Ok(0);
    }
    let offline = Duration::from_secs(unix_now().saturating_sub(snapshot.saved_at));
    let age = |a: &StoredAccount| Duration::from_secs(a.age_secs) + offline;
    let (by_riot_id, by_puuid, matches) = riot.caches();
    for a in &snapshot.by_riot_id {
        if let Some(key) = &a.key {
            by_riot_id.insert_aged(key.clone(), a.account(), age(a));
        }
    }
    for a in &snapshot.by_puuid {
        by_puuid.insert_aged(a.puuid.clone(), a.account(), age(a));
    }
    let count = snapshot.by_riot_id.len() + snapshot.by_puuid.len() + snapshot.matches.len();
    for (id, game) in snapshot.matches {
        matches.insert_aged(id, Arc::new(game), Duration::ZERO);
    }
    Ok(count)
}
