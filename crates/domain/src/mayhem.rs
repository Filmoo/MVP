//! ARAM: Mayhem (queue 2400, game mode `KIWI`, Howling Abyss): its augments, the owner's
//! editorial tiers, and how often players pick each augment in the games players chose to share.
//!
//! **No win rates, by design**: Riot refuses Mayhem games on the public match API (so that
//! aggregators don't "solve" the mode) and its policy forbids augment win rates. The shared
//! games carry champions, augments and final items only: no wins, no names, no ids of players.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::LocalizedText;

/// ARAM: Mayhem from matchmaking.
pub const MAYHEM_QUEUE: u32 = 2400;
/// ARAM: Mayhem in a custom game.
pub const MAYHEM_CUSTOM_QUEUE: u32 = 3270;
/// The client's game mode for ARAM: Mayhem.
pub const MAYHEM_GAME_MODE: &str = "KIWI";

/// A queue of ARAM: Mayhem (matchmade or custom).
pub const fn is_mayhem_queue(queue: u32) -> bool {
    matches!(queue, MAYHEM_QUEUE | MAYHEM_CUSTOM_QUEUE)
}

/// An augment's rarity. Each offer in Mayhem is of one rarity: the player compares the augments
/// of that column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AugmentRarity {
    Silver,
    Gold,
    Prismatic,
}

impl AugmentRarity {
    pub const ALL: [Self; 3] = [Self::Silver, Self::Gold, Self::Prismatic];
}

/// `GET /v1/mayhem/augments`: the augments of the Mayhem pool, as our server builds them from
/// the game's files (`CommunityDragon`'s mirror) once per game version, in English and French.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AugmentCatalog {
    /// The mirrored game version it was built from (`16.19.8217343+branch.releases-16-19…`).
    pub version: String,
    /// Game-version patch, e.g. `16.19`.
    pub patch: String,
    /// Unix epoch milliseconds.
    #[ts(type = "number")]
    pub built_at: i64,
    /// What the builder made of the files (`static_data::mayhem::REVISION`): an older one is
    /// built again, even of the same game version.
    #[serde(default)]
    pub revision: u32,
    /// By id.
    pub augments: Vec<CatalogAugment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CatalogAugment {
    /// As in the client's match history (`playerAugment1`…).
    pub id: u32,
    pub rarity: AugmentRarity,
    /// The icon's path in the client's files, under `CommunityDragon`'s
    /// `plugins/rcp-be-lol-game-data/global/default/` (a white glyph, drawn on a rarity tile).
    pub icon: String,
    pub name: LocalizedText,
    /// The game's short description, plain text (line breaks kept); empty when it couldn't be
    /// read. Values the game computes in play read "some"; "your ability" is the champion's
    /// ability an augment changes (the game names it in play).
    pub description: LocalizedText,
}

/// One augment as the UI shows it, in its language (`mayhem_augments`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AugmentInfo {
    pub id: u32,
    pub rarity: AugmentRarity,
    pub name: String,
    /// Plain text with line breaks; may be empty.
    pub description: String,
    /// Full URL of the icon (`CommunityDragon`, allowed by the app's CSP).
    pub icon: String,
}

/// The catalog in the UI's language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemAugments {
    /// Game-version patch, e.g. `16.19`.
    pub patch: String,
    pub augments: Vec<AugmentInfo>,
}

/// An editorial tier, best first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AugmentTier {
    S,
    A,
    B,
    C,
}

impl AugmentTier {
    pub const ALL: [Self; 4] = [Self::S, Self::A, Self::B, Self::C];
}

/// `GET /v1/mayhem/tiers`: augment tiers made by hand by MVP's owner (the file
/// `mayhem-tiers.json` on our server). Inside a tier the order is the rank: first is best.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemTiers {
    /// The patch the tiers were made for, as the owner writes it (`26.19`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub patch: Option<String>,
    /// When they were last edited (`2026-09-28`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub tiers: TierLists,
    /// A word from the owner shown with the tiers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notes: Option<LocalizedText>,
}

