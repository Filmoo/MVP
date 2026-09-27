//! Match-V5 JSON → [`GameFacts`]: only what the aggregates count, no player identity.

use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Ranked solo/duo.
pub const RANKED_SOLO: u16 = 420;
/// ARAM (Howling Abyss).
pub const ARAM: u16 = 450;
/// Games shorter than this are remakes and never counted.
pub const REMAKE_SECONDS: u64 = 5 * 60;
/// Purchases before this count as starting items.
pub const START_WINDOW_MS: u64 = 90_000;

/// Game-version patch (`16.19`), as in match data and Data Dragon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Patch {
    pub major: u16,
    pub minor: u16,
}

impl Patch {
    /// Parses `gameVersion` (`16.19.712.1234`) or a patch (`16.19`).
    pub fn from_game_version(version: &str) -> Option<Self> {
        let mut parts = version.trim().split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        Some(Self { major, minor })
    }

    /// Public patch name: game version 15.x was patch 25.x, 16.x is 26.x.
    pub fn public_name(self) -> String {
        let year = if self.major >= 15 {
            self.major + 10
        } else {
            self.major
        };
        format!("{year}.{}", self.minor)
    }

    /// The patch before this one (`16.1` → `15.24`; year boundaries assume 24 patches).
    #[must_use]
    pub fn previous(self) -> Self {
        if self.minor > 1 {
            Self {
                major: self.major,
                minor: self.minor - 1,
            }
        } else {
            Self {
                major: self.major.saturating_sub(1),
                minor: 24,
            }
        }
    }
}

impl fmt::Display for Patch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.major, self.minor)
    }
}

impl FromStr for Patch {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_game_version(s).ok_or_else(|| format!("not a patch: {s:?}"))
    }
}

/// Ladder a game was found through (Match-V5 carries no rank: a game counts in the bracket of
/// the ladder player whose history surfaced it first).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SeedBracket {
    Emerald,
    Diamond,
    /// Master, Grandmaster and Challenger.
    Master,
}

impl SeedBracket {
    pub const ALL: [Self; 3] = [Self::Emerald, Self::Diamond, Self::Master];

    pub const fn id(self) -> &'static str {
        match self {
            Self::Emerald => "emerald",
            Self::Diamond => "diamond",
            Self::Master => "master",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|b| b.id() == id)
    }

    /// Whether games of this ladder belong to a published (cumulative) bracket.
    pub const fn within(self, published: domain::Bracket) -> bool {
        match published {
            domain::Bracket::EmeraldPlus => true,
            domain::Bracket::DiamondPlus => !matches!(self, Self::Emerald),
            domain::Bracket::MasterPlus => matches!(self, Self::Master),
        }
    }
}

/// A Summoner's Rift position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lane {
    Top,
    Jungle,
    Middle,
    Bottom,
    Support,
}

impl Lane {
    pub const ALL: [Self; 5] = [
        Self::Top,
        Self::Jungle,
        Self::Middle,
        Self::Bottom,
        Self::Support,
    ];

    /// Match-V5 `teamPosition`.
    pub fn from_team_position(p: &str) -> Option<Self> {
        match p {
            "TOP" => Some(Self::Top),
            "JUNGLE" => Some(Self::Jungle),
            "MIDDLE" => Some(Self::Middle),
            "BOTTOM" => Some(Self::Bottom),
            "UTILITY" => Some(Self::Support),
            _ => None,
        }
    }

    pub const fn domain(self) -> domain::Role {
        match self {
            Self::Top => domain::Role::Top,
            Self::Jungle => domain::Role::Jungle,
            Self::Middle => domain::Role::Middle,
            Self::Bottom => domain::Role::Bottom,
            Self::Support => domain::Role::Support,
        }
    }

