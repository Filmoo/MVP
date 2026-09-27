//! A small JSON file in the data dir, validated at load and reloaded when it changes.
//!
//! No watcher thread and no polling: a request looks at the file's modification time and size
//! (at most once per `min_interval`) and re-reads it only when they changed. An invalid new
//! version is logged and the last good one keeps being served.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime};

/// Parses and validates a file's bytes.
pub type Parser<T> = fn(&[u8]) -> Result<T, String>;

#[derive(Debug)]
pub struct Watched<T> {
    path: PathBuf,
    parse: Parser<T>,
    min_interval: Duration,
    state: Mutex<State<T>>,
}

#[derive(Debug)]
struct State<T> {
    value: Arc<T>,
    stamp: Option<Stamp>,
    checked: Instant,
}

/// Modification time and length: a rewrite (even atomic, by rename) changes at least one.
type Stamp = (SystemTime, u64);

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

impl<T: Default> Watched<T> {
    /// Reads `path` now: a missing file gives `T::default()`, an invalid one is an error (the
    /// service refuses to start on a broken file rather than serve defaults silently).
    pub fn load(path: PathBuf, parse: Parser<T>, min_interval: Duration) -> Result<Self, String> {
        let stamp = stamp(&path);
        let value = read(&path, parse)?.unwrap_or_default();
        Ok(Self {
            path,
            parse,
            min_interval,
            state: Mutex::new(State {
                value: Arc::new(value),
                stamp,
                checked: Instant::now(),
            }),
        })
    }

    /// The current value, reloaded first if the file changed.
    pub fn get(&self) -> Arc<T> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.checked.elapsed() < self.min_interval {
            return Arc::clone(&state.value);
        }
        state.checked = Instant::now();
        let now = stamp(&self.path);
        if now != state.stamp {
            state.stamp = now;
            match read(&self.path, self.parse) {
                Ok(value) => {
                    tracing::info!(path = %self.path.display(), "reloaded");
                    state.value = Arc::new(value.unwrap_or_default());
                }
                Err(e) => {
                    tracing::error!(path = %self.path.display(), error = %e, "invalid file, keeping the previous version");
                }
            }
        }
        Arc::clone(&state.value)
    }
}

/// `Ok(None)` when the file does not exist.
pub fn read<T>(path: &Path, parse: Parser<T>) -> Result<Option<T>, String> {
    match std::fs::read(path) {
        Ok(bytes) => parse(&bytes)
            .map(Some)
            .map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Replaces `path` with `bytes` atomically (write a sibling temp file, fsync, rename), so the
/// service never reads a half-written file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".tmp-{}", std::process::id()));
    let tmp = PathBuf::from(tmp);
    let result = (|| {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(bytes: &[u8]) -> Result<u32, String> {
        std::str::from_utf8(bytes)
            .map_err(|e| e.to_string())?
            .trim()
            .parse()
            .map_err(|e: std::num::ParseIntError| e.to_string())
    }

    #[test]
    fn reloads_on_change_and_keeps_the_last_good_value() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = dir.path().join("n.txt");
        let watched = Watched::load(path.clone(), parse, Duration::ZERO)?;
        assert_eq!(*watched.get(), 0, "missing file: default");

        write_atomic(&path, b"7").map_err(|e| e.to_string())?;
        assert_eq!(*watched.get(), 7);
        write_atomic(&path, b"not a number").map_err(|e| e.to_string())?;
        assert_eq!(*watched.get(), 7, "invalid: previous version kept");
        write_atomic(&path, b"42").map_err(|e| e.to_string())?;
        assert_eq!(*watched.get(), 42);

        std::fs::write(&path, b"oops").map_err(|e| e.to_string())?;
        assert!(
            Watched::load(path, parse, Duration::ZERO).is_err(),
            "refuses to start"
        );
        Ok(())
    }

    #[test]
    fn checks_at_most_once_per_interval() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = dir.path().join("n.txt");
        write_atomic(&path, b"1").map_err(|e| e.to_string())?;
        let watched = Watched::load(path.clone(), parse, Duration::from_secs(3600))?;
        write_atomic(&path, b"22").map_err(|e| e.to_string())?;
        assert_eq!(*watched.get(), 1, "not re-checked within the interval");
        Ok(())
    }
}
