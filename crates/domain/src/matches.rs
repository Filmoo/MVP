use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{RiotId, Role};

/// MVP's grade of one player's game, computed after the game from all ten players' stats
/// (`stats::grade`): how they did against the other nine and their lane opponent, weighted by
/// role. It rates one game, never a player: no MMR, no rank estimate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchGrade {
    /// 0–10, one decimal; 5 is an even game for the role.
    pub score: f64,
    pub letter: GradeLetter,
    /// Place in the game by score, 1 = best of the ten.
    pub place: u32,
    /// Best of the winning team (MVP) or of the losing team (ACE).
    pub badge: Option<GradeBadge>,
    /// The two or three parts that moved the score most, largest first: facts the player can
    /// check on the scoreboard (the UI words them).
    pub factors: Vec<GradeFactor>,
}

/// Letters from the score: S+ ≥ 8.5, S ≥ 7.5, A ≥ 6, B ≥ 4, C below.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum GradeLetter {
    #[serde(rename = "S+")]
    SPlus,
    S,
    A,
    B,
    C,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum GradeBadge {
    /// The best grade of the winning team.
    Mvp,
    /// The best grade of the losing team.
    Ace,
}

/// One part of a grade: a fact of the game and what it did to the score.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GradeFactor {
    pub kind: GradeFactorKind,
    /// The fact, in the kind's unit: a share of the team's total (0–1) for kill participation
    /// and the `…Share` kinds, the KDA ratio (kills + assists over deaths, at least one death)
    /// for `kda`, a difference with the lane opponent for `csLead` (creeps) and `goldLead`.
    pub value: f64,
    /// Points it added to (or took from) the score, on the 0–10 scale.
    pub points: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum GradeFactorKind {
    KillParticipation,
    Kda,
    /// Damage to champions.
    DamageShare,
    /// Damage taken plus damage self-mitigated.
    DamageTakenShare,
    /// Damage to buildings and epic monsters.
    ObjectiveShare,
    VisionShare,
    CsLead,
    GoldLead,
}

/// A grade answered for one match of the list (`match_grades`): `None` when the game has none
/// (a remake, a mode without two teams of five) or couldn't be read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GradedMatch {
    pub match_id: String,
    pub grade: Option<MatchGrade>,
    /// The role the player played there, as worked out from the whole game (the list only
    /// guesses it): the row follows it. `None` when the game wasn't read or has no roles.
    pub role: Option<Role>,
}

/// One finished game in full, for the match details view (`match_details`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchDetails {
    pub match_id: String,
    /// Queue id (420 = ranked solo/duo, 450 = ARAM…).
    pub queue_id: u32,
    pub duration_seconds: u32,
    /// Game end, Unix epoch milliseconds.
    #[ts(type = "number")]
    pub ended_at: i64,
    /// Both teams, blue side (100) first.
    pub teams: Vec<MatchTeam>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchTeam {
    /// Riot's team id: 100 blue side, 200 red side.
    pub team_id: u32,
    pub win: bool,
    /// Top, jungle, mid, bot, support when the roles are known, else as the game lists them.
    pub players: Vec<MatchPlayer>,
}

/// One player's game, as the post-game scoreboard shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchPlayer {
    /// `None` when the game doesn't name the player: hidden by Riot (streamer mode) or a bot.
    pub riot_id: Option<RiotId>,
    /// Identity hidden by Riot (streamer mode): shown as such, never looked up.
    pub hidden: bool,
    /// The local player (their own games, from the League client).
    pub is_me: bool,
    pub champion_id: u32,
    pub champion_level: u32,
    pub role: Option<Role>,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    /// Lane minions + neutral monsters.
    pub creep_score: u32,
    pub gold: u32,
    pub damage_to_champions: u32,
    pub vision_score: u32,
    /// Final items in slot order, empty slots omitted (the trinket apart).
    pub items: Vec<u32>,
    pub trinket: Option<u32>,
    /// Summoner spell ids (D, F).
    pub spells: Vec<u32>,
    /// Rune ids: the keystone and the secondary tree.
    pub keystone: Option<u32>,
    pub secondary_tree: Option<u32>,
    /// `None` for remakes and modes without two teams of five.
    pub grade: Option<MatchGrade>,
    /// The end-of-game numbers (the opened game's stats table); all `None` from a server that
    /// doesn't send them yet.
    #[serde(default)]
    pub stats: EndOfGameStats,
}

/// One player's end-of-game numbers, as the League client's post-game "Stats" tab lists them.
/// Each is `None` when the source doesn't carry it (the League client's match history may lack
/// the healing and shielding done to teammates): the stats table leaves out a row no player of
/// the game has. Kills, deaths, assists, damage to champions, gold earned and the vision score
/// are the scoreboard's, on [`MatchPlayer`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct EndOfGameStats {
    pub largest_killing_spree: Option<u32>,
    pub largest_multi_kill: Option<u32>,
    /// Got the game's first kill.
    pub first_blood: Option<bool>,
    pub physical_damage_to_champions: Option<u32>,
    pub magic_damage_to_champions: Option<u32>,
    pub true_damage_to_champions: Option<u32>,
    pub damage_to_turrets: Option<u32>,
    /// Damage to buildings and epic monsters.
    pub damage_to_objectives: Option<u32>,
    pub damage_taken: Option<u32>,
    pub damage_self_mitigated: Option<u32>,
    pub healing: Option<u32>,
    pub healing_on_teammates: Option<u32>,
    pub shielding_on_teammates: Option<u32>,
    pub wards_placed: Option<u32>,
    pub wards_destroyed: Option<u32>,
    /// Control wards bought.
    pub control_wards: Option<u32>,
    pub gold_spent: Option<u32>,
    /// Lane minions killed.
    pub minions: Option<u32>,
    /// Neutral monsters killed.
    pub monsters: Option<u32>,
    /// Riot's `timeCCingOthers`: seconds of crowd control on enemy champions.
    pub crowd_control_seconds: Option<u32>,
    pub turrets_destroyed: Option<u32>,
    pub inhibitors_destroyed: Option<u32>,
}

