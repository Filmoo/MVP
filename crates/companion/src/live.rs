//! Loading-screen scouting: the game session (League client) → the UI's [`LiveGame`], every
//! player named as Riot or the game shows them, and a scouting card per player from our backend.
//!
//! Policy (docs/policy.md, "Loading-screen scouting"): read only once the game starts (loading
//! screen, in game), when the game itself shows every name — never in champion select. Players
//! hidden by Riot (streamer mode) stay hidden: never named, never looked up.
//!
//! The League client's session names nobody but the local player (2026-09: its team entries
//! carry no names, and bots aren't listed in custom games). The names come from:
//! 1. **Riot's live game** (Spectator-V5 through our backend, asked with the local player's own
//!    Riot ID and the game's id): from the loading screen on, streamer-mode players anonymous,
//!    with the cards of the visible players;
//! 2. **the game itself** (Live Client Data API, [`GAME_CLIENT_URL`]) when Riot has none for this
//!    game (no backend, not listed, a "filtered" queue: Ranked Flex, Arena): asked only while the
//!    game runs and until it answers, which it does once the game has loaded. Streamer-mode
//!    players' stand-in names are never taken for Riot IDs ([`game::listed`]).
//!
//! Seats are matched by side and champion ([`seats`]). Cards are looked up by **Riot ID**: the
//! client's PUUIDs are not the ones our backend's key sees (Riot encrypts PUUIDs per key), so
//! they never leave the core.

mod game;
mod seats;

use std::sync::Arc;
use std::time::Duration;

use domain::{BackendError, LiveGame, LiveNames, LivePlayer, RiotId, Role, ScoutCard, Scouting};
use lcu::LcuClient;
use serde_json::Value;
use tokio::sync::watch;

pub use game::{ALL_GAME_DATA, GAME_CLIENT_URL, GameClient, GameIds, GamePlayer, NoGameIds};

use crate::backend::{ActiveGameAnswer, BackendClient};
use crate::profile;

/// The gameflow session: teams, champions and spells once the game is found.
pub const SESSION: &str = "/lol-gameflow/v1/session";

/// Debug builds may ask another game API (`mock-lcu`'s fake one), named by this variable.
pub const GAME_CLIENT_ENV: &str = "SCOUT_GAME_CLIENT";

/// Where the players' names come from besides Riot's live game, and how patiently.
#[derive(Debug, Clone)]
pub struct LiveConfig {
    /// The game's Live Client Data API; `None`: never asked (names from Riot's live game only).
    pub game_client: Option<String>,
    /// Between two looks at the game while it hasn't loaded.
    pub game_poll: Duration,
    /// Riot may list a game a moment after it starts: asked once more after this.
    pub riot_retry: Duration,
}

impl Default for LiveConfig {
    /// No game API (tests); the app uses [`LiveConfig::for_the_game`].
    fn default() -> Self {
        Self {
            game_client: None,
            game_poll: Duration::from_secs(2),
            riot_retry: Duration::from_secs(8),
        }
    }
}

impl LiveConfig {
    /// The game on this PC ([`GAME_CLIENT_URL`]), or [`GAME_CLIENT_ENV`] in debug builds.
    pub fn for_the_game() -> Self {
        let url = std::env::var(GAME_CLIENT_ENV)
            .ok()
            .filter(|url| cfg!(debug_assertions) && !url.trim().is_empty())
            .unwrap_or_else(|| GAME_CLIENT_URL.to_owned());
        Self {
            game_client: Some(url),
            ..Self::default()
        }
    }
}

/// Riot platform id for a client region (`/riotclient/region-locale`).
pub fn platform_for_region(region: &str) -> Option<&'static str> {
    Some(match region.to_ascii_uppercase().as_str() {
        "EUW" => "euw1",
        "EUNE" => "eun1",
        "NA" => "na1",
        "KR" => "kr",
        "BR" => "br1",
        "JP" => "jp1",
        "LAN" | "LA1" => "la1",
        "LAS" | "LA2" => "la2",
        "ME" => "me1",
        "OCE" | "OC1" => "oc1",
        "RU" => "ru",
        "SG" | "SG2" => "sg2",
        "TR" => "tr1",
        "TW" | "TW2" => "tw2",
        "VN" | "VN2" => "vn2",
        _ => return None,
    })
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn u32_at(v: &Value, key: &str) -> Option<u32> {
    v.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .filter(|&n| n != 0)
}