impl MayhemTiers {
    /// Where `augment` stands: its tier and its rank in it (1 = best).
    pub fn of(&self, augment: u32) -> Option<(AugmentTier, u32)> {
        AugmentTier::ALL.into_iter().find_map(|tier| {
            let at = self.tiers.get(tier).iter().position(|&id| id == augment)?;
            Some((tier, u32::try_from(at + 1).unwrap_or(u32::MAX)))
        })
    }

    /// No augment is tiered yet.
    pub fn is_empty(&self) -> bool {
        AugmentTier::ALL
            .into_iter()
            .all(|tier| self.tiers.get(tier).is_empty())
    }
}

/// Augment ids per tier, in rank order (first = best).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TierLists {
    #[serde(rename = "S", default)]
    pub s: Vec<u32>,
    #[serde(rename = "A", default)]
    pub a: Vec<u32>,
    #[serde(rename = "B", default)]
    pub b: Vec<u32>,
    #[serde(rename = "C", default)]
    pub c: Vec<u32>,
}

impl TierLists {
    pub fn get(&self, tier: AugmentTier) -> &[u32] {
        match tier {
            AugmentTier::S => &self.s,
            AugmentTier::A => &self.a,
            AugmentTier::B => &self.b,
            AugmentTier::C => &self.c,
        }
    }
}

/// `POST /v1/mayhem/games` (opt-in: Settings → "Help build Mayhem stats"): anonymous facts of
/// the player's own Mayhem games, read from their League client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemUpload {
    /// Platform id of the games, e.g. `EUW1`.
    pub platform: String,
    pub games: Vec<MayhemGame>,
}

/// One game: what each of its players took, nothing about who they are or who won.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemGame {
    /// One-way hash of the platform and game id (64 hex digits): the same game shared by two
    /// players counts once. Not the game id itself.
    pub game: String,
    /// Game-version patch, e.g. `16.19`.
    pub patch: String,
    /// Every player of the game, in no particular order (the sharer isn't marked).
    pub players: Vec<MayhemPlayer>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemPlayer {
    pub champion: u32,
    /// Augments taken, in the order taken.
    pub augments: Vec<u32>,
    /// Items held at the end of the game (the trinket left out).
    pub items: Vec<u32>,
}

/// The server's answer to an upload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemUploadAnswer {
    /// Games counted now.
    pub accepted: u32,
    /// Games already counted (shared before, by this player or another one).
    pub duplicates: u32,
}

/// How many times something was picked (an augment) or held (an item).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PickCount {
    pub id: u32,
    pub n: u32,
}

/// `GET /v1/mayhem/stats`: popularity in the shared games of one patch. Pick counts only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemStats {
    /// Game-version patch, e.g. `16.19`.
    pub patch: String,
    /// Games counted (each once, whoever shared it).
    pub games: u32,
    /// Champion games: every player of every game.
    pub players: u32,
    /// Unix epoch milliseconds.
    #[ts(type = "number")]
    pub updated_at: i64,
    /// Champion games each augment was taken in, most first.
    pub augments: Vec<PickCount>,
    /// By champion id.
    pub champions: Vec<MayhemChampionStats>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemChampionStats {
    pub id: u32,
    /// Games of this champion.
    pub g: u32,
    /// Its games with each augment, most first.
    pub augments: Vec<PickCount>,
    /// Its games ending with each item, most first (the most common ones only).
    pub items: Vec<PickCount>,
}

/// What the Mayhem page shows besides the augments (`mayhem_overview`). A part that isn't
/// published yet (or can't be had offline) is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemOverview {
    pub tiers: Option<MayhemTiers>,
    pub popularity: Option<MayhemPopularity>,
    pub progress: MayhemProgress,
}

/// How far the shared games of the current patch are from switching each feature on (nothing
/// shared yet: zeros). Below it the views show how far, never the numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemProgress {
    /// Shared games, and how many the pick rates over all champions need (the Mayhem page).
    pub games: u32,
    pub games_needed: u32,
    /// Champions with enough shared games for their own pick rates, most picked augments and
    /// common items, and how many games each needs.
    pub champions_ready: u32,
    pub champion_games_needed: u32,
}

