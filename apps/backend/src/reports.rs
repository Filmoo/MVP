//! Opt-in crash/diagnostic reports: `POST /v1/reports` (`domain::CrashReport`) → 202.
//!
//! Validated, size-limited, scrubbed of personal data (`scrub.rs`), rate limited per install
//! and appended to `reports/YYYY-MM-DD.jsonl` (UTC day) in the data dir. Files older than
//! `RETENTION_DAYS` are deleted by `prune` (daily task + `mvp-backend reports prune`);
//! `mvp-backend reports forget --install-id …` erases one install's reports (GDPR).
//! The client IP is never stored.

use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use domain::{ApiErrorCode, CrashReport, ReportKind};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use time::{Date, Duration as Days, OffsetDateTime};

use crate::error::Failure;
use crate::limits::{TokenBuckets, too_many, valid_install_id};
use crate::scrub::{scrub, truncate};
use crate::telemetry::Metrics;
use crate::watched::write_atomic;

pub const REPORTS_DIR: &str = "reports";
pub const RETENTION_DAYS: i64 = 30;
/// Largest accepted body (a full 16 KB stack plus JSON escaping and the other fields).
pub const MAX_BODY: usize = 40 * 1024;
pub const MAX_MESSAGE: usize = 2 * 1024;
pub const MAX_STACK: usize = 16 * 1024;
/// Past this, a day's file stops growing (a crash loop across many installs).
const MAX_DAY_BYTES: u64 = 64 * 1024 * 1024;
/// Per install: 5 at once, then 10 an hour.
const BURST: u32 = 5;
const PER_SEC: f64 = 10.0 / 3600.0;

/// One stored line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredReport {
    pub received_at: String,
    pub install_id: String,
    pub app_version: String,
    pub os_version: String,
    pub kind: ReportKind,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

#[derive(Debug)]
pub struct Reports {
    dir: PathBuf,
    per_install: TokenBuckets,
    write: Mutex<()>,
    metrics: Arc<Metrics>,
}