impl EndOfGameStats {
    /// Riot's fields, named alike in a Match-V5 participant and in the League client's
    /// `participants[].stats`: `number(key)` and `flag(key)` look one up (`None` when absent).
    pub fn read(number: impl Fn(&str) -> Option<u32>, flag: impl Fn(&str) -> Option<bool>) -> Self {
        Self {
            largest_killing_spree: number("largestKillingSpree"),
            largest_multi_kill: number("largestMultiKill"),
            first_blood: flag("firstBloodKill"),
            physical_damage_to_champions: number("physicalDamageDealtToChampions"),
            magic_damage_to_champions: number("magicDamageDealtToChampions"),
            true_damage_to_champions: number("trueDamageDealtToChampions"),
            damage_to_turrets: number("damageDealtToTurrets"),
            damage_to_objectives: number("damageDealtToObjectives"),
            damage_taken: number("totalDamageTaken"),
            damage_self_mitigated: number("damageSelfMitigated"),
            healing: number("totalHeal"),
            healing_on_teammates: number("totalHealsOnTeammates"),
            shielding_on_teammates: number("totalDamageShieldedOnTeammates"),
            wards_placed: number("wardsPlaced"),
            wards_destroyed: number("wardsKilled"),
            control_wards: number("visionWardsBoughtInGame"),
            gold_spent: number("goldSpent"),
            minions: number("totalMinionsKilled"),
            monsters: number("neutralMinionsKilled"),
            crowd_control_seconds: number("timeCCingOthers"),
            turrets_destroyed: number("turretKills"),
            inhibitors_destroyed: number("inhibitorKills"),
        }
    }
}

impl MatchTeam {
    /// Groups a game's players by team (blue side first), each team in lane order (top to
    /// support, players without a role last, in the order given).
    pub fn group(players: impl IntoIterator<Item = (u32, bool, MatchPlayer)>) -> Vec<Self> {
        let mut teams: Vec<Self> = Vec::new();
        for (team_id, win, player) in players {
            if let Some(team) = teams.iter_mut().find(|t| t.team_id == team_id) {
                team.players.push(player);
            } else {
                teams.push(Self {
                    team_id,
                    win,
                    players: vec![player],
                });
            }
        }
        teams.sort_by_key(|t| t.team_id);
        for team in &mut teams {
            team.players.sort_by_key(|p| match p.role {
                Some(Role::Top) => 0,
                Some(Role::Jungle) => 1,
                Some(Role::Middle) => 2,
                Some(Role::Bottom) => 3,
                Some(Role::Support) => 4,
                None => 5,
            });
        }
        teams
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(value: &impl Serialize) -> String {
        serde_json::to_string(value).expect("serializable")
    }

    #[test]
    fn end_of_game_stats_read_riots_names_and_default_when_absent() {
        let stats = EndOfGameStats::read(
            |key| match key {
                "largestMultiKill" => Some(3),
                "timeCCingOthers" => Some(42),
                "visionWardsBoughtInGame" => Some(4),
                _ => None,
            },
            |key| (key == "firstBloodKill").then_some(true),
        );
        assert_eq!(stats.largest_multi_kill, Some(3));
        assert_eq!(stats.crowd_control_seconds, Some(42));
        assert_eq!(stats.control_wards, Some(4));
        assert_eq!(stats.first_blood, Some(true));
        assert_eq!(stats.healing_on_teammates, None);
        let wire = json(&stats);
        assert!(wire.contains(r#""crowdControlSeconds":42"#), "{wire}");
        assert!(wire.contains(r#""healingOnTeammates":null"#), "{wire}");

        // A server that doesn't send them yet: every player's stats are empty, not an error.
        let player: MatchPlayer = serde_json::from_str(
            r#"{ "riotId": null, "hidden": true, "isMe": false, "championId": 1,
                 "championLevel": 12, "role": null, "kills": 1, "deaths": 2, "assists": 3,
                 "creepScore": 100, "gold": 8000, "damageToChampions": 9000, "visionScore": 10,
                 "items": [], "trinket": null, "spells": [4, 14], "keystone": null,
                 "secondaryTree": null, "grade": null }"#,
        )
        .expect("an older server's player");
        assert_eq!(player.stats, EndOfGameStats::default());
    }

    #[test]
    fn letters_and_badges_serialize_as_the_ui_reads_them() {
        assert_eq!(json(&GradeLetter::SPlus), r#""S+""#);
        assert_eq!(json(&GradeLetter::C), r#""C""#);
        assert_eq!(json(&GradeBadge::Mvp), r#""mvp""#);
        assert_eq!(
            json(&GradeFactorKind::DamageTakenShare),
            r#""damageTakenShare""#
        );
    }
}
