//! Published champion statistics in the app: the index and the per-patch data files our backend
//! serves (`GET /v1/stats/index`, `GET /v1/stats/{patch}/{queue}/{bracket}/{file}`, written by
//! `mvp-crawler publish`; layout in `docs/architecture.md`, Stats pipeline).
//!
//! [`StatsClient`] fetches lazily, on demand, and never polls:
//! - **Disk**: every file is kept under the app cache directory (`stats/v1/…`, the server's
//!   layout) with its `ETag`, so stats answer offline. Only the current and the previous patch
//!   stay on disk.
//! - **Index**: read from disk at start, revalidated (`If-None-Match`) at startup and then at
//!   most once per `max-age` (5 min) when something asks for stats. A stale index is answered
//!   at once and revalidated in the background; a different one is announced on
//!   [`StatsClient::subscribe`].
//! - **Data files** don't change within a publication: each carries its patch's publication
//!   time (`info.updated_at`, the index's `PatchIndex::updated_at`), so a cached file of the
//!   current generation is served without a request. Otherwise it is revalidated: 304 → the disk
//!   copy, 404 → not published (remembered for that generation). A copy the server vouched for
//!   under the current index is asked about again at most every 5 minutes.
//! - **Failures**: the cached copy (whatever its generation), else the previous patch's, else
//!   the error. Requests for one file are coalesced; a 429 pauses every request for its
//!   `Retry-After` (the backend limits each install to 60 at once, 120 a minute, lookups
//!   included).
//! - **Memory**: the files served last, parsed (a small LRU).

mod disk;
pub mod model;

use std::any::Any;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use domain::{
    BackendError, Bracket, BuildsFile, ChampionPage, ChampionsFile, DataSetInfo, MatchupsFile,
    STATS_SCHEMA, StatsIndex, TierList,
};
use serde::de::DeserializeOwned;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard, watch};
use tokio::time::Instant;

use crate::backend::{BackendClient, FileAnswer};
use disk::Disk;
pub use model::DraftStats;

/// Ranked solo/duo: the queue with matchups, duos and draft priors.
pub const RANKED: u32 = 420;
/// ARAM.
pub const ARAM: u32 = 450;

const INDEX_KEY: &str = "index.json";
/// Freshness of the index when the server doesn't say (it says `max-age=300`).
const INDEX_MAX_AGE: Duration = Duration::from_secs(300);
/// A file whose generation looks stale is asked for at most this often.
const RECHECK: Duration = Duration::from_secs(300);
/// After a failed request, how long its answer (a cached copy or nothing) stands.
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(30);
/// Pause after a 429 without `Retry-After`.
const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(10);
/// Parsed files kept in memory.
const MEMORY_FILES: usize = 64;

/// A published data file: each starts with its data set's header.
pub trait DataFile: DeserializeOwned + Send + Sync + 'static {
    fn info(&self) -> &DataSetInfo;
}

impl DataFile for ChampionsFile {
    fn info(&self) -> &DataSetInfo {
        &self.info
    }
}

impl DataFile for TierList {
    fn info(&self) -> &DataSetInfo {
        &self.info
    }
}

impl DataFile for MatchupsFile {
    fn info(&self) -> &DataSetInfo {
        &self.info
    }
}

impl DataFile for BuildsFile {
    fn info(&self) -> &DataSetInfo {
        &self.info
    }
}

/// `16.19`: a patch as the index names it, safe as a path segment.
pub(crate) fn valid_patch(patch: &str) -> bool {
    let mut parts = patch.split('.');
    let numeric = |p: Option<&str>| {
        p.is_some_and(|p| !p.is_empty() && p.len() <= 4 && p.bytes().all(|b| b.is_ascii_digit()))
    };
    numeric(parts.next()) && numeric(parts.next()) && parts.next().is_none()
}

