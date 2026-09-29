//! ARAM: Mayhem in the app: the augments (names, rarities, icons, descriptions), the owner's
//! tiers, how often players pick each augment, each champion's augments ranked per rarity, and
//! the opt-in sharing of the player's own Mayhem games.
//!
//! **Never a win rate** (Riot's policy on augments, and Riot keeps Mayhem off its public match
//! API so the mode isn't "solved"): pick counts only, and nothing reacts to what the game offers
//! while it runs. The ranked augments are several options with their reasons, shown before the
//! game (Draft) or as static reference (Live, stats pages).
//!
//! - **Data** ([`MayhemClient`]): `GET /v1/mayhem/{augments,tiers,stats}` from our backend,
//!   kept on disk with their `ETag`s (`{app cache}/mayhem/v1/…`) so they answer offline; a copy
//!   older than its freshness (augments 1 h, tiers and stats 5 min) is answered at once and
//!   revalidated in the background. Never on a timer: only when something asks.
//! - **Sharing** ([`share`], opt-in: `Settings.shareMayhemGames`, off by default, and the
//!   remote config's `mayhemSharing` flag): when a game ends, and once when the switch is turned
//!   on, the core reads the player's recent games from their League client
//!   (`/lol-match-history/…/matches`, then `/lol-match-history/v1/games/{gameId}` for each
//!   Mayhem game not shared yet) and sends each game's champions, augments and final items with
//!   a one-way hash of its id. No names, PUUIDs, summoner ids or wins leave the app.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use domain::{
    AugmentCatalog, AugmentInfo, AugmentPriorities, AugmentPriority, AugmentRarity, AugmentTier,
    BackendError, ClientConnection, ClientStatus, GameflowPhase, Language, MAYHEM_GAME_MODE,
    MAYHEM_QUEUE, MayhemAugments, MayhemChampion, MayhemGame, MayhemOverview, MayhemPlayer,
    MayhemPopularity, MayhemStats, MayhemTiers, MayhemUpload, PickCount, RemoteConfig, Settings,
    is_mayhem_queue,
};
use lcu::LcuClient;
use serde::de::DeserializeOwned;
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use tokio::sync::{Mutex as AsyncMutex, watch};
use tokio::time::Instant;

use crate::backend::{BackendClient, FileAnswer, ReportRefused};
use crate::stats::disk::Disk;

/// Games a champion needs before its pick rates order the augments of a tier.
pub const MIN_GAMES: u32 = 30;
/// Augments listed per rarity for a champion.
pub const PER_RARITY: usize = 8;
/// A champion's most picked augments and most common items shown.
pub const MOST_PICKED: usize = 10;
pub const ITEMS_SHOWN: usize = 12;
/// Where the augments' icons are: the client's files on `CommunityDragon`'s mirror (the app's
/// CSP allows it; nothing is redistributed by us).
pub const ICON_BASE: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";

/// A game that ends before this is a remake: not shared.
const REMAKE_SECONDS: u64 = 300;
/// After a game ends, the client's match history takes a moment to list it.
pub const AFTER_GAME: Duration = Duration::from_secs(10);
/// Shared games remembered (their hashes), so none is sent twice.
const RECORD_MAX: usize = 500;
/// After a failed request, how long a held copy stands before asking again.
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(30);

// ---- Reading the client's games ------------------------------------------------------------------

