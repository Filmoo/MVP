//! Published champion statistics: the per-patch JSON files the crawler publishes and the app
//! downloads (`stats/v1/…`, see `docs/architecture.md`). Keys are short because these files
//! hold thousands of rows: `g` = games, `w` = wins (of the file's champion), always raw counts
//! so the app can shrink small samples itself.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Role;

/// Version of the published file layout (`stats/v{SCHEMA}/…`).
pub const STATS_SCHEMA: u32 = 1;

/// Rank bracket of a published data set. Brackets are cumulative: `emeraldPlus` holds every
/// crawled game, `masterPlus` only games seeded from the Master+ ladders.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize, TS,
)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Bracket {
    /// The widest one, published first: the default.
    #[default]
    EmeraldPlus,
    DiamondPlus,
    MasterPlus,
}

impl Bracket {
    pub const ALL: [Self; 3] = [Self::EmeraldPlus, Self::DiamondPlus, Self::MasterPlus];

    /// Path segment and JSON name (`emeraldPlus`).
    pub const fn slug(self) -> &'static str {
        match self {
            Self::EmeraldPlus => "emeraldPlus",
            Self::DiamondPlus => "diamondPlus",
            Self::MasterPlus => "masterPlus",
        }
    }

    /// Display name, e.g. `Emerald+`.
    pub const fn label(self) -> &'static str {
        match self {
            Self::EmeraldPlus => "Emerald+",
            Self::DiamondPlus => "Diamond+",
            Self::MasterPlus => "Master+",
        }
    }
}

/// `stats/v1/index.json`: what is published. Fetched first (small, short cache).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StatsIndex {
    pub schema: u32,
    /// Patch the app should use: the newest one with enough Emerald+ ranked games, else the
    /// previous one (`None` before anything is published).
    pub current: Option<String>,
    /// Newest first.
    pub patches: Vec<PatchIndex>,
    /// Unix epoch milliseconds.
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PatchIndex {
    /// Game version patch as in match data and Data Dragon, e.g. `16.19` (path segment).
    pub patch: String,
    /// Public patch name, e.g. `26.19`.
    pub name: String,
    pub sets: Vec<DataSetIndex>,
    /// Unix epoch milliseconds of this patch's last publication.
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// One published `{queue}/{bracket}` directory of a patch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DataSetIndex {
    /// 420 = ranked solo/duo, 450 = ARAM.
    pub queue: u32,
    pub bracket: Bracket,
    /// Matches counted.
    pub games: u32,
}

/// Header shared by every file of one data set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DataSetInfo {
    pub schema: u32,
    pub patch: String,
    pub queue: u32,
    pub bracket: Bracket,
    /// Matches in the data set (pick rate = `g / games`, ban rate = `bans / games`).
    pub games: u32,
    /// Unix epoch milliseconds.
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// `{patch}/{queue}/{bracket}/champions.json`: every champion's record per role, plus the
/// draft model's priors fitted on this data set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionsFile {
    pub info: DataSetInfo,
    /// Sorted by champion id.
    pub champions: Vec<ChampionStats>,
    /// Between-pair spread per pair type (ranked only; empty for ARAM).
    pub priors: Vec<PairPrior>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionStats {
    /// Numeric champion key (`championId`).
    pub id: u32,
    /// Games over all roles.
    pub g: u32,
    /// Wins.
    pub w: u32,
    /// Games in which it was banned (by either team).
    pub bans: u32,
    /// Most played first. Shares of `g` give the champion's role odds. ARAM has one entry
    /// without a role.
    pub roles: Vec<ChampionRoleStats>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionRoleStats {
    /// `None` in ARAM.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub role: Option<Role>,
    /// Games.
    pub g: u32,
    /// Wins.
    pub w: u32,
    /// The previous patch's record in this role (the base-strength prior), when published.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prev: Option<GamesWins>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GamesWins {
    /// Games.
    pub g: u32,
    /// Wins.
    pub w: u32,
}

/// Which kind of pair a prior applies to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PairKind {
    /// Opponents in the same lane (same role, or bottom vs support).
    Lane,
    /// A laner against the enemy jungler (`roles = [role, jungle]`).
    Jungle,
    /// Teammates.
    Duo,
}

