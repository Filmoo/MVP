//! ARAM: Mayhem on our server. **Pick counts only, never a win rate**: Riot keeps Mayhem games
//! off its public match API so that nobody "solves" the mode with win/loss stats, and its
//! policy forbids augment win rates. Nothing here receives, stores or computes a win.
//!
//! - `GET /v1/mayhem/tiers` → `MayhemTiers`: the owner's augment tiers, edited by hand in
//!   `mayhem-tiers.json` (data dir; validated at load, reloaded on change, checked with
//!   `mvp-backend mayhem check`). Inside a tier the order is the rank: first is best.
//! - `GET /v1/mayhem/augments` → `AugmentCatalog`: the pool's names, rarities, icons and short
//!   descriptions in English and French, built from the game's files (`CommunityDragon`) into
//!   `mayhem/augments.json` once per game version (a background task, or
//!   `mvp-backend mayhem augments`). 404 until built.
//! - `POST /v1/mayhem/games` (`MayhemUpload`, opt-in in the app) → `MayhemUploadAnswer`:
//!   anonymous facts of the players' own games (champions, augments, final items), validated,
//!   bounded, rate limited per install, counted once per hashed game id. Stored as JSON lines per
//!   patch (`mayhem/games/{patch}.jsonl`) without the install id or the IP.
//! - `GET /v1/mayhem/stats[?patch=]` → `MayhemStats`: the counts of a patch (the newest by
//!   default), re-rendered at most once a minute.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;
use std::fs::OpenOptions;
use std::io::{BufRead as _, BufReader, Write as _};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use axum::Json;
use axum::body::Body;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use domain::{
    ApiErrorCode, AugmentCatalog, AugmentRarity, AugmentTier, MayhemChampionStats, MayhemGame,
    MayhemPlayer, MayhemStats, MayhemTiers, MayhemUpload, MayhemUploadAnswer, PickCount,
};
use riot_api::Platform;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::config::{check_keys, matches};
use crate::error::Failure;
use crate::limits::{INSTALL_HEADER, TokenBuckets, too_many, valid_install_id};
use crate::telemetry::Metrics;
use crate::watched::{Watched, write_atomic};

/// The owner's tiers, in the data dir.
pub const TIERS_FILE: &str = "mayhem-tiers.json";
/// `mayhem/augments.json` (the catalog) and `mayhem/games/` (shared games), in the data dir.
pub const DIR: &str = "mayhem";
pub const CATALOG_FILE: &str = "augments.json";
const GAMES_DIR: &str = "games";

/// Largest upload (20 games of 10 players with every augment and item, escaped).
pub const MAX_BODY: usize = 64 * 1024;
/// Games per upload (the app sends the ones not shared yet of its last 20).
pub const MAX_GAMES: usize = 20;
/// Players of a Mayhem game.
const PLAYERS: usize = 10;
const MAX_IDS: usize = 6;
const MAX_PER_TIER: usize = 300;
const MAX_NOTE: usize = 300;
/// Past this, a patch's file stops growing.
const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
/// Games remembered for deduplication (32 bytes each).
const MAX_SEEN: usize = 2_000_000;
/// Per install: 10 uploads at once, then 30 an hour (a game ends every ~20 minutes).
const BURST: u32 = 10;
const PER_SEC: f64 = 30.0 / 3600.0;
/// Stats are rendered again at most this often while games keep coming.
const RENDER_EVERY: Duration = Duration::from_secs(60);
/// Per champion, the most common final items kept in the stats.
const ITEMS_KEPT: usize = 20;

const TIERS_CACHE: &str = "no-cache";
const CATALOG_CACHE: &str = "public, max-age=3600";
const STATS_CACHE: &str = "public, max-age=300";

// ---- Patches ------------------------------------------------------------------------------------

/// A game-version patch (`16.19`), ordered numerically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Patch(u16, u16);

impl Patch {
    pub fn parse(text: &str) -> Option<Self> {
        let (major, minor) = text.trim().split_once('.')?;
        let part = |p: &str| {
            (!p.is_empty() && p.len() <= 3 && p.bytes().all(|b| b.is_ascii_digit()))
                .then(|| p.parse().ok())
                .flatten()
        };
        Some(Self(part(major)?, part(minor)?))
    }
}

impl std::fmt::Display for Patch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}", self.0, self.1)
    }
}

// ---- The owner's tiers ----------------------------------------------------------------------------

const TOP_KEYS: [&str; 4] = ["patch", "updatedAt", "tiers", "notes"];
const TIER_KEYS: [&str; 4] = ["S", "A", "B", "C"];
const NOTE_KEYS: [&str; 2] = ["en", "fr"];