/// One published `queue × bracket` data set of the index's current patch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataSet {
    /// Game-version patch, e.g. `16.19` (the path segment).
    pub patch: String,
    /// Public patch name, e.g. `26.19`.
    pub name: String,
    pub queue: u32,
    pub bracket: Bracket,
    /// Matches counted, per the index.
    pub games: u32,
    /// The patch's publication (`PatchIndex::updated_at`): the files of that publication
    /// carry it in `info.updated_at`.
    pub generation: i64,
    /// The next older published patch, whose cached files stand in when the current ones
    /// can't be fetched.
    pub previous: Option<String>,
}

impl DataSet {
    /// `queue` × `bracket` of `index`'s current patch, when published.
    pub fn current(index: &StatsIndex, queue: u32, bracket: Bracket) -> Option<Self> {
        let current = index.current.as_deref()?;
        let at = index.patches.iter().position(|p| p.patch == current)?;
        let patch = index.patches.get(at)?;
        let set = patch
            .sets
            .iter()
            .find(|s| s.queue == queue && s.bracket == bracket)?;
        valid_patch(&patch.patch).then(|| Self {
            patch: patch.patch.clone(),
            name: patch.name.clone(),
            queue,
            bracket,
            games: set.games,
            generation: patch.updated_at,
            previous: index
                .patches
                .get(at + 1)
                .map(|p| p.patch.clone())
                .filter(|p| valid_patch(p)),
        })
    }

    fn key_in(&self, patch: &str, file: &str) -> String {
        format!("{patch}/{}/{}/{file}", self.queue, self.bracket.slug())
    }

    fn key(&self, file: &str) -> String {
        self.key_in(&self.patch, file)
    }
}

/// The patches kept on disk: the index's current one and the next older one.
fn kept_patches(index: &StatsIndex) -> Vec<String> {
    let Some(current) = index.current.as_deref() else {
        return Vec::new();
    };
    let at = index.patches.iter().position(|p| p.patch == current);
    let previous = at.and_then(|at| index.patches.get(at + 1));
    std::iter::once(current.to_owned())
        .chain(previous.map(|p| p.patch.clone()))
        .collect()
}

fn unexpected(error: impl fmt::Display) -> BackendError {
    BackendError::Unavailable {
        message: format!("unexpected answer: {error}"),
    }
}

fn parse_index(bytes: &[u8]) -> Result<StatsIndex, BackendError> {
    let index: StatsIndex = serde_json::from_slice(bytes).map_err(unexpected)?;
    if index.schema != STATS_SCHEMA {
        return Err(unexpected(format!(
            "stats schema {} (this app reads {STATS_SCHEMA})",
            index.schema
        )));
    }
    Ok(index)
}

type Shared = Arc<dyn Any + Send + Sync>;

/// What the cache knows about a file.
enum Known<T> {
    File(Arc<T>),
    /// The server said it isn't published.
    Missing,
}

impl<T> Known<T> {
    fn file(self) -> Option<Arc<T>> {
        match self {
            Self::File(file) => Some(file),
            Self::Missing => None,
        }
    }
}

/// A file as the cache holds it.
#[derive(Clone)]
struct Entry {
    /// The parsed file; `None` when the server said it isn't published.
    value: Option<Shared>,
    etag: Option<String>,
    /// `info.updated_at` of the file, or the generation a 404 was answered for.
    generation: Option<i64>,
    /// The index generation the server last answered for (or failed on), and until when that
    /// answer stands although the file's own generation differs (bounds revalidation).
    checked: Option<(i64, Instant)>,
}

impl Entry {
    fn current(&self, generation: i64, now: Instant) -> bool {
        self.generation == Some(generation)
            || self
                .checked
                .is_some_and(|(checked, until)| checked == generation && now < until)
    }

    /// `None` if the entry holds another type.
    fn get<T: DataFile>(&self) -> Option<Known<T>> {
        match &self.value {
            None => Some(Known::Missing),
            Some(value) => Arc::clone(value).downcast::<T>().ok().map(Known::File),
        }
    }
}

/// A copy we hold, typed.
struct Held<T> {
    value: Option<Arc<T>>,
    etag: Option<String>,
    generation: Option<i64>,
}