fn u64_at(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn u32_at(v: &Value, key: &str) -> u32 {
    u32::try_from(u64_at(v, key)).unwrap_or(0)
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// A game of ARAM: Mayhem from matchmaking (custom games aren't shared: anything goes there).
fn matchmade_mayhem(game: &Value) -> bool {
    u32_at(game, "queueId") == MAYHEM_QUEUE
}

/// The hash a game is shared under: SHA-256 of the platform and the game id. One-way (the game
/// id isn't sent) and the same for every player of the game, so the server counts it once.
pub fn game_key(platform: &str, game_id: u64) -> String {
    let digest = Sha256::digest(format!(
        "mvp-mayhem-v1\n{}\n{game_id}",
        platform.trim().to_ascii_uppercase()
    ));
    let mut hex = String::with_capacity(64);
    for byte in digest {
        use fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

/// The listed games worth sharing: matchmade Mayhem, not a remake. (game id, platform, key)
pub fn listed_mayhem(history: &Value, platform: &str) -> Vec<(u64, String, String)> {
    history
        .pointer("/games/games")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|g| matchmade_mayhem(g) && u64_at(g, "gameDuration") > REMAKE_SECONDS)
        .filter_map(|g| {
            let id = g.get("gameId")?.as_u64()?;
            let platform = str_at(g, "platformId")
                .unwrap_or(platform)
                .to_ascii_uppercase();
            Some((id, platform.clone(), game_key(&platform, id)))
        })
        .collect()
}

/// `16.19.712.4` → `16.19`.
fn patch_of(version: &str) -> Option<String> {
    let mut parts = version.split('.');
    let (major, minor) = (parts.next()?, parts.next()?);
    let numeric = |p: &str| !p.is_empty() && p.len() <= 3 && p.bytes().all(|b| b.is_ascii_digit());
    (numeric(major) && numeric(minor)).then(|| format!("{major}.{minor}"))
}

/// A whole game (`/lol-match-history/v1/games/{gameId}`) as it is shared: its hash, patch and
/// every player's champion, augments and final items. Identities and results are never read.
/// `None` when it isn't a full matchmade Mayhem game with augments.
pub fn shared_game(game: &Value, platform: &str) -> Option<MayhemGame> {
    if !matchmade_mayhem(game) || u64_at(game, "gameDuration") <= REMAKE_SECONDS {
        return None;
    }
    let id = game.get("gameId")?.as_u64()?;
    let platform = str_at(game, "platformId").unwrap_or(platform);
    let patch = patch_of(str_at(game, "gameVersion")?)?;
    let players: Vec<MayhemPlayer> = game
        .get("participants")?
        .as_array()?
        .iter()
        .map(|p| {
            let stats = p.get("stats").unwrap_or(&Value::Null);
            let nonzero = |key: String| Some(u32_at(stats, &key)).filter(|&id| id != 0);
            MayhemPlayer {
                champion: u32_at(p, "championId"),
                augments: (1..=6)
                    .filter_map(|i| nonzero(format!("playerAugment{i}")))
                    .collect(),
                // The trinket (`item6`) isn't a build choice.
                items: (0..6).filter_map(|i| nonzero(format!("item{i}"))).collect(),
            }
        })
        .collect();
    let full = players.len() == 10 && players.iter().all(|p| p.champion != 0);
    let augmented = players.iter().any(|p| !p.augments.is_empty());
    (full && augmented).then(|| MayhemGame {
        game: game_key(platform, id),
        patch,
        players,
    })
}

/// A champion select or game of ARAM: Mayhem, from the gameflow session.
pub fn is_mayhem_session(session: &Value) -> bool {
    let queue = session.pointer("/gameData/queue");
    let id = queue
        .and_then(|q| q.get("id"))
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok());
    let mode = |v: Option<&Value>| v.and_then(|v| str_at(v, "gameMode")) == Some(MAYHEM_GAME_MODE);
    id.is_some_and(is_mayhem_queue) || mode(queue) || mode(session.get("map"))
}

// ---- Augments per champion --------------------------------------------------------------------

/// A champion's augments ranked per rarity (silver, gold, prismatic: each offer in Mayhem is
/// one rarity), plus its most picked augments and most common items.
///
/// Order within a rarity: the editorial tier (S before A…), then the owner's rank inside it
/// (first = best): the owner's order always holds. The champion's pick rate is the second
/// signal once it has [`MIN_GAMES`] shared games: every entry shows it, and the augments without
/// a tier that its players pick follow the tiered ones, most picked first. Fewer games: the
/// tiers alone. At most [`PER_RARITY`] each; nothing without a tier or a signal.
pub fn champion(
    champion_id: u32,
    catalog: &AugmentCatalog,
    tiers: Option<&MayhemTiers>,
    stats: Option<&MayhemStats>,
) -> MayhemChampion {
    let own = stats.and_then(|s| s.champions.iter().find(|c| c.id == champion_id));
    let games = own.map_or(0, |c| c.g);
    let picks: HashMap<u32, u32> = own
        .map(|c| c.augments.iter().map(|p| (p.id, p.n)).collect())
        .unwrap_or_default();
    let by_rate = games >= MIN_GAMES;
    let rate = |id: u32| {
        let n = picks.get(&id).copied().unwrap_or(0);
        by_rate.then(|| f64::from(n) / f64::from(games.max(1)))
    };
    let known: HashSet<u32> = catalog.augments.iter().map(|a| a.id).collect();
    let priorities = AugmentRarity::ALL
        .into_iter()
        .map(|rarity| {
            let mut entries: Vec<AugmentPriority> = catalog
                .augments
                .iter()
                .filter(|a| a.rarity == rarity)
                .filter_map(|a| {
                    let placed = tiers.and_then(|t| t.of(a.id));
                    let n = picks.get(&a.id).copied().unwrap_or(0);
                    (placed.is_some() || (by_rate && n > 0)).then(|| AugmentPriority {
                        id: a.id,
                        tier: placed.map(|(t, _)| t),
                        rank: placed.map(|(_, r)| r),
                        picks: n,
                        pick_rate: rate(a.id),
                    })
                })
                .collect();
            let tier_key =
                |e: &AugmentPriority| e.tier.map_or(AugmentTier::ALL.len(), |t| t as usize);
            // Ranks are unique inside a tier, so picks only order the untiered augments (which
            // are listed with enough games only).
            entries.sort_by(|a, b| {
                tier_key(a)
                    .cmp(&tier_key(b))
                    .then(a.rank.unwrap_or(u32::MAX).cmp(&b.rank.unwrap_or(u32::MAX)))
                    .then(b.picks.cmp(&a.picks))
                    .then(a.id.cmp(&b.id))
            });
            entries.truncate(PER_RARITY);
            AugmentPriorities {
                rarity,
                by_pick_rate: by_rate,
                entries,
            }
        })
        .collect();
    let top = |list: Option<&Vec<PickCount>>, keep: usize, only_known: bool| -> Vec<PickCount> {
        list.into_iter()
            .flatten()
            .filter(|p| !only_known || known.contains(&p.id))
            .take(keep)
            .copied()
            .collect()
    };
    MayhemChampion {
        champion_id,
        patch: stats.map(|s| s.patch.clone()),
        games,
        min_games: MIN_GAMES,
        augments: top(own.map(|c| &c.augments), MOST_PICKED, true),
        items: top(own.map(|c| &c.items), ITEMS_SHOWN, false),
        priorities,
        tiered: tiers.is_some_and(|t| !t.is_empty()),
    }
}

/// The catalog in `language` (French names and descriptions, English where they're missing),
/// with the icons' full URLs.
pub fn localized(catalog: &AugmentCatalog, language: Language) -> MayhemAugments {
    let pick = |en: &String, fr: &String| {
        if language == Language::Fr && !fr.trim().is_empty() {
            fr.clone()
        } else {
            en.clone()
        }
    };
    MayhemAugments {
        patch: catalog.patch.clone(),
        augments: catalog
            .augments
            .iter()
            .map(|a| AugmentInfo {
                id: a.id,
                rarity: a.rarity,
                name: pick(&a.name.en, &a.name.fr),
                description: pick(&a.description.en, &a.description.fr),
                icon: format!("{ICON_BASE}/{}", a.icon),
            })
            .collect(),
    }
}

/// Every augment's pick count over all champions (the Mayhem page).
fn popularity(stats: &MayhemStats) -> MayhemPopularity {
    MayhemPopularity {
        patch: stats.patch.clone(),
        games: stats.games,
        players: stats.players,
        updated_at: stats.updated_at,
        augments: stats.augments.clone(),
    }
}

// ---- Data from our backend ----------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Augments,
    Tiers,
    Stats,
}

impl Kind {
    const fn name(self) -> &'static str {
        match self {
            Self::Augments => "augments",
            Self::Tiers => "tiers",
            Self::Stats => "stats",
        }
    }

    const fn fresh_for(self) -> Duration {
        match self {
            Self::Augments => Duration::from_secs(60 * 60),
            Self::Tiers | Self::Stats => Duration::from_secs(5 * 60),
        }
    }

    const fn index(self) -> usize {
        self as usize
    }
}