/// `mayhem-tiers.json`, validated: known keys only (a misspelled tier must not vanish
/// silently), positive ids, **no augment twice** (within or across tiers), a patch like
/// `26.19`, a date, notes of at most 300 characters.
pub fn parse_tiers(bytes: &[u8]) -> Result<MayhemTiers, String> {
    let value: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    check_keys(&value, &TOP_KEYS, "")?;
    check_keys(&value["tiers"], &TIER_KEYS, "tiers.")?;
    check_keys(&value["notes"], &NOTE_KEYS, "notes.")?;
    let tiers: MayhemTiers = serde_json::from_value(value).map_err(|e| e.to_string())?;
    validate_tiers(&tiers)?;
    Ok(tiers)
}

fn validate_tiers(file: &MayhemTiers) -> Result<(), String> {
    if let Some(patch) = &file.patch
        && Patch::parse(patch).is_none()
    {
        return Err(format!("patch {patch:?}: write it like 26.19"));
    }
    if let Some(date) = &file.updated_at {
        let day = time::Date::parse(
            date,
            time::macros::format_description!("[year]-[month]-[day]"),
        );
        if day.is_err() && OffsetDateTime::parse(date, &Rfc3339).is_err() {
            return Err(format!("updatedAt {date:?}: write it like 2026-09-28"));
        }
    }
    let mut placed: HashMap<u32, (AugmentTier, usize)> = HashMap::new();
    for tier in AugmentTier::ALL {
        let ids = file.tiers.get(tier);
        if ids.len() > MAX_PER_TIER {
            return Err(format!("tiers.{tier:?}: at most {MAX_PER_TIER} augments"));
        }
        for (at, &id) in ids.iter().enumerate() {
            if !(1..=100_000).contains(&id) {
                return Err(format!("tiers.{tier:?}[{at}]: {id} is not an augment id"));
            }
            if let Some((first, first_at)) = placed.insert(id, (tier, at)) {
                return Err(format!(
                    "augment {id} is listed twice: tiers.{first:?}[{first_at}] and tiers.{tier:?}[{at}] (an augment has one tier and one rank)"
                ));
            }
        }
    }
    if let Some(notes) = &file.notes {
        let en = notes.en.trim();
        if en.is_empty() || en.chars().count() > MAX_NOTE || notes.fr.chars().count() > MAX_NOTE {
            return Err(format!(
                "notes: en 1–{MAX_NOTE} characters, fr at most {MAX_NOTE} (empty: English shows)"
            ));
        }
    }
    Ok(())
}

// ---- The augment catalog ------------------------------------------------------------------------

/// `mayhem/augments.json` as `Watched` reads it (missing: `None`).
pub fn parse_catalog(bytes: &[u8]) -> Result<Option<AugmentCatalog>, String> {
    let catalog: AugmentCatalog = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if Patch::parse(&catalog.patch).is_none() {
        return Err(format!("unexpected patch {:?}", catalog.patch));
    }
    Ok(Some(catalog))
}

/// Builds the catalog of what the mirror at `base` holds now into the data dir, unless the one
/// there is of that game version already (`force`: build anyway). Answers what it did.
pub async fn build_catalog(data_dir: &Path, base: &str, force: bool) -> Result<String, String> {
    let dir = data_dir.join(DIR);
    let path = dir.join(CATALOG_FILE);
    let source =
        static_data::mayhem::CatalogSource::new(base, data_dir.join("cache").join("cdragon"))
            .map_err(|e| e.to_string())?;
    let version = source.version().await.map_err(|e| e.to_string())?;
    let current = crate::watched::read(&path, parse_catalog)?.flatten();
    if !force && current.as_ref().is_some_and(|c| c.version == version) {
        return Ok(format!("augments of {version} already built"));
    }
    let catalog = source.build().await.map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&catalog).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    write_atomic(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    let described = catalog
        .augments
        .iter()
        .filter(|a| !a.description.en.is_empty())
        .count();
    Ok(format!(
        "built {} Mayhem augments of patch {} ({described} described) from {}",
        catalog.augments.len(),
        catalog.patch,
        catalog.version
    ))
}

// ---- Uploads ------------------------------------------------------------------------------------

/// An upload, validated: the platform in Riot's case and its games.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Clean {
    pub platform: String,
    pub games: Vec<MayhemGame>,
}

fn hex_digest(text: &str) -> Option<[u8; 32]> {
    if text.len() != 64 {
        return None;
    }
    let mut out = [0_u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        let pair = text.get(i * 2..i * 2 + 2)?;
        if !pair
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return None;
        }
        *byte = u8::from_str_radix(pair, 16).ok()?;
    }
    Some(out)
}

fn player(p: &MayhemPlayer, at: usize) -> Result<(), String> {
    if !(1..=10_000).contains(&p.champion) {
        return Err(format!("players[{at}].champion: a champion id"));
    }
    if p.augments.len() > MAX_IDS || p.items.len() > MAX_IDS {
        return Err(format!(
            "players[{at}]: at most {MAX_IDS} augments and {MAX_IDS} items"
        ));
    }
    let mut seen = HashSet::new();
    if p.augments
        .iter()
        .any(|&a| !(1..=100_000).contains(&a) || !seen.insert(a))
    {
        return Err(format!("players[{at}].augments: distinct augment ids"));
    }
    if p.items.iter().any(|&i| !(1..=1_000_000).contains(&i)) {
        return Err(format!("players[{at}].items: item ids"));
    }
    Ok(())
}