fn role(position: &str) -> Option<Role> {
    match position.trim().to_ascii_uppercase().as_str() {
        "TOP" => Some(Role::Top),
        "JUNGLE" => Some(Role::Jungle),
        "MIDDLE" | "MID" => Some(Role::Middle),
        "BOTTOM" | "BOT" => Some(Role::Bottom),
        "UTILITY" | "SUPPORT" => Some(Role::Support),
        _ => None,
    }
}

/// A seat as read from the session. The client's PUUID stays in the core: it identifies the
/// local player and pairs spells, and is never sent anywhere (our backend's key can't read it).
#[derive(Debug, Clone, PartialEq)]
pub struct Seat {
    pub player: LivePlayer,
    /// `None` when hidden or unknown (bots).
    pub puuid: Option<String>,
}

/// Riot IDs are case-insensitive: the backend answers with the account's own spelling.
pub fn same_riot_id(a: &RiotId, b: &RiotId) -> bool {
    let norm = |s: &str| s.trim().to_lowercase();
    norm(&a.game_name) == norm(&b.game_name) && norm(&a.tag_line) == norm(&b.tag_line)
}

/// A mapped session: the view, plus whom to scout.
#[derive(Debug, Clone, PartialEq)]
pub struct Scouted {
    pub game: LiveGame,
    /// The allies are the session's first team (`teamOne`: blue side).
    allies_first_team: bool,
    /// Riot IDs whose card is settled (in, or unknown to our backend): not asked again.
    covered: Vec<RiotId>,
}

impl Scouted {
    fn seats_mut(&mut self) -> impl Iterator<Item = &mut LivePlayer> {
        self.game
            .allies
            .iter_mut()
            .chain(self.game.enemies.iter_mut())
    }

    /// Distinct Riot IDs to ask the backend about, in seat order: named players without a card
    /// yet. Hidden players have none (their names are never read), neither do bots.
    pub fn wanted(&self) -> Vec<RiotId> {
        let mut out: Vec<RiotId> = Vec::new();
        let seats = self.game.allies.iter().chain(&self.game.enemies);
        for id in seats
            .filter(|p| !p.hidden && !p.bot && p.card.is_none())
            .filter_map(|p| p.riot_id.as_ref())
            .filter(|id| !self.covered.iter().any(|c| same_riot_id(c, id)))
        {
            if !out.iter().any(|o| same_riot_id(o, id)) {
                out.push(id.clone());
            }
        }
        out
    }

    /// Fills the cards in, seat by seat by Riot ID (or records why they can't come).
    pub fn apply(&mut self, result: Result<Vec<ScoutCard>, BackendError>) {
        match result {
            Ok(cards) => {
                for player in self.seats_mut().filter(|p| !p.hidden && !p.bot) {
                    let Some(id) = &player.riot_id else { continue };
                    let card = cards
                        .iter()
                        .find(|c| c.riot_id.as_ref().is_some_and(|c| same_riot_id(c, id)));
                    if let Some(card) = card {
                        player.card = Some(card.clone());
                    }
                }
                self.game.scouting = Scouting::Done;
            }
            Err(error) => self.game.scouting = Scouting::Failed { error },
        }
    }

    /// Names the seats as Riot's live game shows them; the cards it brought are settled, and
    /// so are those of players it knows nothing about when it asked for every card.
    fn named_by_riot(&mut self, game: &domain::ActiveGame, me: Option<&RiotId>) {
        self.name_from(&seats::from_riot(game), me);
        self.covered = game
            .participants
            .iter()
            .filter(|p| game.cards_complete || p.card.is_some())
            .filter_map(|p| p.riot_id.clone())
            .collect();
        self.game.names = LiveNames::Known;
    }
}