type Shared = Arc<dyn std::any::Any + Send + Sync>;

/// A file as held: parsed (`None`: the server says it isn't published), its `ETag`, when the
/// server last vouched for it and when asking it last failed.
#[derive(Clone, Default)]
struct Held {
    value: Option<Shared>,
    known: bool,
    etag: Option<String>,
    checked: Option<Instant>,
    failed: Option<Instant>,
}

impl Held {
    fn stale(&self, kind: Kind, now: Instant) -> bool {
        let fresh = self.checked.is_some_and(|t| now < t + kind.fresh_for());
        let backing_off = self.failed.is_some_and(|t| now < t + RETRY_AFTER_FAILURE);
        !fresh && !backing_off
    }
}

struct Inner {
    backend: BackendClient,
    disk: Disk,
    held: Mutex<HashMap<Kind, Held>>,
    flights: [AsyncMutex<()>; 3],
    refreshing: [AtomicBool; 3],
}

/// Mayhem data from our backend, cached on disk. Cheap to clone.
#[derive(Clone)]
pub struct MayhemClient(Arc<Inner>);

impl fmt::Debug for MayhemClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MayhemClient")
            .field("dir", &self.0.disk.root())
            .finish_non_exhaustive()
    }
}

fn unexpected(error: impl fmt::Display) -> BackendError {
    BackendError::Unavailable {
        message: format!("unexpected answer: {error}"),
    }
}

impl MayhemClient {
    /// Mayhem data from `backend`, cached under `dir` (e.g. `{app cache}/mayhem`).
    pub fn new(backend: BackendClient, dir: impl Into<PathBuf>) -> Self {
        Self(Arc::new(Inner {
            backend,
            disk: Disk::new(dir.into()),
            held: Mutex::new(HashMap::new()),
            flights: [
                AsyncMutex::new(()),
                AsyncMutex::new(()),
                AsyncMutex::new(()),
            ],
            refreshing: [
                AtomicBool::new(false),
                AtomicBool::new(false),
                AtomicBool::new(false),
            ],
        }))
    }

