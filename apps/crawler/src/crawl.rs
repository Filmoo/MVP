//! The crawl: ladder players → their recent ranked and ARAM match ids → matches (+ timelines)
//! → facts in the store. Every request goes through the shared header-driven rate limiter, so
//! a development key simply crawls slowly.

use std::time::Duration;

use aggregate::{ARAM, GameFacts, RANKED_SOLO, SeedBracket, extract};
use futures_util::future::join_all;
use riot_api::{MatchQuery, Platform, RiotClient, RiotError};

use crate::store::{NextPlayer, PendingMatch, Store, StoreError};

const LADDER_QUEUE: &str = "RANKED_SOLO_5x5";
const DIVISIONS: [&str; 4] = ["I", "II", "III", "IV"];
const APEX: [&str; 3] = ["challengerleagues", "grandmasterleagues", "masterleagues"];
/// Consecutive failed fetches (network, 5xx) before the crawl gives up.
const MAX_FAILURES: u32 = 20;

#[derive(Debug, Clone)]
pub struct CrawlConfig {
    pub platform: Platform,
    /// Matches to fetch in this run (counted or not).
    pub max_matches: u64,
    /// Ladder players to seed per bracket.
    pub players_per_bracket: u64,
    /// Match ids are listed from this many days back.
    pub since_days: u32,
    /// Match ids per player and queue (1–100).
    pub ids_per_player: u32,
    /// Also fetch timelines (skill order, item order): one more request per match.
    pub timelines: bool,
    /// Matches fetched concurrently (the rate limiter still paces them).
    pub concurrency: usize,
    /// A player's history is read again after this long.
    pub refresh: Duration,
    pub brackets: Vec<SeedBracket>,
}