/// Maps one team member. Hidden players' identity fields are never read. The client's session
/// carries no names today (2026: `summonerName` empty, no `gameName`/`tagLine`): the local
/// player's own Riot ID comes from `current-summoner` instead, the others' from Riot's live game
/// or the game itself.
fn seat(
    member: &Value,
    selections: &[Value],
    my_puuid: Option<&str>,
    my_riot_id: Option<&RiotId>,
) -> Seat {
    let hidden =
        str_at(member, "nameVisibilityType").is_some_and(|v| v.eq_ignore_ascii_case("HIDDEN"));
    let champion_id = u32_at(member, "championId");
    let puuid = if hidden {
        None
    } else {
        str_at(member, "puuid").map(str::to_owned)
    };
    // Spells aren't identity: matched by PUUID when known, else by champion (unique per game).
    let selection = selections
        .iter()
        .find(|s| puuid.is_some() && str_at(s, "puuid") == puuid.as_deref())
        .or_else(|| {
            selections
                .iter()
                .find(|s| champion_id.is_some() && u32_at(s, "championId") == champion_id)
        });
    let spells = selection
        .map(|s| {
            ["spell1Id", "spell2Id"]
                .iter()
                .filter_map(|k| u32_at(s, k))
                .collect()
        })
        .unwrap_or_default();
    let riot_id = if hidden {
        None
    } else {
        match (str_at(member, "gameName"), str_at(member, "tagLine")) {
            (Some(game_name), Some(tag_line)) => Some(RiotId {
                game_name: game_name.to_owned(),
                tag_line: tag_line.to_owned(),
            }),
            _ => None,
        }
    };
    let is_me = !hidden && my_puuid.is_some() && puuid.as_deref() == my_puuid;
    let riot_id = riot_id.or_else(|| is_me.then(|| my_riot_id.cloned()).flatten());
    Seat {
        player: LivePlayer {
            champion_id,
            spells,
            role: str_at(member, "selectedPosition").and_then(role),
            is_me,
            hidden,
            bot: false,
            riot_id,
            card: None,
        },
        puuid,
    }
}