/// A valid upload, or what is wrong. `newest`: games of a later patch than the game's current
/// one (the catalog's) are refused.
pub fn clean(upload: MayhemUpload, newest: Option<Patch>) -> Result<Clean, String> {
    let platform = Platform::from_id(&upload.platform)
        .ok_or_else(|| format!("unknown platform {:?}", upload.platform))?;
    if upload.games.is_empty() || upload.games.len() > MAX_GAMES {
        return Err(format!("send 1 to {MAX_GAMES} games"));
    }
    for (g, game) in upload.games.iter().enumerate() {
        let fail = |what: String| format!("games[{g}]: {what}");
        if hex_digest(&game.game).is_none() {
            return Err(fail("game: 64 lower-case hex digits (a SHA-256)".into()));
        }
        let patch = Patch::parse(&game.patch).ok_or_else(|| fail("patch: like 16.19".into()))?;
        if newest.is_some_and(|newest| patch > newest) {
            return Err(fail(format!("patch {patch} is newer than the game's")));
        }
        if game.players.len() != PLAYERS {
            return Err(fail(format!("{PLAYERS} players")));
        }
        let mut champions = HashSet::new();
        for (at, p) in game.players.iter().enumerate() {
            player(p, at).map_err(fail)?;
            if !champions.insert(p.champion) {
                return Err(fail("a champion twice".into()));
            }
        }
        if game.players.iter().all(|p| p.augments.is_empty()) {
            return Err(fail("no augments: nothing to count".into()));
        }
    }
    Ok(Clean {
        platform: platform.id().to_ascii_uppercase(),
        games: upload.games,
    })
}

// ---- Counting -----------------------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
struct ChampionTally {
    games: u32,
    augments: HashMap<u32, u32>,
    items: HashMap<u32, u32>,
}

/// Every count of one patch: sums, so the order games arrive in doesn't matter.
#[derive(Debug, Default, Clone)]
struct Tally {
    games: u32,
    players: u32,
    augments: HashMap<u32, u32>,
    champions: HashMap<u32, ChampionTally>,
    /// Unix epoch milliseconds of the last game counted.
    updated_at: i64,
}

fn bump(counts: &mut HashMap<u32, u32>, id: u32) {
    let n = counts.entry(id).or_default();
    *n = n.saturating_add(1);
}

/// Most first, then by id: a stable order.
fn ranked(counts: &HashMap<u32, u32>, keep: usize) -> Vec<PickCount> {
    let mut list: Vec<PickCount> = counts.iter().map(|(&id, &n)| PickCount { id, n }).collect();
    list.sort_by(|a, b| b.n.cmp(&a.n).then(a.id.cmp(&b.id)));
    list.truncate(keep);
    list
}

impl Tally {
    fn add(&mut self, game: &MayhemGame, at: i64) {
        self.games = self.games.saturating_add(1);
        self.updated_at = self.updated_at.max(at);
        for p in &game.players {
            self.players = self.players.saturating_add(1);
            let champion = self.champions.entry(p.champion).or_default();
            champion.games = champion.games.saturating_add(1);
            for &a in &p.augments {
                bump(&mut self.augments, a);
                bump(&mut champion.augments, a);
            }
            // An item held twice counts once per game.
            let items: HashSet<u32> = p.items.iter().copied().collect();
            for i in items {
                bump(&mut champion.items, i);
            }
        }
    }

    fn stats(&self, patch: Patch) -> MayhemStats {
        let mut champions: Vec<MayhemChampionStats> = self
            .champions
            .iter()
            .map(|(&id, c)| MayhemChampionStats {
                id,
                g: c.games,
                augments: ranked(&c.augments, usize::MAX),
                items: ranked(&c.items, ITEMS_KEPT),
            })
            .collect();
        champions.sort_by_key(|c| c.id);
        MayhemStats {
            patch: patch.to_string(),
            games: self.games,
            players: self.players,
            updated_at: self.updated_at,
            augments: ranked(&self.augments, usize::MAX),
            champions,
        }
    }
}

/// One stored line: no install id, no IP, no win.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredGame {
    received_at: String,
    platform: String,
    #[serde(flatten)]
    game: MayhemGame,
}

struct Rendered {
    changes: u64,
    at: Instant,
    body: Arc<Vec<u8>>,
    etag: String,
}

#[derive(Default)]
struct GamesState {
    seen: HashSet<[u8; 32]>,
    patches: BTreeMap<Patch, Tally>,
    /// Bumped on every counted game: rendered stats know when they're behind.
    changes: u64,
    rendered: HashMap<Patch, Rendered>,
}

