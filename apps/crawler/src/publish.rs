//! Stored facts → aggregates → the per-patch JSON files under the stats directory, replaced
//! atomically per patch, then the index.

use std::io;
use std::path::{Path, PathBuf};

use aggregate::publish::{self, INDEX_PATH, Options};
use aggregate::{Dataset, ItemCatalog, Patch};
use domain::StatsIndex;
use static_data::DataDragon;

use crate::store::{Store, StoreError};

/// Build options kept per choice while loading (the published top is much smaller).
const COMPACT_KEEP: usize = 64;
/// Games between two compactions while loading.
const COMPACT_EVERY: u64 = 50_000;

#[derive(Debug, Clone)]
pub struct PublishConfig {
    /// The stats root served by the backend (`STATS_DIR`); files go to `v1/…` under it.
    pub stats_dir: PathBuf,
    /// Patches to publish; empty = the two newest with games.
    pub patches: Vec<Patch>,
    pub options: Options,
}

#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    #[error("crawl store: {0}")]
    Store(#[from] StoreError),
    #[error("writing stats files: {0}")]
    Io(#[from] io::Error),
    #[error("encoding stats files: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PublishReport {
    pub patches: Vec<String>,
    pub files: usize,
    pub bytes: usize,
    pub current: Option<String>,
}

pub fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// Item classes of a patch from Data Dragon; empty (no item builds) when unavailable.
async fn catalog(ddragon: Option<&DataDragon>, patch: Patch) -> ItemCatalog {
    let Some(dd) = ddragon else {
        return ItemCatalog::default();
    };
    let load = async {
        let version = dd
            .version_of_patch(&patch.to_string())
            .await?
            .ok_or(static_data::StaticDataError::NothingCached)?;
        let bytes = dd.raw_file(&version, "item.json").await?;
        Ok::<_, static_data::StaticDataError>(bytes)
    };
    match load.await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(|v| ItemCatalog::from_data_dragon(&v))
            .unwrap_or_default(),
        Err(error) => {
            tracing::warn!(%error, %patch, "no item data: builds are published without items");
            ItemCatalog::default()
        }
    }
}

/// Loads a patch's games into `ds`.
fn load(
    store: &Store,
    ds: &mut Dataset,
    patch: Patch,
    items: &ItemCatalog,
) -> Result<u64, StoreError> {
    let mut n = 0u64;
    store.for_each_game(patch, |facts, bracket| {
        ds.add(&facts, bracket, items);
        n += 1;
        if n.is_multiple_of(COMPACT_EVERY) {
            ds.compact(COMPACT_KEEP);
        }
    })
}

fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// Replaces `v1/{patch}` with freshly written files (readers never see a half-written patch).
fn replace_patch_dir(
    stats_dir: &Path,
    patch: Patch,
    files: &[publish::PublishedFile],
) -> io::Result<()> {
    let root = stats_dir.join("v1");
    let prefix = format!("v1/{patch}/");
    let staging = root.join(format!(".staging-{patch}"));
    let old = root.join(format!(".old-{patch}"));
    let target = root.join(patch.to_string());
    for dir in [&staging, &old] {
        if dir.exists() {
            std::fs::remove_dir_all(dir)?;
        }
    }
    for f in files {
        let rel = f.path.strip_prefix(&prefix).unwrap_or(&f.path);
        let file = staging.join(rel);
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(file, &f.body)?;
    }
    if target.exists() {
        std::fs::rename(&target, &old)?;
    }
    std::fs::rename(&staging, &target)?;
    if old.exists() {
        std::fs::remove_dir_all(&old)?;
    }
    Ok(())
}

pub fn read_index(stats_dir: &Path) -> Option<StatsIndex> {
    let bytes = std::fs::read(stats_dir.join(INDEX_PATH)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Publishes the configured patches (each with its previous patch as the base prior).
pub async fn publish(
    store: &Store,
    ddragon: Option<&DataDragon>,
    cfg: &PublishConfig,
) -> Result<PublishReport, PublishError> {
    let patches = if cfg.patches.is_empty() {
        store.patches()?.into_iter().take(2).collect()
    } else {
        cfg.patches.clone()
    };
    let updated_at = now_millis();
    let mut report = PublishReport::default();
    let mut entries = Vec::new();
    for patch in patches {
        let mut ds = Dataset::default();
        let games = load(store, &mut ds, patch, &catalog(ddragon, patch).await)?;
        // Only the previous patch's champion records are published (no builds): no items needed.
        load(store, &mut ds, patch.previous(), &ItemCatalog::default())?;
        let (files, entry) = publish::publish_patch(&ds, patch, &cfg.options, updated_at)?;
        let Some(entry) = entry else {
            tracing::warn!(%patch, "no games to publish");
            continue;
        };
        replace_patch_dir(&cfg.stats_dir, patch, &files)?;
        report.files += files.len();
        report.bytes += files.iter().map(|f| f.body.len()).sum::<usize>();
        report.patches.push(patch.to_string());
        tracing::info!(%patch, games, files = files.len(), "published");
        entries.push(entry);
    }
    let index = publish::build_index(
        read_index(&cfg.stats_dir),
        entries,
        &cfg.options,
        updated_at,
    );
    report.current.clone_from(&index.current);
    write_atomically(
        &cfg.stats_dir.join(INDEX_PATH),
        &serde_json::to_vec(&index)?,
    )?;
    Ok(report)
}
