//! Counting facts into mergeable aggregates.

use std::collections::BTreeMap;

use crate::facts::{
    GameFacts, Lane, Patch, PlayerFacts, RANKED_SOLO, RunePage, START_WINDOW_MS, SeedBracket,
    length_bucket,
};
use crate::items::ItemCatalog;
use crate::tally::{Rec, Tally, merge_maps};

/// Shares are counted in basis points, so sums stay integers (and merges exact).
pub const BASIS_POINTS: u64 = 10_000;

/// What one champion in one role brings to a team composition, summed over its games: exact
/// integers, so merging stays commutative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CompTally {
    /// Games with combat facts (facts crawled before them are left out).
    pub games: u32,
    /// Their length, in seconds.
    pub seconds: u64,
    /// Damage to champions: physical, magic, true.
    pub damage: [u64; 3],
    /// Its share of the team's damage taken and mitigated, per game, in basis points.
    pub frontline: u64,
    /// `timeCCingOthers`, in seconds.
    pub cc: u64,
    /// Record per game-length bucket (games with a known length).
    pub lengths: [Rec; 3],
}

impl CompTally {
    pub fn merge(&mut self, o: &Self) {
        self.games = self.games.saturating_add(o.games);
        self.seconds = self.seconds.saturating_add(o.seconds);
        for (a, b) in self.damage.iter_mut().zip(o.damage) {
            *a = a.saturating_add(b);
        }
        self.frontline = self.frontline.saturating_add(o.frontline);
        self.cc = self.cc.saturating_add(o.cc);
        for (a, b) in self.lengths.iter_mut().zip(o.lengths) {
            a.merge(b);
        }
    }
}

/// `part` of `whole` in basis points, rounded (0 without a whole).
fn basis_points(part: u64, whole: u64) -> u64 {
    if whole == 0 {
        return 0;
    }
    (part * BASIS_POINTS + whole / 2) / whole
}

/// Ability slots in max order (1 = Q, 2 = W, 3 = E), first maxed first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SkillOrder(pub [u8; 3]);

/// Level-ups needed before a max order means something.
const SKILL_ORDER_MIN_LEVELS: usize = 9;

impl SkillOrder {
    /// Order in which Q, W and E got their 5th point; abilities not maxed yet rank by points,
    /// then by slot. `None` before level 9.
    pub fn from_levels(levels: &[u8]) -> Option<Self> {
        if levels.len() < SKILL_ORDER_MIN_LEVELS {
            return None;
        }
        let mut points = [0usize; 3];
        let mut maxed_at = [usize::MAX; 3];
        for (i, &slot) in levels.iter().enumerate() {
            if let Some(n) = (1..=3).contains(&slot).then(|| usize::from(slot - 1)) {
                points[n] += 1;
                if points[n] == 5 {
                    maxed_at[n] = i;
                }
            }
        }
        let mut order = [1u8, 2, 3];
        order.sort_by_key(|&s| {
            let n = usize::from(s - 1);
            (maxed_at[n], usize::MAX - points[n], s)
        });
        Some(Self(order))
    }
}

/// Build choices of one champion in one role.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Builds {
    pub games: Rec,
    pub runes: Tally<RunePage>,
    pub keystones: Tally<u32>,
    pub spells: Tally<[u16; 2]>,
    pub skills: Tally<SkillOrder>,
    /// First four skill points.
    pub skill_start: Tally<[u8; 4]>,
    /// Items bought before 1:30, sorted.
    pub starts: Tally<Vec<u32>>,
    /// First three completed legendaries in completion order.
    pub core: Tally<[u32; 3]>,
    pub boots: Tally<u32>,
    /// 4th, 5th and 6th completed legendary.
    pub later: [Tally<u32>; 3],
}