/// The shared games: counted in memory, appended to disk (reloaded at start).
pub struct Games {
    dir: PathBuf,
    state: Mutex<GamesState>,
}

impl std::fmt::Debug for Games {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Games")
            .field("dir", &self.dir)
            .finish_non_exhaustive()
    }
}

fn epoch_ms(at: OffsetDateTime) -> i64 {
    i64::try_from(at.unix_timestamp_nanos() / 1_000_000).unwrap_or(0)
}

impl Games {
    /// Counts the games stored in `dir` (`{patch}.jsonl`); unreadable lines are skipped.
    pub fn load(dir: PathBuf) -> Self {
        let mut state = GamesState::default();
        let (mut games, mut skipped) = (0_u64, 0_u64);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let Some(patch) = name
                    .to_str()
                    .and_then(|n| n.strip_suffix(".jsonl"))
                    .and_then(Patch::parse)
                else {
                    continue;
                };
                let Ok(file) = std::fs::File::open(entry.path()) else {
                    continue;
                };
                for line in BufReader::new(file).lines() {
                    let parsed = line
                        .ok()
                        .and_then(|l| serde_json::from_str::<StoredGame>(&l).ok());
                    let Some(stored) = parsed else {
                        skipped += 1;
                        continue;
                    };
                    let Some(hash) = hex_digest(&stored.game.game) else {
                        skipped += 1;
                        continue;
                    };
                    if state.seen.insert(hash) {
                        let at = OffsetDateTime::parse(&stored.received_at, &Rfc3339)
                            .map_or(0, epoch_ms);
                        state
                            .patches
                            .entry(patch)
                            .or_default()
                            .add(&stored.game, at);
                        games += 1;
                    }
                }
            }
        }
        if games > 0 || skipped > 0 {
            tracing::info!(games, skipped, "shared Mayhem games loaded");
        }
        Self {
            dir,
            state: Mutex::new(state),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, GamesState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Counts the new games of `clean` and stores them: (accepted, duplicates, dropped).
    pub fn accept(&self, clean: &Clean, now: OffsetDateTime) -> std::io::Result<(u32, u32, u32)> {
        let (mut accepted, mut duplicates, mut dropped) = (0, 0, 0);
        let received_at = now.format(&Rfc3339).unwrap_or_default();
        let mut state = self.state();
        for game in &clean.games {
            let (Some(hash), Some(patch)) = (hex_digest(&game.game), Patch::parse(&game.patch))
            else {
                continue;
            };
            if state.seen.contains(&hash) {
                duplicates += 1;
                continue;
            }
            let file = self.dir.join(format!("{patch}.jsonl"));
            let full = state.seen.len() >= MAX_SEEN
                || std::fs::metadata(&file).is_ok_and(|m| m.len() >= MAX_FILE_BYTES);
            if full {
                dropped += 1;
                continue;
            }
            let stored = StoredGame {
                received_at: received_at.clone(),
                platform: clean.platform.clone(),
                game: MayhemGame {
                    patch: patch.to_string(),
                    ..game.clone()
                },
            };
            let mut line = serde_json::to_vec(&stored).map_err(std::io::Error::other)?;
            line.push(b'\n');
            std::fs::create_dir_all(&self.dir)?;
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file)?
                .write_all(&line)?;
            state.seen.insert(hash);
            state
                .patches
                .entry(patch)
                .or_default()
                .add(&stored.game, epoch_ms(now));
            state.changes += 1;
            accepted += 1;
        }
        Ok((accepted, duplicates, dropped))
    }

    /// The patch served by default: the newest with games, not newer than `newest`.
    pub fn current(&self, newest: Option<Patch>) -> Option<Patch> {
        self.state()
            .patches
            .iter()
            .rev()
            .find(|(p, t)| t.games > 0 && newest.is_none_or(|n| **p <= n))
            .map(|(p, _)| *p)
    }

    /// `patch`'s stats as JSON with their `ETag`, rendered again at most once a minute while
    /// games keep coming. `None` when the patch has no games.
    pub fn stats(&self, patch: Patch) -> Option<(Arc<Vec<u8>>, String)> {
        let mut state = self.state();
        let changes = state.changes;
        if let Some(r) = state.rendered.get(&patch)
            && (r.changes == changes || r.at.elapsed() < RENDER_EVERY)
        {
            return Some((Arc::clone(&r.body), r.etag.clone()));
        }
        let tally = state.patches.get(&patch)?;
        let body = Arc::new(serde_json::to_vec(&tally.stats(patch)).ok()?);
        let etag = etag_of(&body);
        state.rendered.insert(
            patch,
            Rendered {
                changes,
                at: Instant::now(),
                body: Arc::clone(&body),
                etag: etag.clone(),
            },
        );
        Some((body, etag))
    }
}

// ---- Routes -------------------------------------------------------------------------------------