    pub const fn draft(self) -> stats::draft::Role {
        match self {
            Self::Top => stats::draft::Role::Top,
            Self::Jungle => stats::draft::Role::Jungle,
            Self::Middle => stats::draft::Role::Middle,
            Self::Bottom => stats::draft::Role::Bottom,
            Self::Support => stats::draft::Role::Support,
        }
    }
}

/// A full rune page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RunePage {
    pub primary: u32,
    pub sub: u32,
    /// Keystone first.
    pub perks: [u32; 4],
    pub sub_perks: [u32; 2],
    /// Offense, flex, defense.
    pub shards: [u32; 3],
}

impl RunePage {
    pub const fn keystone(&self) -> u32 {
        self.perks[0]
    }

    /// `[primary, sub, 4 perks, 2 sub perks, 3 shards]` (the published `ids`).
    pub fn ids(&self) -> Vec<u32> {
        let mut ids = vec![self.primary, self.sub];
        ids.extend(self.perks);
        ids.extend(self.sub_perks);
        ids.extend(self.shards);
        ids
    }
}

/// One item bought (net of undos), from the timeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Purchase {
    /// Milliseconds since the game started.
    pub t: u32,
    pub item: u32,
}

/// One participant, anonymous.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PlayerFacts {
    /// 0 = blue (100), 1 = red (200).
    pub team: u8,
    pub win: bool,
    pub champion: u16,
    /// `None` in ARAM.
    pub role: Option<Lane>,
    /// Lower id first.
    pub spells: [u16; 2],
    pub runes: Option<RunePage>,
    /// Ability slots (1 = Q … 4 = R) in level-up order; empty without a timeline.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<u8>,
    /// Items bought in order; empty without a timeline.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub purchases: Vec<Purchase>,
}

/// What the aggregates need from one game.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GameFacts {
    pub id: String,
    pub patch: Patch,
    pub queue: u16,
    /// Champions banned (each once, even when both teams banned it).
    pub bans: Vec<u16>,
    pub players: Vec<PlayerFacts>,
    /// Skills and purchases are known (a timeline was read).
    pub timeline: bool,
}

/// Why a game is not counted.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Skip {
    #[error("queue {0} is not aggregated")]
    Queue(u64),
    #[error("remake (shorter than 5 minutes or early surrender)")]
    Remake,
    #[error("missing or malformed {0}")]
    Malformed(&'static str),
    #[error("roles are not one of each per team")]
    Roles,
}

fn u64_at(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}

fn u32_at(v: &Value, key: &str) -> Option<u32> {
    u64_at(v, key).and_then(|n| u32::try_from(n).ok())
}

fn u16_at(v: &Value, key: &str) -> Option<u16> {
    u64_at(v, key).and_then(|n| u16::try_from(n).ok())
}

fn rune_page(p: &Value) -> Option<RunePage> {
    let perks = p.get("perks")?;
    let styles = perks.get("styles")?.as_array()?;
    let style = |desc: &str| {
        styles
            .iter()
            .find(|s| s.get("description").and_then(Value::as_str) == Some(desc))
    };
    let selections = |s: &Value| -> Option<Vec<u32>> {
        s.get("selections")?
            .as_array()?
            .iter()
            .map(|sel| u32_at(sel, "perk"))
            .collect()
    };
    let primary = style("primaryStyle")?;
    let sub = style("subStyle")?;
    let main: [u32; 4] = selections(primary)?.try_into().ok()?;
    let second: [u32; 2] = selections(sub)?.try_into().ok()?;
    let stat = perks.get("statPerks")?;
    Some(RunePage {
        primary: u32_at(primary, "style")?,
        sub: u32_at(sub, "style")?,
        perks: main,
        sub_perks: second,
        shards: [
            u32_at(stat, "offense")?,
            u32_at(stat, "flex")?,
            u32_at(stat, "defense")?,
        ],
    })
}