/// Empirical-Bayes prior of one pair type: spread of true pair effects `tau` (win-rate scale)
/// and the matching strength `k ≈ 0.25 / tau²` in pseudo-games.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PairPrior {
    pub kind: PairKind,
    pub roles: Vec<Role>,
    pub tau: f64,
    pub k: f64,
    /// Pairs the fit used.
    pub pairs: u32,
}

/// `{patch}/{queue}/{bracket}/tierlist.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TierList {
    pub info: DataSetInfo,
    /// Best score first.
    pub entries: Vec<TierEntry>,
}

/// One champion in one role. `score` is the shrunk win rate minus 50 %, in percentage points:
/// small samples are pulled toward 50 %, so luck can't top the list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TierEntry {
    pub id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub role: Option<Role>,
    pub tier: TierGrade,
    pub score: f64,
    /// Games.
    pub g: u32,
    /// Wins.
    pub w: u32,
    /// Shrunk win rate (0–1).
    pub win_rate: f64,
    /// Share of matches with this champion in this role (0–1).
    pub pick_rate: f64,
    /// Share of matches with this champion banned (0–1).
    pub ban_rate: f64,
    /// Share of this champion's games played in this role (0–1), every role counted, published
    /// or not. `None` in ARAM and in files published before it existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub share: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TierGrade {
    S,
    A,
    B,
    C,
    D,
}

/// `{patch}/{queue}/{bracket}/matchups/{championId}.json` (ranked only).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchupsFile {
    pub info: DataSetInfo,
    pub id: u32,
    pub roles: Vec<RoleMatchups>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoleMatchups {
    pub role: Role,
    /// This champion's games in the role.
    pub g: u32,
    /// Wins.
    pub w: u32,
    /// Against the enemy in the same role, most games first; bottom and support also list
    /// the other half of the enemy bot lane (`role` tells which).
    pub lane: Vec<MatchupEntry>,
    /// Against the enemy jungler (empty for junglers: see `lane`).
    pub jungle: Vec<MatchupEntry>,
    /// With each teammate (`role` = the teammate's).
    pub duos: Vec<MatchupEntry>,
}

/// This champion with or against another one. `w` counts this champion's wins.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchupEntry {
    /// The other champion.
    pub id: u32,
    /// The other champion's role.
    pub role: Role,
    /// Games.
    pub g: u32,
    /// Wins.
    pub w: u32,
    /// Effect beyond both champions' base strengths after shrinkage, in percentage points
    /// (positive = good for this champion).
    pub d: f64,
}

/// `{patch}/{queue}/{bracket}/builds/{championId}.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildsFile {
    pub info: DataSetInfo,
    pub id: u32,
    /// Most played role first.
    pub roles: Vec<BuildStats>,
}

/// What players of one champion in one role choose, each option with its games and wins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildStats {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub role: Option<Role>,
    /// Games.
    pub g: u32,
    /// Wins.
    pub w: u32,
    /// `ids` = `[primaryStyle, subStyle, 4 primary perks, 2 secondary perks, 3 shards
    /// (offense, flex, defense)]`, ready for a rune page import.
    pub runes: BuildSection,
    /// `ids` = `[keystone]`.
    pub keystones: BuildSection,
    /// `ids` = the two summoner spells, lower id first.
    pub spells: BuildSection,
    /// Skill max order: `ids` = ability slots (1 = Q, 2 = W, 3 = E), first maxed first.
    pub skills: BuildSection,
    /// First four skill points: `ids` = slots (4 = R).
    pub skill_start: BuildSection,
    /// Items bought before 1:30, sorted by id (duplicates repeated: two potions).
    pub starts: BuildSection,
    /// First three completed legendary items, in completion order.
    pub core: BuildSection,
    /// `ids` = `[boots]`: first upgraded boots bought.
    pub boots: BuildSection,
    /// `ids` = `[item]`: the 4th, 5th and 6th completed legendary.
    pub item4: BuildSection,
    pub item5: BuildSection,
    pub item6: BuildSection,
}

