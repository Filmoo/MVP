//! Match insights: every player's grade (`stats::grade`) and the match details view.
//!
//! **Your games** come from the League client. Its match list holds only your side of each
//! game; the grade needs the whole game (`/lol-match-history/v1/games/{gameId}`), read once per
//! game, a few at a time, and kept for the session: finished games never change. **Anyone
//! else's games** come from our backend (`GET /v1/matches/{platform}/{matchId}`): the League
//! client is never used to look other players' games up.
//!
//! Names come from the game only: a player the client doesn't name, or marks hidden (streamer
//! mode), stays unnamed. PUUIDs stay in the core: they only find your own row.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};

use domain::{
    BackendError, GradedMatch, MatchDetails, MatchGrade, MatchPlayer, MatchSummary, MatchTeam,
    PlayerProfile, RiotId, Role,
};
use lcu::{LcuClient, LcuError};
use serde_json::Value;
use stats::grade::{Lobby, LobbyPlayer, grade};
use tokio::sync::{OnceCell, Semaphore};
use tokio::task::JoinSet;

use crate::backend::BackendClient;
use crate::profile;

/// One whole game of the local player's history.
pub fn game_path(game_id: u64) -> String {
    format!("/lol-match-history/v1/games/{game_id}")
}

/// Games kept in memory (each a few KB); your listed games are never the ones dropped.
const GAMES_MAX: usize = 100;
/// Whole games read from the League client at once.
const READS_AT_ONCE: usize = 4;

const SMITE: u32 = 11;
const HOWLING_ABYSS: u32 = 12;
const ARAM: u32 = 450;
const ROLES: [Role; 5] = [
    Role::Top,
    Role::Jungle,
    Role::Middle,
    Role::Bottom,
    Role::Support,
];

fn u32_at(v: &Value, key: &str) -> u32 {
    v.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0)
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// The local player, as the client names them: to find their row in their games.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct Me {
    puuid: Option<String>,
    summoner_id: Option<u64>,
}

impl fmt::Debug for Me {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Me")
            .field("puuid", &self.puuid.as_ref().map(|_| "<redacted>"))
            .field("summoner_id", &self.summoner_id.map(|_| "<redacted>"))
            .finish()
    }
}

impl Me {
    /// From `/lol-summoner/v1/current-summoner`.
    pub fn from_summoner(summoner: &Value) -> Self {
        Self {
            puuid: str_at(summoner, "puuid").map(str::to_owned),
            summoner_id: summoner
                .get("summonerId")
                .and_then(Value::as_u64)
                .filter(|&id| id != 0),
        }
    }

    /// `player` (a game's `participantIdentities[].player`) is the local player.
    fn is(&self, player: &Value) -> bool {
        let puuid = str_at(player, "puuid");
        let summoner_id = player.get("summonerId").and_then(Value::as_u64);
        (self.puuid.is_some() && puuid == self.puuid.as_deref())
            || (self.summoner_id.is_some() && summoner_id == self.summoner_id)
    }
}

// ---- The client's whole game → grades and details --------------------------------------------

/// The role the client's timeline suggests (`lane`, `role`); often wrong for the bottom lane.
fn timeline_role(p: &Value) -> Option<Role> {
    let timeline = p.get("timeline");
    let lane = timeline.and_then(|t| str_at(t, "lane"));
    let role = timeline.and_then(|t| str_at(t, "role"));
    match (lane, role) {
        (Some("TOP"), _) => Some(Role::Top),
        (Some("JUNGLE"), _) => Some(Role::Jungle),
        (Some("MIDDLE" | "MID"), _) => Some(Role::Middle),
        (Some("BOTTOM" | "BOT"), Some("SUPPORT" | "DUO_SUPPORT")) => Some(Role::Support),
        (Some("BOTTOM" | "BOT"), _) => Some(Role::Bottom),
        _ => None,
    }
}

fn has_spell(p: &Value, spell: u32) -> bool {
    u32_at(p, "spell1Id") == spell || u32_at(p, "spell2Id") == spell
}

fn lane_minions(p: &Value) -> u32 {
    p.get("stats")
        .map_or(0, |s| u32_at(s, "totalMinionsKilled"))
}

