//! The roadmap in `SQLite`: one file, WAL mode. Every change runs in one transaction together
//! with its audit entry, after the rights check (`policy`), so the log never misses a change and
//! never records one that didn't happen.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension as _, Row, params};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value, json};

use crate::model::{
    AREA_COLORS, Actor, ActorKind, Area, AuditEntry, Comment, Feature, FeatureDetail, Link,
    Placement, Proposer, Roadmap, Status, Timestamp, Version,
};
use crate::policy::{self, Denied};
use crate::seed::SeedFile;
use crate::validate;

const SCHEMA_VERSION: &str = "1";

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS areas (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    goal TEXT NOT NULL DEFAULT '',
    target_date TEXT,
    released_on TEXT,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS features (
    id INTEGER PRIMARY KEY,
    seed_key TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    version_id INTEGER NOT NULL REFERENCES versions (id),
    status TEXT NOT NULL,
    area TEXT NOT NULL REFERENCES areas (key),
    proposed_by TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    done_at INTEGER,
    removed_at INTEGER
);
CREATE INDEX IF NOT EXISTS features_by_version ON features (version_id, position);
CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY,
    feature_id INTEGER NOT NULL REFERENCES features (id),
    url TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    added_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS links_by_feature ON links (feature_id);
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    feature_id INTEGER NOT NULL REFERENCES features (id),
    author_kind TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_by_feature ON comments (feature_id);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    actor_kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    feature_id INTEGER,
    version_id INTEGER,
    summary TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_by_feature ON audit (feature_id, id);
CREATE TABLE IF NOT EXISTS sessions (
    id_hash BLOB PRIMARY KEY,
    login TEXT NOT NULL,
    github_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT NOT NULL,
    csrf TEXT NOT NULL,
    github_token BLOB,
    dev INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    verified_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    hash BLOB NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS tokens_active_name ON tokens (name) WHERE revoked_at IS NULL;
";

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Denied(&'static str),
    #[error("{0}")]
    Conflict(String),
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),
}

impl From<Denied> for StoreError {
    fn from(denied: Denied) -> Self {
        Self::Denied(denied.0)
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

fn invalid(message: String) -> StoreError {
    StoreError::Invalid(message)
}

// ---- Inputs ------------------------------------------------------------------------------

/// `POST /api/features`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewFeature {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub version_id: i64,
    pub area: String,
    /// The owner's choice (default accepted); Claude's features are always proposals.
    #[serde(default)]
    pub status: Option<Status>,
}

/// `PATCH /api/features/{id}`: the fields to change.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeaturePatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub area: Option<String>,
    /// Another version: the feature goes to its end.
    pub version_id: Option<i64>,
}

/// `POST /api/features/{id}/move`: into a version, before a feature of it (or at its end),
/// optionally changing status on the way (a card dropped in another lane).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveTo {
    pub version_id: i64,
    #[serde(default)]
    pub before_id: Option<i64>,
    #[serde(default)]
    pub status: Option<Status>,
}

/// `POST /api/versions`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewVersion {
    pub name: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub released_on: Option<String>,
}

/// `PATCH /api/versions/{id}`: absent fields stay, `null` clears a date.
#[allow(
    clippy::option_option,
    reason = "a date may be left alone (absent), cleared (null) or set"
)]
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionPatch {
    pub name: Option<String>,
    pub goal: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub target_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub released_on: Option<Option<String>>,
}

/// A field that is present, maybe `null` (absent stays `None` through `#[serde(default)]`).
#[allow(
    clippy::option_option,
    reason = "a date may be left alone (absent), cleared (null) or set"
)]
fn present<'de, D: Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

/// What a move changed: the feature, and the order of every version it touched.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    pub feature: Feature,
    pub placements: Vec<Placement>,
}

/// A signed-in browser, found by the keyed hash of its cookie (`auth`).
#[derive(Clone)]
pub struct Session {
    pub login: String,
    pub github_id: i64,
    pub name: String,
    pub avatar_url: String,
    pub csrf: String,
    /// The user's GitHub token, sealed with the session key (`crypto::Keys::seal`).
    pub github_token: Option<Vec<u8>>,
    /// Made by `--dev-login` (never accepted by a server without it).
    pub dev: bool,
    pub created_at: i64,
    pub last_seen_at: i64,
    /// When GitHub last said this login is an admin of the repository.
    pub verified_at: i64,
    pub expires_at: i64,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("login", &self.login)
            .field("dev", &self.dev)
            .field("csrf", &"[redacted]")
            .field(
                "github_token",
                &self.github_token.as_ref().map(|_| "[redacted]"),
            )
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

/// A machine token as `mvp-roadmap token list` shows it (never the token itself).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenInfo {
    pub name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub revoked_at: Option<i64>,
}

/// What `import_seed` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeedOutcome {
    Imported {
        areas: usize,
        versions: usize,
        features: usize,
    },
    /// The database already holds a roadmap: nothing was touched.
    NotEmpty,
}

// ---- The store ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct Store {
    db: Connection,
}

const FEATURE_COLUMNS: &str = "f.id, f.title, f.description, f.version_id, f.status, f.area, \
     f.proposed_by, f.position, f.created_at, f.updated_at, f.started_at, f.done_at, \
     f.removed_at, (SELECT COUNT(*) FROM comments c WHERE c.feature_id = f.id)";