/// Skill level-ups and net purchases per participant id, from a Match-V5 timeline.
fn timeline_events(timeline: &Value) -> Events {
    let mut out: Events = HashMap::new();
    let frames = timeline
        .pointer("/info/frames")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    for event in frames
        .iter()
        .filter_map(|f| f.get("events").and_then(Value::as_array))
        .flatten()
    {
        let Some(pid) = u64_at(event, "participantId") else {
            continue;
        };
        let t = u32_at(event, "timestamp").unwrap_or(u32::MAX);
        let entry = out.entry(pid).or_default();
        match event.get("type").and_then(Value::as_str) {
            Some("SKILL_LEVEL_UP")
                if event.get("levelUpType").and_then(Value::as_str) != Some("EVOLVE") =>
            {
                if let Some(slot) = u64_at(event, "skillSlot")
                    .and_then(|s| u8::try_from(s).ok())
                    .filter(|s| (1..=4).contains(s))
                {
                    entry.0.push(slot);
                }
            }
            Some("ITEM_PURCHASED") => {
                if let Some(item) = u32_at(event, "itemId").filter(|&i| i > 0) {
                    entry.1.push(Purchase { t, item });
                }
            }
            // An undone purchase: `beforeId` = the item, `afterId` = 0.
            Some("ITEM_UNDO") => {
                let before = u32_at(event, "beforeId").unwrap_or(0);
                if before > 0
                    && u32_at(event, "afterId").unwrap_or(0) == 0
                    && let Some(i) = entry.1.iter().rposition(|p| p.item == before)
                {
                    entry.1.remove(i);
                }
            }
            _ => {}
        }
    }
    out
}

/// Per-timeline-participant skills and purchases.
type Events = HashMap<u64, (Vec<u8>, Vec<Purchase>)>;

fn player(
    p: &Value,
    queue: u16,
    events: &Events,
    timeline_ids: &HashMap<&str, u64>,
) -> Result<PlayerFacts, Skip> {
    let team = match u64_at(p, "teamId") {
        Some(100) => 0,
        Some(200) => 1,
        _ => return Err(Skip::Malformed("teamId")),
    };
    let role = if queue == RANKED_SOLO {
        let position = p.get("teamPosition").and_then(Value::as_str).unwrap_or("");
        Some(Lane::from_team_position(position).ok_or(Skip::Roles)?)
    } else {
        None
    };
    let s1 = u16_at(p, "summoner1Id").unwrap_or(0);
    let s2 = u16_at(p, "summoner2Id").unwrap_or(0);
    // Timeline participant ids map to match participants through the PUUID when present.
    let pid = p
        .get("puuid")
        .and_then(Value::as_str)
        .and_then(|puuid| timeline_ids.get(puuid).copied())
        .or_else(|| u64_at(p, "participantId"));
    let (skills, purchases) = pid
        .and_then(|pid| events.get(&pid).cloned())
        .unwrap_or_default();
    Ok(PlayerFacts {
        team,
        win: p
            .get("win")
            .and_then(Value::as_bool)
            .ok_or(Skip::Malformed("win"))?,
        champion: u16_at(p, "championId")
            .filter(|&c| c > 0)
            .ok_or(Skip::Malformed("championId"))?,
        role,
        spells: [s1.min(s2), s1.max(s2)],
        runes: rune_page(p),
        skills,
        purchases,
    })
}

/// Five players per team and, in ranked, one of each role.
fn check_teams(players: &[PlayerFacts], queue: u16) -> Result<(), Skip> {
    if players.iter().filter(|p| p.team == 0).count() != 5 {
        return Err(Skip::Malformed("teams"));
    }
    if queue == RANKED_SOLO {
        for team in 0..2 {
            let mut seen = [false; 5];
            for p in players.iter().filter(|p| p.team == team) {
                let i = p.role.map_or(0, |r| r as usize);
                if std::mem::replace(&mut seen[i], true) {
                    return Err(Skip::Roles);
                }
            }
        }
    }
    Ok(())
}