/// Each player's role, fixed up team by team: the one player with Smite jungles, of the bottom
/// pair the one with fewer lane minions supports, a role claimed twice is unknown, and the
/// last role left goes to the last player left. ARAM has none.
fn roles(participants: &[Value], aram: bool) -> Vec<Option<Role>> {
    if aram {
        return vec![None; participants.len()];
    }
    let mut roles: Vec<Option<Role>> = participants.iter().map(timeline_role).collect();
    let teams: HashSet<u32> = participants.iter().map(|p| u32_at(p, "teamId")).collect();
    for team in teams {
        let members: Vec<usize> = (0..participants.len())
            .filter(|&i| u32_at(&participants[i], "teamId") == team)
            .collect();
        settle_team(participants, &members, &mut roles);
    }
    roles
}

fn settle_team(participants: &[Value], members: &[usize], roles: &mut [Option<Role>]) {
    let smiting: Vec<usize> = members
        .iter()
        .copied()
        .filter(|&i| has_spell(&participants[i], SMITE))
        .collect();
    if let [jungler] = smiting[..] {
        for &i in members {
            if roles[i] == Some(Role::Jungle) {
                roles[i] = None;
            }
        }
        roles[jungler] = Some(Role::Jungle);
    }
    let bottom: Vec<usize> = members
        .iter()
        .copied()
        .filter(|&i| matches!(roles[i], Some(Role::Bottom | Role::Support)))
        .collect();
    if let [a, b] = bottom[..] {
        let (support, carry) = if lane_minions(&participants[a]) <= lane_minions(&participants[b]) {
            (a, b)
        } else {
            (b, a)
        };
        roles[support] = Some(Role::Support);
        roles[carry] = Some(Role::Bottom);
    }
    for role in ROLES {
        let holders: Vec<usize> = members
            .iter()
            .copied()
            .filter(|&i| roles[i] == Some(role))
            .collect();
        if holders.len() > 1 {
            for i in holders {
                roles[i] = None;
            }
        }
    }
    let unknown: Vec<usize> = members
        .iter()
        .copied()
        .filter(|&i| roles[i].is_none())
        .collect();
    let free: Vec<Role> = ROLES
        .into_iter()
        .filter(|&role| members.iter().all(|&i| roles[i] != Some(role)))
        .collect();
    if let ([i], [role]) = (&unknown[..], &free[..]) {
        roles[*i] = Some(*role);
    }
}

fn lobby_player(p: &Value, role: Option<Role>) -> LobbyPlayer {
    let stats = p.get("stats").unwrap_or(&Value::Null);
    let at = |key: &str| u32_at(stats, key);
    LobbyPlayer {
        team: u32_at(p, "teamId"),
        win: stats.get("win").and_then(Value::as_bool).unwrap_or(false),
        role,
        champion_id: u32_at(p, "championId"),
        kills: at("kills"),
        deaths: at("deaths"),
        assists: at("assists"),
        creep_score: at("totalMinionsKilled").saturating_add(at("neutralMinionsKilled")),
        gold: at("goldEarned"),
        damage_to_champions: at("totalDamageDealtToChampions"),
        damage_taken: at("totalDamageTaken").saturating_add(at("damageSelfMitigated")),
        vision_score: at("visionScore"),
        objective_damage: at("damageDealtToObjectives"),
    }
}

fn match_player(
    p: &Value,
    lobby: &LobbyPlayer,
    identity: Option<&Value>,
    me: &Me,
    grade: Option<MatchGrade>,
) -> MatchPlayer {
    let stats = p.get("stats").unwrap_or(&Value::Null);
    let nonzero = |v: &Value, key: &str| Some(u32_at(v, key)).filter(|&id| id != 0);
    // Streamer mode: the client may still carry a name; it stays hidden.
    let hidden_by_riot = identity.and_then(|i| str_at(i, "nameVisibilityType")) == Some("HIDDEN");
    let riot_id = identity.filter(|_| !hidden_by_riot).and_then(|player| {
        Some(RiotId {
            game_name: str_at(player, "gameName")?.to_owned(),
            tag_line: str_at(player, "tagLine").unwrap_or_default().to_owned(),
        })
    });
    MatchPlayer {
        hidden: riot_id.is_none(),
        riot_id,
        is_me: identity.is_some_and(|player| me.is(player)),
        champion_id: lobby.champion_id,
        champion_level: u32_at(stats, "champLevel"),
        role: lobby.role,
        kills: lobby.kills,
        deaths: lobby.deaths,
        assists: lobby.assists,
        creep_score: lobby.creep_score,
        gold: lobby.gold,
        damage_to_champions: lobby.damage_to_champions,
        vision_score: lobby.vision_score,
        items: (0..6)
            .filter_map(|i| nonzero(stats, &format!("item{i}")))
            .collect(),
        trinket: nonzero(stats, "item6"),
        spells: [nonzero(p, "spell1Id"), nonzero(p, "spell2Id")]
            .into_iter()
            .flatten()
            .collect(),
        keystone: nonzero(stats, "perk0"),
        secondary_tree: nonzero(stats, "perkSubStyle"),
        grade,
    }
}

