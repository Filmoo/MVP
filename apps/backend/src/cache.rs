//! In-memory cache with a time-to-live, a size bound (least recently used goes first) and
//! request coalescing: concurrent lookups of the same key share one upstream fetch.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::hash::Hash;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::OnceCell;
use tokio::time::Instant;

struct Slot<V> {
    cell: Arc<OnceCell<V>>,
    created: Instant,
    /// Logical clock of the last lookup (LRU order).
    used: u64,
}

struct Slots<K, V> {
    map: HashMap<K, Slot<V>>,
    clock: u64,
}

pub struct Cache<K, V> {
    /// `None`: entries never expire (they only leave when the cache is full).
    ttl: Option<Duration>,
    capacity: usize,
    slots: Mutex<Slots<K, V>>,
    hits: AtomicU64,
    misses: AtomicU64,
}

/// Lookups served from the cache (including ones joining an in-flight fetch) vs. fetched.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub len: usize,
}

impl<K, V> fmt::Debug for Cache<K, V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Cache")
            .field("ttl", &self.ttl)
            .field("capacity", &self.capacity)
            .finish_non_exhaustive()
    }
}

impl<K: Eq + Hash + Clone, V: Clone> Cache<K, V> {
    pub fn new(ttl: Option<Duration>, capacity: usize) -> Self {
        Self {
            ttl,
            capacity: capacity.max(1),
            slots: Mutex::new(Slots {
                map: HashMap::new(),
                clock: 0,
            }),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
        }
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
            len: self.len(),
        }
    }

    /// Fetched, unexpired values with their age (for a snapshot to disk).
    pub fn entries(&self) -> Vec<(K, V, Duration)> {
        let now = Instant::now();
        self.lock()
            .map
            .iter()
            .filter(|(_, slot)| !self.expired(slot, now))
            .filter_map(|(k, slot)| {
                let v = slot.cell.get()?.clone();
                Some((k.clone(), v, now.duration_since(slot.created)))
            })
            .collect()
    }

    /// Puts back a value fetched `age` ago (restored from disk); skipped if already expired,
    /// already present, or the cache is full.
    pub fn insert_aged(&self, key: K, value: V, age: Duration) {
        if self.ttl.is_some_and(|ttl| age >= ttl) {
            return;
        }
        let now = Instant::now();
        let mut slots = self.lock();
        if slots.map.len() >= self.capacity || slots.map.contains_key(&key) {
            return;
        }
        slots.clock += 1;
        let used = slots.clock;
        slots.map.insert(
            key,
            Slot {
                cell: Arc::new(OnceCell::new_with(Some(value))),
                created: now.checked_sub(age).unwrap_or(now),
                used,
            },
        );
    }

    /// The value held for `key`, if fetched and unexpired (counts as a hit or a miss).
    pub fn get(&self, key: &K) -> Option<V> {
        let now = Instant::now();
        let mut slots = self.lock();
        slots.clock += 1;
        let tick = slots.clock;
        let value = slots
            .map
            .get_mut(key)
            .filter(|slot| !self.expired(slot, now))
            .and_then(|slot| {
                slot.used = tick;
                slot.cell.get().cloned()
            });
        let counter = if value.is_some() {
            &self.hits
        } else {
            &self.misses
        };
        counter.fetch_add(1, Ordering::Relaxed);
        value
    }

    /// Holds `value` for `key` from now on, replacing what was there.
    pub fn insert(&self, key: K, value: V) {
        let now = Instant::now();
        let mut slots = self.lock();
        slots.clock += 1;
        let used = slots.clock;
        self.make_room(&mut slots, &key, now);
        slots.map.insert(
            key,
            Slot {
                cell: Arc::new(OnceCell::new_with(Some(value))),
                created: now,
                used,
            },
        );
    }

    /// Before adding `key`: when full, drops expired entries, then the least recently used.
    fn make_room(&self, slots: &mut Slots<K, V>, key: &K, now: Instant) {
        if slots.map.len() < self.capacity || slots.map.contains_key(key) {
            return;
        }
        slots.map.retain(|_, slot| !self.expired(slot, now));
        if slots.map.len() >= self.capacity
            && let Some(oldest) = slots
                .map
                .iter()
                .min_by_key(|(_, slot)| slot.used)
                .map(|(k, _)| k.clone())
        {
            slots.map.remove(&oldest);
        }
    }

    fn expired(&self, slot: &Slot<V>, now: Instant) -> bool {
        self.ttl
            .is_some_and(|ttl| now.duration_since(slot.created) >= ttl)
    }

    /// Returns the cached value, or runs `fetch` once for all concurrent callers of `key`.
    /// Errors are not cached: the next lookup fetches again.
    pub async fn get_or_try_insert<E, F, Fut>(&self, key: K, fetch: F) -> Result<V, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        let cell = self.cell(key);
        cell.get_or_try_init(fetch).await.cloned()
    }

    /// Entries currently held (including expired ones not yet evicted).
    pub fn len(&self) -> usize {
        self.lock().map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Slots<K, V>> {
        self.slots.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn cell(&self, key: K) -> Arc<OnceCell<V>> {
        let now = Instant::now();
        let mut slots = self.lock();
        slots.clock += 1;
        let tick = slots.clock;
        if let Some(slot) = slots.map.get_mut(&key)
            && !self.expired(slot, now)
        {
            slot.used = tick;
            self.hits.fetch_add(1, Ordering::Relaxed);
            return Arc::clone(&slot.cell);
        }
        self.misses.fetch_add(1, Ordering::Relaxed);
        self.make_room(&mut slots, &key, now);
        let cell = Arc::new(OnceCell::new());
        slots.map.insert(
            key,
            Slot {
                cell: Arc::clone(&cell),
                created: now,
                used: tick,
            },
        );
        cell
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    async fn lookup(cache: &Cache<&'static str, u32>, key: &'static str, calls: &AtomicU32) -> u32 {
        cache
            .get_or_try_insert(key, || async {
                tokio::time::sleep(Duration::from_millis(50)).await;
                Ok::<_, ()>(calls.fetch_add(1, Ordering::SeqCst) + 1)
            })
            .await
            .unwrap_or_default()
    }

    #[tokio::test(start_paused = true)]
    async fn coalesces_concurrent_lookups() {
        let cache = Cache::new(None, 10);
        let calls = AtomicU32::new(0);
        let (a, b, c) = tokio::join!(
            lookup(&cache, "k", &calls),
            lookup(&cache, "k", &calls),
            lookup(&cache, "k", &calls)
        );
        assert_eq!((a, b, c), (1, 1, 1));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn expires_after_ttl() {
        let cache = Cache::new(Some(Duration::from_secs(120)), 10);
        let calls = AtomicU32::new(0);
        assert_eq!(lookup(&cache, "k", &calls).await, 1);
        tokio::time::advance(Duration::from_secs(60)).await;
        assert_eq!(lookup(&cache, "k", &calls).await, 1, "still fresh");
        tokio::time::advance(Duration::from_secs(61)).await;
        assert_eq!(lookup(&cache, "k", &calls).await, 2, "refetched");
    }

    #[tokio::test(start_paused = true)]
    async fn evicts_least_recently_used() {
        let cache = Cache::new(None, 2);
        let calls = AtomicU32::new(0);
        lookup(&cache, "a", &calls).await;
        lookup(&cache, "b", &calls).await;
        lookup(&cache, "a", &calls).await; // a is now more recent than b
        lookup(&cache, "c", &calls).await; // evicts b
        assert_eq!(cache.len(), 2);
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        lookup(&cache, "a", &calls).await;
        assert_eq!(calls.load(Ordering::SeqCst), 3, "a kept");
        lookup(&cache, "b", &calls).await;
        assert_eq!(calls.load(Ordering::SeqCst), 4, "b was evicted");
    }

    #[tokio::test]
    async fn does_not_cache_errors() {
        let cache: Cache<&str, u32> = Cache::new(None, 10);
        let failed = cache
            .get_or_try_insert("k", || async { Err::<u32, &str>("boom") })
            .await;
        assert_eq!(failed, Err("boom"));
        let ok = cache
            .get_or_try_insert("k", || async { Ok::<u32, &str>(7) })
            .await;
        assert_eq!(ok, Ok(7));
    }

    #[tokio::test(start_paused = true)]
    async fn peeks_and_overwrites() {
        let cache: Cache<&str, u32> = Cache::new(Some(Duration::from_secs(100)), 2);
        assert_eq!(cache.get(&"a"), None);
        cache.insert("a", 1);
        assert_eq!(cache.get(&"a"), Some(1));
        cache.insert("a", 2);
        assert_eq!(cache.get(&"a"), Some(2), "replaced");
        let calls = AtomicU32::new(10);
        assert_eq!(lookup(&cache, "a", &calls).await, 2, "lookups see it too");
        // Full: the least recently used goes.
        cache.insert("b", 3);
        cache.get(&"a");
        cache.insert("c", 4);
        assert_eq!((cache.get(&"a"), cache.get(&"b")), (Some(2), None));
        tokio::time::advance(Duration::from_secs(100)).await;
        assert_eq!(cache.get(&"a"), None, "expired");
    }

    #[tokio::test(start_paused = true)]
    async fn counts_hits_and_restores_aged_entries() {
        let cache = Cache::new(Some(Duration::from_secs(100)), 10);
        let calls = AtomicU32::new(0);
        lookup(&cache, "a", &calls).await;
        lookup(&cache, "a", &calls).await;
        let stats = cache.stats();
        assert_eq!((stats.hits, stats.misses, stats.len), (1, 1, 1));

        tokio::time::advance(Duration::from_secs(30)).await;
        let entries = cache.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].2,
            Duration::from_millis(30_050),
            "age includes the fetch"
        );

        let restored: Cache<&str, u32> = Cache::new(Some(Duration::from_secs(100)), 10);
        restored.insert_aged("a", 1, Duration::from_secs(30));
        restored.insert_aged("old", 2, Duration::from_secs(100));
        assert_eq!(restored.len(), 1, "expired entries are not restored");
        let other = AtomicU32::new(10);
        assert_eq!(
            lookup(&restored, "a", &other).await,
            1,
            "served from the restored value"
        );
    }
}