    /// Where the shared games are remembered.
    fn record_path(&self) -> PathBuf {
        self.0.disk.root().join("shared.json")
    }

    fn held(&self, kind: Kind) -> Option<Held> {
        self.0
            .held
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&kind)
            .cloned()
    }

    fn update(&self, kind: Kind, change: impl FnOnce(&mut Held)) {
        let mut held = self.0.held.lock().unwrap_or_else(PoisonError::into_inner);
        change(held.entry(kind).or_default());
    }

    fn typed<T: Send + Sync + 'static>(held: &Held) -> Option<Arc<T>> {
        held.value.clone().and_then(|v| v.downcast::<T>().ok())
    }

    fn key(kind: Kind) -> String {
        format!("{}.json", kind.name())
    }

    /// The file: held and fresh as is; held but stale answered at once and revalidated in the
    /// background; else read from disk (then revalidated), else fetched now.
    async fn file<T: DeserializeOwned + Send + Sync + 'static>(
        &self,
        kind: Kind,
    ) -> Result<Option<Arc<T>>, BackendError> {
        if self.held(kind).is_none_or(|h| !h.known)
            && let Some((bytes, etag)) = self.0.disk.read(&Self::key(kind)).await
        {
            match serde_json::from_slice::<T>(&bytes) {
                Ok(value) => self.update(kind, |h| {
                    if !h.known {
                        *h = Held {
                            value: Some(Arc::new(value)),
                            known: true,
                            etag,
                            checked: None,
                            failed: None,
                        };
                    }
                }),
                Err(error) => {
                    tracing::warn!(%error, kind = kind.name(), "dropping an unreadable Mayhem file");
                    self.0.disk.remove(&Self::key(kind)).await;
                }
            }
        }
        match self.held(kind) {
            Some(held) if held.known => {
                if held.stale(kind, Instant::now()) {
                    self.refresh_in_background::<T>(kind);
                }
                Ok(Self::typed(&held))
            }
            _ => self.fetch::<T>(kind).await,
        }
    }

    fn refresh_in_background<T: DeserializeOwned + Send + Sync + 'static>(&self, kind: Kind) {
        if self.0.refreshing[kind.index()].swap(true, Ordering::AcqRel) {
            return;
        }
        let this = self.clone();
        tokio::spawn(async move {
            if let Err(error) = this.fetch::<T>(kind).await {
                tracing::info!(%error, kind = kind.name(), "Mayhem data not refreshed");
            }
            this.0.refreshing[kind.index()].store(false, Ordering::Release);
        });
    }

    /// Asks the server (`If-None-Match` with the copy held): a new copy, the same, or none.
    async fn fetch<T: DeserializeOwned + Send + Sync + 'static>(
        &self,
        kind: Kind,
    ) -> Result<Option<Arc<T>>, BackendError> {
        let asked = Instant::now();
        let _flight = self.0.flights[kind.index()].lock().await;
        let held = self.held(kind).unwrap_or_default();
        if held.known && held.checked.is_some_and(|t| t >= asked) {
            // Answered for someone else while we waited.
            return Ok(Self::typed(&held));
        }
        let etag = held.value.as_ref().and(held.etag.clone());
        let answer = self
            .0
            .backend
            .get_file(&["v1", "mayhem", kind.name()], etag.as_deref())
            .await;
        let now = Instant::now();
        match answer {
            Ok(FileAnswer::Body { bytes, etag, .. }) => {
                let value: T = serde_json::from_slice(&bytes).map_err(unexpected)?;
                self.0
                    .disk
                    .write(&Self::key(kind), &bytes, etag.as_deref())
                    .await;
                let value: Arc<T> = Arc::new(value);
                let shared: Shared = value.clone();
                self.update(kind, |h| {
                    *h = Held {
                        value: Some(shared),
                        known: true,
                        etag,
                        checked: Some(now),
                        failed: None,
                    };
                });
                Ok(Some(value))
            }
            Ok(FileAnswer::NotModified { .. }) if held.value.is_some() => {
                self.update(kind, |h| {
                    h.checked = Some(now);
                    h.failed = None;
                });
                Ok(Self::typed(&held))
            }
            Ok(FileAnswer::NotModified { .. }) => Err(unexpected("304 without a copy")),
            Err(BackendError::NotFound) => {
                if held.value.is_some() {
                    self.0.disk.remove(&Self::key(kind)).await;
                }
                self.update(kind, |h| {
                    *h = Held {
                        known: true,
                        checked: Some(now),
                        ..Held::default()
                    };
                });
                Ok(None)
            }
            Err(error) => {
                self.update(kind, |h| h.failed = Some(now));
                if held.known {
                    tracing::info!(%error, kind = kind.name(), "Mayhem data: serving the copy held");
                    Ok(Self::typed(&held))
                } else {
                    Err(error)
                }
            }
        }
    }

    pub async fn catalog(&self) -> Result<Option<Arc<AugmentCatalog>>, BackendError> {
        self.file(Kind::Augments).await
    }

    pub async fn tiers(&self) -> Result<Option<Arc<MayhemTiers>>, BackendError> {
        self.file(Kind::Tiers).await
    }

    pub async fn stats(&self) -> Result<Option<Arc<MayhemStats>>, BackendError> {
        self.file(Kind::Stats).await
    }

    /// The augments in `language` (`None` before our server has built them).
    pub async fn augments(
        &self,
        language: Language,
    ) -> Result<Option<MayhemAugments>, BackendError> {
        Ok(self.catalog().await?.map(|c| localized(&c, language)))
    }

    /// The tiers and every augment's pick count; a part that can't be had is `None`.
    pub async fn overview(&self) -> MayhemOverview {
        let (tiers, stats) = tokio::join!(self.tiers(), self.stats());
        MayhemOverview {
            tiers: tiers
                .inspect_err(|error| tracing::info!(%error, "Mayhem tiers unavailable"))
                .ok()
                .flatten()
                .map(|t| MayhemTiers::clone(&t)),
            popularity: stats
                .inspect_err(|error| tracing::info!(%error, "Mayhem stats unavailable"))
                .ok()
                .flatten()
                .map(|s| popularity(&s)),
        }
    }

    /// One champion's augments ranked per rarity, most picked augments and items. Fails only
    /// when the augments themselves can't be had.
    pub async fn champion(&self, champion_id: u32) -> Result<MayhemChampion, BackendError> {
        let (catalog, tiers, stats) = tokio::join!(self.catalog(), self.tiers(), self.stats());
        let catalog = catalog?.ok_or(BackendError::NotFound)?;
        let tiers = tiers.ok().flatten();
        let stats = stats.ok().flatten();
        Ok(champion(
            champion_id,
            &catalog,
            tiers.as_deref(),
            stats.as_deref(),
        ))
    }
}

