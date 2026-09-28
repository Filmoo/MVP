//! Logs to stdout (debug builds and `pnpm app` show them) and to a file in the app's log folder:
//! a release build has no console, so without the file its logs would be lost. `mvp.log` holds
//! this run (at most [`MAX_BYTES`]), `mvp.previous.log` the one before. Settings → About opens
//! the folder, and copies the last lines (scrubbed) into its diagnostics.

use std::fs::{self, File};
use std::io::{self, BufRead as _, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;
use tracing_subscriber::{EnvFilter, fmt};

pub const FILE_NAME: &str = "mvp.log";
const PREVIOUS: &str = "mvp.previous.log";
/// A run stops writing past this (days of normal use; a loop gone wrong can't fill the disk).
pub const MAX_BYTES: u64 = 16 * 1024 * 1024;

/// A file that stops growing at `MAX_BYTES`; its last line says so.
struct Capped {
    file: File,
    written: u64,
    full: bool,
}

impl Write for Capped {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.full {
            return Ok(buf.len());
        }
        let len = u64::try_from(buf.len()).unwrap_or(u64::MAX);
        if self.written.saturating_add(len) > MAX_BYTES {
            self.full = true;
            self.file
                .write_all(b"... log full: the rest of this run is not written\n")?;
            return Ok(buf.len());
        }
        self.file.write_all(buf)?;
        self.written += len;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

/// `dir/mvp.log`, fresh (the last run's moves to `mvp.previous.log`).
fn open(dir: &Path) -> io::Result<File> {
    fs::create_dir_all(dir)?;
    let current = dir.join(FILE_NAME);
    if current.exists() {
        // Best effort: without it, this run simply starts a new file.
        let _ = fs::rename(&current, dir.join(PREVIOUS));
    }
    File::create(current)
}

/// Starts logging (stdout, plus `dir`'s file when it can be written). Returns the file's path.
pub fn init(dir: Option<&Path>) -> Option<PathBuf> {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,scout_desktop=debug".into());
    let opened = dir.map(|dir| (dir.join(FILE_NAME), open(dir)));
    let file_layer = match &opened {
        Some((_, Ok(file))) => file.try_clone().ok().map(|file| {
            fmt::layer()
                .with_ansi(false)
                .with_writer(Mutex::new(Capped {
                    file,
                    written: 0,
                    full: false,
                }))
        }),
        _ => None,
    };
    // `try_init`: a second call (tests) keeps the first subscriber.
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer())
        .with(file_layer)
        .try_init();
    match opened {
        Some((path, Ok(_))) => Some(path),
        Some((path, Err(error))) => {
            tracing::warn!(%error, path = %path.display(), "no log file");
            None
        }
        None => None,
    }
}

/// The last `count` lines of the log at `path` (all of it when shorter).
pub fn tail(path: &Path, count: usize) -> io::Result<Vec<String>> {
    let mut lines = std::collections::VecDeque::with_capacity(count);
    for line in BufReader::new(File::open(path)?).lines() {
        if lines.len() == count {
            lines.pop_front();
        }
        lines.push_back(line?);
    }
    Ok(lines.into())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mvp-logging-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn the_last_run_is_kept_once() {
        let dir = temp_dir("rotate");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), "run 1\n").unwrap();
        open(&dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join(PREVIOUS)).unwrap(), "run 1\n");
        assert_eq!(fs::read_to_string(dir.join(FILE_NAME)).unwrap(), "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_full_file_stops_growing_and_says_so() {
        let dir = temp_dir("cap");
        let mut capped = Capped {
            file: open(&dir).unwrap(),
            written: MAX_BYTES - 4,
            full: false,
        };
        capped.write_all(b"12345678").unwrap();
        capped.write_all(b"more").unwrap();
        let text = fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        assert_eq!(text, "... log full: the rest of this run is not written\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_keeps_the_last_lines() {
        let dir = temp_dir("tail");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        fs::write(&path, "a\nb\nc\nd\n").unwrap();
        assert_eq!(tail(&path, 2).unwrap(), vec!["c", "d"]);
        assert_eq!(tail(&path, 10).unwrap(), vec!["a", "b", "c", "d"]);
        let _ = fs::remove_dir_all(&dir);
    }
}
