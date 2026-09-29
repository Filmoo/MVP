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