// ---- Sharing ------------------------------------------------------------------------------------

/// The games already shared (their hashes, oldest first), kept on disk.
#[derive(Debug, Default)]
struct Record {
    path: PathBuf,
    keys: VecDeque<String>,
}

impl Record {
    fn load(path: PathBuf) -> Self {
        let keys = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<VecDeque<String>>(&bytes).ok())
            .unwrap_or_default();
        Self { path, keys }
    }

    fn has(&self, key: &str) -> bool {
        self.keys.iter().any(|k| k == key)
    }

    fn add(&mut self, keys: impl IntoIterator<Item = String>) {
        for key in keys {
            if !self.has(&key) {
                self.keys.push_back(key);
            }
        }
        while self.keys.len() > RECORD_MAX {
            self.keys.pop_front();
        }
        let saved = serde_json::to_vec(&self.keys)
            .map_err(std::io::Error::other)
            .and_then(|bytes| {
                if let Some(dir) = self.path.parent() {
                    std::fs::create_dir_all(dir)?;
                }
                crate::settings::write_atomic(&self.path, &bytes)
            });
        if let Err(error) = saved {
            tracing::warn!(%error, "cannot remember the shared Mayhem games");
        }
    }
}

/// What the sharing task follows.
#[derive(Debug)]
pub struct Sharing {
    pub client: watch::Receiver<Option<LcuClient>>,
    pub status: watch::Receiver<ClientStatus>,
    pub settings: watch::Receiver<Settings>,
    pub remote: watch::Receiver<RemoteConfig>,
    pub backend: BackendClient,
    pub mayhem: MayhemClient,
    /// How long after a game ends (or the client connects) its history is read: [`AFTER_GAME`].
    pub after_game: Duration,
}

/// Starts sharing the player's Mayhem games ([`share`]) beside the core: its League client and
/// status, the player's settings and the remote config. Runs until the settings' sender is
/// gone; nothing at all while the switch is off. Must run inside a Tokio runtime.
pub fn spawn_sharing(
    backend: BackendClient,
    data: MayhemClient,
    core: &crate::Companion,
    settings: watch::Receiver<Settings>,
    remote: watch::Receiver<RemoteConfig>,
) {
    tokio::spawn(share(Sharing {
        client: core.client.clone(),
        status: core.status.clone(),
        settings,
        remote,
        backend,
        mayhem: data,
        after_game: AFTER_GAME,
    }));
}

fn allowed(settings: &Settings, remote: &RemoteConfig) -> bool {
    settings.share_mayhem_games && remote.features.mayhem_sharing
}