/// One of your games as `/lol-match-history/v1/games/{gameId}` answers it: both teams, every
/// player's grade, your row marked. `platform` names the match when the game doesn't say.
pub fn details_from_client(game: &Value, me: &Me, platform: &str) -> Option<MatchDetails> {
    let game_id = game.get("gameId")?.as_u64()?;
    let participants = game.get("participants")?.as_array()?;
    let identities: HashMap<u64, &Value> = game
        .get("participantIdentities")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|i| Some((i.get("participantId")?.as_u64()?, i.get("player")?)))
                .collect()
        })
        .unwrap_or_default();
    let queue_id = u32_at(game, "queueId");
    let duration = u32_at(game, "gameDuration");
    let aram = queue_id == ARAM || u32_at(game, "mapId") == HOWLING_ABYSS;
    let roles = roles(participants, aram);
    let lobby = Lobby {
        duration_seconds: duration,
        players: participants
            .iter()
            .zip(&roles)
            .map(|(p, &role)| lobby_player(p, role))
            .collect(),
    };
    let mut grades = grade(&lobby).map(Vec::into_iter);
    let players = participants.iter().zip(&lobby.players).map(|(p, stats)| {
        let identity = p
            .get("participantId")
            .and_then(Value::as_u64)
            .and_then(|id| identities.get(&id).copied());
        let grade = grades.as_mut().and_then(Iterator::next);
        (
            stats.team,
            stats.win,
            match_player(p, stats, identity, me, grade),
        )
    });
    let teams = MatchTeam::group(players);
    Some(MatchDetails {
        match_id: format!(
            "{}_{game_id}",
            str_at(game, "platformId").unwrap_or(platform)
        ),
        queue_id,
        duration_seconds: duration,
        ended_at: game.get("gameCreation")?.as_i64()? + i64::from(duration) * 1000,
        teams,
    })
}

/// Your grade in one of your games.
fn my_grade(details: &MatchDetails) -> Option<MatchGrade> {
    details
        .teams
        .iter()
        .flat_map(|t| &t.players)
        .find(|p| p.is_me)
        .and_then(|p| p.grade.clone())
}

// ---- Games kept for the session -------------------------------------------------------------

type Slot = Arc<OnceCell<Arc<MatchDetails>>>;

/// Games by match id, bounded (oldest first out, never a game in `keep`).
#[derive(Debug, Default)]
struct Kept {
    slots: HashMap<String, Slot>,
    order: VecDeque<String>,
}

impl Kept {
    fn slot(&mut self, match_id: &str, keep: &HashMap<String, bool>) -> Slot {
        if let Some(slot) = self.slots.get(match_id) {
            return Arc::clone(slot);
        }
        let slot = Slot::default();
        self.slots.insert(match_id.to_owned(), Arc::clone(&slot));
        self.order.push_back(match_id.to_owned());
        let mut spared = 0;
        while self.slots.len() > GAMES_MAX && spared < self.order.len() {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if keep.contains_key(&oldest) || oldest == match_id {
                self.order.push_back(oldest);
                spared += 1;
            } else {
                self.slots.remove(&oldest);
            }
        }
        slot
    }

    fn read(&self, match_id: &str) -> Option<Arc<MatchDetails>> {
        self.slots.get(match_id)?.get().cloned()
    }

    fn clear(&mut self) {
        self.slots.clear();
        self.order.clear();
    }
}

#[derive(Debug, Default)]
struct State {
    me: Me,
    /// The local player's listed games, and whether each is worth reading for a grade.
    listed: HashMap<String, bool>,
    /// Your games, read from the League client.
    own: Kept,
    /// Other players' games, from our backend.
    theirs: Kept,
}