fn feature_row(row: &Row<'_>) -> rusqlite::Result<Feature> {
    let status: String = row.get(4)?;
    let proposer: String = row.get(6)?;
    let at = |i: usize| -> rusqlite::Result<Option<Timestamp>> {
        Ok(row.get::<_, Option<i64>>(i)?.map(Timestamp))
    };
    Ok(Feature {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        version_id: row.get(3)?,
        status: Status::parse(&status).unwrap_or(Status::Proposed),
        area: row.get(5)?,
        proposed_by: Proposer::parse(&proposer).unwrap_or(Proposer::Owner),
        position: row.get(7)?,
        links: Vec::new(),
        comments: row.get(13)?,
        created_at: Timestamp(row.get(8)?),
        updated_at: Timestamp(row.get(9)?),
        started_at: at(10)?,
        done_at: at(11)?,
        removed_at: at(12)?,
    })
}

fn version_row(row: &Row<'_>) -> rusqlite::Result<Version> {
    Ok(Version {
        id: row.get(0)?,
        name: row.get(1)?,
        goal: row.get(2)?,
        target_date: row.get(3)?,
        released_on: row.get(4)?,
        position: row.get(5)?,
        created_at: Timestamp(row.get(6)?),
        updated_at: Timestamp(row.get(7)?),
    })
}

fn audit_row(row: &Row<'_>) -> rusqlite::Result<AuditEntry> {
    let kind: String = row.get(2)?;
    let detail: String = row.get(8)?;
    Ok(AuditEntry {
        id: row.get(0)?,
        at: Timestamp(row.get(1)?),
        actor: Actor {
            kind: ActorKind::parse(&kind),
            name: row.get(3)?,
        },
        action: row.get(4)?,
        feature_id: row.get(5)?,
        version_id: row.get(6)?,
        summary: row.get(7)?,
        detail: serde_json::from_str(&detail).unwrap_or(Value::Null),
    })
}

const AUDIT_COLUMNS: &str =
    "id, at, actor_kind, actor, action, feature_id, version_id, summary, detail";

/// One audit line to write.
struct Audit {
    action: &'static str,
    feature_id: Option<i64>,
    version_id: Option<i64>,
    summary: String,
    detail: Value,
}

fn audit(db: &Connection, by: &Actor, now: i64, entry: &Audit) -> Result<()> {
    db.execute(
        "INSERT INTO audit (at, actor_kind, actor, action, feature_id, version_id, summary, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            now,
            by.kind.as_str(),
            by.name,
            entry.action,
            entry.feature_id,
            entry.version_id,
            entry.summary,
            entry.detail.to_string()
        ],
    )?;
    Ok(())
}

fn load_feature(db: &Connection, id: i64) -> Result<Feature> {
    let mut feature = db
        .query_row(
            &format!("SELECT {FEATURE_COLUMNS} FROM features f WHERE f.id = ?1"),
            [id],
            feature_row,
        )
        .optional()?
        .ok_or(StoreError::NotFound("feature"))?;
    feature.links = links_of(db, id)?;
    Ok(feature)
}

/// A feature that may still change (not removed).
fn live_feature(db: &Connection, id: i64) -> Result<Feature> {
    let feature = load_feature(db, id)?;
    if feature.removed_at.is_some() {
        return Err(StoreError::Conflict(format!(
            "“{}” was removed: restore it first",
            feature.title
        )));
    }
    Ok(feature)
}