/// Every augment's pick count over all champions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemPopularity {
    pub patch: String,
    pub games: u32,
    /// Champion games (the pick rate's denominator).
    pub players: u32,
    /// Unix epoch milliseconds.
    #[ts(type = "number")]
    pub updated_at: i64,
    pub augments: Vec<PickCount>,
}

/// One champion in Mayhem (`mayhem_champion`): the augments and items its players pick, and the
/// augments ranked for it per rarity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MayhemChampion {
    pub champion_id: u32,
    /// Patch of the shared games (`None` without any).
    pub patch: Option<String>,
    /// Its shared games.
    pub games: u32,
    /// Games needed before its pick rates count as the second signal (fewer: the tiers alone).
    pub min_games: u32,
    /// Its most picked augments, most first.
    pub augments: Vec<PickCount>,
    /// Its most common final items, most first.
    pub items: Vec<PickCount>,
    /// One ranked list per rarity (silver, gold, prismatic): several options with their reasons,
    /// never a single "pick this".
    pub priorities: Vec<AugmentPriorities>,
    /// Whether the editorial tiers are published (else the order is popularity alone).
    pub tiered: bool,
}

/// The augments of one rarity, in order: tier, then the owner's rank, then (untiered) picks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AugmentPriorities {
    pub rarity: AugmentRarity,
    /// Whether the champion's pick rates are the second signal (enough games): shown with every
    /// entry, and ordering the untiered augments after the tiered ones. Else the tiers alone.
    /// The owner's tier and rank always come first.
    pub by_pick_rate: bool,
    pub entries: Vec<AugmentPriority>,
}

/// One augment in a ranked list, with its reasons.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AugmentPriority {
    pub id: u32,
    /// Its editorial tier and rank in it (1 = best), when tiered.
    pub tier: Option<AugmentTier>,
    pub rank: Option<u32>,
    /// The champion's games with it.
    pub picks: u32,
    /// Share of the champion's games with it (0–1), once it has enough games.
    pub pick_rate: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiers_on_the_wire_are_upper_case_keys_in_rank_order() {
        let tiers: MayhemTiers = serde_json::from_str(
            r#"{"patch":"26.19","updatedAt":"2026-09-28","tiers":{"S":[2137,1344],"A":[1028],"B":[],"C":[]}}"#,
        )
        .expect("parses");
        assert_eq!(tiers.of(1344), Some((AugmentTier::S, 2)));
        assert_eq!(tiers.of(1028), Some((AugmentTier::A, 1)));
        assert_eq!(tiers.of(9), None);
        assert!(!tiers.is_empty());
        let json = serde_json::to_string(&tiers.tiers).expect("serializes");
        assert_eq!(json, r#"{"S":[2137,1344],"A":[1028],"B":[],"C":[]}"#);
        assert!(MayhemTiers::default().is_empty());
        let bare: MayhemTiers = serde_json::from_str(r#"{"tiers":{"S":[1]}}"#).expect("parses");
        assert_eq!(bare.tiers.a, Vec::<u32>::new());
    }

    #[test]
    fn rarities_and_queues() {
        assert_eq!(
            serde_json::to_string(&AugmentRarity::Prismatic).expect("serializes"),
            r#""prismatic""#
        );
        assert!(is_mayhem_queue(2400) && is_mayhem_queue(3270));
        assert!(!is_mayhem_queue(450));
        assert!(AugmentRarity::Silver < AugmentRarity::Prismatic);
    }

    #[test]
    fn uploads_carry_no_wins_nor_names() {
        let game = MayhemGame {
            game: "a".repeat(64),
            patch: "16.19".into(),
            players: vec![MayhemPlayer {
                champion: 103,
                augments: vec![2137, 1028],
                items: vec![6655],
            }],
        };
        let json = serde_json::to_string(&game).expect("serializes");
        assert_eq!(
            json,
            format!(
                r#"{{"game":"{}","patch":"16.19","players":[{{"champion":103,"augments":[2137,1028],"items":[6655]}}]}}"#,
                "a".repeat(64)
            )
        );
        for word in ["win", "puuid", "name", "summoner"] {
            assert!(!json.to_lowercase().contains(word), "{word} in {json}");
        }
    }
}