/// Why one of your games couldn't be read from the client.
#[derive(Debug, thiserror::Error)]
enum ReadError {
    #[error(transparent)]
    Client(#[from] LcuError),
    #[error("the League client's game has no players")]
    Unreadable,
    #[error("not a match id: {0}")]
    BadId(String),
}

impl From<ReadError> for BackendError {
    fn from(error: ReadError) -> Self {
        match error {
            ReadError::Client(e) if e.is_not_found() => Self::NotFound,
            ReadError::BadId(_) => Self::NotFound,
            other => Self::Unavailable {
                message: other.to_string(),
            },
        }
    }
}

/// Games read once and kept for the session, shared by the commands (cheap to clone).
#[derive(Debug, Clone, Default)]
pub struct MatchInsights(Arc<Mutex<State>>);

impl MatchInsights {
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The local player's profile from the client; games already read carry their grade
    /// ([`Self::grades`] reads the others).
    pub async fn profile(&self, client: &LcuClient) -> Result<PlayerProfile, LcuError> {
        let read = profile::read_local(client).await?;
        let mut profile = read.profile;
        let mut state = self.state();
        if state.me != read.me {
            // Another account: "your row" is someone else's now.
            state.own.clear();
            state.me = read.me;
        }
        state.listed = read.gradable;
        for m in &mut profile.recent_matches {
            m.grade = state.own.read(&m.match_id).and_then(|d| my_grade(&d));
        }
        Ok(profile)
    }

    /// Your grade in each of `match_ids` (your listed games; anything else answers none),
    /// reading the games not read yet from the client, a few at a time.
    pub async fn grades(&self, client: &LcuClient, match_ids: &[String]) -> Vec<GradedMatch> {
        let permits = Arc::new(Semaphore::new(READS_AT_ONCE));
        let mut reads = JoinSet::new();
        let worth: Vec<bool> = {
            let state = self.state();
            match_ids
                .iter()
                .map(|id| state.listed.get(id).copied().unwrap_or(false))
                .collect()
        };
        for (i, id) in match_ids.iter().enumerate().filter(|&(i, _)| worth[i]) {
            let (this, client, id) = (self.clone(), client.clone(), id.clone());
            let permits = Arc::clone(&permits);
            reads.spawn(async move {
                let _permit = permits.acquire_owned().await;
                (i, this.own_game(&client, &id).await)
            });
        }
        let mut grades: Vec<Option<MatchGrade>> = vec![None; match_ids.len()];
        while let Some(read) = reads.join_next().await {
            match read {
                Ok((i, Ok(game))) => grades[i] = my_grade(&game),
                Ok((i, Err(error))) => {
                    tracing::info!(%error, game = match_ids[i], "game not read for its grade");
                }
                Err(error) => tracing::warn!(%error, "grade read stopped"),
            }
        }
        match_ids
            .iter()
            .zip(grades)
            .map(|(id, grade)| GradedMatch {
                match_id: id.clone(),
                grade,
            })
            .collect()
    }

    /// One game in full. Your listed games come from the League client (our backend when the
    /// client can't answer); anyone else's from our backend.
    pub async fn details(
        &self,
        client: Option<&LcuClient>,
        backend: Option<&BackendClient>,
        match_id: &str,
    ) -> Result<MatchDetails, BackendError> {
        let mine = self.state().listed.contains_key(match_id);
        if mine && let Some(client) = client {
            match self.own_game(client, match_id).await {
                Ok(game) => return Ok(MatchDetails::clone(&game)),
                Err(error) if backend.is_none() => return Err(error.into()),
                Err(error) => {
                    tracing::info!(%error, "your game unread from the client, asking our backend");
                }
            }
        }
        let backend = backend.ok_or_else(|| BackendError::Unavailable {
            message: "no backend configured".to_owned(),
        })?;
        self.their_game(backend, match_id)
            .await
            .map(|game| MatchDetails::clone(&game))
    }

    /// One of your games, read from the client once.
    async fn own_game(
        &self,
        client: &LcuClient,
        match_id: &str,
    ) -> Result<Arc<MatchDetails>, ReadError> {
        let (platform, game_id) = split(match_id)?;
        let (slot, me) = {
            let mut state = self.state();
            let state = &mut *state;
            (state.own.slot(match_id, &state.listed), state.me.clone())
        };
        slot.get_or_try_init(|| async {
            let game: Value = client.get(&game_path(game_id)).await?;
            details_from_client(&game, &me, platform)
                .map(Arc::new)
                .ok_or(ReadError::Unreadable)
        })
        .await
        .cloned()
    }