/// Everything the Mayhem routes read.
#[derive(Debug)]
pub struct Mayhem {
    tiers: Watched<MayhemTiers>,
    catalog: Watched<Option<AugmentCatalog>>,
    games: Games,
    uploads: TokenBuckets,
    metrics: Arc<Metrics>,
}

impl Mayhem {
    /// Loads the tiers (invalid: error, the service refuses to start), the catalog and the
    /// shared games from `data_dir`.
    pub fn load(
        data_dir: &Path,
        reload_check: Duration,
        metrics: Arc<Metrics>,
    ) -> Result<Self, String> {
        let dir = data_dir.join(DIR);
        Ok(Self {
            tiers: Watched::load(data_dir.join(TIERS_FILE), parse_tiers, reload_check)?,
            catalog: Watched::load(dir.join(CATALOG_FILE), parse_catalog, reload_check)?,
            games: Games::load(dir.join(GAMES_DIR)),
            uploads: TokenBuckets::new(BURST, PER_SEC),
            metrics,
        })
    }

    /// The game's current patch, from the catalog.
    fn newest(&self) -> Option<Patch> {
        self.catalog
            .get()
            .as_ref()
            .as_ref()
            .and_then(|c| Patch::parse(&c.patch))
    }
}

fn etag_of(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut etag = String::from("\"");
    for b in &digest[..12] {
        let _ = write!(etag, "{b:02x}");
    }
    etag.push('"');
    etag
}

/// `body` with its `ETag` and `Cache-Control`, or a bodiless 304 when `If-None-Match` has it.
fn answer(body: Vec<u8>, etag: &str, cache: &'static str, headers: &HeaderMap) -> Response {
    let etag_value = HeaderValue::from_str(etag).unwrap_or(HeaderValue::from_static("\"\""));
    let cache = HeaderValue::from_static(cache);
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|inm| matches(inm, etag))
    {
        return (
            StatusCode::NOT_MODIFIED,
            [(header::ETAG, etag_value), (header::CACHE_CONTROL, cache)],
        )
            .into_response();
    }
    (
        [
            (header::ETAG, etag_value),
            (header::CACHE_CONTROL, cache),
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            ),
        ],
        Body::from(body),
    )
        .into_response()
}

/// `GET /v1/mayhem/tiers`: the owner's tiers (empty until the file exists).
pub async fn get_tiers(State(mayhem): State<Arc<Mayhem>>, headers: HeaderMap) -> Response {
    // Plain numbers and strings: serializing cannot fail.
    let body = serde_json::to_vec(&*mayhem.tiers.get()).unwrap_or_default();
    let etag = etag_of(&body);
    answer(body, &etag, TIERS_CACHE, &headers)
}

/// `GET /v1/mayhem/augments`: the catalog, 404 until built.
pub async fn get_augments(State(mayhem): State<Arc<Mayhem>>, headers: HeaderMap) -> Response {
    let catalog = mayhem.catalog.get();
    let Some(catalog) = catalog.as_ref() else {
        return Failure::not_found().into_response();
    };
    let body = serde_json::to_vec(catalog).unwrap_or_default();
    let etag = etag_of(&body);
    answer(body, &etag, CATALOG_CACHE, &headers)
}

#[derive(Debug, Deserialize)]
pub struct StatsParams {
    patch: Option<String>,
}

/// `GET /v1/mayhem/stats[?patch=16.19]`: counts of the patch, 404 without games.
pub async fn get_stats(
    State(mayhem): State<Arc<Mayhem>>,
    Query(params): Query<StatsParams>,
    headers: HeaderMap,
) -> Result<Response, Failure> {
    let patch = match params.patch.as_deref().filter(|p| !p.is_empty()) {
        Some(p) => Some(Patch::parse(p).ok_or_else(|| Failure::bad_request("patch: like 16.19"))?),
        None => mayhem.games.current(mayhem.newest()),
    };
    let (body, etag) = patch
        .and_then(|p| mayhem.games.stats(p))
        .ok_or_else(Failure::not_found)?;
    Ok(answer(body.as_ref().clone(), &etag, STATS_CACHE, &headers))
}