impl Builds {
    fn add(&mut self, p: &PlayerFacts, timeline: bool, catalog: &ItemCatalog) {
        let win = p.win;
        self.games.add(win);
        if let Some(page) = p.runes {
            self.runes.add(page, win);
            self.keystones.add(page.keystone(), win);
        }
        self.spells.add(p.spells, win);
        if !timeline {
            return;
        }
        if let Some(order) = SkillOrder::from_levels(&p.skills) {
            self.skills.add(order, win);
        }
        if let Some(start) = p.skills.get(..4).and_then(|s| <[u8; 4]>::try_from(s).ok()) {
            self.skill_start.add(start, win);
        }
        let mut start: Vec<u32> = p
            .purchases
            .iter()
            .filter(|b| u64::from(b.t) < START_WINDOW_MS)
            .map(|b| b.item)
            .collect();
        if !start.is_empty() {
            start.sort_unstable();
            self.starts.add(start, win);
        }
        let mut legendaries: Vec<u32> = Vec::with_capacity(6);
        for b in &p.purchases {
            if catalog.is_legendary(b.item) && !legendaries.contains(&b.item) {
                legendaries.push(b.item);
            }
        }
        if let Some(core) = legendaries
            .get(..3)
            .and_then(|c| <[u32; 3]>::try_from(c).ok())
        {
            self.core.add(core, win);
        }
        for (slot, tally) in self.later.iter_mut().enumerate() {
            if let Some(&item) = legendaries.get(3 + slot) {
                tally.add(item, win);
            }
        }
        if let Some(b) = p.purchases.iter().find(|b| catalog.is_boots(b.item)) {
            self.boots.add(b.item, win);
        }
    }

    fn merge(&mut self, o: &Self) {
        self.games.merge(o.games);
        self.runes.merge(&o.runes);
        self.keystones.merge(&o.keystones);
        self.spells.merge(&o.spells);
        self.skills.merge(&o.skills);
        self.skill_start.merge(&o.skill_start);
        self.starts.merge(&o.starts);
        self.core.merge(&o.core);
        self.boots.merge(&o.boots);
        for (a, b) in self.later.iter_mut().zip(&o.later) {
            a.merge(b);
        }
    }

    fn compact(&mut self, keep: usize) {
        self.runes.compact(keep);
        self.keystones.compact(keep);
        self.spells.compact(keep);
        self.skills.compact(keep);
        self.skill_start.compact(keep);
        self.starts.compact(keep);
        self.core.compact(keep);
        self.boots.compact(keep);
        for t in &mut self.later {
            t.compact(keep);
        }
    }
}

/// Everything counted for one patch × queue × seed bracket. Records are from the first
/// champion's point of view (`wins` = its wins).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SliceStats {
    /// Matches counted.
    pub games: u32,
    /// (champion, role) → record; role `None` in ARAM. Pick counts are the games.
    pub champions: BTreeMap<(u16, Option<Lane>), Rec>,
    /// Matches in which the champion was banned.
    pub bans: BTreeMap<u16, u32>,
    /// (champion, role, enemy, enemy's role) for lane-relevant opponents only: the same role,
    /// the enemy jungler (from the laner's side; jungler vs jungler is a same-role pair) and
    /// the other half of the bot lane (bottom vs support).
    pub versus: BTreeMap<(u16, Lane, u16, Lane), Rec>,
    /// (champion, role, teammate, teammate's role), each pair once with `role < teammate's`.
    pub duos: BTreeMap<(u16, Lane, u16, Lane), Rec>,
    pub builds: BTreeMap<(u16, Option<Lane>), Builds>,
    /// (champion, role) → what it brings to a team composition (games with those facts only).
    pub comps: BTreeMap<(u16, Option<Lane>), CompTally>,
}

impl SliceStats {
    pub fn add(&mut self, game: &GameFacts, catalog: &ItemCatalog) {
        self.games = self.games.saturating_add(1);
        for &c in &game.bans {
            *self.bans.entry(c).or_default() += 1;
        }
        for p in &game.players {
            self.champions
                .entry((p.champion, p.role))
                .or_default()
                .add(p.win);
            self.builds
                .entry((p.champion, p.role))
                .or_default()
                .add(p, game.timeline, catalog);
        }
        self.add_comps(game);
        if game.queue != RANKED_SOLO {
            return;
        }
        for a in &game.players {
            let Some(ra) = a.role else { continue };
            for b in &game.players {
                let Some(rb) = b.role else { continue };
                if a.team == b.team {
                    if ra < rb {
                        self.duos
                            .entry((a.champion, ra, b.champion, rb))
                            .or_default()
                            .add(a.win);
                    }
                } else if lane_relevant(ra, rb) {
                    self.versus
                        .entry((a.champion, ra, b.champion, rb))
                        .or_default()
                        .add(a.win);
                }
            }
        }
    }