    /// Another player's game, asked of our backend once.
    async fn their_game(
        &self,
        backend: &BackendClient,
        match_id: &str,
    ) -> Result<Arc<MatchDetails>, BackendError> {
        let (platform, _) = split(match_id).map_err(|_| BackendError::NotFound)?;
        let slot = {
            let mut state = self.state();
            let state = &mut *state;
            state.theirs.slot(match_id, &state.listed)
        };
        slot.get_or_try_init(|| async {
            backend
                .match_details(&platform.to_ascii_lowercase(), match_id)
                .await
                .map(Arc::new)
        })
        .await
        .cloned()
    }
}

// ---- After a game, and further back ----------------------------------------------------------

impl MatchInsights {
    /// The platform your listed games name (`EUW1`), when a list was read.
    fn listed_platform(&self) -> Option<String> {
        let state = self.state();
        state
            .listed
            .keys()
            .find_map(|id| id.rsplit_once('_').map(|(platform, _)| platform.to_owned()))
    }

    /// The game you just played, read whole from the client once and kept (the list then shows
    /// its grade, and it opens at once). Who you are is read first when no profile was asked
    /// for yet (the window closed during the game).
    pub async fn after_game(
        &self,
        client: &LcuClient,
        game_id: u64,
    ) -> Result<Arc<MatchDetails>, BackendError> {
        if self.state().me == Me::default() {
            let summoner: Value = client
                .get(profile::CURRENT_SUMMONER)
                .await
                .map_err(ReadError::from)?;
            let mut state = self.state();
            if state.me == Me::default() {
                state.me = Me::from_summoner(&summoner);
            }
        }
        let platform = match self.listed_platform() {
            Some(platform) => platform,
            None => profile::platform(client).await,
        };
        Ok(self
            .own_game(client, &format!("{platform}_{game_id}"))
            .await?)
    }

    /// Your games further back: `beg_index` and the next [`profile::PAGE`] − 1 (fewer, or none,
    /// at the end of the history). Their grades and details then work like the first page's;
    /// games already read carry their grade.
    pub async fn older(
        &self,
        client: &LcuClient,
        beg_index: u32,
    ) -> Result<Vec<MatchSummary>, LcuError> {
        let path = profile::matches_path(beg_index, beg_index + profile::PAGE - 1);
        let history: Value = client.get(&path).await?;
        let platform = match self.listed_platform() {
            Some(platform) => platform,
            None => profile::platform(client).await,
        };
        let mut games = profile::map_matches(&history, &platform);
        let mut state = self.state();
        state.listed.extend(profile::gradable(&history, &platform));
        for game in &mut games {
            game.grade = state.own.read(&game.match_id).and_then(|d| my_grade(&d));
        }
        Ok(games)
    }
}

/// `EUW1_7000000001` → (`EUW1`, 7000000001).
fn split(match_id: &str) -> Result<(&str, u64), ReadError> {
    match_id
        .rsplit_once('_')
        .and_then(|(platform, id)| Some((platform, id.parse().ok()?)))
        .filter(|(platform, _)| !platform.is_empty())
        .ok_or_else(|| ReadError::BadId(match_id.to_owned()))
}

#[cfg(test)]
mod tests {
    use domain::GradeBadge;
    use mock_lcu::history::{Game, Local};

    use super::*;

    fn local() -> Local {
        Local {
            puuid: "local-puuid".into(),
            game_name: "Fillmo".into(),
            tag_line: "7272".into(),
            summoner_id: 42,
        }
    }

    fn game(lane: &'static str, win: bool) -> Game {
        Game {
            game_id: 7_000_000_003,
            queue_id: 420,
            map_id: 11,
            created: 1_790_500_000_000,
            duration: 1742,
            champion: 103,
            lane,
            spells: [14, 4],
            win,
        }
    }

    fn me() -> Me {
        Me::from_summoner(&serde_json::json!({ "puuid": "local-puuid", "summonerId": 42 }))
    }