impl<T: DataFile> Held<T> {
    fn entry(&self, checked: Option<(i64, Instant)>) -> Entry {
        Entry {
            value: self.value.clone().map(|v| v as Shared),
            etag: self.etag.clone(),
            generation: self.generation,
            checked,
        }
    }
}

/// The parsed files used last.
#[derive(Default)]
struct Memory {
    entries: HashMap<String, Entry>,
    /// Least recently used first.
    order: VecDeque<String>,
}

impl Memory {
    fn touch(&mut self, key: &str) {
        if let Some(at) = self.order.iter().position(|k| k == key) {
            self.order.remove(at);
        }
        self.order.push_back(key.to_owned());
    }

    fn get(&mut self, key: &str) -> Option<Entry> {
        let entry = self.entries.get(key).cloned()?;
        self.touch(key);
        Some(entry)
    }

    fn put(&mut self, key: &str, entry: Entry) {
        self.entries.insert(key.to_owned(), entry);
        self.touch(key);
        while self.order.len() > MEMORY_FILES {
            if let Some(old) = self.order.pop_front() {
                self.entries.remove(&old);
            }
        }
    }

    /// Drops the files of patches not in `keep`.
    fn retain_patches(&mut self, keep: &[String]) {
        let kept = |key: &str| {
            key.split('/')
                .next()
                .is_some_and(|patch| keep.iter().any(|k| k == patch))
        };
        self.entries.retain(|key, _| kept(key));
        self.order.retain(|key| kept(key));
    }
}

#[derive(Default)]
struct State {
    index_etag: Option<String>,
    /// Last answer of the server about the index (200 or 304).
    index_checked: Option<Instant>,
    index_max_age: Option<Duration>,
    index_failed: Option<Instant>,
    /// The server asked us to slow down (429) until then.
    paused_until: Option<Instant>,
    memory: Memory,
}

impl State {
    fn paused(&self, now: Instant) -> Option<Duration> {
        self.paused_until
            .filter(|&until| until > now)
            .map(|until| until - now)
    }

    fn pause(&mut self, now: Instant, retry_after: Option<u32>) {
        let wait = retry_after.map_or(RATE_LIMIT_PAUSE, |s| Duration::from_secs(u64::from(s)));
        self.paused_until = Some(now + wait);
    }
}

fn rate_limited(wait: Duration) -> BackendError {
    BackendError::RateLimited {
        retry_after: Some(u32::try_from(wait.as_secs().max(1)).unwrap_or(u32::MAX)),
    }
}

struct Inner {
    backend: BackendClient,
    disk: Disk,
    index: watch::Sender<Option<Arc<StatsIndex>>>,
    state: Mutex<State>,
    /// One lock per file being fetched: concurrent requests for it wait for the first one.
    flights: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    refreshing: AtomicBool,
}

/// Downloads, caches and parses the published stats. Cheap to clone (shared state).
#[derive(Clone)]
pub struct StatsClient(Arc<Inner>);