/// The most common options of one build choice.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildSection {
    /// Games where this choice was observed (the denominator of each option's pick rate;
    /// skills and items need a timeline, so it can be below the role's games).
    pub n: u32,
    /// Most games first.
    pub top: Vec<BuildOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildOption {
    pub ids: Vec<u32>,
    /// Games.
    pub g: u32,
    /// Wins.
    pub w: u32,
}

/// `{patch}/{queue}/{bracket}/compositions.json`: what each champion in each role brings to a
/// team composition, from the games crawled with those numbers (older ones are left out, never
/// counted as zero). Read by the draft helper; not in the estimate, shown for information.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CompositionsFile {
    pub info: DataSetInfo,
    /// Upper bounds of the game-length buckets in minutes: `[25, 35]` = under 25, 25 to 35,
    /// 35 and more (ARAM games are shorter: their own bounds).
    pub lengths: Vec<u32>,
    /// Every champion of each role together (`id` 0): what a usual pick in the role brings.
    pub roles: Vec<CompositionStats>,
    /// Per champion × role with enough games, sorted by champion, then role.
    pub champions: Vec<CompositionStats>,
}

/// One champion in one role (`None` in ARAM), averaged over its `n` games.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CompositionStats {
    /// Champion id (0 for a whole role).
    pub id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub role: Option<Role>,
    /// Games behind these numbers.
    pub n: u32,
    /// Damage to champions per minute: physical, magic, true.
    pub dmg: [f64; 3],
    /// Mean share of its team's damage taken and self-mitigated (0–1): its frontline.
    pub front: f64,
    /// Mean crowd control (`timeCCingOthers`) per game, in seconds.
    pub cc: f64,
    /// `[games, wins]` in each game-length bucket (see `lengths`); empty for a whole role.
    #[serde(default)]
    pub len: Vec<(u32, u32)>,
}

/// Everything the Champions page shows for one champion in one queue × bracket, read by the
/// core from the current patch's published files (`champions.json`, `tierlist.json`,
/// `builds/{id}.json`, `matchups/{id}.json`). A file that isn't published for this data set
/// (no games yet, or matchups in ARAM) leaves its part empty instead of failing the page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionPage {
    /// The data set the numbers come from (patch, queue, bracket, games).
    pub info: DataSetInfo,
    /// The champion's record per role, most played first (`None` without games).
    pub stats: Option<ChampionStats>,
    /// Its tier list rows, one per role it is ranked in (best role first).
    pub tiers: Vec<TierEntry>,
    /// Builds per role (`None` when not published).
    pub builds: Option<BuildsFile>,
    /// Matchups and duos per role (ranked only; `None` in ARAM or when not published).
    pub matchups: Option<MatchupsFile>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_keys_on_the_wire() {
        let e = MatchupEntry {
            id: 86,
            role: Role::Top,
            g: 120,
            w: 64,
            d: 1.25,
        };
        assert_eq!(
            serde_json::to_string(&e).expect("serializes"),
            r#"{"id":86,"role":"top","g":120,"w":64,"d":1.25}"#
        );
        let r = ChampionRoleStats {
            role: None,
            g: 3,
            w: 1,
            prev: None,
        };
        assert_eq!(
            serde_json::to_string(&r).expect("serializes"),
            r#"{"g":3,"w":1}"#
        );
        assert_eq!(Bracket::EmeraldPlus.slug(), "emeraldPlus");
        assert_eq!(
            serde_json::to_string(&Bracket::DiamondPlus).expect("serializes"),
            r#""diamondPlus""#
        );
    }
}