/// `POST /v1/mayhem/games`: counts the games not counted yet.
pub async fn post_games(
    State(mayhem): State<Arc<Mayhem>>,
    headers: HeaderMap,
    body: Result<Json<MayhemUpload>, JsonRejection>,
) -> Response {
    let install = headers
        .get(INSTALL_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|id| valid_install_id(id))
        .unwrap_or("anonymous");
    if let Err(wait) = mayhem.uploads.check(install) {
        mayhem.metrics.mayhem("rateLimited", 1);
        return too_many(wait, "too many Mayhem games from this install");
    }
    let upload = match body {
        Ok(Json(upload)) => upload,
        Err(e) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            mayhem.metrics.mayhem("tooLarge", 1);
            return Failure::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                ApiErrorCode::BadRequest,
                format!("uploads are limited to {MAX_BODY} bytes"),
            )
            .into_response();
        }
        Err(e) => {
            mayhem.metrics.mayhem("invalid", 1);
            return Failure::bad_request(e.body_text()).into_response();
        }
    };
    let clean = match clean(upload, mayhem.newest()) {
        Ok(clean) => clean,
        Err(e) => {
            mayhem.metrics.mayhem("invalid", 1);
            return Failure::bad_request(e).into_response();
        }
    };
    let sink = Arc::clone(&mayhem);
    let counted =
        tokio::task::spawn_blocking(move || sink.games.accept(&clean, OffsetDateTime::now_utc()))
            .await;
    match counted {
        Ok(Ok((accepted, duplicates, dropped))) => {
            let m = &mayhem.metrics;
            m.mayhem("accepted", u64::from(accepted));
            m.mayhem("duplicate", u64::from(duplicates));
            if dropped > 0 {
                m.mayhem("dropped", u64::from(dropped));
                tracing::warn!(dropped, "Mayhem game storage is full, dropping games");
            }
            Json(MayhemUploadAnswer {
                accepted,
                duplicates,
            })
            .into_response()
        }
        Ok(Err(e)) => {
            mayhem.metrics.mayhem("failed", 1);
            tracing::error!(error = %e, "cannot store Mayhem games");
            Failure::new(
                StatusCode::SERVICE_UNAVAILABLE,
                ApiErrorCode::Upstream,
                "Mayhem stats are unavailable",
            )
            .into_response()
        }
        Err(e) => {
            mayhem.metrics.mayhem("failed", 1);
            tracing::error!(error = %e, "Mayhem writer panicked");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ---- Admin --------------------------------------------------------------------------------------

fn rarity_name(r: AugmentRarity) -> &'static str {
    match r {
        AugmentRarity::Silver => "silver",
        AugmentRarity::Gold => "gold",
        AugmentRarity::Prismatic => "prismatic",
    }
}

/// `mvp-backend mayhem check`: whether the tiers file is valid, and what it holds (names when
/// the catalog is built).
pub fn check(data_dir: &Path, out: &mut dyn std::io::Write) -> Result<(), String> {
    let path = data_dir.join(TIERS_FILE);
    let say = |out: &mut dyn std::io::Write, line: String| {
        writeln!(out, "{line}").map_err(|e| e.to_string())
    };
    let Some(tiers) = crate::watched::read(&path, parse_tiers)? else {
        return say(
            out,
            format!(
                "{} is missing: the app shows no tiers (see the backend README, ARAM: Mayhem)",
                path.display()
            ),
        );
    };
    let catalog = crate::watched::read(&data_dir.join(DIR).join(CATALOG_FILE), parse_catalog)
        .ok()
        .flatten()
        .flatten();
    let names: HashMap<u32, (&str, AugmentRarity)> = catalog
        .iter()
        .flat_map(|c| &c.augments)
        .map(|a| (a.id, (a.name.en.as_str(), a.rarity)))
        .collect();
    say(
        out,
        format!(
            "{} is valid (patch {}, updated {})",
            path.display(),
            tiers.patch.as_deref().unwrap_or("not given"),
            tiers.updated_at.as_deref().unwrap_or("not given")
        ),
    )?;
    let mut unknown = Vec::new();
    for tier in AugmentTier::ALL {
        let ids = tiers.tiers.get(tier);
        say(out, format!("{tier:?} ({})", ids.len()))?;
        for (rank, id) in ids.iter().enumerate() {
            let line = if let Some((name, rarity)) = names.get(id) {
                let rarity = rarity_name(*rarity);
                format!("  {tier:?} · {}  {name} ({rarity}, {id})", rank + 1)
            } else {
                unknown.push(*id);
                format!("  {tier:?} · {}  {id}", rank + 1)
            };
            say(out, line)?;
        }
    }
    match &catalog {
        Some(catalog) => {
            let tiered = catalog
                .augments
                .iter()
                .filter(|a| tiers.of(a.id).is_some())
                .count();
            say(
                out,
                format!(
                    "{tiered} of the {} augments of patch {} are tiered",
                    catalog.augments.len(),
                    catalog.patch
                ),
            )?;
            if !unknown.is_empty() {
                say(
                    out,
                    format!(
                        "warning: not Mayhem augments of patch {} (a typo, or from another patch?): {unknown:?}",
                        catalog.patch
                    ),
                )?;
            }
        }
        None => say(
            out,
            "no augment catalog yet: `mvp-backend mayhem augments` builds it (names in this list)"
                .to_owned(),
        )?,
    }
    Ok(())
}

/// `mvp-backend mayhem list [--rarity R]`: every augment of the catalog with its id, rarity and
/// tier, to fill the tiers file.
pub fn list(
    data_dir: &Path,
    rarity: Option<&str>,
    out: &mut dyn std::io::Write,
) -> Result<(), String> {
    let wanted = match rarity {
        None => None,
        Some(r) => Some(
            AugmentRarity::ALL
                .into_iter()
                .find(|x| rarity_name(*x) == r.to_ascii_lowercase())
                .ok_or_else(|| format!("--rarity {r:?}: silver, gold or prismatic"))?,
        ),
    };
    let catalog = crate::watched::read(&data_dir.join(DIR).join(CATALOG_FILE), parse_catalog)?
        .flatten()
        .ok_or("no augment catalog yet: run `mvp-backend mayhem augments` first")?;
    let tiers = crate::watched::read(&data_dir.join(TIERS_FILE), parse_tiers)
        .ok()
        .flatten()
        .unwrap_or_default();
    let mut augments: Vec<_> = catalog
        .augments
        .iter()
        .filter(|a| wanted.is_none_or(|w| a.rarity == w))
        .collect();
    augments.sort_by(|a, b| a.rarity.cmp(&b.rarity).then(a.name.en.cmp(&b.name.en)));
    writeln!(out, "{:<7} {:<10} {:<6} name", "id", "rarity", "tier").map_err(|e| e.to_string())?;
    for a in augments {
        let tier = tiers
            .of(a.id)
            .map_or_else(|| "-".to_owned(), |(t, r)| format!("{t:?}·{r}"));
        writeln!(
            out,
            "{:<7} {:<10} {:<6} {}",
            a.id,
            rarity_name(a.rarity),
            tier,
            a.name.en
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use domain::{CatalogAugment, LocalizedText};
    use time::macros::datetime;

    use super::*;

    const HASH: &str = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";

    fn game(hash: &str, patch: &str) -> MayhemGame {
        MayhemGame {
            game: hash.to_owned(),
            patch: patch.to_owned(),
            players: (0..10)
                .map(|i| MayhemPlayer {
                    champion: 100 + i,
                    augments: if i == 0 { vec![2137, 1028] } else { vec![1344] },
                    items: vec![3089, 3089, 6655],
                })
                .collect(),
        }
    }

    fn upload(games: Vec<MayhemGame>) -> MayhemUpload {
        MayhemUpload {
            platform: "EUW1".into(),
            games,
        }
    }

    #[test]
    fn tiers_are_validated() {
        let good = br#"{"patch":"26.19","updatedAt":"2026-09-28","tiers":{"S":[2137,1344],"A":[1028]},"notes":{"en":"First pass","fr":""}}"#;
        let tiers = parse_tiers(good).unwrap();
        assert_eq!(tiers.of(1344), Some((AugmentTier::S, 2)));
        assert_eq!(parse_tiers(b"{}").unwrap(), MayhemTiers::default());
        for (bad, expected) in [
            (r#"{"tiers":{"S":[1],"A":[1]}}"#.as_bytes(), "listed twice"),
            (br#"{"tiers":{"S":[5,5]}}"#, "listed twice"),
            (br#"{"tiers":{"SS":[1]}}"#, "tiers.SS"),
            (br#"{"tier":{}}"#, "unknown key tier"),
            (br#"{"tiers":{"S":["2137"]}}"#, "invalid type"),
            (br#"{"tiers":{"S":[0]}}"#, "not an augment id"),
            (br#"{"patch":"latest"}"#, "26.19"),
            (br#"{"updatedAt":"yesterday"}"#, "2026-09-28"),
            (br#"{"notes":{"en":" ","fr":"x"}}"#, "notes"),
        ] {
            let err = parse_tiers(bad).expect_err(expected);
            assert!(
                err.contains(expected),
                "{err:?} should mention {expected:?}"
            );
        }
    }

    #[test]
    fn uploads_are_validated() {
        let ok = clean(upload(vec![game(HASH, "16.19")]), None).unwrap();
        assert_eq!(ok.platform, "EUW1");
        let newest = Patch::parse("16.19");
        let cases: [(MayhemUpload, &str); 8] = [
            (upload(vec![]), "1 to 20"),
            (
                MayhemUpload {
                    platform: "mars1".into(),
                    games: vec![game(HASH, "16.19")],
                },
                "platform",
            ),
            (upload(vec![game("ABC", "16.19")]), "SHA-256"),
            (upload(vec![game(&HASH.to_uppercase(), "16.19")]), "SHA-256"),
            (upload(vec![game(HASH, "16.20")]), "newer"),
            (upload(vec![game(HASH, "x")]), "patch"),
            (
                upload(vec![MayhemGame {
                    players: game(HASH, "16.19").players[..9].to_vec(),
                    ..game(HASH, "16.19")
                }]),
                "10 players",
            ),
            (
                upload(vec![{
                    let mut g = game(HASH, "16.19");
                    g.players[1].champion = g.players[0].champion;
                    g
                }]),
                "champion twice",
            ),
        ];
        for (bad, expected) in cases {
            let err = clean(bad, newest).expect_err(expected);
            assert!(
                err.contains(expected),
                "{err:?} should mention {expected:?}"
            );
        }
        let mut repeated = game(HASH, "16.19");
        repeated.players[0].augments = vec![1, 1];
        assert!(clean(upload(vec![repeated]), None).is_err());
        let mut none = game(HASH, "16.19");
        for p in &mut none.players {
            p.augments.clear();
        }
        assert!(
            clean(upload(vec![none]), None)
                .unwrap_err()
                .contains("no augments")
        );
        assert!(clean(upload(vec![game(HASH, "16.19"); 21]), None).is_err());
    }

    #[test]
    fn counts_once_per_game_and_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let games = Games::load(dir.path().to_path_buf());
        let now = datetime!(2026-09-29 10:00 UTC);
        let other = HASH.replace('0', "1");
        let batch = clean(
            upload(vec![
                game(HASH, "16.19"),
                game(HASH, "16.19"),
                game(&other, "16.18"),
            ]),
            None,
        )
        .unwrap();
        assert_eq!(games.accept(&batch, now).unwrap(), (2, 1, 0));
        assert_eq!(
            games.accept(&batch, now).unwrap(),
            (0, 3, 0),
            "shared again, by anyone"
        );
        assert_eq!(games.current(None), Patch::parse("16.19"));
        assert_eq!(games.current(Patch::parse("16.18")), Patch::parse("16.18"));

        let (body, etag) = games.stats(Patch(16, 19)).unwrap();
        let stats: MayhemStats = serde_json::from_slice(&body).unwrap();
        assert_eq!((stats.games, stats.players), (1, 10));
        assert_eq!(stats.augments[0], PickCount { id: 1344, n: 9 });
        let first = stats.champions.iter().find(|c| c.id == 100).unwrap();
        assert_eq!(first.g, 1);
        assert_eq!(
            first.items,
            vec![PickCount { id: 3089, n: 1 }, PickCount { id: 6655, n: 1 }],
            "an item held twice counts once"
        );
        assert!(!String::from_utf8_lossy(&body).contains("win"));

        let stored = std::fs::read_to_string(dir.path().join("16.19.jsonl")).unwrap();
        assert_eq!(stored.lines().count(), 1);
        assert!(stored.contains("\"platform\":\"EUW1\"") && !stored.contains("install"));

        let reloaded = Games::load(dir.path().to_path_buf());
        let (again, same) = reloaded.stats(Patch(16, 19)).unwrap();
        assert_eq!(same, etag, "the same counts after a restart");
        assert_eq!(again, body);
        assert_eq!(reloaded.accept(&batch, now).unwrap(), (0, 3, 0));
    }

    #[test]
    fn patches_order_numerically() {
        assert!(Patch::parse("16.10") > Patch::parse("16.9"));
        assert_eq!(
            Patch::parse("16.19").map(|p| p.to_string()).as_deref(),
            Some("16.19")
        );
        for bad in ["16", "16.", ".19", "a.b", "16.19.1", "1234.1"] {
            assert_eq!(Patch::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn check_and_list_name_the_augments() {
        let dir = tempfile::tempdir().unwrap();
        let mut out = Vec::new();
        check(dir.path(), &mut out).unwrap();
        assert!(String::from_utf8_lossy(&out).contains("missing"));
        std::fs::write(
            dir.path().join(TIERS_FILE),
            br#"{"tiers":{"S":[7,99]},"patch":"26.19"}"#,
        )
        .unwrap();
        std::fs::create_dir_all(dir.path().join(DIR)).unwrap();
        let catalog = AugmentCatalog {
            version: "16.19.1".into(),
            patch: "16.19".into(),
            built_at: 0,
            augments: vec![CatalogAugment {
                id: 7,
                rarity: AugmentRarity::Gold,
                icon: "assets/x.png".into(),
                name: LocalizedText {
                    en: "Glass Test".into(),
                    fr: "Verre".into(),
                },
                description: LocalizedText {
                    en: String::new(),
                    fr: String::new(),
                },
            }],
        };
        std::fs::write(
            dir.path().join(DIR).join(CATALOG_FILE),
            serde_json::to_vec(&catalog).unwrap(),
        )
        .unwrap();
        let mut out = Vec::new();
        check(dir.path(), &mut out).unwrap();
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("S · 1  Glass Test (gold, 7)"), "{text}");
        assert!(text.contains("warning") && text.contains("[99]"), "{text}");
        let mut out = Vec::new();
        list(dir.path(), Some("gold"), &mut out).unwrap();
        assert!(String::from_utf8_lossy(&out).contains("S·1"));
        assert!(list(dir.path(), Some("bronze"), &mut Vec::new()).is_err());
        std::fs::write(dir.path().join(TIERS_FILE), br#"{"tiers":{"S":[7,7]}}"#).unwrap();
        assert!(check(dir.path(), &mut Vec::new()).is_err());
    }
}