/// Shares the player's new Mayhem games (see the module docs): after each game (and when it
/// leaves the end-of-game screen, in case the history wasn't ready), when the League client
/// connects (games played without MVP), and once when the switch is turned on. Runs until the
/// settings' sender is gone. Nothing at all while the switch is off: every scan checks it first.
pub async fn share(mut s: Sharing) {
    let mut record = Record::load(s.mayhem.record_path());
    let mut was_on = allowed(
        &s.settings.borrow_and_update(),
        &s.remote.borrow_and_update(),
    );
    let mut status = s.status.borrow_and_update().clone();
    let mut due: Option<Instant> = None;
    loop {
        tokio::select! {
            changed = s.settings.changed() => {
                if changed.is_err() {
                    break;
                }
                let on = allowed(&s.settings.borrow_and_update(), &s.remote.borrow());
                if on && !was_on {
                    // Just turned on: the recent games (again when the client connects, if it isn't).
                    scan(&s, &mut record).await;
                }
                was_on = on;
            }
            Ok(()) = s.remote.changed() => {
                was_on = allowed(&s.settings.borrow(), &s.remote.borrow_and_update());
            }
            Ok(()) = s.status.changed() => {
                let next = s.status.borrow_and_update().clone();
                let connected = next.connection == ClientConnection::Connected;
                if connected && status.connection != ClientConnection::Connected {
                    due = Some(Instant::now() + s.after_game);
                }
                let (was, now) = (status.phase, next.phase);
                if now == GameflowPhase::PostGame && was != GameflowPhase::PostGame {
                    due = Some(Instant::now() + s.after_game);
                } else if was == GameflowPhase::PostGame && now != GameflowPhase::PostGame {
                    due = Some(Instant::now());
                }
                status = next;
            }
            () = tokio::time::sleep_until(due.unwrap_or_else(Instant::now)), if due.is_some() => {
                due = None;
                scan(&s, &mut record).await;
            }
        }
    }
}

