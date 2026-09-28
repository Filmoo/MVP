//! The player's settings: loaded once at start, saved atomically on every change, and
//! published on a watch channel so the core reacts to changes without restarting.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use domain::Settings;
use tokio::sync::watch;

/// File name inside the app's config directory.
pub const FILE_NAME: &str = "settings.json";

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("settings file not writable ({path}): {source}")]
    Write {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("couldn't encode settings: {0}")]
    Encode(#[from] serde_json::Error),
}

/// Settings persisted as JSON in one file.
#[derive(Debug)]
pub struct SettingsStore {
    path: PathBuf,
    tx: watch::Sender<Settings>,
    /// Serializes writers so the file always holds the latest accepted value.
    write: Mutex<()>,
}

impl SettingsStore {
    /// Reads `path`. A missing file means defaults; an unreadable one is set aside
    /// (`settings.json.bad`) and replaced by defaults on the next save, never a crash.
    pub fn load(path: PathBuf) -> Self {
        let settings = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<Settings>(&bytes) {
                Ok(settings) => settings.normalized(),
                Err(error) => {
                    tracing::warn!(%error, path = %path.display(), "settings unreadable, using defaults");
                    let _ = std::fs::rename(&path, path.with_extension("json.bad"));
                    Settings::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(error) => {
                tracing::warn!(%error, path = %path.display(), "cannot read settings, using defaults");
                Settings::default()
            }
        };
        Self {
            path,
            tx: watch::channel(settings).0,
            write: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Current settings.
    pub fn get(&self) -> Settings {
        self.tx.borrow().clone()
    }

    /// Follows every accepted change.
    pub fn subscribe(&self) -> watch::Receiver<Settings> {
        self.tx.subscribe()
    }

    /// Saves `next` (normalized) and publishes it. On failure nothing changes.
    pub fn update(&self, next: Settings) -> Result<Settings, SettingsError> {
        let next = next.normalized();
        let _guard = self.write.lock().unwrap_or_else(PoisonError::into_inner);
        let mut json = serde_json::to_vec_pretty(&next)?;
        json.push(b'\n');
        write_atomic(&self.path, &json).map_err(|source| SettingsError::Write {
            path: self.path.clone(),
            source,
        })?;
        self.tx.send_if_modified(|current| {
            let changed = *current != next;
            current.clone_from(&next);
            changed
        });
        Ok(next)
    }
}

/// Writes to a temporary file next to `path`, flushes it to disk, then renames it over `path`:
/// a crash or power loss leaves either the old or the new file, never a torn one.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = temp_dir();
        let store = SettingsStore::load(dir.path().join(FILE_NAME));
        assert_eq!(store.get(), Settings::default());
    }

    #[test]
    fn saves_and_reloads() {
        let dir = temp_dir();
        let path = dir.path().join("nested").join(FILE_NAME);
        let store = SettingsStore::load(path.clone());
        let mut rx = store.subscribe();
        let saved = store
            .update(Settings {
                auto_accept: true,
                auto_accept_delay_seconds: 99,
                ..Settings::default()
            })
            .unwrap();
        assert_eq!(
            saved.auto_accept_delay_seconds,
            Settings::MAX_AUTO_ACCEPT_DELAY
        );
        assert!(rx.has_changed().unwrap());
        assert_eq!(*rx.borrow_and_update(), saved);
        assert!(!path.with_extension("json.tmp").exists());

        let reloaded = SettingsStore::load(path);
        assert_eq!(reloaded.get(), saved);
    }

    #[test]
    fn corrupt_file_is_set_aside() {
        let dir = temp_dir();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, b"{ not json").unwrap();
        let store = SettingsStore::load(path.clone());
        assert_eq!(store.get(), Settings::default());
        assert!(path.with_extension("json.bad").exists());
    }

    #[test]
    fn failed_write_changes_nothing() {
        let dir = temp_dir();
        // The settings "file" is a directory: the rename over it fails.
        let path = dir.path().join(FILE_NAME);
        std::fs::create_dir_all(path.join("occupied")).unwrap();
        let store = SettingsStore::load(path);
        let rx = store.subscribe();
        let result = store.update(Settings {
            auto_accept: true,
            ..Settings::default()
        });
        assert!(matches!(result, Err(SettingsError::Write { .. })));
        assert_eq!(store.get(), Settings::default());
        assert!(!rx.has_changed().unwrap());
    }
}