    /// Composition numbers: games with a known length count in their length bucket; those with
    /// combat facts also count their damage, frontline share and crowd control. Older facts
    /// without them are left out, never counted as zero.
    fn add_comps(&mut self, game: &GameFacts) {
        let Some(seconds) = game.duration else {
            return;
        };
        // Each team's damage soaked, for the players' shares of it.
        let mut soaked = [0u64; 2];
        for p in &game.players {
            if let Some(c) = p.combat {
                soaked[usize::from(p.team.min(1))] += c.soaked();
            }
        }
        for p in &game.players {
            let tally = self.comps.entry((p.champion, p.role)).or_default();
            tally.lengths[length_bucket(game.queue, seconds)].add(p.win);
            let Some(c) = p.combat else { continue };
            tally.games = tally.games.saturating_add(1);
            tally.seconds = tally.seconds.saturating_add(u64::from(seconds));
            for (sum, dealt) in tally
                .damage
                .iter_mut()
                .zip([c.physical, c.magic, c.true_damage])
            {
                *sum = sum.saturating_add(u64::from(dealt));
            }
            let team = soaked[usize::from(p.team.min(1))];
            tally.frontline = tally
                .frontline
                .saturating_add(basis_points(c.soaked(), team));
            tally.cc = tally.cc.saturating_add(u64::from(c.cc));
        }
    }

    pub fn merge(&mut self, o: &Self) {
        self.games = self.games.saturating_add(o.games);
        for (c, n) in &o.bans {
            *self.bans.entry(*c).or_default() += n;
        }
        merge_maps(&mut self.champions, &o.champions);
        merge_maps(&mut self.versus, &o.versus);
        merge_maps(&mut self.duos, &o.duos);
        for (k, b) in &o.builds {
            self.builds.entry(*k).or_default().merge(b);
        }
        for (k, c) in &o.comps {
            self.comps.entry(*k).or_default().merge(c);
        }
    }

    /// Bounds memory: keeps the `keep` most played options of every build choice.
    pub fn compact(&mut self, keep: usize) {
        for b in self.builds.values_mut() {
            b.compact(keep);
        }
    }
}

/// Opponent pairs we count: same role, a laner vs the enemy jungler, and the 2v2 bot lane.
pub fn lane_relevant(a: Lane, b: Lane) -> bool {
    a == b
        || (b == Lane::Jungle && a != Lane::Jungle)
        || matches!(
            (a, b),
            (Lane::Bottom, Lane::Support) | (Lane::Support, Lane::Bottom)
        )
}

/// Which slice a game is counted in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Slice {
    pub patch: Patch,
    pub queue: u16,
    pub bracket: SeedBracket,
}

/// Aggregates of any number of games, per slice. Merging is commutative (every count is a
/// sum) and exact until [`Dataset::compact`] folds rare build options into a tail.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Dataset {
    pub slices: BTreeMap<Slice, SliceStats>,
}

impl Dataset {
    /// Counts one game found through `bracket`'s ladder. Items are classified with the
    /// game's patch catalog (an empty catalog skips item builds).
    pub fn add(&mut self, game: &GameFacts, bracket: SeedBracket, catalog: &ItemCatalog) {
        let slice = Slice {
            patch: game.patch,
            queue: game.queue,
            bracket,
        };
        self.slices.entry(slice).or_default().add(game, catalog);
    }

    pub fn merge(&mut self, other: &Self) {
        for (k, s) in &other.slices {
            self.slices.entry(*k).or_default().merge(s);
        }
    }

    pub fn compact(&mut self, keep: usize) {
        for s in self.slices.values_mut() {
            s.compact(keep);
        }
    }

    /// Every seed bracket of a published bracket, merged.
    pub fn combined(&self, patch: Patch, queue: u16, bracket: domain::Bracket) -> SliceStats {
        let mut out = SliceStats::default();
        for (k, s) in &self.slices {
            if k.patch == patch && k.queue == queue && k.bracket.within(bracket) {
                out.merge(s);
            }
        }
        out
    }

    /// Patches present, newest first.
    pub fn patches(&self) -> Vec<Patch> {
        let mut v: Vec<Patch> = self.slices.keys().map(|k| k.patch).collect();
        v.sort_unstable_by(|a, b| b.cmp(a));
        v.dedup();
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_max_order() {
        // Q E Q W Q E Q E Q  E E R … → Q maxed at level 9, then E.
        let levels = [1, 3, 1, 2, 1, 3, 1, 3, 1, 3, 3, 4, 2, 2];
        assert_eq!(
            SkillOrder::from_levels(&levels),
            Some(SkillOrder([1, 3, 2]))
        );
        // Nothing maxed yet at level 9: most points first.
        let levels = [2, 1, 2, 3, 2, 1, 2, 4, 1];
        assert_eq!(
            SkillOrder::from_levels(&levels),
            Some(SkillOrder([2, 1, 3]))
        );
        assert_eq!(SkillOrder::from_levels(&[1, 2, 3]), None);
    }
}