/// Reads the recent games and shares the Mayhem ones not shared yet (at most 20).
async fn scan(s: &Sharing, record: &mut Record) {
    if !allowed(&s.settings.borrow(), &s.remote.borrow()) {
        return;
    }
    let Some(client) = s.client.borrow().clone() else {
        return;
    };
    let history = match client.get::<Value>(crate::profile::MATCHES).await {
        Ok(history) => history,
        Err(error) => {
            tracing::info!(%error, "Mayhem sharing: match history unavailable");
            return;
        }
    };
    // Each listed game names its platform; the client's region is for one that doesn't.
    let platform = client
        .get::<Value>(crate::profile::REGION)
        .await
        .ok()
        .and_then(|r| str_at(&r, "region").and_then(crate::live::platform_for_region))
        .unwrap_or("euw1")
        .to_ascii_uppercase();
    let fresh: Vec<(u64, String, String)> = listed_mayhem(&history, &platform)
        .into_iter()
        .filter(|(_, _, key)| !record.has(key))
        .collect();
    if fresh.is_empty() {
        return;
    }
    // One upload per platform (a player's games are all on theirs).
    let mut by_platform: HashMap<String, (Vec<MayhemGame>, Vec<String>)> = HashMap::new();
    let mut unshareable = Vec::new();
    for (id, platform, key) in fresh {
        match client
            .get::<Value>(&crate::matches::game_path(id))
            .await
            .ok()
            .and_then(|game| shared_game(&game, &platform))
        {
            Some(game) => {
                let entry = by_platform.entry(platform).or_default();
                entry.1.push(key);
                entry.0.push(game);
            }
            // Read, but nothing to share (no augments, a player missing): never again.
            None => unshareable.push(key),
        }
    }
    if !unshareable.is_empty() {
        record.add(unshareable);
    }
    for (platform, (games, keys)) in by_platform {
        let upload = MayhemUpload { platform, games };
        match s.backend.upload_mayhem(&upload).await {
            Ok(answer) => {
                tracing::info!(
                    accepted = answer.accepted,
                    duplicates = answer.duplicates,
                    "Mayhem games shared"
                );
                record.add(keys);
            }
            Err(ReportRefused::Rejected(error)) => {
                tracing::warn!(%error, "Mayhem games refused by the server, not sent again");
                record.add(keys);
            }
            Err(ReportRefused::Later(error)) => {
                tracing::info!(%error, "Mayhem games not shared, next time");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use domain::{CatalogAugment, LocalizedText, MayhemChampionStats, TierLists};
    use serde_json::json;

    use super::*;

    fn catalog() -> AugmentCatalog {
        let augment = |id: u32, rarity| CatalogAugment {
            id,
            rarity,
            icon: format!("assets/ux/kiwi/augments/icons/a{id}_small.png"),
            name: LocalizedText {
                en: format!("Augment {id}"),
                fr: if id == 1 {
                    String::new()
                } else {
                    format!("Augment {id} fr")
                },
            },
            description: LocalizedText {
                en: "Does things.".into(),
                fr: "Fait des choses.".into(),
            },
        };
        AugmentCatalog {
            version: "16.19.1".into(),
            patch: "16.19".into(),
            built_at: 0,
            augments: vec![
                augment(1, AugmentRarity::Silver),
                augment(2, AugmentRarity::Silver),
                augment(3, AugmentRarity::Silver),
                augment(4, AugmentRarity::Silver),
                augment(5, AugmentRarity::Silver),
                augment(10, AugmentRarity::Gold),
                augment(20, AugmentRarity::Prismatic),
            ],
        }
    }

    fn tiers() -> MayhemTiers {
        MayhemTiers {
            tiers: TierLists {
                s: vec![2, 1],
                a: vec![3, 10],
                ..TierLists::default()
            },
            ..MayhemTiers::default()
        }
    }

    fn stats(games: u32, picks: &[(u32, u32)]) -> MayhemStats {
        MayhemStats {
            patch: "16.19".into(),
            games: 100,
            players: 1000,
            updated_at: 0,
            augments: Vec::new(),
            champions: vec![MayhemChampionStats {
                id: 96,
                g: games,
                augments: picks.iter().map(|&(id, n)| PickCount { id, n }).collect(),
                items: vec![PickCount { id: 3089, n: 5 }, PickCount { id: 6655, n: 3 }],
            }],
        }
    }

    fn order(c: &MayhemChampion, rarity: AugmentRarity) -> Vec<u32> {
        c.priorities
            .iter()
            .find(|p| p.rarity == rarity)
            .unwrap()
            .entries
            .iter()
            .map(|e| e.id)
            .collect()
    }

    #[test]
    fn few_games_order_by_tier_and_rank_alone() {
        let c = champion(
            96,
            &catalog(),
            Some(&tiers()),
            Some(&stats(12, &[(1, 10), (4, 9)])),
        );
        assert_eq!(
            order(&c, AugmentRarity::Silver),
            [2, 1, 3],
            "untiered 4 needs enough games"
        );
        assert!(!c.priorities[0].by_pick_rate);
        assert_eq!(c.priorities[0].entries[0].rank, Some(1));
        assert_eq!(c.priorities[0].entries[0].pick_rate, None);
        assert_eq!(c.games, 12);
        assert_eq!(c.min_games, MIN_GAMES);
        assert!(c.tiered);
    }

    #[test]
    fn enough_games_add_the_champions_picks_after_the_owners_order() {
        let c = champion(
            96,
            &catalog(),
            Some(&tiers()),
            Some(&stats(40, &[(1, 30), (2, 4), (4, 9), (5, 12)])),
        );
        assert_eq!(
            order(&c, AugmentRarity::Silver),
            [2, 1, 3, 5, 4],
            "the owner's order holds (1, picked more, stays S · 2); then untiered, most picked first"
        );
        assert!(c.priorities[0].by_pick_rate);
        let second = &c.priorities[0].entries[1];
        assert_eq!(
            (second.tier, second.rank, second.picks),
            (Some(AugmentTier::S), Some(2), 30)
        );
        assert!((second.pick_rate.unwrap() - 0.75).abs() < 1e-9);
        let untiered = &c.priorities[0].entries[3];
        assert_eq!((untiered.id, untiered.tier, untiered.rank), (5, None, None));
        assert_eq!(order(&c, AugmentRarity::Gold), [10]);
        assert!(
            order(&c, AugmentRarity::Prismatic).is_empty(),
            "no tier, no picks: nothing to rank"
        );
        assert_eq!(c.items[0], PickCount { id: 3089, n: 5 });
    }

    #[test]
    fn without_tiers_or_games_there_is_nothing_to_rank() {
        let c = champion(96, &catalog(), None, None);
        assert!(c.priorities.iter().all(|p| p.entries.is_empty()));
        assert!(!c.tiered);
        assert_eq!(c.patch, None);
        let empty = champion(
            96,
            &catalog(),
            Some(&MayhemTiers::default()),
            Some(&stats(50, &[(20, 9), (999, 3)])),
        );
        assert!(!empty.tiered);
        assert_eq!(order(&empty, AugmentRarity::Prismatic), [20]);
        assert_eq!(
            empty.augments,
            vec![PickCount { id: 20, n: 9 }],
            "augments not in the catalog left out"
        );
    }

    #[test]
    fn localizes_names_with_english_as_a_fallback() {
        let fr = localized(&catalog(), Language::Fr);
        assert_eq!(fr.augments[0].name, "Augment 1", "no French name");
        assert_eq!(fr.augments[1].name, "Augment 2 fr");
        assert_eq!(fr.augments[1].description, "Fait des choses.");
        assert_eq!(
            fr.augments[0].icon,
            format!("{ICON_BASE}/assets/ux/kiwi/augments/icons/a1_small.png")
        );
        assert_eq!(
            localized(&catalog(), Language::En).augments[1].name,
            "Augment 2"
        );
    }

    fn whole_game(queue: u32, duration: u64) -> Value {
        let participants: Vec<Value> = (0..10)
            .map(|i| {
                json!({
                    "participantId": i + 1, "teamId": if i < 5 { 100 } else { 200 }, "championId": 100 + i,
                    "stats": { "win": i < 5, "kills": 3, "playerAugment1": 2137, "playerAugment2": if i == 0 { 1028 } else { 0 },
                               "playerAugment3": 0, "item0": 3089, "item1": 0, "item6": 3364 }
                })
            })
            .collect();
        json!({
            "gameId": 7_200_000_001_u64, "platformId": "EUW1", "queueId": queue, "gameMode": "KIWI",
            "gameVersion": "16.19.712.4", "gameDuration": duration, "mapId": 12,
            "participantIdentities": [{ "participantId": 1, "player": { "gameName": "Fillmo", "tagLine": "7272", "puuid": "secret" } }],
            "participants": participants
        })
    }

    #[test]
    fn shares_champions_augments_and_items_only() {
        let game = shared_game(&whole_game(2400, 1200), "EUW1").unwrap();
        assert_eq!(game.patch, "16.19");
        assert_eq!(game.game, game_key("euw1", 7_200_000_001));
        assert_eq!(game.players.len(), 10);
        assert_eq!(game.players[0].augments, vec![2137, 1028]);
        assert_eq!(
            game.players[0].items,
            vec![3089],
            "no trinket, no empty slot"
        );
        let json = serde_json::to_string(&game).unwrap();
        for leak in ["Fillmo", "secret", "win", "7200000001", "kills"] {
            assert!(!json.contains(leak), "{leak} in {json}");
        }
        assert!(
            shared_game(&whole_game(2400, 200), "EUW1").is_none(),
            "a remake"
        );
        assert!(
            shared_game(&whole_game(3270, 1200), "EUW1").is_none(),
            "a custom game"
        );
        assert!(
            shared_game(&whole_game(450, 1200), "EUW1").is_none(),
            "plain ARAM"
        );
    }

    #[test]
    fn game_keys_are_one_way_and_the_same_for_everyone() {
        let key = game_key("EUW1", 42);
        assert_eq!(key.len(), 64);
        assert!(
            key.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        );
        assert_eq!(key, game_key(" euw1 ", 42));
        assert_ne!(key, game_key("EUW1", 43));
        assert_ne!(key, game_key("NA1", 42));
        assert!(!key.contains("42"));
    }

    #[test]
    fn lists_matchmade_mayhem_games_and_reads_the_mode() {
        let history = json!({ "games": { "games": [
            { "gameId": 1, "queueId": 2400, "gameDuration": 1100, "platformId": "EUW1" },
            { "gameId": 2, "queueId": 2400, "gameDuration": 100 },
            { "gameId": 3, "queueId": 450, "gameDuration": 1100 },
            { "gameId": 4, "queueId": 3270, "gameDuration": 1100 },
            { "gameId": 5, "queueId": 2400, "gameDuration": 1300 }
        ] } });
        let listed = listed_mayhem(&history, "EUN1");
        let ids: Vec<(u64, &str)> = listed.iter().map(|(id, p, _)| (*id, p.as_str())).collect();
        assert_eq!(ids, [(1, "EUW1"), (5, "EUN1")]);
        assert!(is_mayhem_session(
            &json!({ "gameData": { "queue": { "id": 2400, "mapId": 12 } } })
        ));
        assert!(is_mayhem_session(
            &json!({ "gameData": { "queue": { "id": 3270 } } })
        ));
        assert!(is_mayhem_session(
            &json!({ "gameData": { "queue": { "id": 0, "gameMode": "KIWI" } } })
        ));
        assert!(is_mayhem_session(
            &json!({ "map": { "id": 12, "gameMode": "KIWI" } })
        ));
        assert!(!is_mayhem_session(
            &json!({ "gameData": { "queue": { "id": 450, "gameMode": "ARAM" } } })
        ));
    }

    #[test]
    fn the_record_is_bounded_and_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mayhem").join("shared.json");
        let mut record = Record::load(path.clone());
        record.add((0..RECORD_MAX + 5).map(|i| format!("k{i}")));
        record.add(["k600".to_owned()]);
        assert_eq!(record.keys.len(), RECORD_MAX);
        assert!(!record.has("k0") && record.has("k504"));
        let again = Record::load(path);
        assert_eq!(again.keys.len(), RECORD_MAX);
    }
}