impl fmt::Debug for StatsClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StatsClient")
            .field("backend", &self.0.backend)
            .field("dir", &self.0.disk.root())
            .finish_non_exhaustive()
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl StatsClient {
    /// Stats from `backend`, cached under `dir` (e.g. `{app cache}/stats`). Reads the cached
    /// index (no network).
    pub fn new(backend: BackendClient, dir: impl Into<PathBuf>) -> Self {
        let disk = Disk::new(dir.into());
        let mut state = State::default();
        let index =
            disk.read_blocking(INDEX_KEY)
                .and_then(|(bytes, etag)| match parse_index(&bytes) {
                    Ok(index) => {
                        state.index_etag = etag;
                        Some(Arc::new(index))
                    }
                    Err(error) => {
                        tracing::warn!(%error, "ignoring the cached stats index");
                        None
                    }
                });
        Self(Arc::new(Inner {
            backend,
            disk,
            index: watch::Sender::new(index),
            state: Mutex::new(state),
            flights: Mutex::new(HashMap::new()),
            refreshing: AtomicBool::new(false),
        }))
    }

    fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.0.state)
    }

    /// Waits for the other fetches of `key` to finish, then holds it.
    async fn flight(&self, key: &str) -> OwnedMutexGuard<()> {
        let flight = {
            let mut flights = lock(&self.0.flights);
            flights.retain(|_, f| Arc::strong_count(f) > 1);
            Arc::clone(flights.entry(key.to_owned()).or_default())
        };
        flight.lock_owned().await
    }

    /// The index as last read (disk or server), `None` before any.
    pub fn cached_index(&self) -> Option<Arc<StatsIndex>> {
        self.0.index.borrow().clone()
    }

    /// Follows the index: changes when a different one arrives (new patch, republication).
    pub fn subscribe(&self) -> watch::Receiver<Option<Arc<StatsIndex>>> {
        self.0.index.subscribe()
    }

    /// The index; fetched first when none is known. A stale one is answered at once and
    /// revalidated in the background (subscribers hear about a different one).
    pub async fn index(&self) -> Result<Arc<StatsIndex>, BackendError> {
        if let Some(index) = self.cached_index() {
            if self.index_stale() {
                self.refresh_in_background();
            }
            return Ok(index);
        }
        self.refresh_index().await
    }

    fn index_stale(&self) -> bool {
        let now = Instant::now();
        let state = self.state();
        let max_age = state.index_max_age.unwrap_or(INDEX_MAX_AGE);
        let fresh = state.index_checked.is_some_and(|t| now < t + max_age);
        let backing_off = state
            .index_failed
            .is_some_and(|t| now < t + RETRY_AFTER_FAILURE);
        !fresh && !backing_off && state.paused(now).is_none()
    }

    fn refresh_in_background(&self) {
        if self.0.refreshing.swap(true, Ordering::AcqRel) {
            return;
        }
        let this = self.clone();
        tokio::spawn(async move {
            if let Err(error) = this.refresh_index().await {
                tracing::info!(%error, "stats index not refreshed");
            }
            this.0.refreshing.store(false, Ordering::Release);
        });
    }

    /// Asks the server for the index now (`If-None-Match` with the cached one): at startup.
    /// On failure the cached index stays in use.
    pub async fn refresh_index(&self) -> Result<Arc<StatsIndex>, BackendError> {
        let asked = Instant::now();
        let _flight = self.flight(INDEX_KEY).await;
        let current = self.cached_index();
        let etag = {
            let state = self.state();
            if let Some(index) = &current
                && state.index_checked.is_some_and(|t| t >= asked)
            {
                // Refreshed by someone else while we waited.
                return Ok(Arc::clone(index));
            }
            if let Some(wait) = state.paused(Instant::now()) {
                return Err(rate_limited(wait));
            }
            current.as_ref().and(state.index_etag.clone())
        };
        let answer = self
            .0
            .backend
            .get_file(&["v1", "stats", "index"], etag.as_deref())
            .await;
        let now = Instant::now();
        let fresh = match answer {
            Ok(FileAnswer::Body {
                bytes,
                etag,
                max_age,
            }) => parse_index(&bytes).map(|index| (Some((index, bytes, etag)), max_age)),
            Ok(FileAnswer::NotModified { max_age }) => match &current {
                Some(_) => Ok((None, max_age)),
                None => Err(unexpected("304 without a cached index")),
            },
            Err(error) => Err(error),
        };
        let (body, max_age) = match fresh {
            Ok(fresh) => fresh,
            Err(error) => {
                let mut state = self.state();
                state.index_failed = Some(now);
                if let BackendError::RateLimited { retry_after } = &error {
                    state.pause(now, *retry_after);
                }
                return Err(error);
            }
        };
        {
            let mut state = self.state();
            state.index_checked = Some(now);
            state.index_max_age = max_age;
            state.index_failed = None;
        }
        let Some((index, bytes, etag)) = body else {
            return current.ok_or_else(|| unexpected("no index"));
        };
        self.0.disk.write(INDEX_KEY, &bytes, etag.as_deref()).await;
        self.state().index_etag = etag;
        if current.as_deref() == Some(&index) {
            return Ok(current.unwrap_or_else(|| Arc::new(index)));
        }
        let index = Arc::new(index);
        tracing::info!(current = ?index.current, "stats index updated");
        self.0.index.send_replace(Some(Arc::clone(&index)));
        let keep = kept_patches(&index);
        if !keep.is_empty() {
            self.state().memory.retain_patches(&keep);
            self.0.disk.prune(&keep).await;
        }
        Ok(index)
    }

    /// The current patch's `queue` × `bracket` data set (`NotFound` when not published).
    pub async fn data_set(&self, queue: u32, bracket: Bracket) -> Result<DataSet, BackendError> {
        let index = self.index().await?;
        DataSet::current(&index, queue, bracket).ok_or(BackendError::NotFound)
    }

    pub async fn champions(
        &self,
        set: &DataSet,
    ) -> Result<Option<Arc<ChampionsFile>>, BackendError> {
        self.file(set, "champions.json").await
    }

    pub async fn tier_list(&self, set: &DataSet) -> Result<Option<Arc<TierList>>, BackendError> {
        self.file(set, "tierlist.json").await
    }

    /// Matchups and duos of `champion` (ranked only; `None` when not published).
    pub async fn matchups(
        &self,
        set: &DataSet,
        champion: u32,
    ) -> Result<Option<Arc<MatchupsFile>>, BackendError> {
        self.file(set, &format!("matchups/{champion}.json")).await
    }

    /// Builds of `champion` (`None` when not published).
    pub async fn builds(
        &self,
        set: &DataSet,
        champion: u32,
    ) -> Result<Option<Arc<BuildsFile>>, BackendError> {
        self.file(set, &format!("builds/{champion}.json")).await
    }

    /// The current patch's tier list for `queue` × `bracket` (the `tier_list` command).
    pub async fn current_tier_list(
        &self,
        queue: u32,
        bracket: Bracket,
    ) -> Result<TierList, BackendError> {
        let set = self.data_set(queue, bracket).await?;
        match self.tier_list(&set).await? {
            Some(list) => Ok(TierList::clone(&list)),
            None => Err(BackendError::NotFound),
        }
    }

    /// One champion's page for `queue` × `bracket` (the `champion_stats` command): its record,
    /// tier rows (best role first), builds and matchups (ranked). A file that isn't published
    /// leaves its part empty; `NotFound` only when the data set itself isn't there.
    pub async fn champion_page(
        &self,
        champion: u32,
        queue: u32,
        bracket: Bracket,
    ) -> Result<ChampionPage, BackendError> {
        let set = self.data_set(queue, bracket).await?;
        let (champions, tiers) = tokio::join!(self.champions(&set), self.tier_list(&set));
        let (champions, tiers) = (champions?, tiers?);
        let info = champions
            .as_ref()
            .map(|c| c.info.clone())
            .or_else(|| tiers.as_ref().map(|t| t.info.clone()))
            .ok_or(BackendError::NotFound)?;
        let stats = champions
            .as_ref()
            .and_then(|c| c.champions.iter().find(|s| s.id == champion).cloned());
        // Builds and matchups are only published for champions with games.
        let played = stats.as_ref().is_some_and(|s| s.g > 0);
        let (builds, matchups) = if played {
            let matchups = async {
                if queue == RANKED {
                    self.matchups(&set, champion).await
                } else {
                    Ok(None)
                }
            };
            let (builds, matchups) = tokio::join!(self.builds(&set, champion), matchups);
            (builds?, matchups?)
        } else {
            (None, None)
        };
        Ok(ChampionPage {
            info,
            stats,
            // Best score first in the file: the champion's best role first.
            tiers: tiers
                .map(|t| {
                    t.entries
                        .iter()
                        .filter(|e| e.id == champion)
                        .cloned()
                        .collect()
                })
                .unwrap_or_default(),
            builds: builds.map(|b| BuildsFile::clone(&b)),
            matchups: matchups.map(|m| MatchupsFile::clone(&m)),
        })
    }

    /// The memory entry of `key` when it is current for `generation`.
    fn fresh<T: DataFile>(&self, key: &str, generation: i64) -> Option<Known<T>> {
        let entry = self.state().memory.get(key)?;
        entry
            .current(generation, Instant::now())
            .then(|| entry.get::<T>())
            .flatten()
    }

    /// The copy of `key` we hold, from memory or disk, whatever its generation.
    async fn held<T: DataFile>(&self, key: &str) -> Option<Held<T>> {
        let remembered = self.state().memory.get(key);
        if let Some(entry) = remembered
            && let Some(known) = entry.get::<T>()
        {
            return Some(Held {
                value: known.file(),
                etag: entry.etag,
                generation: entry.generation,
            });
        }
        let (bytes, etag) = self.0.disk.read(key).await?;
        match serde_json::from_slice::<T>(&bytes) {
            Ok(value) => Some(Held {
                generation: Some(value.info().updated_at),
                value: Some(Arc::new(value)),
                etag,
            }),
            Err(error) => {
                tracing::warn!(%error, key, "dropping an unreadable cached stats file");
                self.0.disk.remove(key).await;
                None
            }
        }
    }

    /// `name` of `set`: from memory or disk while current, else from the server (see the
    /// module docs). `Ok(None)` when it isn't published.
    async fn file<T: DataFile>(
        &self,
        set: &DataSet,
        name: &str,
    ) -> Result<Option<Arc<T>>, BackendError> {
        let key = set.key(name);
        if let Some(hit) = self.fresh::<T>(&key, set.generation) {
            return Ok(hit.file());
        }
        let _flight = self.flight(&key).await;
        if let Some(hit) = self.fresh::<T>(&key, set.generation) {
            return Ok(hit.file());
        }
        let held = self.held::<T>(&key).await;
        let now = Instant::now();
        if let Some(held) = &held
            && held.value.is_some()
            && held.generation == Some(set.generation)
        {
            // A disk copy of this very publication.
            self.state().memory.put(&key, held.entry(None));
            return Ok(held.value.clone());
        }
        let paused = self.state().paused(now);
        if let Some(wait) = paused {
            return self.fallback(set, name, held, rate_limited(wait)).await;
        }
        let etag = held
            .as_ref()
            .filter(|h| h.value.is_some())
            .and_then(|h| h.etag.clone());
        let queue = set.queue.to_string();
        let mut segments = vec!["v1", "stats", &set.patch, &queue, set.bracket.slug()];
        segments.extend(name.split('/'));
        let answer = self.0.backend.get_file(&segments, etag.as_deref()).await;
        let now = Instant::now();
        let checked = Some((set.generation, now + RECHECK));
        let error = match answer {
            Ok(FileAnswer::Body { bytes, etag, .. }) => match serde_json::from_slice::<T>(&bytes) {
                Ok(value) => {
                    let value = Arc::new(value);
                    self.0.disk.write(&key, &bytes, etag.as_deref()).await;
                    let fetched = Held {
                        generation: Some(value.info().updated_at),
                        value: Some(Arc::clone(&value)),
                        etag,
                    };
                    self.state().memory.put(&key, fetched.entry(checked));
                    return Ok(Some(value));
                }
                Err(error) => unexpected(error),
            },
            Ok(FileAnswer::NotModified { .. }) => match held {
                Some(held) if held.value.is_some() => {
                    self.state().memory.put(&key, held.entry(checked));
                    return Ok(held.value);
                }
                _ => unexpected("304 without a cached copy"),
            },
            Err(BackendError::NotFound) => {
                if held.is_some() {
                    self.0.disk.remove(&key).await;
                }
                // Missing from this publication: until the next one.
                let missing = Entry {
                    value: None,
                    etag: None,
                    generation: Some(set.generation),
                    checked: None,
                };
                self.state().memory.put(&key, missing);
                return Ok(None);
            }
            Err(error) => error,
        };
        if let BackendError::RateLimited { retry_after } = &error {
            self.state().pause(now, *retry_after);
        }
        self.fallback(set, name, held, error).await
    }

    /// After a failed (or skipped) request: the copy we hold, else the previous patch's copy,
    /// else the error.
    async fn fallback<T: DataFile>(
        &self,
        set: &DataSet,
        name: &str,
        held: Option<Held<T>>,
        error: BackendError,
    ) -> Result<Option<Arc<T>>, BackendError> {
        let key = set.key(name);
        if let Some(held) = held {
            tracing::info!(%error, key, "stats: serving the cached copy");
            let until = Instant::now() + RETRY_AFTER_FAILURE;
            self.state()
                .memory
                .put(&key, held.entry(Some((set.generation, until))));
            return Ok(held.value);
        }
        if let Some(previous) = &set.previous
            && let Some(Held {
                value: Some(value), ..
            }) = self.held::<T>(&set.key_in(previous, name)).await
        {
            tracing::info!(%error, key, previous, "stats: serving the previous patch's copy");
            return Ok(Some(value));
        }
        Err(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{DataSetIndex, PatchIndex};

    fn patch(patch: &str, updated_at: i64) -> PatchIndex {
        PatchIndex {
            patch: patch.to_owned(),
            name: format!("2{}", patch.trim_start_matches('1')),
            sets: vec![DataSetIndex {
                queue: RANKED,
                bracket: Bracket::EmeraldPlus,
                games: 50_000,
            }],
            updated_at,
        }
    }

    #[test]
    fn patches_are_path_safe() {
        for good in ["16.19", "4.2"] {
            assert!(valid_patch(good), "{good}");
        }
        for bad in [
            "16", "16.19.1", "../16.19", "16.x", ".19", "16.", "", "16/19",
        ] {
            assert!(!valid_patch(bad), "{bad}");
        }
    }

    #[test]
    fn data_sets_of_the_current_patch() {
        let index = StatsIndex {
            schema: STATS_SCHEMA,
            current: Some("16.19".into()),
            patches: vec![patch("16.20", 30), patch("16.19", 20), patch("16.18", 10)],
            updated_at: 30,
        };
        let set = DataSet::current(&index, RANKED, Bracket::EmeraldPlus).expect("published");
        assert_eq!(set.patch, "16.19");
        assert_eq!(set.name, "26.19");
        assert_eq!(set.generation, 20);
        assert_eq!(set.previous.as_deref(), Some("16.18"));
        assert_eq!(
            set.key("matchups/54.json"),
            "16.19/420/emeraldPlus/matchups/54.json"
        );
        assert!(DataSet::current(&index, ARAM, Bracket::EmeraldPlus).is_none());
        assert!(DataSet::current(&index, RANKED, Bracket::MasterPlus).is_none());
        assert_eq!(kept_patches(&index), ["16.19", "16.18"]);
        let traversal = StatsIndex {
            current: Some("../x".into()),
            patches: vec![patch("../x", 1)],
            ..index
        };
        assert!(DataSet::current(&traversal, RANKED, Bracket::EmeraldPlus).is_none());
    }

    #[test]
    fn memory_keeps_the_latest_files() {
        let mut memory = Memory::default();
        let entry = || Entry {
            value: None,
            etag: None,
            generation: Some(1),
            checked: None,
        };
        for i in 0..=MEMORY_FILES {
            memory.put(&format!("16.19/420/emeraldPlus/matchups/{i}.json"), entry());
            // The first file stays in use.
            memory.get("16.19/420/emeraldPlus/matchups/0.json");
        }
        assert_eq!(memory.entries.len(), MEMORY_FILES);
        assert_eq!(memory.order.len(), MEMORY_FILES);
        assert!(
            memory
                .get("16.19/420/emeraldPlus/matchups/0.json")
                .is_some()
        );
        assert!(
            memory
                .get("16.19/420/emeraldPlus/matchups/1.json")
                .is_none()
        );
        memory.put("16.18/420/emeraldPlus/champions.json", entry());
        memory.retain_patches(&["16.18".to_owned()]);
        assert_eq!(
            memory.entries.keys().collect::<Vec<_>>(),
            ["16.18/420/emeraldPlus/champions.json"]
        );
        assert_eq!(memory.order.len(), 1);
    }
}
