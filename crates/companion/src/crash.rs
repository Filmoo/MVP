//! Opt-in crash reports (Settings → App, off by default).
//!
//! - A **panic** in the core is written to disk by the panic hook (release builds abort right
//!   after it) and sent on the next start, or at once when the app survives it.
//! - **UI errors** (uncaught errors, crashed widgets) come through the `report_error` command.
//!
//! Nothing is written or sent while the setting is off, and turning it off deletes the reports
//! not sent yet. Every report is scrubbed here, before it leaves the machine (`crates/scrub`:
//! Riot IDs, PUUIDs, user names in paths, e-mails, credentials, IPs; the server scrubs again),
//! and bounded to the server's limits. A report says what failed, the app and OS versions and
//! the random install id: nothing about the player's account.

use std::backtrace::Backtrace;
use std::io::Write as _;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use domain::{CrashReport, ReportKind, Settings};
use tokio::sync::{Notify, watch};

use crate::backend::{BackendClient, ReportRefused};

/// Directory (next to `settings.json`) of reports waiting to be sent.
pub const DIR_NAME: &str = "crash-reports";
/// Server limits (`apps/backend/src/reports.rs`).
pub const MAX_MESSAGE: usize = 2 * 1024;
pub const MAX_STACK: usize = 16 * 1024;
const MAX_OS_VERSION: usize = 64;
/// Reports kept waiting at most (the oldest go first): a crash loop must not fill the disk.
const MAX_PENDING: usize = 10;
/// Sent per start: the server takes a burst of 5 per install, then 10 an hour.
const SEND_PER_START: usize = 5;
/// UI errors sent per session (the same error once).
const MAX_UI_REPORTS: usize = 10;

/// A report ready to leave the machine: scrubbed and within the server's limits.
pub fn build_report(
    kind: ReportKind,
    message: &str,
    stack: Option<&str>,
    app_version: &str,
    os_version: &str,
    install_id: &str,
) -> CrashReport {
    let clean =
        |text: &str, max: usize| scrub::truncate(&scrub::scrub(text.trim()), max).to_owned();
    let message = clean(message, MAX_MESSAGE);
    CrashReport {
        app_version: app_version.to_owned(),
        os_version: clean(os_version, MAX_OS_VERSION),
        kind,
        message: if message.is_empty() {
            "(no message)".to_owned()
        } else {
            message
        },
        stack: stack.map(|s| clean(s, MAX_STACK)).filter(|s| !s.is_empty()),
        install_id: install_id.to_owned(),
    }
}

/// `thread 'main' panicked at src/x.rs:1:2: message` from a panic hook's information.
fn describe_panic(info: &PanicHookInfo<'_>) -> String {
    let payload = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "(no message)".to_owned());
    let thread = std::thread::current();
    let thread = thread.name().unwrap_or("<unnamed>");
    match info.location() {
        Some(at) => format!(
            "thread '{thread}' panicked at {}:{}:{}: {payload}",
            at.file(),
            at.line(),
            at.column()
        ),
        None => format!("thread '{thread}' panicked: {payload}"),
    }
}