/// Banned champions, each once.
fn bans(info: &Value) -> Vec<u16> {
    let mut bans: Vec<u16> = info
        .get("teams")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter_map(|t| t.get("bans").and_then(Value::as_array))
        .flatten()
        .filter_map(|b| u16_at(b, "championId"))
        .filter(|&c| c > 0)
        .collect();
    bans.sort_unstable();
    bans.dedup();
    bans
}

/// Extracts the facts of one Match-V5 game (`/lol/match/v5/matches/{id}`), with skills and
/// purchases when its timeline (`…/timeline`) is given.
pub fn extract(game: &Value, timeline: Option<&Value>) -> Result<GameFacts, Skip> {
    let info = game.get("info").ok_or(Skip::Malformed("info"))?;
    let id = game
        .pointer("/metadata/matchId")
        .and_then(Value::as_str)
        .ok_or(Skip::Malformed("matchId"))?
        .to_owned();
    let queue_raw = u64_at(info, "queueId").ok_or(Skip::Malformed("queueId"))?;
    let queue = u16::try_from(queue_raw)
        .ok()
        .filter(|q| matches!(*q, RANKED_SOLO | ARAM))
        .ok_or(Skip::Queue(queue_raw))?;
    let patch = info
        .get("gameVersion")
        .and_then(Value::as_str)
        .and_then(Patch::from_game_version)
        .ok_or(Skip::Malformed("gameVersion"))?;
    let duration = u64_at(info, "gameDuration").ok_or(Skip::Malformed("gameDuration"))?;
    let participants = info
        .get("participants")
        .and_then(Value::as_array)
        .filter(|ps| ps.len() == 10)
        .ok_or(Skip::Malformed("participants"))?;
    let early_surrender = participants.iter().any(|p| {
        p.get("gameEndedInEarlySurrender")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    });
    if duration < REMAKE_SECONDS || early_surrender {
        return Err(Skip::Remake);
    }

    let events = timeline.map(timeline_events).unwrap_or_default();
    let timeline_ids: HashMap<&str, u64> = timeline
        .and_then(|t| t.pointer("/info/participants"))
        .and_then(Value::as_array)
        .map(|ps| {
            ps.iter()
                .filter_map(|p| Some((p.get("puuid")?.as_str()?, u64_at(p, "participantId")?)))
                .collect()
        })
        .unwrap_or_default();

    let players = participants
        .iter()
        .map(|p| player(p, queue, &events, &timeline_ids))
        .collect::<Result<Vec<_>, _>>()?;
    check_teams(&players, queue)?;
    let bans = bans(info);

    Ok(GameFacts {
        id,
        patch,
        queue,
        bans,
        players,
        timeline: timeline.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_patches_from_game_versions() {
        assert_eq!(
            Patch::from_game_version("16.19.712.1234"),
            Some(Patch {
                major: 16,
                minor: 19
            })
        );
        assert_eq!(
            Patch::from_game_version("15.1.2"),
            Some(Patch {
                major: 15,
                minor: 1
            })
        );
        assert_eq!(Patch::from_game_version("16"), None);
        assert_eq!(Patch::from_game_version("x.y"), None);
        let p: Patch = "16.19".parse().expect("valid");
        assert_eq!(p.to_string(), "16.19");
        assert_eq!(p.public_name(), "26.19");
        assert_eq!(p.previous().to_string(), "16.18");
        assert_eq!(
            Patch {
                major: 16,
                minor: 1
            }
            .previous()
            .to_string(),
            "15.24"
        );
    }

    #[test]
    fn brackets_are_cumulative() {
        use domain::Bracket;
        assert!(SeedBracket::Emerald.within(Bracket::EmeraldPlus));
        assert!(!SeedBracket::Emerald.within(Bracket::DiamondPlus));
        assert!(SeedBracket::Master.within(Bracket::DiamondPlus));
        assert!(!SeedBracket::Diamond.within(Bracket::MasterPlus));
        assert_eq!(SeedBracket::from_id("master"), Some(SeedBracket::Master));
    }
}
