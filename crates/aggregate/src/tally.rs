//! Counters that only ever add up, so merging is commutative.

use std::collections::BTreeMap;

/// Games and wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, PartialOrd, Ord)]
pub struct Rec {
    pub games: u32,
    pub wins: u32,
}

impl Rec {
    pub fn add(&mut self, win: bool) {
        self.games = self.games.saturating_add(1);
        self.wins = self.wins.saturating_add(u32::from(win));
    }

    pub fn merge(&mut self, other: Self) {
        self.games = self.games.saturating_add(other.games);
        self.wins = self.wins.saturating_add(other.wins);
    }

    /// The same games seen from the opponent's side.
    #[must_use]
    pub const fn flipped(self) -> Self {
        Self {
            games: self.games,
            wins: self.games - self.wins,
        }
    }

    pub fn win_rate(self) -> Option<f64> {
        (self.games > 0).then(|| f64::from(self.wins) / f64::from(self.games))
    }
}

/// Merges `other` into `into`, summing records of equal keys.
pub fn merge_maps<K: Ord + Clone>(into: &mut BTreeMap<K, Rec>, other: &BTreeMap<K, Rec>) {
    for (k, r) in other {
        into.entry(k.clone()).or_default().merge(*r);
    }
}

/// Options of one choice (rune pages, item sets…) with a bounded number of distinct keys:
/// [`Tally::compact`] folds the rarest options into `tail`, keeping totals exact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tally<K: Ord> {
    pub options: BTreeMap<K, Rec>,
    /// Options dropped by compaction, summed.
    pub tail: Rec,
}

impl<K: Ord> Default for Tally<K> {
    fn default() -> Self {
        Self {
            options: BTreeMap::new(),
            tail: Rec::default(),
        }
    }
}

impl<K: Ord + Clone> Tally<K> {
    pub fn add(&mut self, key: K, win: bool) {
        self.options.entry(key).or_default().add(win);
    }

    pub fn merge(&mut self, other: &Self) {
        merge_maps(&mut self.options, &other.options);
        self.tail.merge(other.tail);
    }

    /// Every observation, including compacted ones.
    pub fn total(&self) -> Rec {
        let mut total = self.tail;
        for r in self.options.values() {
            total.merge(*r);
        }
        total
    }

    /// Options by games (then key) descending order of popularity.
    pub fn ranked(&self) -> Vec<(&K, Rec)> {
        let mut v: Vec<(&K, Rec)> = self.options.iter().map(|(k, r)| (k, *r)).collect();
        v.sort_by(|a, b| b.1.games.cmp(&a.1.games).then_with(|| a.0.cmp(b.0)));
        v
    }

    /// Keeps the `keep` most played options and folds the others into `tail`. Deterministic:
    /// ties break on the key, so the result depends only on the counts.
    pub fn compact(&mut self, keep: usize) {
        if self.options.len() <= keep {
            return;
        }
        let dropped: Vec<K> = self
            .ranked()
            .into_iter()
            .skip(keep)
            .map(|(k, _)| k.clone())
            .collect();
        for k in dropped {
            if let Some(r) = self.options.remove(&k) {
                self.tail.merge(r);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compaction_keeps_totals() {
        let mut t = Tally::default();
        for (k, n) in [(1, 5), (2, 3), (3, 3), (4, 1)] {
            for i in 0..n {
                t.add(k, i % 2 == 0);
            }
        }
        let before = t.total();
        t.compact(2);
        assert_eq!(t.total(), before);
        assert_eq!(t.options.keys().copied().collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(t.tail.games, 4);
    }

    #[test]
    fn flips_perspective() {
        let r = Rec { games: 10, wins: 7 };
        assert_eq!(r.flipped(), Rec { games: 10, wins: 3 });
    }
}
