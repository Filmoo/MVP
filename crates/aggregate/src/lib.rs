//! The stats pipeline's pure core.
//!
//! 1. [`extract`] turns one Match-V5 game (and optionally its timeline) into [`GameFacts`]: a
//!    small, player-anonymous record of what the aggregates need (the crawler stores these,
//!    so aggregates can be rebuilt without calling Riot again).
//! 2. [`Dataset::add`] counts facts per patch × queue × seed bracket into [`SliceStats`]:
//!    champion × role records, bans, lane and jungle matchups, duos and builds. Every count is
//!    a sum, so [`Dataset::merge`] is commutative and shards can be combined in any order.
//! 3. [`publish`] turns a dataset into the versioned JSON files the app downloads.

mod dataset;
mod facts;
mod items;
pub mod publish;
pub mod synthetic;
mod tally;

pub use dataset::{Builds, Dataset, SkillOrder, Slice, SliceStats, lane_relevant};
pub use facts::{
    ARAM, GameFacts, Lane, Patch, PlayerFacts, Purchase, RANKED_SOLO, RunePage, SeedBracket, Skip,
    extract,
};
pub use items::ItemCatalog;
pub use tally::{Rec, Tally};
