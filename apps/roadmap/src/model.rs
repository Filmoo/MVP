//! The roadmap's data as the API shows it: versions, areas, features and what hangs off them.
//! JSON is camelCase; times are RFC 3339 in UTC; dates (a version's target, its release) are
//! `YYYY-MM-DD`.

use serde::{Deserialize, Serialize, Serializer};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

/// Where a feature stands. Removal isn't a status: it is a soft delete (`removedAt`), undone by
/// a restore.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Proposed,
    Accepted,
    InProgress,
    Done,
    Rejected,
}

impl Status {
    pub const ALL: [Self; 5] = [
        Self::Proposed,
        Self::Accepted,
        Self::InProgress,
        Self::Done,
        Self::Rejected,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Accepted => "accepted",
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::Rejected => "rejected",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|status| status.as_str() == s)
    }

    /// As people read it in the audit log.
    pub fn label(self) -> &'static str {
        match self {
            Self::Proposed => "Proposed",
            Self::Accepted => "Accepted",
            Self::InProgress => "In progress",
            Self::Done => "Done",
            Self::Rejected => "Rejected",
        }
    }

    /// Work the owner agreed to. Claude moves these between accepted, in progress and done;
    /// proposals and rejections are the owner's.
    pub fn is_planned(self) -> bool {
        matches!(self, Self::Accepted | Self::InProgress | Self::Done)
    }
}

/// Who suggested a feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Proposer {
    Owner,
    Claude,
}

impl Proposer {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Claude => "claude",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(Self::Owner),
            "claude" => Some(Self::Claude),
            _ => None,
        }
    }
}

/// Who did something.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorKind {
    /// A GitHub admin of the repository, signed in (named by login).
    Owner,
    /// Claude, with a machine token (named by the token's name).
    Claude,
    /// The server itself or its command line (seed, tokens).
    System,
    /// Someone who tried to sign in and isn't an admin (named by GitHub login).
    Visitor,
}

impl ActorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Claude => "claude",
            Self::System => "system",
            Self::Visitor => "visitor",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "owner" => Self::Owner,
            "claude" => Self::Claude,
            "visitor" => Self::Visitor,
            _ => Self::System,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    pub kind: ActorKind,
    pub name: String,
}

impl Actor {
    pub fn owner(login: &str) -> Self {
        Self {
            kind: ActorKind::Owner,
            name: login.to_owned(),
        }
    }

    pub fn claude(token_name: &str) -> Self {
        Self {
            kind: ActorKind::Claude,
            name: token_name.to_owned(),
        }
    }

    pub fn system(name: &str) -> Self {
        Self {
            kind: ActorKind::System,
            name: name.to_owned(),
        }
    }

    /// Whether this actor has the owner's rights (the owner, or the server's own command line).
    pub fn is_owner(&self) -> bool {
        matches!(self.kind, ActorKind::Owner | ActorKind::System)
    }

    /// Who a feature this actor creates is "proposed by".
    pub fn proposer(&self) -> Proposer {
        if self.kind == ActorKind::Claude {
            Proposer::Claude
        } else {
            Proposer::Owner
        }
    }
}

/// Seconds since the Unix epoch, shown as RFC 3339 (`2026-09-29T10:00:00Z`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Timestamp(pub i64);

impl Timestamp {
    pub fn rfc3339(self) -> String {
        OffsetDateTime::from_unix_timestamp(self.0)
            .unwrap_or(OffsetDateTime::UNIX_EPOCH)
            .format(&Rfc3339)
            .unwrap_or_default()
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.rfc3339())
    }
}

/// Area colours are design tokens of the app (`ui/src/design/tokens.css`), by name: the UI
/// paints an area with `var(--<color>)`. None of them is a status colour (the accent is in
/// progress, `win` accepted, `good` done, `loss` rejected), so a dot's colour never reads as a
/// status. New areas take the first colour not in use.
pub const AREA_COLORS: [&str; 14] = [
    "rank-master",
    "rank-diamond",
    "rank-platinum",
    "role-support",
    "warn",
    "role-top",
    "rank-silver",
    "rank-bronze",
    "rank-iron",
    "rank-grandmaster",
    "rank-gold",
    "rank-emerald",
    "rank-challenger",
    "tier-c",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub key: String,
    pub name: String,
    pub color: String,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: i64,
    pub name: String,
    pub goal: String,
    pub target_date: Option<String>,
    pub released_on: Option<String>,
    pub position: i64,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub id: i64,
    pub url: String,
    pub label: String,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    pub id: i64,
    pub title: String,
    /// Markdown.
    pub description: String,
    pub version_id: i64,
    pub status: Status,
    /// An area's key.
    pub area: String,
    pub proposed_by: Proposer,
    /// Order within its version (0 first).
    pub position: i64,
    pub links: Vec<Link>,
    /// How many comments it has (the comments come with the feature's detail).
    pub comments: i64,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    /// First time it went in progress.
    pub started_at: Option<Timestamp>,
    /// When it was done (cleared when it leaves done).
    pub done_at: Option<Timestamp>,
    /// Set while removed (soft delete); a restore clears it.
    pub removed_at: Option<Timestamp>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: i64,
    pub feature_id: i64,
    pub author: Actor,
    /// Markdown.
    pub body: String,
    pub created_at: Timestamp,
}

/// One line of the audit log: who did what, when.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: i64,
    pub at: Timestamp,
    pub actor: Actor,
    /// `feature.create`, `feature.status`, `auth.sign_in`… (see `store::Action`).
    pub action: String,
    pub feature_id: Option<i64>,
    pub version_id: Option<i64>,
    /// One line for people ("“Settings search”: Accepted → In progress").
    pub summary: String,
    /// What changed, for the record (fields before and after).
    pub detail: serde_json::Value,
}

/// Everything the board needs at once (removed features included, flagged).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Roadmap {
    pub versions: Vec<Version>,
    pub areas: Vec<Area>,
    pub features: Vec<Feature>,
}

/// A feature with its conversation and history.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureDetail {
    pub feature: Feature,
    pub comments: Vec<Comment>,
    pub activity: Vec<AuditEntry>,
}

/// Where a feature sits after a move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub id: i64,
    pub version_id: i64,
    pub position: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_round_trip_through_their_names() {
        for status in Status::ALL {
            assert_eq!(Status::parse(status.as_str()), Some(status));
            let json = serde_json::to_string(&status).unwrap_or_default();
            assert_eq!(json, format!("\"{}\"", status.as_str()));
        }
        assert_eq!(Status::parse("removed"), None);
    }

    #[test]
    fn timestamps_read_as_rfc3339() {
        assert_eq!(Timestamp(0).rfc3339(), "1970-01-01T00:00:00Z");
        assert_eq!(Timestamp(1_790_000_000).rfc3339(), "2026-09-21T14:13:20Z");
    }

    #[test]
    fn only_the_owner_and_the_system_have_the_owners_rights() {
        assert!(Actor::owner("Filmoo").is_owner());
        assert!(Actor::system("seed").is_owner());
        assert!(!Actor::claude("claude").is_owner());
        assert_eq!(Actor::claude("claude").proposer(), Proposer::Claude);
    }
}
