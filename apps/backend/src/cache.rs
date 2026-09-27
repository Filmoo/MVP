//! In-memory cache with a time-to-live, a size bound (least recently used goes first) and
//! request coalescing: concurrent lookups of the same key share one upstream fetch.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::hash::Hash;
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
            return Arc::clone(&slot.cell);
        }
        if slots.map.len() >= self.capacity && !slots.map.contains_key(&key) {
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
}
