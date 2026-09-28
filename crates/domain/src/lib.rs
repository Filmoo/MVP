//! UI-facing domain model.
//!
//! These types are the contract between the Rust core and the UI. They are
//! serialized as camelCase JSON and exported to TypeScript with `ts-rs`
//! (run `cargo test -p domain` to regenerate `ui/src/data/generated`).
//! Wire formats of external APIs (LCU, Riot API) live in their own crates and
//! are mapped into these types; the UI never sees raw external payloads.

mod backend;
mod client;
mod draft;
mod game_data;
mod live;
mod player;
mod remote;
mod scout;
mod settings;
mod stats;

pub use backend::{ApiError, ApiErrorCode, BackendError, Health};
pub use client::{AppInfo, ClientConnection, ClientStatus, GameflowPhase};
pub use draft::{
    DataInfo, DraftPhase, DraftSlot, DraftView, Estimate, PersonalRecord, Reason, ReasonKind,
    RoleOdds, Suggestion,
};
pub use game_data::{ChampionInfo, GameData, ItemInfo, SpellInfo};
pub use live::{LiveGame, LivePlayer, Scouting};
pub use player::{Division, MatchSummary, PlayerProfile, RankedEntry, RiotId, Role, Tier};
pub use remote::{
    Banner, BannerSeverity, CrashReport, FeatureFlags, KillSwitches, LocalizedText, MinVersion,
    RemoteConfig, ReportKind,
};
pub use scout::{ChampionRecord, ScoutCard, ScoutRequest, ScoutTag};
pub use settings::{AutoAcceptEvent, Settings, ViewRoute};
pub use stats::{
    Bracket, BuildOption, BuildSection, BuildStats, BuildsFile, ChampionPage, ChampionRoleStats,
    ChampionStats, ChampionsFile, DataSetIndex, DataSetInfo, GamesWins, MatchupEntry, MatchupsFile,
    PairKind, PairPrior, PatchIndex, RoleMatchups, STATS_SCHEMA, StatsIndex, TierEntry, TierGrade,
    TierList,
};
