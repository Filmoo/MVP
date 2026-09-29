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
//!
//! Roles: the client's own are a guess, so each team's are worked out again ([`roles`]); the
//! rows of the match list follow them once their game is read.

mod roles;

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use domain::{
    BackendError, Bracket, EndOfGameStats, GradedMatch, MatchDetails, MatchGrade, MatchPlayer,
    MatchTeam, PlayerProfile, RiotId, Role,
};
use lcu::{LcuClient, LcuError};
use serde_json::Value;
use stats::grade::{Lobby, LobbyPlayer, grade};
use tokio::sync::{OnceCell, Semaphore};
use tokio::task::JoinSet;

pub use self::roles::RoleShares;
use crate::backend::BackendClient;
use crate::profile;
use crate::stats::{DataSet, RANKED, StatsClient};

/// One whole game of the local player's history.
pub fn game_path(game_id: u64) -> String {
    format!("/lol-match-history/v1/games/{game_id}")
}

/// Games kept in memory (each a few KB); your listed games are never the ones dropped.
const GAMES_MAX: usize = 100;
/// Whole games read from the League client at once.
const READS_AT_ONCE: usize = 4;
/// How long reading games waits for the published role shares before going on with the
/// built-in prior (the stats are on disk, or a request away).
const STATS_WAIT: Duration = Duration::from_secs(3);
/// The published stats the role shares come from: ranked, the widest bracket.
const SHARES_BRACKET: Bracket = Bracket::EmeraldPlus;

const HOWLING_ABYSS: u32 = 12;
const ARAM: u32 = 450;

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
        // The client's end-of-game numbers (what it doesn't send stays `None`: its match
        // history may not count the healing and shielding done to teammates).
        stats: EndOfGameStats::read(
            |key| {
                stats
                    .get(key)
                    .and_then(Value::as_u64)
                    .and_then(|n| u32::try_from(n).ok())
            },
            |key| stats.get(key).and_then(Value::as_bool),
        ),
    }
}