impl Default for CrawlConfig {
    fn default() -> Self {
        Self {
            platform: Platform::Euw1,
            max_matches: 500,
            players_per_bracket: 300,
            since_days: 14,
            ids_per_player: 20,
            timelines: true,
            concurrency: 4,
            refresh: Duration::from_secs(12 * 60 * 60),
            brackets: SeedBracket::ALL.to_vec(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CrawlError {
    #[error("Riot API: {0}")]
    Riot(#[from] RiotError),
    #[error("crawl store: {0}")]
    Store(#[from] StoreError),
    #[error("{0} fetches failed in a row, stopping (state is saved, run again to resume)")]
    Failing(u32),
}

/// What one run did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CrawlReport {
    pub players_added: u64,
    /// Matches fetched and stored (counted + skipped).
    pub fetched: u64,
    /// Of which counted (ranked/ARAM, no remake).
    pub counted: u64,
    /// No player left to read (every history is fresh).
    pub exhausted: bool,
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}

/// Errors that end the run: a bad key never gets better by retrying.
fn fatal(e: &RiotError) -> bool {
    matches!(e, RiotError::Forbidden(_))
}

/// Seeds ladder players until each bracket has `players_per_bracket` (resumable per page).
pub async fn seed(
    client: &RiotClient,
    store: &mut Store,
    cfg: &CrawlConfig,
) -> Result<u64, CrawlError> {
    let platform = cfg.platform;
    let pid = platform.id();
    let mut added = 0u64;
    for &b in &cfg.brackets {
        let enough = |store: &Store| -> Result<bool, StoreError> {
            Ok(store.players_in(pid, b)? >= cfg.players_per_bracket)
        };
        if enough(store)? {
            continue;
        }
        match b {
            SeedBracket::Master => {
                for tier in APEX {
                    if enough(store)? {
                        break;
                    }
                    if store.ladder_page_done(pid, tier, "", 1)? {
                        continue;
                    }
                    let list = match client.apex_league(platform, tier, LADDER_QUEUE).await {
                        Ok(list) => list.entries,
                        Err(RiotError::NotFound) => Vec::new(),
                        Err(e) => return Err(e.into()),
                    };
                    let puuids: Vec<String> = list.into_iter().filter_map(|e| e.puuid).collect();
                    added += store.add_players(pid, b, &puuids)? as u64;
                    store.mark_ladder_page(pid, tier, "", 1)?;
                }
            }
            SeedBracket::Emerald | SeedBracket::Diamond => {
                let tier = if b == SeedBracket::Emerald {
                    "EMERALD"
                } else {
                    "DIAMOND"
                };
                // Divisions interleaved page by page, so a small quota still spans the bracket.
                let mut finished = [false; 4];
                let mut page = 1;
                while !enough(store)? && finished.iter().any(|f| !f) {
                    for (i, division) in DIVISIONS.iter().enumerate() {
                        if finished[i] || enough(store)? {
                            continue;
                        }
                        if store.ladder_page_done(pid, tier, division, page)? {
                            continue;
                        }
                        let entries = match client
                            .league_page(platform, LADDER_QUEUE, tier, division, page)
                            .await
                        {
                            Ok(entries) => entries,
                            Err(RiotError::NotFound) => Vec::new(),
                            Err(e) => return Err(e.into()),
                        };
                        if entries.is_empty() {
                            finished[i] = true;
                            continue;
                        }
                        let puuids: Vec<String> =
                            entries.into_iter().filter_map(|e| e.puuid).collect();
                        added += store.add_players(pid, b, &puuids)? as u64;
                        store.mark_ladder_page(pid, tier, division, page)?;
                    }
                    page += 1;
                }
            }
        }
        tracing::info!(
            bracket = b.id(),
            players = store.players_in(pid, b)?,
            "ladder seeded"
        );
    }
    Ok(added)
}

/// Lists a player's recent ranked and ARAM match ids and queues the new ones.
async fn read_history(
    client: &RiotClient,
    store: &mut Store,
    cfg: &CrawlConfig,
    player: &NextPlayer,
) -> Result<usize, CrawlError> {
    let since = now_secs() - i64::from(cfg.since_days) * 24 * 60 * 60;
    let mut ids = Vec::new();
    for queue in [RANKED_SOLO, ARAM] {
        let query = MatchQuery {
            queue: Some(u32::from(queue)),
            start_time: Some(since),
            start: 0,
            count: cfg.ids_per_player,
        };
        match client.match_ids(cfg.platform, &player.puuid, &query).await {
            Ok(list) => ids.extend(list),
            Err(RiotError::NotFound) => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(store.queue_matches(player, &ids, now_secs())?)
}

/// One match: its facts, or why it isn't counted.
async fn fetch_match(
    client: &RiotClient,
    m: &PendingMatch,
    timelines: bool,
) -> Result<Result<GameFacts, String>, RiotError> {
    let platform = Platform::from_id(&m.platform).unwrap_or(Platform::Euw1);
    let game = match client.match_by_id(platform, &m.id).await {
        Ok(game) => game,
        Err(RiotError::NotFound) => return Ok(Err("not found".to_owned())),
        Err(e) => return Err(e),
    };
    // Don't spend a timeline request on a game that won't be counted.
    if let Err(skip) = extract(&game, None) {
        return Ok(Err(skip.to_string()));
    }
    let timeline = if timelines {
        match client.match_timeline(platform, &m.id).await {
            Ok(t) => Some(t),
            Err(RiotError::NotFound) => None,
            Err(e) => return Err(e),
        }
    } else {
        None
    };
    Ok(extract(&game, timeline.as_ref()).map_err(|s| s.to_string()))
}

/// Seeds the ladder if needed, then fetches up to `max_matches` new matches.
pub async fn crawl(
    client: &RiotClient,
    store: &mut Store,
    cfg: &CrawlConfig,
) -> Result<CrawlReport, CrawlError> {
    let mut report = CrawlReport {
        players_added: seed(client, store, cfg).await?,
        ..CrawlReport::default()
    };
    let brackets = if cfg.brackets.is_empty() {
        SeedBracket::ALL.to_vec()
    } else {
        cfg.brackets.clone()
    };
    let refresh = i64::try_from(cfg.refresh.as_secs()).unwrap_or(i64::MAX);
    let mut cursor = 0usize;
    let mut failures = 0u32;
    while report.fetched < cfg.max_matches {
        let room = usize::try_from(cfg.max_matches - report.fetched).unwrap_or(usize::MAX);
        let batch = store.pending(cfg.concurrency.clamp(1, 32).min(room))?;
        if batch.is_empty() {
            // Next player, rotating brackets so each gets its share.
            let mut next = None;
            for _ in 0..brackets.len() {
                let b = brackets[cursor % brackets.len()];
                cursor += 1;
                next = store.next_player(cfg.platform.id(), b, now_secs() - refresh)?;
                if next.is_some() {
                    break;
                }
            }
            let Some(player) = next else {
                report.exhausted = true;
                break;
            };
            match read_history(client, store, cfg, &player).await {
                Ok(_) => failures = 0,
                Err(CrawlError::Riot(e)) if !fatal(&e) => {
                    failures += 1;
                    tracing::warn!(error = %e, "cannot list a player's matches");
                    backoff(&e, failures).await;
                }
                Err(e) => return Err(e),
            }
        } else {
            let results =
                join_all(batch.iter().map(|m| fetch_match(client, m, cfg.timelines))).await;
            for (m, result) in batch.iter().zip(results) {
                match result {
                    Ok(outcome) => {
                        failures = 0;
                        if store.store_match(m, &outcome, now_secs())? {
                            report.fetched += 1;
                            report.counted += u64::from(outcome.is_ok());
                        }
                    }
                    Err(e) if fatal(&e) => return Err(e.into()),
                    Err(e) => {
                        failures += 1;
                        tracing::warn!(id = m.id, error = %e, "match fetch failed, will retry");
                        backoff(&e, failures).await;
                    }
                }
            }
            if report.fetched > 0 && report.fetched.is_multiple_of(100) {
                tracing::info!(
                    fetched = report.fetched,
                    counted = report.counted,
                    "crawling"
                );
            }
        }
        if failures >= MAX_FAILURES {
            return Err(CrawlError::Failing(failures));
        }
    }
    Ok(report)
}

/// Waits before retrying: what Riot asked for, or a growing pause for other failures.
async fn backoff(e: &RiotError, failures: u32) {
    let wait = match e {
        RiotError::RateLimited { retry_after_secs } => Duration::from_secs(*retry_after_secs),
        _ => Duration::from_millis(250 * u64::from(failures.min(20))),
    };
    tokio::time::sleep(wait).await;
}