    #[test]
    fn maps_a_whole_game_from_the_client() {
        let doc = game("MIDDLE", true).document(&local());
        let details = details_from_client(&doc, &me(), "LOCAL").expect("mapped");
        assert_eq!(details.match_id, "EUW1_7000000003");
        assert_eq!((details.queue_id, details.duration_seconds), (420, 1742));
        assert_eq!(details.ended_at, 1_790_500_000_000 + 1_742_000);
        let [blue, red] = &details.teams[..] else {
            panic!("two teams: {details:?}")
        };
        assert!(blue.win && !red.win);
        for team in &details.teams {
            let roles: Vec<Option<Role>> = team.players.iter().map(|p| p.role).collect();
            assert_eq!(roles, ROLES.map(Some), "roles fixed up, in lane order");
        }
        let mine: Vec<&MatchPlayer> = details
            .teams
            .iter()
            .flat_map(|t| &t.players)
            .filter(|p| p.is_me)
            .collect();
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].champion_id, 103);
        assert_eq!(mine[0].role, Some(Role::Middle));
        assert_eq!(mine[0].spells, vec![14, 4]);
        assert!(mine[0].grade.is_some());
        assert!(mine[0].keystone.is_some() && mine[0].trinket.is_some());
        // Streamer mode stays hidden, whatever the client carries.
        let hidden = &red.players[1];
        assert!(hidden.hidden && hidden.riot_id.is_none());
        let badges = details
            .teams
            .iter()
            .flat_map(|t| &t.players)
            .filter_map(|p| p.grade.as_ref()?.badge)
            .collect::<Vec<_>>();
        assert_eq!(badges.len(), 2);
        assert!(badges.contains(&GradeBadge::Mvp) && badges.contains(&GradeBadge::Ace));
    }

    #[test]
    fn a_name_the_client_marks_hidden_stays_hidden() {
        let mut doc = game("TOP", false).document(&local());
        doc["participantIdentities"][3]["player"]["nameVisibilityType"] = "HIDDEN".into();
        let details = details_from_client(&doc, &me(), "EUW1").expect("mapped");
        let named = details
            .teams
            .iter()
            .flat_map(|t| &t.players)
            .filter(|p| p.riot_id.is_some())
            .count();
        assert_eq!(
            named, 8,
            "the streamer-mode enemy and the hidden ally have no name"
        );
    }

    #[test]
    fn roles_from_a_confused_timeline() {
        // Both bottom players say DUO_CARRY and the jungler's lane is NONE.
        let mut doc = game("MIDDLE", true).document(&local());
        for (seat, lane, role) in [
            (3, "BOTTOM", "DUO_CARRY"),
            (4, "BOTTOM", "DUO_CARRY"),
            (1, "NONE", "NONE"),
        ] {
            doc["participants"][seat]["timeline"] =
                serde_json::json!({ "lane": lane, "role": role });
        }
        let fixed = roles(doc["participants"].as_array().expect("list"), false);
        assert_eq!(&fixed[..5], &ROLES.map(Some));
        assert!(
            roles(doc["participants"].as_array().expect("list"), true)
                .iter()
                .all(Option::is_none)
        );
    }

    #[test]
    fn aram_and_remakes() {
        let mut aram = game("MIDDLE", true);
        (aram.map_id, aram.queue_id) = (12, 450);
        let details = details_from_client(&aram.document(&local()), &me(), "EUW1").expect("mapped");
        let players: Vec<&MatchPlayer> = details.teams.iter().flat_map(|t| &t.players).collect();
        assert!(
            players
                .iter()
                .all(|p| p.role.is_none() && p.grade.is_some())
        );

        let mut remake = game("MIDDLE", false);
        remake.duration = 240;
        let details =
            details_from_client(&remake.document(&local()), &me(), "EUW1").expect("mapped");
        assert!(
            details
                .teams
                .iter()
                .flat_map(|t| &t.players)
                .all(|p| p.grade.is_none())
        );
    }

    #[test]
    fn keeps_a_bounded_number_of_games() {
        let mut kept = Kept::default();
        let listed: HashMap<String, bool> = [("EUW1_1".to_owned(), true)].into();
        for i in 1..=(GAMES_MAX + 10) {
            kept.slot(&format!("EUW1_{i}"), &listed);
        }
        assert_eq!(kept.slots.len(), GAMES_MAX);
        assert!(kept.slots.contains_key("EUW1_1"), "a listed game stays");
        assert!(!kept.slots.contains_key("EUW1_2"));
        assert!(kept.slots.contains_key(&format!("EUW1_{}", GAMES_MAX + 10)));
    }

    #[test]
    fn splits_match_ids() {
        assert_eq!(split("EUW1_7000000001").ok(), Some(("EUW1", 7_000_000_001)));
        assert!(split("7000000001").is_err());
        assert!(split("EUW1_x").is_err());
        assert!(split("_1").is_err());
    }

    #[test]
    fn me_stays_out_of_logs() {
        assert!(!format!("{:?}", me()).contains("local-puuid"));
    }
}