fn links_of(db: &Connection, feature_id: i64) -> Result<Vec<Link>> {
    let mut statement = db.prepare_cached(
        "SELECT id, url, label, created_at FROM links WHERE feature_id = ?1 ORDER BY id",
    )?;
    let links = statement
        .query_map([feature_id], |row| {
            Ok(Link {
                id: row.get(0)?,
                url: row.get(1)?,
                label: row.get(2)?,
                created_at: Timestamp(row.get(3)?),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(links)
}

/// A version named in a request body: a missing one is the caller's mistake (400).
fn version_named(db: &Connection, id: i64) -> Result<String> {
    db.query_row("SELECT name FROM versions WHERE id = ?1", [id], |r| {
        r.get(0)
    })
    .optional()?
    .ok_or_else(|| invalid(format!("there is no version {id}")))
}

/// A version in the path (`/api/versions/{id}`): a missing one is a 404.
fn version_at(db: &Connection, id: i64) -> Result<Version> {
    db.query_row(
        "SELECT id, name, goal, target_date, released_on, position, created_at, updated_at
         FROM versions WHERE id = ?1",
        [id],
        version_row,
    )
    .optional()?
    .ok_or(StoreError::NotFound("version"))
}

fn area_exists(db: &Connection, key: &str) -> Result<()> {
    let found: Option<i64> = db
        .query_row("SELECT 1 FROM areas WHERE key = ?1", [key], |r| r.get(0))
        .optional()?;
    found
        .map(|_| ())
        .ok_or_else(|| invalid(format!("there is no area {key:?}")))
}

fn next_position(db: &Connection, version_id: i64) -> Result<i64> {
    Ok(db.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM features WHERE version_id = ?1",
        [version_id],
        |r| r.get(0),
    )?)
}

/// The features of a version in order, removed ones included (they keep their place).
fn order_of(db: &Connection, version_id: i64) -> Result<Vec<i64>> {
    let mut statement =
        db.prepare_cached("SELECT id FROM features WHERE version_id = ?1 ORDER BY position, id")?;
    let ids = statement
        .query_map([version_id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(ids)
}

/// Writes `ids` as the version's order, 0 first.
fn renumber(db: &Connection, version_id: i64, ids: &[i64]) -> Result<Vec<Placement>> {
    let mut statement =
        db.prepare_cached("UPDATE features SET position = ?1, version_id = ?2 WHERE id = ?3")?;
    let mut placements = Vec::with_capacity(ids.len());
    for (position, id) in (0_i64..).zip(ids) {
        statement.execute(params![position, version_id, id])?;
        placements.push(Placement {
            id: *id,
            version_id,
            position,
        });
    }
    Ok(placements)
}

fn apply_status(db: &Connection, id: i64, to: Status, now: i64) -> Result<()> {
    db.execute(
        "UPDATE features SET status = ?1, updated_at = ?2,
             started_at = CASE WHEN ?3 THEN COALESCE(started_at, ?2) ELSE started_at END,
             done_at = CASE WHEN ?4 THEN ?2 ELSE NULL END
         WHERE id = ?5",
        params![
            to.as_str(),
            now,
            to == Status::InProgress,
            to == Status::Done,
            id
        ],
    )?;
    Ok(())
}

fn status_audit(feature: &Feature, to: Status) -> Audit {
    Audit {
        action: "feature.status",
        feature_id: Some(feature.id),
        version_id: Some(feature.version_id),
        summary: format!(
            "“{}”: {} → {}",
            feature.title,
            feature.status.label(),
            to.label()
        ),
        detail: json!({ "from": feature.status.as_str(), "to": to.as_str() }),
    }
}

/// The seed's features, in order within each version, with their links.
fn seed_features(
    db: &Connection,
    seed: &SeedFile,
    versions: &HashMap<&str, i64>,
    now: i64,
) -> Result<()> {
    let mut positions: HashMap<i64, i64> = HashMap::new();
    for feature in &seed.features {
        let version_id = *versions
            .get(feature.version.as_str())
            .ok_or_else(|| invalid(format!("no version {:?}", feature.version)))?;
        let position = positions.entry(version_id).or_insert(0);
        let created = feature
            .created_on
            .as_deref()
            .map(day_start)
            .transpose()?
            .unwrap_or(now);
        let done = match (feature.status, feature.done_on.as_deref()) {
            (Status::Done, Some(day)) => Some(day_start(day)?),
            (Status::Done, None) => Some(now),
            _ => None,
        };
        let started =
            matches!(feature.status, Status::InProgress | Status::Done).then_some(created);
        db.execute(
            "INSERT INTO features (seed_key, title, description, version_id, status, area,
                 proposed_by, position, created_at, updated_at, started_at, done_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                feature.key,
                feature.title,
                feature.description,
                version_id,
                feature.status.as_str(),
                feature.area,
                feature.proposed_by.as_str(),
                *position,
                created,
                done.unwrap_or(created),
                started,
                done
            ],
        )?;
        *position += 1;
        let id = db.last_insert_rowid();
        for link in &feature.links {
            db.execute(
                "INSERT INTO links (feature_id, url, label, added_by, created_at)
                 VALUES (?1, ?2, ?3, 'seed', ?4)",
                params![id, link.url, link.label, created],
            )?;
        }
    }
    Ok(())
}

fn day_start(date: &str) -> Result<i64> {
    Ok(validate::date(date)
        .map_err(invalid)?
        .midnight()
        .assume_utc()
        .unix_timestamp())
}

fn excerpt(text: &str) -> String {
    let line = text.lines().next().unwrap_or_default();
    if line.chars().count() > 80 {
        format!("{}…", line.chars().take(79).collect::<String>())
    } else {
        line.to_owned()
    }
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(db: Connection) -> Result<Self> {
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch(SCHEMA)?;
        let schema: Option<String> = db
            .query_row("SELECT value FROM meta WHERE key = 'schema'", [], |r| {
                r.get(0)
            })
            .optional()?;
        match schema.as_deref() {
            None => {
                db.execute(
                    "INSERT INTO meta (key, value) VALUES ('schema', ?1)",
                    [SCHEMA_VERSION],
                )?;
            }
            Some(SCHEMA_VERSION) => {}
            Some(other) => {
                return Err(invalid(format!(
                    "the database's schema {other} is newer than this build's ({SCHEMA_VERSION})"
                )));
            }
        }
        Ok(Self { db })
    }

    // ---- Reads ---------------------------------------------------------------------------

    pub fn roadmap(&self) -> Result<Roadmap> {
        let versions = self
            .db
            .prepare_cached(
                "SELECT id, name, goal, target_date, released_on, position, created_at, updated_at
                 FROM versions ORDER BY position, id",
            )?
            .query_map([], version_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let areas = self
            .db
            .prepare_cached("SELECT key, name, color, position FROM areas ORDER BY position, key")?
            .query_map([], |row| {
                Ok(Area {
                    key: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    position: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut links: HashMap<i64, Vec<Link>> = HashMap::new();
        let mut statement = self.db.prepare_cached(
            "SELECT id, feature_id, url, label, created_at FROM links ORDER BY id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(1)?,
                Link {
                    id: row.get(0)?,
                    url: row.get(2)?,
                    label: row.get(3)?,
                    created_at: Timestamp(row.get(4)?),
                },
            ))
        })?;
        for row in rows {
            let (feature, link) = row?;
            links.entry(feature).or_default().push(link);
        }
        let mut features = self
            .db
            .prepare_cached(&format!(
                "SELECT {FEATURE_COLUMNS} FROM features f
                 JOIN versions v ON v.id = f.version_id
                 ORDER BY v.position, f.position, f.id"
            ))?
            .query_map([], feature_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for feature in &mut features {
            feature.links = links.remove(&feature.id).unwrap_or_default();
        }
        Ok(Roadmap {
            versions,
            areas,
            features,
        })
    }

    pub fn feature(&self, id: i64) -> Result<Feature> {
        load_feature(&self.db, id)
    }

    pub fn feature_detail(&self, id: i64) -> Result<FeatureDetail> {
        let feature = load_feature(&self.db, id)?;
        let comments = self
            .db
            .prepare_cached(
                "SELECT id, feature_id, author_kind, author, body, created_at FROM comments
                 WHERE feature_id = ?1 ORDER BY id",
            )?
            .query_map([id], |row| {
                let kind: String = row.get(2)?;
                Ok(Comment {
                    id: row.get(0)?,
                    feature_id: row.get(1)?,
                    author: Actor {
                        kind: ActorKind::parse(&kind),
                        name: row.get(3)?,
                    },
                    body: row.get(4)?,
                    created_at: Timestamp(row.get(5)?),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let activity = self
            .db
            .prepare_cached(&format!(
                "SELECT {AUDIT_COLUMNS} FROM audit WHERE feature_id = ?1 ORDER BY id"
            ))?
            .query_map([id], audit_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(FeatureDetail {
            feature,
            comments,
            activity,
        })
    }

    /// The audit log, newest first: `limit` entries older than `before` (an entry id).
    pub fn audit(&self, before: Option<i64>, limit: u32) -> Result<Vec<AuditEntry>> {
        Ok(self
            .db
            .prepare_cached(&format!(
                "SELECT {AUDIT_COLUMNS} FROM audit WHERE ?1 IS NULL OR id < ?1
                 ORDER BY id DESC LIMIT ?2"
            ))?
            .query_map(params![before, limit], audit_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Records an event that isn't a change of the roadmap (sign-ins, tokens).
    pub fn record(
        &self,
        by: &Actor,
        action: &'static str,
        summary: String,
        detail: Value,
        now: i64,
    ) -> Result<()> {
        audit(
            &self.db,
            by,
            now,
            &Audit {
                action,
                feature_id: None,
                version_id: None,
                summary,
                detail,
            },
        )
    }

    // ---- Features ------------------------------------------------------------------------

    pub fn create_feature(&mut self, input: &NewFeature, by: &Actor, now: i64) -> Result<Feature> {
        let status = policy::create(by, input.status)?;
        let title = validate::title(&input.title).map_err(invalid)?;
        let description =
            validate::text(&input.description, validate::DESCRIPTION_MAX).map_err(invalid)?;
        let tx = self.db.transaction()?;
        let version = version_named(&tx, input.version_id)?;
        area_exists(&tx, &input.area)?;
        let position = next_position(&tx, input.version_id)?;
        tx.execute(
            "INSERT INTO features (title, description, version_id, status, area, proposed_by,
                 position, created_at, updated_at, started_at, done_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10)",
            params![
                title,
                description,
                input.version_id,
                status.as_str(),
                input.area,
                by.proposer().as_str(),
                position,
                now,
                matches!(status, Status::InProgress | Status::Done).then_some(now),
                (status == Status::Done).then_some(now),
            ],
        )?;
        let id = tx.last_insert_rowid();
        let verb = if status == Status::Proposed {
            "Proposed"
        } else {
            "Created"
        };
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "feature.create",
                feature_id: Some(id),
                version_id: Some(input.version_id),
                summary: format!("{verb} “{title}” in {version}"),
                detail: json!({
                    "title": title,
                    "status": status.as_str(),
                    "area": input.area,
                    "version": version,
                }),
            },
        )?;
        tx.commit()?;
        self.feature(id)
    }

    pub fn update_feature(
        &mut self,
        id: i64,
        patch: &FeaturePatch,
        by: &Actor,
        now: i64,
    ) -> Result<Feature> {
        policy::owner_only(by, "only the owner edits features")?;
        let tx = self.db.transaction()?;
        let current = live_feature(&tx, id)?;
        let (mut before, mut after) = (Map::new(), Map::new());
        if let Some(title) = &patch.title {
            let title = validate::title(title).map_err(invalid)?;
            if title != current.title {
                tx.execute(
                    "UPDATE features SET title = ?1 WHERE id = ?2",
                    params![title, id],
                )?;
                before.insert("title".into(), current.title.clone().into());
                after.insert("title".into(), title.into());
            }
        }
        if let Some(description) = &patch.description {
            let description =
                validate::text(description, validate::DESCRIPTION_MAX).map_err(invalid)?;
            if description != current.description {
                tx.execute(
                    "UPDATE features SET description = ?1 WHERE id = ?2",
                    params![description, id],
                )?;
                before.insert("description".into(), current.description.clone().into());
                after.insert("description".into(), description.into());
            }
        }
        if let Some(area) = &patch.area
            && *area != current.area
        {
            area_exists(&tx, area)?;
            tx.execute(
                "UPDATE features SET area = ?1 WHERE id = ?2",
                params![area, id],
            )?;
            before.insert("area".into(), current.area.clone().into());
            after.insert("area".into(), area.clone().into());
        }
        if let Some(version_id) = patch.version_id
            && version_id != current.version_id
        {
            let to = version_named(&tx, version_id)?;
            let from = version_named(&tx, current.version_id)?;
            let position = next_position(&tx, version_id)?;
            tx.execute(
                "UPDATE features SET version_id = ?1, position = ?2 WHERE id = ?3",
                params![version_id, position, id],
            )?;
            let rest = order_of(&tx, current.version_id)?;
            renumber(&tx, current.version_id, &rest)?;
            before.insert("version".into(), from.into());
            after.insert("version".into(), to.into());
        }
        if !after.is_empty() {
            tx.execute(
                "UPDATE features SET updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            let fields: Vec<&str> = ["title", "description", "area", "version"]
                .into_iter()
                .filter(|field| after.contains_key(*field))
                .collect();
            let title = after
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(&current.title);
            audit(
                &tx,
                by,
                now,
                &Audit {
                    action: "feature.update",
                    feature_id: Some(id),
                    version_id: patch.version_id.or(Some(current.version_id)),
                    summary: format!("Edited “{title}”: {}", fields.join(", ")),
                    detail: json!({ "before": before, "after": after }),
                },
            )?;
        }
        tx.commit()?;
        self.feature(id)
    }

    pub fn set_status(&mut self, id: i64, to: Status, by: &Actor, now: i64) -> Result<Feature> {
        let tx = self.db.transaction()?;
        let current = live_feature(&tx, id)?;
        policy::status(by, current.status, to)?;
        if current.status != to {
            apply_status(&tx, id, to, now)?;
            audit(&tx, by, now, &status_audit(&current, to))?;
        }
        tx.commit()?;
        self.feature(id)
    }

    pub fn move_feature(&mut self, id: i64, to: &MoveTo, by: &Actor, now: i64) -> Result<Moved> {
        policy::owner_only(by, "only the owner orders the roadmap")?;
        let tx = self.db.transaction()?;
        let current = live_feature(&tx, id)?;
        let target = version_named(&tx, to.version_id)?;
        let mut ids: Vec<i64> = order_of(&tx, to.version_id)?
            .into_iter()
            .filter(|other| *other != id)
            .collect();
        let index = match to.before_id {
            Some(before) if before == id => {
                return Err(invalid("a feature can't go before itself".into()));
            }
            Some(before) => ids
                .iter()
                .position(|other| *other == before)
                .ok_or_else(|| invalid(format!("feature {before} isn't in version {target}")))?,
            None => ids.len(),
        };
        let old_order = order_of(&tx, current.version_id)?;
        ids.insert(index, id);
        let mut placements = renumber(&tx, to.version_id, &ids)?;
        let changed_version = current.version_id != to.version_id;
        if changed_version {
            let rest: Vec<i64> = old_order
                .iter()
                .copied()
                .filter(|other| *other != id)
                .collect();
            placements.extend(renumber(&tx, current.version_id, &rest)?);
        }
        let moved = changed_version || old_order != ids;
        if moved {
            tx.execute(
                "UPDATE features SET updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            let summary = if changed_version {
                let from = version_named(&tx, current.version_id)?;
                format!("Moved “{}” from {from} to {target}", current.title)
            } else {
                format!("Reordered “{}” in {target}", current.title)
            };
            audit(
                &tx,
                by,
                now,
                &Audit {
                    action: "feature.move",
                    feature_id: Some(id),
                    version_id: Some(to.version_id),
                    summary,
                    detail: json!({
                        "fromVersion": current.version_id,
                        "toVersion": to.version_id,
                        "index": index,
                    }),
                },
            )?;
        }
        if let Some(status) = to.status
            && status != current.status
        {
            policy::status(by, current.status, status)?;
            apply_status(&tx, id, status, now)?;
            audit(&tx, by, now, &status_audit(&current, status))?;
        }
        tx.commit()?;
        Ok(Moved {
            feature: self.feature(id)?,
            placements,
        })
    }

    pub fn remove_feature(&mut self, id: i64, by: &Actor, now: i64) -> Result<Feature> {
        policy::owner_only(by, "only the owner removes features")?;
        let tx = self.db.transaction()?;
        let current = live_feature(&tx, id)?;
        tx.execute(
            "UPDATE features SET removed_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "feature.remove",
                feature_id: Some(id),
                version_id: Some(current.version_id),
                summary: format!("Removed “{}”", current.title),
                detail: json!({ "status": current.status.as_str() }),
            },
        )?;
        tx.commit()?;
        self.feature(id)
    }

    pub fn restore_feature(&mut self, id: i64, by: &Actor, now: i64) -> Result<Feature> {
        policy::owner_only(by, "only the owner restores features")?;
        let tx = self.db.transaction()?;
        let current = load_feature(&tx, id)?;
        if current.removed_at.is_none() {
            return Err(StoreError::Conflict(format!(
                "“{}” isn't removed",
                current.title
            )));
        }
        tx.execute(
            "UPDATE features SET removed_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "feature.restore",
                feature_id: Some(id),
                version_id: Some(current.version_id),
                summary: format!("Restored “{}”", current.title),
                detail: json!({}),
            },
        )?;
        tx.commit()?;
        self.feature(id)
    }

    pub fn add_comment(&mut self, id: i64, body: &str, by: &Actor, now: i64) -> Result<Comment> {
        let body = validate::comment(body).map_err(invalid)?;
        let tx = self.db.transaction()?;
        let feature = live_feature(&tx, id)?;
        tx.execute(
            "INSERT INTO comments (feature_id, author_kind, author, body, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, by.kind.as_str(), by.name, body, now],
        )?;
        let comment_id = tx.last_insert_rowid();
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "comment.create",
                feature_id: Some(id),
                version_id: Some(feature.version_id),
                summary: format!("Commented on “{}”", feature.title),
                detail: json!({ "commentId": comment_id, "excerpt": excerpt(&body) }),
            },
        )?;
        tx.commit()?;
        Ok(Comment {
            id: comment_id,
            feature_id: id,
            author: by.clone(),
            body,
            created_at: Timestamp(now),
        })
    }

    pub fn add_link(
        &mut self,
        id: i64,
        url: &str,
        label: &str,
        by: &Actor,
        now: i64,
    ) -> Result<Link> {
        let url = validate::url(url).map_err(invalid)?;
        let label = validate::text(label, 200)
            .map_err(invalid)?
            .trim()
            .to_owned();
        let tx = self.db.transaction()?;
        let feature = live_feature(&tx, id)?;
        policy::link(by, feature.status)?;
        tx.execute(
            "INSERT INTO links (feature_id, url, label, added_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, url, label, by.name, now],
        )?;
        let link_id = tx.last_insert_rowid();
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "link.add",
                feature_id: Some(id),
                version_id: Some(feature.version_id),
                summary: format!(
                    "Linked {} to “{}”",
                    if label.is_empty() { &url } else { &label },
                    feature.title
                ),
                detail: json!({ "linkId": link_id, "url": url, "label": label }),
            },
        )?;
        tx.commit()?;
        Ok(Link {
            id: link_id,
            url,
            label,
            created_at: Timestamp(now),
        })
    }

    pub fn remove_link(&mut self, id: i64, link_id: i64, by: &Actor, now: i64) -> Result<()> {
        policy::owner_only(by, "only the owner removes links")?;
        let tx = self.db.transaction()?;
        let feature = live_feature(&tx, id)?;
        let link = feature
            .links
            .iter()
            .find(|link| link.id == link_id)
            .ok_or(StoreError::NotFound("link"))?;
        tx.execute("DELETE FROM links WHERE id = ?1", [link_id])?;
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "link.remove",
                feature_id: Some(id),
                version_id: Some(feature.version_id),
                summary: format!("Unlinked {} from “{}”", link.url, feature.title),
                detail: json!({ "url": link.url, "label": link.label }),
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    // ---- Versions and areas --------------------------------------------------------------

    pub fn create_version(&mut self, input: &NewVersion, by: &Actor, now: i64) -> Result<Version> {
        policy::owner_only(by, "only the owner plans versions")?;
        let name = validate::name(&input.name, 40).map_err(invalid)?;
        let goal = validate::text(&input.goal, 500).map_err(invalid)?;
        for date in [&input.target_date, &input.released_on]
            .into_iter()
            .flatten()
        {
            validate::date(date).map_err(invalid)?;
        }
        let tx = self.db.transaction()?;
        let taken: Option<i64> = tx
            .query_row("SELECT id FROM versions WHERE name = ?1", [&name], |r| {
                r.get(0)
            })
            .optional()?;
        if taken.is_some() {
            return Err(StoreError::Conflict(format!(
                "there is already a version {name}"
            )));
        }
        let position: i64 = tx.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM versions",
            [],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO versions (name, goal, target_date, released_on, position, created_at,
                 updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![
                name,
                goal,
                input.target_date,
                input.released_on,
                position,
                now
            ],
        )?;
        let id = tx.last_insert_rowid();
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "version.create",
                feature_id: None,
                version_id: Some(id),
                summary: format!("Added version {name}"),
                detail: json!({ "name": name, "goal": goal }),
            },
        )?;
        tx.commit()?;
        version_at(&self.db, id)
    }

    pub fn update_version(
        &mut self,
        id: i64,
        patch: &VersionPatch,
        by: &Actor,
        now: i64,
    ) -> Result<Version> {
        policy::owner_only(by, "only the owner plans versions")?;
        let tx = self.db.transaction()?;
        let current = version_at(&tx, id)?;
        let mut changed = Vec::new();
        if let Some(name) = &patch.name {
            let name = validate::name(name, 40).map_err(invalid)?;
            if name != current.name {
                let taken: Option<i64> = tx
                    .query_row("SELECT id FROM versions WHERE name = ?1", [&name], |r| {
                        r.get(0)
                    })
                    .optional()?;
                if taken.is_some() {
                    return Err(StoreError::Conflict(format!(
                        "there is already a version {name}"
                    )));
                }
                tx.execute(
                    "UPDATE versions SET name = ?1 WHERE id = ?2",
                    params![name, id],
                )?;
                changed.push("name");
            }
        }
        if let Some(goal) = &patch.goal {
            let goal = validate::text(goal, 500).map_err(invalid)?;
            if goal != current.goal {
                tx.execute(
                    "UPDATE versions SET goal = ?1 WHERE id = ?2",
                    params![goal, id],
                )?;
                changed.push("goal");
            }
        }
        for (field, column, value, old) in [
            (
                "target date",
                "target_date",
                &patch.target_date,
                &current.target_date,
            ),
            (
                "release date",
                "released_on",
                &patch.released_on,
                &current.released_on,
            ),
        ] {
            if let Some(value) = value {
                if let Some(date) = value {
                    validate::date(date).map_err(invalid)?;
                }
                if value != old {
                    tx.execute(
                        &format!("UPDATE versions SET {column} = ?1 WHERE id = ?2"),
                        params![value, id],
                    )?;
                    changed.push(field);
                }
            }
        }
        if !changed.is_empty() {
            tx.execute(
                "UPDATE versions SET updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            let name = version_at(&tx, id)?.name;
            audit(
                &tx,
                by,
                now,
                &Audit {
                    action: "version.update",
                    feature_id: None,
                    version_id: Some(id),
                    summary: format!("Edited version {name}: {}", changed.join(", ")),
                    detail: json!({ "fields": changed, "before": current.name }),
                },
            )?;
        }
        tx.commit()?;
        version_at(&self.db, id)
    }

    /// Puts a version before another one (or last), and returns every version in order.
    pub fn move_version(
        &mut self,
        id: i64,
        before_id: Option<i64>,
        by: &Actor,
        now: i64,
    ) -> Result<Vec<Version>> {
        policy::owner_only(by, "only the owner plans versions")?;
        let tx = self.db.transaction()?;
        let current = version_at(&tx, id)?;
        let old: Vec<i64> = tx
            .prepare("SELECT id FROM versions ORDER BY position, id")?
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut ids: Vec<i64> = old.iter().copied().filter(|other| *other != id).collect();
        let index = match before_id {
            Some(before) => ids
                .iter()
                .position(|other| *other == before)
                .ok_or_else(|| invalid(format!("there is no version {before}")))?,
            None => ids.len(),
        };
        ids.insert(index, id);
        if ids != old {
            for (position, version) in (0_i64..).zip(&ids) {
                tx.execute(
                    "UPDATE versions SET position = ?1 WHERE id = ?2",
                    params![position, version],
                )?;
            }
            audit(
                &tx,
                by,
                now,
                &Audit {
                    action: "version.move",
                    feature_id: None,
                    version_id: Some(id),
                    summary: format!("Moved version {}", current.name),
                    detail: json!({ "index": index }),
                },
            )?;
        }
        tx.commit()?;
        Ok(self.roadmap()?.versions)
    }

    /// Deletes a version that holds no feature at all (removed ones count: they keep their place).
    pub fn delete_version(&mut self, id: i64, by: &Actor, now: i64) -> Result<()> {
        policy::owner_only(by, "only the owner plans versions")?;
        let tx = self.db.transaction()?;
        let current = version_at(&tx, id)?;
        let features: i64 = tx.query_row(
            "SELECT COUNT(*) FROM features WHERE version_id = ?1",
            [id],
            |r| r.get(0),
        )?;
        if features > 0 {
            return Err(StoreError::Conflict(format!(
                "version {} still holds {features} feature(s), removed ones included",
                current.name
            )));
        }
        tx.execute("DELETE FROM versions WHERE id = ?1", [id])?;
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "version.delete",
                feature_id: None,
                version_id: Some(id),
                summary: format!("Deleted version {}", current.name),
                detail: json!({ "name": current.name }),
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn create_area(
        &mut self,
        name: &str,
        color: Option<&str>,
        by: &Actor,
        now: i64,
    ) -> Result<Area> {
        policy::owner_only(by, "only the owner adds areas")?;
        let name = validate::name(name, 40).map_err(invalid)?;
        let key = validate::key_for(&name);
        let tx = self.db.transaction()?;
        let taken: Option<i64> = tx
            .query_row(
                "SELECT 1 FROM areas WHERE key = ?1 OR name = ?2",
                params![key, name],
                |r| r.get(0),
            )
            .optional()?;
        if taken.is_some() {
            return Err(StoreError::Conflict(format!(
                "there is already an area {name}"
            )));
        }
        let used: Vec<String> = tx
            .prepare("SELECT color FROM areas")?
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let color = match color {
            Some(color) if AREA_COLORS.contains(&color) => color.to_owned(),
            Some(color) => return Err(invalid(format!("{color:?} isn't one of the colours"))),
            None => AREA_COLORS
                .iter()
                .copied()
                .find(|c| !used.iter().any(|u| u.as_str() == *c))
                .unwrap_or(AREA_COLORS[used.len() % AREA_COLORS.len()])
                .to_owned(),
        };
        let position: i64 = tx.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM areas",
            [],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO areas (key, name, color, position) VALUES (?1, ?2, ?3, ?4)",
            params![key, name, color, position],
        )?;
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "area.create",
                feature_id: None,
                version_id: None,
                summary: format!("Added area {name}"),
                detail: json!({ "key": key, "color": color }),
            },
        )?;
        tx.commit()?;
        Ok(Area {
            key,
            name,
            color,
            position,
        })
    }

    // ---- Seed, backup, reset -------------------------------------------------------------

    /// Imports the seed into an empty database (no area, version or feature, removed ones
    /// included); otherwise touches nothing.
    pub fn import_seed(&mut self, seed: &SeedFile, now: i64) -> Result<SeedOutcome> {
        let tx = self.db.transaction()?;
        let rows: i64 = tx.query_row(
            "SELECT (SELECT COUNT(*) FROM areas) + (SELECT COUNT(*) FROM versions)
                  + (SELECT COUNT(*) FROM features)",
            [],
            |r| r.get(0),
        )?;
        if rows > 0 {
            return Ok(SeedOutcome::NotEmpty);
        }
        for (position, area) in (0_i64..).zip(&seed.areas) {
            tx.execute(
                "INSERT INTO areas (key, name, color, position) VALUES (?1, ?2, ?3, ?4)",
                params![area.key, area.name, area.color, position],
            )?;
        }
        let mut versions = HashMap::new();
        for (position, version) in (0_i64..).zip(&seed.versions) {
            tx.execute(
                "INSERT INTO versions (name, goal, target_date, released_on, position, created_at,
                     updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    version.name,
                    version.goal,
                    version.target_date,
                    version.released_on,
                    position,
                    now
                ],
            )?;
            versions.insert(version.name.as_str(), tx.last_insert_rowid());
        }
        seed_features(&tx, seed, &versions, now)?;
        audit(
            &tx,
            &Actor::system("seed"),
            now,
            &Audit {
                action: "seed.import",
                feature_id: None,
                version_id: None,
                summary: format!(
                    "Imported the roadmap from the docs: {} versions, {} features",
                    seed.versions.len(),
                    seed.features.len()
                ),
                detail: json!({ "areas": seed.areas.len() }),
            },
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded_at', ?1)",
            [now.to_string()],
        )?;
        tx.commit()?;
        Ok(SeedOutcome::Imported {
            areas: seed.areas.len(),
            versions: seed.versions.len(),
            features: seed.features.len(),
        })
    }

    /// A consistent copy of the database in a new file (`VACUUM INTO`), safe while serving.
    pub fn backup(&self, to: &Path) -> Result<()> {
        if to.exists() {
            return Err(StoreError::Conflict(format!(
                "{} already exists",
                to.display()
            )));
        }
        self.db.execute("VACUUM INTO ?1", [to.to_string_lossy()])?;
        Ok(())
    }

    /// Development only (`--dev-login`): forgets the roadmap and its log, keeps sessions and
    /// tokens.
    pub fn reset(&mut self) -> Result<()> {
        let tx = self.db.transaction()?;
        tx.execute_batch(
            "DELETE FROM links; DELETE FROM comments; DELETE FROM features;
             DELETE FROM versions; DELETE FROM areas; DELETE FROM audit;
             DELETE FROM meta WHERE key = 'seeded_at';",
        )?;
        tx.commit()?;
        Ok(())
    }

    // ---- Sessions ------------------------------------------------------------------------

    pub fn insert_session(&self, id_hash: &[u8], session: &Session) -> Result<()> {
        self.db.execute(
            "INSERT INTO sessions (id_hash, login, github_id, name, avatar_url, csrf, github_token,
                 dev, created_at, last_seen_at, verified_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id_hash,
                session.login,
                session.github_id,
                session.name,
                session.avatar_url,
                session.csrf,
                session.github_token,
                session.dev,
                session.created_at,
                session.last_seen_at,
                session.verified_at,
                session.expires_at
            ],
        )?;
        Ok(())
    }

    pub fn session(&self, id_hash: &[u8]) -> Result<Option<Session>> {
        Ok(self
            .db
            .query_row(
                "SELECT login, github_id, name, avatar_url, csrf, github_token, dev, created_at,
                     last_seen_at, verified_at, expires_at
                 FROM sessions WHERE id_hash = ?1",
                [id_hash],
                |row| {
                    Ok(Session {
                        login: row.get(0)?,
                        github_id: row.get(1)?,
                        name: row.get(2)?,
                        avatar_url: row.get(3)?,
                        csrf: row.get(4)?,
                        github_token: row.get(5)?,
                        dev: row.get(6)?,
                        created_at: row.get(7)?,
                        last_seen_at: row.get(8)?,
                        verified_at: row.get(9)?,
                        expires_at: row.get(10)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn touch_session(&self, id_hash: &[u8], now: i64) -> Result<()> {
        self.db.execute(
            "UPDATE sessions SET last_seen_at = ?1 WHERE id_hash = ?2",
            params![now, id_hash],
        )?;
        Ok(())
    }

    pub fn session_verified(&self, id_hash: &[u8], now: i64) -> Result<()> {
        self.db.execute(
            "UPDATE sessions SET verified_at = ?1 WHERE id_hash = ?2",
            params![now, id_hash],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id_hash: &[u8]) -> Result<()> {
        self.db
            .execute("DELETE FROM sessions WHERE id_hash = ?1", [id_hash])?;
        Ok(())
    }

    /// Forgets sessions past their end or idle for longer than `idle` seconds.
    pub fn prune_sessions(&self, now: i64, idle: i64) -> Result<usize> {
        Ok(self.db.execute(
            "DELETE FROM sessions WHERE expires_at <= ?1 OR last_seen_at + ?2 <= ?1",
            params![now, idle],
        )?)
    }

    // ---- Machine tokens ------------------------------------------------------------------

    /// Stores a token's hash under a name no active token has.
    pub fn create_token(&mut self, name: &str, hash: &[u8], by: &Actor, now: i64) -> Result<()> {
        let name = validate::name(name, 40).map_err(invalid)?;
        let tx = self.db.transaction()?;
        let active: Option<i64> = tx
            .query_row(
                "SELECT id FROM tokens WHERE name = ?1 AND revoked_at IS NULL",
                [&name],
                |r| r.get(0),
            )
            .optional()?;
        if active.is_some() {
            return Err(StoreError::Conflict(format!(
                "a token named {name:?} exists: revoke it first (mvp-roadmap token revoke --name {name})"
            )));
        }
        tx.execute(
            "INSERT INTO tokens (name, hash, created_at) VALUES (?1, ?2, ?3)",
            params![name, hash, now],
        )?;
        audit(
            &tx,
            by,
            now,
            &Audit {
                action: "token.create",
                feature_id: None,
                version_id: None,
                summary: format!("Created the machine token {name:?}"),
                detail: json!({ "name": name }),
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    /// The name of the active token with this hash.
    pub fn token(&self, hash: &[u8]) -> Result<Option<(i64, String, Option<i64>)>> {
        Ok(self
            .db
            .query_row(
                "SELECT id, name, last_used_at FROM tokens WHERE hash = ?1 AND revoked_at IS NULL",
                [hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?)
    }

    pub fn touch_token(&self, id: i64, now: i64) -> Result<()> {
        self.db.execute(
            "UPDATE tokens SET last_used_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn tokens(&self) -> Result<Vec<TokenInfo>> {
        Ok(self
            .db
            .prepare("SELECT name, created_at, last_used_at, revoked_at FROM tokens ORDER BY id")?
            .query_map([], |r| {
                Ok(TokenInfo {
                    name: r.get(0)?,
                    created_at: r.get(1)?,
                    last_used_at: r.get(2)?,
                    revoked_at: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    /// Revokes the active token with this name; `false` when there is none.
    pub fn revoke_token(&mut self, name: &str, by: &Actor, now: i64) -> Result<bool> {
        let tx = self.db.transaction()?;
        let revoked = tx.execute(
            "UPDATE tokens SET revoked_at = ?1 WHERE name = ?2 AND revoked_at IS NULL",
            params![now, name],
        )?;
        if revoked > 0 {
            audit(
                &tx,
                by,
                now,
                &Audit {
                    action: "token.revoke",
                    feature_id: None,
                    version_id: None,
                    summary: format!("Revoked the machine token {name:?}"),
                    detail: json!({ "name": name }),
                },
            )?;
        }
        tx.commit()?;
        Ok(revoked > 0)
    }
}
