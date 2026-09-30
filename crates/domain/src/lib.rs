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
mod imports;
mod live;
mod matches;
mod mayhem;
mod player;
mod progress;
mod remote;
mod scout;
mod settings;
mod stats;
mod update;

pub use backend::{ApiError, ApiErrorCode, BackendError, Health};
pub use client::{AppInfo, ClientConnection, ClientError, ClientStatus, GameflowPhase};
pub use draft::{
    CompMember, CompReading, Compositions, DamageMix, DataInfo, DraftPhase, DraftSlot, DraftView,
    Estimate, GameMode, Mastery, PersonalRecord, Reason, ReasonKind, RoleOdds, Suggestion,
    TeamComp,
};
pub use game_data::{
    ChampionInfo, Description, DescriptionKind, GameData, ItemInfo, PositionIcon, PositionIcons,
    RankEmblem, RankEmblems, RuneInfo, RuneStyle, SpellInfo, TextSpan, TextTone,
};
pub use imports::{
    FailReason, FlashKey, FlashNote, ImportOutcome, ImportPart, ImportRequest, ImportResult,
    ImportWarning, Lock, PartResult, SkipReason, SpellKey,
};
pub use live::{ActiveGame, ActiveParticipant, LiveGame, LiveNames, LivePlayer, Scouting};
pub use matches::{
    GradeBadge, GradeFactor, GradeFactorKind, GradeLetter, GradedMatch, MatchDetails, MatchGrade,
    MatchPlayer, MatchTeam,
};
pub use mayhem::{
    AugmentCatalog, AugmentInfo, AugmentPriorities, AugmentPriority, AugmentRarity, AugmentTier,
    CatalogAugment, MAYHEM_CUSTOM_QUEUE, MAYHEM_GAME_MODE, MAYHEM_QUEUE, MayhemAugments,
    MayhemChampion, MayhemChampionStats, MayhemGame, MayhemOverview, MayhemPlayer,
    MayhemPopularity, MayhemStats, MayhemTiers, MayhemUpload, MayhemUploadAnswer, PickCount,
    TierLists, is_mayhem_queue,
};
pub use player::{Division, MatchSummary, PlayerProfile, RankedEntry, RiotId, Role, Tier};
pub use progress::{ChampionMastery, LpGame, PostGame, RankedQueue};
pub use remote::{
    Banner, BannerSeverity, CrashReport, FeatureFlags, KillSwitches, LocalizedText, MinVersion,
    RemoteConfig, ReportKind,
};
pub use scout::{ChampionRecord, ScoutCard, ScoutRequest, ScoutTag};
pub use settings::{AutoAcceptEvent, Effects, Language, Settings, ViewRoute};
pub use stats::{
    Bracket, BuildOption, BuildSection, BuildStats, BuildsFile, ChampionPage, ChampionRoleStats,
    ChampionStats, ChampionsFile, CompositionStats, CompositionsFile, DataSetIndex, DataSetInfo,
    GamesWins, MatchupEntry, MatchupsFile, PairKind, PairPrior, PatchIndex, RoleMatchups,
    STATS_SCHEMA, StatsIndex, TierEntry, TierGrade, TierList,
};
pub use update::UpdateStatus;