/// Maps a gameflow session; `None` when it has no game (yet).
pub fn map_session(
    session: &Value,
    my_puuid: Option<&str>,
    my_riot_id: Option<&RiotId>,
    platform: &str,
) -> Option<Scouted> {
    let data = session.get("gameData")?;
    let game_id = data
        .get("gameId")
        .and_then(Value::as_u64)
        .filter(|&id| id != 0)?;
    let team = |key: &str| {
        data.get(key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let (one, two) = (team("teamOne"), team("teamTwo"));
    if one.is_empty() && two.is_empty() {
        return None;
    }
    let selections = team("playerChampionSelections");
    let map = |members: &[Value]| -> Vec<Seat> {
        members
            .iter()
            .map(|m| seat(m, &selections, my_puuid, my_riot_id))
            .collect()
    };
    let (one, two) = (map(&one), map(&two));
    // Our side first; a spectated game keeps the client's order.
    let allies_first_team = !two.iter().any(|s| s.player.is_me);
    let (allies, enemies) = if allies_first_team {
        (one, two)
    } else {
        (two, one)
    };
    Some(Scouted {
        game: LiveGame {
            game_id,
            queue_id: data
                .get("queue")
                .and_then(|q| u32_at(q, "id"))
                .unwrap_or_default(),
            stats_queue: crate::imports::stats_queue(session),
            platform: platform.to_owned(),
            allies: allies.into_iter().map(|s| s.player).collect(),
            enemies: enemies.into_iter().map(|s| s.player).collect(),
            names: LiveNames::Asking,
            scouting: Scouting::Loading,
        },
        allies_first_team,
        covered: Vec::new(),
    })
}

/// What scouting asks besides the League client.
#[derive(Clone)]
pub(crate) struct Sources {
    /// Our backend; `None` without one, or when the remote config turned scouting off.
    pub backend: Option<BackendClient>,
    /// The game's own API; `None` when it isn't asked (tests).
    pub game: Option<GameClient>,
    pub ids: Arc<dyn GameIds>,
    pub riot_retry: Duration,
}

fn publish(live: &watch::Sender<Option<LiveGame>>, scouted: &Scouted) {
    live.send_replace(Some(scouted.game.clone()));
}

/// Reads the game from the client and publishes it, then names the players and fills their
/// cards in, publishing each step. Aborted by the core when the game ends. Without a backend
/// (none, or turned off remotely) the names still come from the game, without cards.
/// `previous`: the game as published before a retry; names already in are kept, and only the
/// cards are asked again.
pub(crate) async fn scout_game(
    lcu: LcuClient,
    sources: Sources,
    live: watch::Sender<Option<LiveGame>>,
    previous: Option<LiveGame>,
) {
    let session = match lcu.get::<Value>(SESSION).await {
        Ok(session) => session,
        Err(error) => {
            tracing::warn!(%error, "cannot read the game session");
            return;
        }
    };
    let me = lcu.get::<Value>(profile::CURRENT_SUMMONER).await.ok();
    let my_puuid = me.as_ref().and_then(|m| str_at(m, "puuid"));
    let my_riot_id = me.as_ref().and_then(|m| {
        Some(RiotId {
            game_name: str_at(m, "gameName")?.to_owned(),
            tag_line: str_at(m, "tagLine")?.to_owned(),
        })
    });
    let region = lcu.get::<Value>(profile::REGION).await.ok();
    let platform = region
        .as_ref()
        .and_then(|r| str_at(r, "region"))
        .and_then(platform_for_region)
        .unwrap_or("euw1");
    let Some(mut scouted) = map_session(&session, my_puuid, my_riot_id.as_ref(), platform) else {
        tracing::debug!("no game in the session yet");
        return;
    };
    match previous.filter(|p| p.game_id == scouted.game.game_id && p.names == LiveNames::Known) {
        Some(before) => {
            scouted.game = LiveGame {
                scouting: Scouting::Loading,
                ..before
            };
        }
        None => {
            find_names(&mut scouted, &sources, my_riot_id.as_ref(), platform, &live).await;
        }
    }
    find_cards(&mut scouted, sources.backend.as_ref(), platform, &live).await;
}

/// Names the players: Riot's live game first (asked twice: it may list a game a moment after
/// it starts), else the game itself once it has loaded.
async fn find_names(
    scouted: &mut Scouted,
    sources: &Sources,
    me: Option<&RiotId>,
    platform: &str,
    live: &watch::Sender<Option<LiveGame>>,
) {
    let mut filtered = false;
    if let (Some(backend), Some(me)) = (&sources.backend, me) {
        publish(live, scouted);
        for attempt in 0..2 {
            match backend
                .active_game(platform, me, scouted.game.game_id)
                .await
            {
                Ok(ActiveGameAnswer::Game(game)) if game.game_id == scouted.game.game_id => {
                    scouted.named_by_riot(&game, Some(me));
                    tracing::info!("players named from Riot's live game");
                    return;
                }
                Ok(ActiveGameAnswer::Filtered) => {
                    filtered = true;
                    break;
                }
                Ok(ActiveGameAnswer::NotListed | ActiveGameAnswer::Game(_)) if attempt == 0 => {
                    tokio::time::sleep(sources.riot_retry).await;
                }
                Ok(_) => break,
                Err(error) => {
                    tracing::info!(%error, "Riot's live game unavailable");
                    break;
                }
            }
        }
    }
    let Some(game) = &sources.game else {
        scouted.game.names = LiveNames::Known;
        return;
    };
    scouted.game.names = LiveNames::Waiting { filtered };
    publish(live, scouted);
    let players = game.wait_for_players().await;
    scouted.name_from(&game::listed(&players, &*sources.ids), me);
    scouted.game.names = LiveNames::Known;
    tracing::info!(players = players.len(), "players named from the game");
}

/// Asks the backend for the cards the players still lack.
async fn find_cards(
    scouted: &mut Scouted,
    backend: Option<&BackendClient>,
    platform: &str,
    live: &watch::Sender<Option<LiveGame>>,
) {
    let wanted = scouted.wanted();
    if wanted.is_empty() {
        scouted.game.scouting = Scouting::Done;
        publish(live, scouted);
        return;
    }
    let Some(backend) = backend else {
        scouted.apply(Err(BackendError::Unavailable {
            message: "player cards are off (no backend, or turned off remotely)".to_owned(),
        }));
        publish(live, scouted);
        return;
    };
    scouted.game.scouting = Scouting::Loading;
    publish(live, scouted);
    let result = backend.scout(platform, &wanted).await;
    if let Err(error) = &result {
        tracing::warn!(%error, "scouting failed");
    }
    scouted.apply(result);
    publish(live, scouted);
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{ActiveGame, ActiveParticipant, RankedEntry, Tier};
    use serde_json::json;

    /// Shaped like a ranked session of an older client, which named players: one streamer-mode
    /// player on each side.
    fn ranked_session() -> Value {
        json!({
            "phase": "InProgress",
            "gameData": {
                "gameId": 7_100_000_001_u64,
                "queue": { "id": 420, "type": "RANKED_SOLO_5x5" },
                "teamOne": [
                    { "championId": 39, "puuid": "e1", "gameName": "Enemy", "tagLine": "EUW", "selectedPosition": "TOP" },
                    { "championId": 234, "puuid": "e2-secret", "gameName": "Streamer", "tagLine": "LIVE", "nameVisibilityType": "HIDDEN", "selectedPosition": "JUNGLE" }
                ],
                "teamTwo": [
                    { "championId": 54, "puuid": "me", "gameName": "Fillmo", "tagLine": "7272", "selectedPosition": "TOP" },
                    { "championId": 64, "puuid": "a2", "selectedPosition": "JUNGLE" },
                    { "championId": 103, "puuid": "", "nameVisibilityType": "HIDDEN", "selectedPosition": "MIDDLE" }
                ],
                "playerChampionSelections": [
                    { "championId": 54, "puuid": "me", "spell1Id": 4, "spell2Id": 12 },
                    { "championId": 64, "spell1Id": 11, "spell2Id": 4 },
                    { "championId": 234, "puuid": "e2-secret", "spell1Id": 11, "spell2Id": 4 }
                ]
            }
        })
    }

    fn riot_id(name: &str, tag: &str) -> RiotId {
        RiotId {
            game_name: name.to_owned(),
            tag_line: tag.to_owned(),
        }
    }

    fn card(puuid: &str, name: &str) -> ScoutCard {
        ScoutCard {
            puuid: puuid.to_owned(),
            riot_id: Some(riot_id(name, "EUW")),
            solo_queue: Some(RankedEntry {
                tier: Tier::Gold,
                division: None,
                league_points: 10,
                wins: 1,
                losses: 1,
            }),
            games_sampled: 2,
            top_champions: Vec::new(),
            recent_results: vec![true, false],
            main_roles: Vec::new(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn our_team_comes_first_and_hidden_players_stay_hidden() {
        let scouted = map_session(&ranked_session(), Some("me"), None, "euw1").expect("game");
        let game = &scouted.game;
        assert_eq!((game.game_id, game.queue_id), (7_100_000_001, 420));
        assert_eq!(game.allies.len(), 3);
        let me = &game.allies[0];
        assert!(me.is_me);
        assert_eq!(me.spells, vec![4, 12]);
        assert_eq!(me.role, Some(Role::Top));
        assert_eq!(
            me.riot_id.as_ref().map(|r| r.game_name.as_str()),
            Some("Fillmo")
        );
        assert_eq!(game.allies[1].spells, vec![11, 4], "matched by champion");
        let hidden = &game.enemies[1];
        assert!(hidden.hidden && hidden.riot_id.is_none());
        assert_eq!(hidden.spells, vec![11, 4]);
        // Looked up by Riot ID: the hidden enemy's name never leaves the mapper, and a player
        // without one (a2) can't be looked up.
        let wanted: Vec<String> = scouted
            .wanted()
            .iter()
            .map(|id| format!("{}#{}", id.game_name, id.tag_line))
            .collect();
        assert_eq!(wanted, ["Fillmo#7272", "Enemy#EUW"]);
        let debug = format!("{scouted:?}");
        assert!(!debug.contains("e2-secret") && !debug.contains("Streamer"));
        assert!(
            !debug.contains("\"me\""),
            "client PUUIDs stay out of the view"
        );
    }

    #[test]
    fn spectated_games_keep_the_client_order() {
        let scouted =
            map_session(&ranked_session(), Some("someone-else"), None, "euw1").expect("game");
        assert_eq!(scouted.game.allies[0].champion_id, Some(39));
        assert!(!scouted.game.allies.iter().any(|p| p.is_me));
    }

    /// A real client's session (2026-09-28, a custom game vs bots on the Rift): no names in the
    /// team entries, bots not listed at all, the queue a custom one.
    fn custom_session_as_the_client_sends_it() -> Value {
        json!({
            "phase": "InProgress",
            "gameData": {
                "gameId": 7_997_869_038_u64, "isCustomGame": true,
                "queue": { "id": 3100, "mapId": 11, "gameMode": "CLASSIC", "isCustom": true },
                "teamOne": [{ "championId": 85, "lastSelectedSkinIndex": 0, "profileIconId": 7148,
                              "puuid": "me", "selectedPosition": "MIDDLE",
                              "selectedRole": "MIDDLE.PRIMARY.MIDDLE.UNSELECTED",
                              "summonerId": 1, "summonerInternalName": "", "summonerName": "",
                              "teamOwner": false, "teamParticipantId": 1 }],
                "teamTwo": [],
                "playerChampionSelections": [{ "championId": 85, "puuid": "me", "selectedSkinIndex": 6, "spell1Id": 4, "spell2Id": 14 }]
            }
        })
    }

    #[test]
    fn the_local_player_is_named_from_their_own_summoner() {
        let me = riot_id("Fillmo", "7272");
        let session = custom_session_as_the_client_sends_it();
        let scouted = map_session(&session, Some("me"), Some(&me), "euw1").expect("game");
        let mine = &scouted.game.allies[0];
        assert!(mine.is_me);
        assert_eq!(mine.riot_id.as_ref(), Some(&me));
        assert_eq!(
            (mine.champion_id, mine.spells.as_slice()),
            (Some(85), [4, 14].as_slice())
        );
        assert_eq!(
            scouted.game.stats_queue,
            Some(420),
            "a custom game on the Rift: Rift builds"
        );
        assert_eq!(scouted.game.names, LiveNames::Asking);
        assert_eq!(scouted.wanted(), vec![me.clone()]);

        // Someone else's seat never borrows the local player's name.
        let other = map_session(&session, Some("someone-else"), Some(&me), "euw1").expect("game");
        assert_eq!(other.game.allies[0].riot_id, None);
    }

    #[test]
    fn builds_follow_the_map() {
        let mut session = custom_session_as_the_client_sends_it();
        let queue_of = |s: &Value| {
            map_session(s, None, None, "euw1")
                .expect("game")
                .game
                .stats_queue
        };
        session["gameData"]["queue"] = json!({ "id": 2400, "mapId": 12, "gameMode": "KIWI" });
        assert_eq!(
            queue_of(&session),
            Some(450),
            "ARAM: Mayhem is on Howling Abyss"
        );
        session["gameData"]["queue"] = json!({ "id": 720, "mapId": 12, "gameMode": "ARAM" });
        assert_eq!(queue_of(&session), Some(450), "ARAM Clash");
        session["gameData"]["queue"] = json!({ "id": 1700, "mapId": 30, "gameMode": "CHERRY" });
        assert_eq!(queue_of(&session), None, "Arena");
    }

    #[test]
    fn no_game_no_view() {
        assert!(
            map_session(
                &json!({ "phase": "None", "gameData": { "gameId": 0 } }),
                None,
                None,
                "euw1"
            )
            .is_none()
        );
        assert!(map_session(&json!({}), None, None, "euw1").is_none());
    }

    #[test]
    fn cards_fill_their_seats_by_riot_id() {
        let mut scouted = map_session(&ranked_session(), Some("me"), None, "euw1").expect("game");
        // The backend spells names the account's way: matched case-insensitively. Its PUUIDs
        // are its API key's, unrelated to the client's.
        let mut enemy = card("api-puuid-1", "ENEMY");
        enemy.riot_id = Some(riot_id("enemy", "euw"));
        scouted.apply(Ok(vec![enemy, card("api-puuid-2", "Stranger")]));
        assert_eq!(scouted.game.scouting, Scouting::Done);
        let seat = &scouted.game.enemies[0];
        assert_eq!(
            seat.card.as_ref().map(|c| c.puuid.as_str()),
            Some("api-puuid-1")
        );
        assert_eq!(
            seat.riot_id.as_ref().map(|r| r.game_name.as_str()),
            Some("Enemy"),
            "the client's spelling stays"
        );
        assert!(scouted.game.allies[0].card.is_none(), "no card for me");
        assert!(scouted.game.allies[1].card.is_none(), "no Riot ID, no card");
        assert!(scouted.game.enemies[1].card.is_none(), "hidden");

        let mut failed = map_session(&ranked_session(), Some("me"), None, "euw1").expect("game");
        failed.apply(Err(BackendError::RateLimited {
            retry_after: Some(3),
        }));
        assert!(matches!(failed.game.scouting, Scouting::Failed { .. }));
    }

    #[test]
    fn maps_regions_to_platforms() {
        assert_eq!(platform_for_region("EUW"), Some("euw1"));
        assert_eq!(platform_for_region("eune"), Some("eun1"));
        assert_eq!(platform_for_region("PBE"), None);
    }

    // ── Names from Riot's live game and from the game itself ──────────────────────────────────

    /// A ranked game as the client sends it today: names for nobody (the local player's comes
    /// from `current-summoner`), the local player on red side. Two allies play the same
    /// champion (a mode that allows it).
    fn nameless_session() -> Value {
        let member = |puuid: &str, champion: u32, position: &str| {
            json!({ "championId": champion, "puuid": puuid, "selectedPosition": position,
                    "summonerId": 1, "summonerInternalName": "", "summonerName": "" })
        };
        json!({ "phase": "InProgress", "gameData": {
            "gameId": 42, "queue": { "id": 420 },
            "teamOne": [member("c-e1", 39, "TOP"), member("c-e2", 234, "JUNGLE")],
            "teamTwo": [member("me", 54, "TOP"), member("c-a2", 1, "MIDDLE"), member("c-a3", 1, "UTILITY")],
            "playerChampionSelections": [{ "championId": 54, "puuid": "me", "spell1Id": 4, "spell2Id": 12 }]
        } })
    }

    fn participant(team_id: u32, champion_id: u32, name: Option<&str>) -> ActiveParticipant {
        ActiveParticipant {
            team_id,
            champion_id,
            riot_id: name.map(|n| riot_id(n, "EUW")),
            bot: false,
            spells: vec![4, 7],
            card: None,
        }
    }

    #[test]
    fn riot_names_the_seats_by_side_and_champion() {
        let me = riot_id("Fillmo", "7272");
        let mut scouted =
            map_session(&nameless_session(), Some("me"), Some(&me), "euw1").expect("game");
        let mut first = participant(200, 1, Some("First Annie"));
        first.card = Some(card("api-1", "First Annie"));
        let game = ActiveGame {
            game_id: 42,
            queue_id: 420,
            participants: vec![
                participant(100, 39, Some("Blade Dancer")),
                // Streamer mode: Riot keeps them anonymous.
                participant(100, 234, None),
                ActiveParticipant {
                    riot_id: Some(me.clone()),
                    ..participant(200, 54, None)
                },
                first,
                participant(200, 1, Some("Second Annie")),
            ],
            cards_complete: false,
        };
        scouted.named_by_riot(&game, Some(&me));
        assert_eq!(scouted.game.names, LiveNames::Known);
        let allies = &scouted.game.allies;
        assert!(allies[0].is_me && allies[0].riot_id.as_ref() == Some(&me));
        assert_eq!(allies[0].spells, vec![4, 12], "the client's spells stay");
        // The same champion twice on one side: in order.
        assert_eq!(allies[1].riot_id, Some(riot_id("First Annie", "EUW")));
        assert_eq!(
            allies[1].card.as_ref().map(|c| c.puuid.as_str()),
            Some("api-1")
        );
        assert_eq!(allies[2].riot_id, Some(riot_id("Second Annie", "EUW")));
        let enemies = &scouted.game.enemies;
        assert_eq!(enemies[0].riot_id, Some(riot_id("Blade Dancer", "EUW")));
        assert!(enemies[1].hidden && enemies[1].riot_id.is_none());
        // Cards left out by Riot's answer are asked of the batch; the ones it brought aren't.
        assert_eq!(
            scouted.wanted(),
            vec![
                me.clone(),
                riot_id("Second Annie", "EUW"),
                riot_id("Blade Dancer", "EUW")
            ]
        );
        let mut complete = game.clone();
        complete.cards_complete = true;
        let mut settled =
            map_session(&nameless_session(), Some("me"), Some(&me), "euw1").expect("game");
        settled.named_by_riot(&complete, Some(&me));
        assert!(settled.wanted().is_empty(), "every card was asked for");
    }

    #[test]
    fn a_hidden_seat_stays_hidden_and_players_the_session_missed_get_seats() {
        let me = riot_id("Fillmo", "7272");
        let session = custom_session_as_the_client_sends_it();
        let mut scouted = map_session(&session, Some("me"), Some(&me), "euw1").expect("game");
        let bot = |team_id, champion_id| ActiveParticipant {
            bot: true,
            ..participant(team_id, champion_id, None)
        };
        // A custom game against bots: the session listed the local player only.
        let game = ActiveGame {
            game_id: 7_997_869_038,
            queue_id: 0,
            participants: vec![
                ActiveParticipant {
                    riot_id: Some(me.clone()),
                    ..participant(100, 85, None)
                },
                bot(100, 22),
                bot(200, 1),
                bot(200, 11),
            ],
            cards_complete: false,
        };
        scouted.named_by_riot(&game, Some(&me));
        let allies = &scouted.game.allies;
        assert_eq!(allies.len(), 2);
        assert!(allies[1].bot && allies[1].riot_id.is_none() && !allies[1].hidden);
        assert_eq!(allies[1].champion_id, Some(22));
        assert_eq!(scouted.game.enemies.len(), 2);
        assert!(scouted.game.enemies.iter().all(|p| p.bot));
        assert_eq!(scouted.wanted(), vec![me], "bots are never looked up");

        // A seat the client hides stays hidden, whatever another list says.
        let mut ranked = map_session(&ranked_session(), Some("me"), None, "euw1").expect("game");
        ranked.named_by_riot(
            &ActiveGame {
                game_id: 7_100_000_001,
                queue_id: 420,
                participants: vec![participant(100, 234, Some("Leaked"))],
                cards_complete: true,
            },
            None,
        );
        let hidden = &ranked.game.enemies[1];
        assert!(hidden.hidden && hidden.riot_id.is_none());
    }

    #[test]
    fn the_side_comes_from_the_local_player_else_the_champions() {
        // No name for the local player in the list (streamer mode) and their team on the side
        // the session's order doesn't suggest: the champions tell the side.
        let mut scouted = map_session(&nameless_session(), Some("me"), None, "euw1").expect("game");
        let game = ActiveGame {
            game_id: 42,
            queue_id: 420,
            participants: vec![
                participant(200, 39, Some("Blade Dancer")),
                participant(100, 54, None),
                participant(100, 1, Some("Mid Annie")),
            ],
            cards_complete: true,
        };
        scouted.named_by_riot(&game, None);
        assert_eq!(
            scouted.game.allies[1].riot_id,
            Some(riot_id("Mid Annie", "EUW"))
        );
        assert_eq!(
            scouted.game.enemies[0].riot_id,
            Some(riot_id("Blade Dancer", "EUW"))
        );
        assert!(
            !scouted.game.allies[0].hidden,
            "the local player is never hidden"
        );
    }

    #[test]
    fn the_game_names_players_and_keeps_stand_ins_hidden() {
        let ids = game::tests::game_data();
        let me = riot_id("Fillmo", "7272");
        let mut scouted =
            map_session(&nameless_session(), Some("me"), Some(&me), "euw1").expect("game");
        let entry = |champion: &str, name: &str, tag: &str, team: &str, bot: bool| {
            json!({ "championName": champion,
                    "rawChampionName": format!("game_character_displayname_{champion}"),
                    "riotIdGameName": name, "riotIdTagLine": tag, "team": team, "isBot": bot })
        };
        let players: Vec<GamePlayer> = serde_json::from_value(json!([
            entry("Irelia", "Blade Dancer", "IRE", "ORDER", false),
            // Streamer mode: the champion's name stands in for the player's.
            entry("Viego", "Viego", "", "ORDER", false),
            entry("Malphite", "Fillmo", "7272", "CHAOS", false),
            entry("Annie", "Quiet Storm", "0412", "CHAOS", false),
            entry("Annie", "", "", "CHAOS", true),
        ]))
        .expect("players");
        scouted.name_from(&game::listed(&players, &ids), Some(&me));
        let allies = &scouted.game.allies;
        assert!(allies[0].is_me && allies[0].riot_id.as_ref() == Some(&me));
        assert_eq!(allies[1].riot_id, Some(riot_id("Quiet Storm", "0412")));
        assert!(allies[2].bot, "the second Annie is a bot");
        let enemies = &scouted.game.enemies;
        assert_eq!(enemies[0].riot_id, Some(riot_id("Blade Dancer", "IRE")));
        assert!(enemies[1].hidden && enemies[1].riot_id.is_none());
        assert!(
            !format!("{scouted:?}").contains("Viego"),
            "a stand-in name is never kept"
        );
        assert_eq!(
            scouted.wanted(),
            vec![
                me,
                riot_id("Quiet Storm", "0412"),
                riot_id("Blade Dancer", "IRE")
            ]
        );
    }
}