/// One of your games as `/lol-match-history/v1/games/{gameId}` answers it: both teams, every
/// player's role (worked out with `shares`, none on Howling Abyss) and grade, your row marked.
/// `platform` names the match when the game doesn't say.
pub fn details_from_client(
    game: &Value,
    me: &Me,
    platform: &str,
    shares: &RoleShares,
) -> Option<MatchDetails> {
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
    let roles = if aram {
        vec![None; participants.len()]
    } else {
        roles::assign(participants, duration, shares)
    };
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

/// Your line in one of your games.
fn my_line(details: &MatchDetails) -> Option<&MatchPlayer> {
    details
        .teams
        .iter()
        .flat_map(|t| &t.players)
        .find(|p| p.is_me)
}

/// Your grade in one of your games.
fn my_grade(details: &MatchDetails) -> Option<MatchGrade> {
    my_line(details).and_then(|p| p.grade.clone())
}

/// What one of your games answers for its row: your grade and the role you played there.
fn graded(match_id: &str, details: Option<&MatchDetails>) -> GradedMatch {
    let line = details.and_then(my_line);
    GradedMatch {
        match_id: match_id.to_owned(),
        grade: line.and_then(|p| p.grade.clone()),
        role: line.and_then(|p| p.role),
    }
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

/// The role shares of one batch of reads, loaded by the first read that needs them.
type Shares = Arc<OnceCell<RoleShares>>;

/// Games read once and kept for the session, shared by the commands (cheap to clone).
#[derive(Debug, Clone, Default)]
pub struct MatchInsights {
    state: Arc<Mutex<State>>,
    /// Published champion stats: each champion's role shares (the built-in prior without them).
    stats: Option<StatsClient>,
}

impl MatchInsights {
    /// Your games' roles are worked out with the champions' role shares in `stats` (the
    /// built-in prior without them, or while they can't be had).
    pub fn new(stats: Option<StatsClient>) -> Self {
        Self {
            stats,
            ..Self::default()
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The local player's profile from the client; games already read carry their grade, and
    /// the role worked out for them ([`Self::grades`] reads the others).
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
            let game = state.own.read(&m.match_id);
            m.grade = game.as_deref().and_then(my_grade);
            if let Some(line) = game.as_deref().and_then(my_line) {
                m.role = line.role;
            }
        }
        Ok(profile)
    }

    /// Your grade in each of `match_ids` (your listed games; anything else answers none), and
    /// the role you played there, reading the games not read yet from the client, a few at a
    /// time.
    pub async fn grades(&self, client: &LcuClient, match_ids: &[String]) -> Vec<GradedMatch> {
        let permits = Arc::new(Semaphore::new(READS_AT_ONCE));
        let shares = Shares::default();
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
            let (permits, shares) = (Arc::clone(&permits), Arc::clone(&shares));
            reads.spawn(async move {
                let _permit = permits.acquire_owned().await;
                (i, this.own_game(&client, &id, &shares).await)
            });
        }
        let mut games: Vec<Option<Arc<MatchDetails>>> = vec![None; match_ids.len()];
        while let Some(read) = reads.join_next().await {
            match read {
                Ok((i, Ok(game))) => games[i] = Some(game),
                Ok((i, Err(error))) => {
                    tracing::info!(%error, game = match_ids[i], "game not read for its grade");
                }
                Err(error) => tracing::warn!(%error, "grade read stopped"),
            }
        }
        match_ids
            .iter()
            .zip(games)
            .map(|(id, game)| graded(id, game.as_deref()))
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
            match self.own_game(client, match_id, &Shares::default()).await {
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
        shares: &Shares,
    ) -> Result<Arc<MatchDetails>, ReadError> {
        let (platform, game_id) = split(match_id)?;
        let (slot, me) = {
            let mut state = self.state();
            let state = &mut *state;
            (state.own.slot(match_id, &state.listed), state.me.clone())
        };
        slot.get_or_try_init(|| async {
            let game: Value = client.get(&game_path(game_id)).await?;
            let shares = shares.get_or_init(|| self.role_shares()).await;
            details_from_client(&game, &me, platform, shares)
                .map(Arc::new)
                .ok_or(ReadError::Unreadable)
        })
        .await
        .cloned()
    }

    /// The champions' role shares: the published ranked stats when they can be had within
    /// [`STATS_WAIT`], else the built-in prior. The index is the one at hand (on disk, or read at
    /// startup): nothing asks our server for it just for roles.
    async fn role_shares(&self) -> RoleShares {
        let set = self.stats.as_ref().and_then(|stats| {
            let index = stats.cached_index()?;
            Some((stats, DataSet::current(&index, RANKED, SHARES_BRACKET)?))
        });
        let published = match set {
            Some((stats, set)) => tokio::time::timeout(STATS_WAIT, stats.champions(&set))
                .await
                .ok()
                .and_then(Result::ok)
                .flatten(),
            None => None,
        };
        if let Some(file) = published {
            RoleShares::published(&file)
        } else {
            tracing::info!("roles from the built-in prior: no published stats at hand");
            RoleShares::default()
        }
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

    use super::roles::ROLES;
    use super::*;

    fn prior() -> RoleShares {
        RoleShares::default()
    }

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
        let details = details_from_client(&doc, &me(), "LOCAL", &prior()).expect("mapped");
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
        // The end-of-game numbers the client keeps: the damage by type adds up to the total;
        // what its match history doesn't count stays unknown, never a made-up zero.
        let stats = &mine[0].stats;
        let by_type = [
            stats.physical_damage_to_champions,
            stats.magic_damage_to_champions,
            stats.true_damage_to_champions,
        ];
        assert_eq!(
            by_type.iter().map(|d| d.unwrap_or(0)).sum::<u32>(),
            mine[0].damage_to_champions
        );
        assert!(stats.gold_spent.is_some() && stats.crowd_control_seconds.is_some());
        assert_eq!(stats.healing_on_teammates, None);
        assert_eq!(stats.shielding_on_teammates, None);
        let first_bloods = details
            .teams
            .iter()
            .flat_map(|t| &t.players)
            .filter(|p| p.stats.first_blood == Some(true))
            .count();
        assert_eq!(first_bloods, 1);
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
        let details = details_from_client(&doc, &me(), "EUW1", &prior()).expect("mapped");
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
        let details = details_from_client(&doc, &me(), "EUW1", &prior()).expect("mapped");
        let blue: Vec<Option<Role>> = details.teams[0].players.iter().map(|p| p.role).collect();
        assert_eq!(blue, ROLES.map(Some));
    }

    /// Games the client already named right (the mock's: clean lanes, Smite on the jungler, the
    /// support item on the support) keep their roles, whoever plays what: their grades don't
    /// change.
    #[test]
    fn grades_stay_where_the_roles_were_right() {
        let yours = [
            (54, "TOP"),
            (64, "JUNGLE"),
            (103, "MIDDLE"),
            (222, "BOTTOM"),
            (412, "UTILITY"),
        ];
        for game_id in 7_000_000_100..7_000_000_132 {
            for (champion, lane) in yours {
                let mut played = game(lane, game_id % 3 != 0);
                (played.game_id, played.champion) = (game_id, champion);
                played.spells = if lane == "JUNGLE" { [11, 4] } else { [14, 4] };
                let doc = played.document(&local());
                // The grades with each seat's own lane.
                let participants = doc["participants"].as_array().expect("list");
                let lobby = Lobby {
                    duration_seconds: played.duration,
                    players: participants
                        .iter()
                        .enumerate()
                        .map(|(seat, p)| lobby_player(p, Some(ROLES[seat % 5])))
                        .collect(),
                };
                let expected = grade(&lobby).expect("graded");
                let details = details_from_client(&doc, &me(), "EUW1", &prior()).expect("mapped");
                // Teams list their players in lane order, as the seats are.
                let lines = details.teams.iter().flat_map(|t| &t.players);
                for (seat, line) in lines.enumerate() {
                    let at = format!("game {game_id}, {lane} {champion}, seat {seat}");
                    assert_eq!(line.role, Some(ROLES[seat % 5]), "{at}");
                    assert_eq!(line.grade.as_ref(), Some(&expected[seat]), "{at}");
                }
            }
        }
    }

    #[test]
    fn aram_and_remakes() {
        let mut aram = game("MIDDLE", true);
        (aram.map_id, aram.queue_id) = (12, 450);
        let details =
            details_from_client(&aram.document(&local()), &me(), "EUW1", &prior()).expect("mapped");
        let players: Vec<&MatchPlayer> = details.teams.iter().flat_map(|t| &t.players).collect();
        assert!(
            players
                .iter()
                .all(|p| p.role.is_none() && p.grade.is_some())
        );

        let mut remake = game("MIDDLE", false);
        remake.duration = 240;
        let details = details_from_client(&remake.document(&local()), &me(), "EUW1", &prior())
            .expect("mapped");
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