/// A backtrace worth sending: release builds are stripped, so theirs are only `<unknown>`.
fn useful_backtrace() -> Option<String> {
    let trace = Backtrace::force_capture().to_string();
    trace.contains("::").then_some(trace)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// Where the reports of this install go, and whether the player allows it.
#[derive(Debug)]
pub struct CrashReporter {
    dir: PathBuf,
    app_version: String,
    os_version: String,
    install_id: String,
    backend: Option<BackendClient>,
    /// The player's setting; read by the panic hook, so no lock.
    enabled: AtomicBool,
    /// Makes pending file names unique within a millisecond.
    sequence: AtomicU32,
    /// UI errors already reported this session.
    seen: Mutex<Vec<String>>,
    /// A report was saved: send it if the app is still alive.
    saved: Notify,
}

impl CrashReporter {
    /// Off until [`Self::set_enabled`] (or [`Self::run`]) says otherwise.
    pub fn new(
        dir: PathBuf,
        app_version: &str,
        os_version: &str,
        install_id: &str,
        backend: Option<BackendClient>,
    ) -> Arc<Self> {
        Arc::new(Self {
            dir,
            app_version: app_version.to_owned(),
            os_version: os_version.to_owned(),
            install_id: install_id.to_owned(),
            backend,
            enabled: AtomicBool::new(false),
            sequence: AtomicU32::new(0),
            seen: Mutex::new(Vec::new()),
            saved: Notify::new(),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Follows the player's choice. Turning reports off deletes the ones not sent yet.
    pub fn set_enabled(&self, enabled: bool) {
        let was = self.enabled.swap(enabled, Ordering::SeqCst);
        if !enabled {
            let removed = self.clear_pending();
            if was || removed > 0 {
                tracing::info!(removed, "crash reports off");
            }
        }
    }

    fn report(&self, kind: ReportKind, message: &str, stack: Option<&str>) -> CrashReport {
        build_report(
            kind,
            message,
            stack,
            &self.app_version,
            &self.os_version,
            &self.install_id,
        )
    }

    /// Reports waiting to be sent, oldest first.
    pub fn pending(&self) -> Vec<PathBuf> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut files: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .collect();
        files.sort();
        files
    }

    fn clear_pending(&self) -> usize {
        self.pending()
            .iter()
            .filter(|p| std::fs::remove_file(p).is_ok())
            .count()
    }

    /// Writes `report` to the pending directory (synchronously: the panic hook runs this right
    /// before a release build aborts), keeping at most `MAX_PENDING` reports.
    pub fn save(&self, report: &CrashReport) -> std::io::Result<PathBuf> {
        std::fs::create_dir_all(&self.dir)?;
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let path = self
            .dir
            .join(format!("{:013}-{sequence:04}.json", now_millis()));
        let json = serde_json::to_vec(report).map_err(std::io::Error::other)?;
        let mut file = std::fs::File::create(&path)?;
        file.write_all(&json)?;
        file.sync_all()?;
        let pending = self.pending();
        for old in pending
            .iter()
            .take(pending.len().saturating_sub(MAX_PENDING))
        {
            let _ = std::fs::remove_file(old);
        }
        Ok(path)
    }

    /// Called by the panic hook: saves a report when the player opted in.
    fn record_panic(&self, info: &PanicHookInfo<'_>) {
        if !self.enabled() {
            return;
        }
        let report = self.report(
            ReportKind::Panic,
            &describe_panic(info),
            useful_backtrace().as_deref(),
        );
        if self.save(&report).is_ok() {
            self.saved.notify_one();
        }
    }

    /// Chains a panic hook that saves a report (when opted in) before the default output.
    pub fn install_panic_hook(self: &Arc<Self>) {
        let reporter = Arc::clone(self);
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            reporter.record_panic(info);
            previous(info);
        }));
    }

    /// Sends waiting reports (a few per call, oldest first). Sent and refused ones are deleted;
    /// the rest wait for the next time (offline, rate limited). Returns how many were sent.
    pub async fn send_pending(&self) -> usize {
        let Some(backend) = &self.backend else {
            return 0;
        };
        let mut sent = 0;
        for path in self.pending().into_iter().take(SEND_PER_START) {
            if !self.enabled() {
                break;
            }
            let report = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<CrashReport>(&bytes).ok());
            let Some(report) = report else {
                let _ = std::fs::remove_file(&path);
                continue;
            };
            match backend.report(&report).await {
                Ok(()) => {
                    sent += 1;
                    let _ = std::fs::remove_file(&path);
                }
                Err(ReportRefused::Rejected(error)) => {
                    tracing::warn!(%error, "crash report refused, dropped");
                    let _ = std::fs::remove_file(&path);
                }
                Err(ReportRefused::Later(error)) => {
                    tracing::info!(%error, "crash reports wait for later");
                    break;
                }
            }
        }
        sent
    }

    /// An error in the UI (only sent when the player opted in; the same error once a session).
    pub async fn report_ui_error(&self, message: &str, stack: Option<&str>) {
        if !self.enabled() {
            return;
        }
        let report = self.report(ReportKind::Js, message, stack);
        {
            let mut seen = self.seen.lock().unwrap_or_else(PoisonError::into_inner);
            if seen.len() >= MAX_UI_REPORTS || seen.contains(&report.message) {
                return;
            }
            seen.push(report.message.clone());
        }
        let Some(backend) = &self.backend else {
            return;
        };
        if let Err(ReportRefused::Later(_)) = backend.report(&report).await
            && self.enabled()
            && let Err(error) = self.save(&report)
        {
            tracing::warn!(%error, "cannot keep a crash report for later");
        }
    }

    /// Follows the player's setting for as long as the app runs: sends what waits when reports
    /// are (or get) turned on, and what a surviving panic saved.
    pub async fn run(self: Arc<Self>, mut settings: watch::Receiver<Settings>) {
        let enabled = settings.borrow_and_update().crash_reports;
        self.set_enabled(enabled);
        if enabled {
            self.send_pending().await;
        }
        loop {
            tokio::select! {
                changed = settings.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    let enabled = settings.borrow_and_update().crash_reports;
                    let was = self.enabled();
                    self.set_enabled(enabled);
                    if enabled && !was {
                        self.send_pending().await;
                    }
                }
                () = self.saved.notified() => {
                    self.send_pending().await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    const INSTALL: &str = "0123456789abcdef0123456789abcdef";

    fn reporter(dir: &Path) -> Arc<CrashReporter> {
        CrashReporter::new(dir.join(DIR_NAME), "0.1.0", "windows x86_64", INSTALL, None)
    }

    #[test]
    fn reports_leave_scrubbed_and_bounded() {
        let report = build_report(
            ReportKind::Panic,
            "failed to load Fillmo#7272 from C:\\Users\\Jane Doe\\AppData\\Roaming\\gg.mvp.companion",
            Some(&format!(
                "puuid 0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33 at https://riot:s3cretT0ken@127.0.0.1:2999/x\n{}",
                "frame\n".repeat(5_000)
            )),
            "0.1.0",
            "windows x86_64",
            INSTALL,
        );
        assert!(!report.message.contains("Fillmo") && !report.message.contains("Jane"));
        assert!(report.message.contains("C:\\Users\\<user>\\AppData"));
        let stack = report.stack.unwrap();
        assert!(!stack.contains("0f8e2a7c") && !stack.contains("s3cret"));
        assert!(stack.len() <= MAX_STACK);
        assert_eq!(report.install_id, INSTALL);
        let long = build_report(
            ReportKind::Js,
            &"é".repeat(5_000),
            None,
            "0.1.0",
            "x",
            INSTALL,
        );
        assert!(long.message.len() <= MAX_MESSAGE);
        let empty = build_report(ReportKind::Js, "  ", Some(" "), "0.1.0", "x", INSTALL);
        assert_eq!(
            (empty.message.as_str(), empty.stack),
            ("(no message)", None)
        );
    }

    #[test]
    fn keeps_a_bounded_queue_and_forgets_it_when_turned_off() {
        let dir = tempfile::tempdir().unwrap();
        let reporter = reporter(dir.path());
        let report = reporter.report(ReportKind::Panic, "boom", None);
        for _ in 0..(MAX_PENDING + 3) {
            reporter.save(&report).unwrap();
        }
        assert_eq!(reporter.pending().len(), MAX_PENDING, "the oldest go first");
        reporter.set_enabled(true);
        assert_eq!(reporter.pending().len(), MAX_PENDING);
        reporter.set_enabled(false);
        assert!(
            reporter.pending().is_empty(),
            "opting out deletes what waits"
        );
    }

    #[test]
    fn a_panic_is_saved_only_when_opted_in() {
        let dir = tempfile::tempdir().unwrap();
        let reporter = reporter(dir.path());
        reporter.install_panic_hook();
        let _ = std::panic::catch_unwind(|| panic!("off"));
        assert!(reporter.pending().is_empty(), "nothing written while off");
        reporter.set_enabled(true);
        let _ = std::panic::catch_unwind(|| panic!("while scouting Fillmo#7272"));
        let pending = reporter.pending();
        assert_eq!(pending.len(), 1);
        let report: CrashReport =
            serde_json::from_slice(&std::fs::read(&pending[0]).unwrap()).unwrap();
        assert_eq!(report.kind, ReportKind::Panic);
        assert!(report.message.contains("panicked at"), "{}", report.message);
        assert!(report.message.contains("<riot-id>"), "{}", report.message);
        assert!(!report.message.contains("Fillmo"), "{}", report.message);
        let _ = std::panic::take_hook();
    }
}