impl Reports {
    pub fn new(dir: PathBuf, metrics: Arc<Metrics>) -> Self {
        Self {
            dir,
            per_install: TokenBuckets::new(BURST, PER_SEC),
            write: Mutex::new(()),
            metrics,
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn append(&self, report: &StoredReport, day: Date) -> std::io::Result<bool> {
        let mut line = serde_json::to_vec(report).map_err(std::io::Error::other)?;
        line.push(b'\n');
        let _guard = self.write.lock().unwrap_or_else(PoisonError::into_inner);
        std::fs::create_dir_all(&self.dir)?;
        let path = self.dir.join(file_name(day));
        if std::fs::metadata(&path).is_ok_and(|m| m.len() >= MAX_DAY_BYTES) {
            return Ok(false);
        }
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        file.write_all(&line)?;
        Ok(true)
    }
}

fn file_name(day: Date) -> String {
    format!(
        "{:04}-{:02}-{:02}.jsonl",
        day.year(),
        u8::from(day.month()),
        day.day()
    )
}

fn file_day(name: &str) -> Option<Date> {
    let stem = name.strip_suffix(".jsonl")?;
    Date::parse(stem, format_description!("[year]-[month]-[day]")).ok()
}

/// A valid report, scrubbed; `Err` says what is wrong.
pub fn clean(report: CrashReport, received_at: OffsetDateTime) -> Result<StoredReport, String> {
    if !valid_install_id(&report.install_id) {
        return Err("installId: 8–64 of [A-Za-z0-9-]".into());
    }
    if report.app_version.len() > 64 || semver::Version::parse(&report.app_version).is_err() {
        return Err("appVersion is not semver".into());
    }
    let os = report.os_version.trim();
    if os.is_empty() || os.chars().count() > 64 || os.chars().any(char::is_control) {
        return Err("osVersion: 1–64 printable characters".into());
    }
    if report.message.trim().is_empty() || report.message.len() > MAX_MESSAGE {
        return Err(format!("message: 1–{MAX_MESSAGE} bytes"));
    }
    if report.stack.as_ref().is_some_and(|s| s.len() > MAX_STACK) {
        return Err(format!("stack: at most {MAX_STACK} bytes"));
    }
    Ok(StoredReport {
        received_at: received_at.format(&Rfc3339).unwrap_or_default(),
        install_id: report.install_id,
        app_version: report.app_version,
        os_version: scrub(os),
        kind: report.kind,
        // Scrubbing can only shorten or slightly lengthen ("<id>"): cap again.
        message: truncate(&scrub(&report.message), MAX_MESSAGE).to_owned(),
        stack: report
            .stack
            .filter(|s| !s.trim().is_empty())
            .map(|s| truncate(&scrub(&s), MAX_STACK).to_owned()),
    })
}

pub async fn submit(
    State(reports): State<Arc<Reports>>,
    body: Result<Json<CrashReport>, JsonRejection>,
) -> Response {
    let report = match body {
        Ok(Json(report)) => report,
        Err(e) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            reports.metrics.report("tooLarge");
            return Failure::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                ApiErrorCode::BadRequest,
                format!("reports are limited to {MAX_BODY} bytes"),
            )
            .into_response();
        }
        Err(e) => {
            reports.metrics.report("invalid");
            return Failure::bad_request(e.body_text()).into_response();
        }
    };
    let now = OffsetDateTime::now_utc();
    let stored = match clean(report, now) {
        Ok(stored) => stored,
        Err(e) => {
            reports.metrics.report("invalid");
            return Failure::bad_request(e).into_response();
        }
    };
    if let Err(wait) = reports.per_install.check(&stored.install_id) {
        reports.metrics.report("rateLimited");
        return too_many(wait, "too many reports from this install");
    }
    let sink = Arc::clone(&reports);
    let day = now.date();
    let written = tokio::task::spawn_blocking(move || sink.append(&stored, day)).await;
    match written {
        Ok(Ok(true)) => {
            reports.metrics.report("accepted");
            StatusCode::ACCEPTED.into_response()
        }
        Ok(Ok(false)) => {
            reports.metrics.report("dropped");
            tracing::warn!("today's report file is full, dropping reports");
            StatusCode::ACCEPTED.into_response()
        }
        Ok(Err(e)) => {
            reports.metrics.report("failed");
            tracing::error!(error = %e, "cannot store a report");
            Failure::new(
                StatusCode::SERVICE_UNAVAILABLE,
                ApiErrorCode::Upstream,
                "reports are unavailable",
            )
            .into_response()
        }
        Err(e) => {
            reports.metrics.report("failed");
            tracing::error!(error = %e, "report writer panicked");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn report_files(dir: &Path) -> std::io::Result<Vec<(PathBuf, Date)>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry?;
        if let Some(day) = entry.file_name().to_str().and_then(file_day) {
            files.push((entry.path(), day));
        }
    }
    files.sort_by_key(|(_, day)| *day);
    Ok(files)
}

/// Deletes the day files older than `days` days before `today`. Returns how many.
pub fn prune(dir: &Path, today: Date, days: i64) -> std::io::Result<usize> {
    let oldest_kept = today - Days::days(days);
    let mut removed = 0;
    for (path, day) in report_files(dir)? {
        if day < oldest_kept {
            std::fs::remove_file(path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Erases every report of `install_id` (rewriting the files atomically). Returns how many.
/// A report the service appends to a file while it is being rewritten may be lost.
pub fn forget(dir: &Path, install_id: &str) -> std::io::Result<usize> {
    let mut removed = 0;
    for (path, _) in report_files(dir)? {
        let text = std::fs::read_to_string(&path)?;
        let mut kept = String::with_capacity(text.len());
        let mut dropped = 0;
        for line in text.lines() {
            // Unreadable lines are kept unless they mention the id at all.
            let theirs = serde_json::from_str::<StoredReport>(line).map_or_else(
                |_| line.contains(install_id),
                |r| r.install_id == install_id,
            );
            if theirs {
                dropped += 1;
            } else {
                kept.push_str(line);
                kept.push('\n');
            }
        }
        if dropped > 0 {
            write_atomic(&path, kept.as_bytes())?;
            removed += dropped;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    type Change = fn(&mut CrashReport);

    use time::macros::{date, datetime};

    use super::*;

    fn report(id: &str) -> CrashReport {
        CrashReport {
            app_version: "0.2.0".into(),
            os_version: "Windows 11 23H2".into(),
            kind: ReportKind::Panic,
            message: r"panicked at C:\Users\Jane\app.rs: no card for Fillmo#7272".into(),
            stack: Some("0: mvp::draft\n1: std::rt".into()),
            install_id: id.into(),
        }
    }

    const ID: &str = "0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33";

    #[test]
    fn clean_validates_and_scrubs() {
        let now = datetime!(2026-09-27 10:00 UTC);
        let stored = clean(report(ID), now).expect("valid");
        assert_eq!(stored.install_id, ID, "kept: it keys deletion");
        assert_eq!(stored.received_at, "2026-09-27T10:00:00Z");
        assert_eq!(
            stored.message,
            r"panicked at C:\Users\<user>\app.rs: no <riot-id>"
        );

        let cases: [(&str, Change); 7] = [
            ("installId", |r| r.install_id = "x".into()),
            ("appVersion", |r| r.app_version = "latest".into()),
            ("osVersion", |r| r.os_version = "a\u{0}b".into()),
            ("osVersion", |r| r.os_version = "w".repeat(65)),
            ("message", |r| r.message = " ".into()),
            ("message", |r| r.message = "m".repeat(MAX_MESSAGE + 1)),
            ("stack", |r| r.stack = Some("s".repeat(MAX_STACK + 1))),
        ];
        for (field, change) in cases {
            let mut r = report(ID);
            change(&mut r);
            let err = clean(r, now).expect_err(field);
            assert!(err.contains(field), "{err}");
        }
        let mut r = report(ID);
        r.stack = Some("s".repeat(MAX_STACK));
        assert!(clean(r, now).is_ok(), "exactly 16 KB is fine");
    }

    #[test]
    fn prune_and_forget() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let reports = Reports::new(dir.path().to_path_buf(), Arc::default());
        let other = "11111111-2222-3333-4444-555555555555";
        for (day, id) in [
            (date!(2026 - 08 - 20), ID),
            (date!(2026 - 08 - 28), ID),
            (date!(2026 - 09 - 27), ID),
            (date!(2026 - 09 - 27), other),
        ] {
            let stored =
                clean(report(id), day.midnight().assume_utc()).map_err(std::io::Error::other)?;
            assert!(reports.append(&stored, day)?);
        }
        std::fs::write(dir.path().join("notes.txt"), "not a report")?;

        assert_eq!(prune(dir.path(), date!(2026 - 09 - 27), RETENTION_DAYS)?, 1);
        assert!(!dir.path().join("2026-08-20.jsonl").exists());
        assert!(
            dir.path().join("2026-08-28.jsonl").exists(),
            "within 30 days"
        );
        assert!(
            dir.path().join("notes.txt").exists(),
            "other files untouched"
        );

        assert_eq!(forget(dir.path(), ID)?, 2);
        let today = std::fs::read_to_string(dir.path().join("2026-09-27.jsonl"))?;
        assert_eq!(today.lines().count(), 1);
        assert!(today.contains(other) && !today.contains(ID));
        assert_eq!(forget(dir.path(), ID)?, 0);
        Ok(())
    }
}
