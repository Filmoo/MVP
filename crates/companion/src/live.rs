//! Loading-screen scouting: the game session (League client) → the UI's [`LiveGame`], with a
//! scouting card per player from our backend.
//!
//! Policy (docs/policy.md): read only once the game starts (loading screen, in game), when
//! every player's name is shown by the game itself — never in champion select. Players hidden
//! by Riot (streamer mode) stay hidden: their identity fields are never read, never looked up.
//!
//! Players are looked up by **Riot ID**: the client's PUUIDs are not the ones our backend's
//! API key sees (Riot encrypts PUUIDs per key), so they never leave the core.

use domain::{BackendError, LiveGame, LivePlayer, RiotId, Role, ScoutCard, Scouting};
use lcu::LcuClient;
use serde_json::Value;
use tokio::sync::watch;

use crate::backend::BackendClient;
use crate::profile;

/// The gameflow session: teams, champions and spells once the game is found.
pub const SESSION: &str = "/lol-gameflow/v1/session";

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
    match position.to_ascii_uppercase().as_str() {
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
}

impl Scouted {
    fn seats_mut(&mut self) -> impl Iterator<Item = &mut LivePlayer> {
        self.game
            .allies
            .iter_mut()
            .chain(self.game.enemies.iter_mut())
    }

    /// Distinct Riot IDs to ask the backend about, in seat order. Hidden players have none
    /// (their names are never read), neither do bots.
    pub fn wanted(&self) -> Vec<RiotId> {
        let mut out: Vec<RiotId> = Vec::new();
        let seats = self.game.allies.iter().chain(&self.game.enemies);
        for id in seats
            .filter(|p| !p.hidden)
            .filter_map(|p| p.riot_id.as_ref())
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
                for player in self.seats_mut().filter(|p| !p.hidden) {
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
}

/// Maps one team member. Hidden players' identity fields are never read.
fn seat(member: &Value, selections: &[Value], my_puuid: Option<&str>) -> Seat {
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
    Seat {
        player: LivePlayer {
            champion_id,
            spells,
            role: str_at(member, "selectedPosition").and_then(role),
            is_me,
            hidden,
            riot_id,
            card: None,
        },
        puuid,
    }
}

/// Maps a gameflow session; `None` when it has no game (yet).
pub fn map_session(session: &Value, my_puuid: Option<&str>, platform: &str) -> Option<Scouted> {
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
            .map(|m| seat(m, &selections, my_puuid))
            .collect()
    };
    let (one, two) = (map(&one), map(&two));
    // Our side first; a spectated game keeps the client's order.
    let (allies, enemies) = if two.iter().any(|s| s.player.is_me) {
        (two, one)
    } else {
        (one, two)
    };
    Some(Scouted {
        game: LiveGame {
            game_id,
            queue_id: data
                .get("queue")
                .and_then(|q| u32_at(q, "id"))
                .unwrap_or_default(),
            platform: platform.to_owned(),
            allies: allies.into_iter().map(|s| s.player).collect(),
            enemies: enemies.into_iter().map(|s| s.player).collect(),
            scouting: Scouting::Loading,
        },
    })
}

/// Reads the game from the client, publishes it, asks the backend for the cards and publishes
/// them. Aborted by the core when the game ends. `backend` is `None` without one, or when the
/// remote config turned scouting off: the teams still show, without cards.
pub(crate) async fn scout_game(
    lcu: LcuClient,
    backend: Option<BackendClient>,
    live: watch::Sender<Option<LiveGame>>,
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
    let region = lcu.get::<Value>(profile::REGION).await.ok();
    let platform = region
        .as_ref()
        .and_then(|r| str_at(r, "region"))
        .and_then(platform_for_region)
        .unwrap_or("euw1");
    let Some(mut scouted) = map_session(&session, my_puuid, platform) else {
        tracing::debug!("no game in the session yet");
        return;
    };
    let wanted = scouted.wanted();
    if wanted.is_empty() {
        scouted.game.scouting = Scouting::Done;
        live.send_replace(Some(scouted.game));
        return;
    }
    live.send_replace(Some(scouted.game.clone()));
    let result = match backend {
        Some(backend) => backend.scout(platform, &wanted).await,
        None => Err(BackendError::Unavailable {
            message: "player cards are off (no backend, or turned off remotely)".to_owned(),
        }),
    };
    if let Err(error) = &result {
        tracing::warn!(%error, "scouting failed");
    }
    scouted.apply(result);
    live.send_replace(Some(scouted.game));
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{RankedEntry, Tier};
    use serde_json::json;

    /// Shaped like a real ranked session in game: one streamer-mode player on each side.
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

    fn card(puuid: &str, name: &str) -> ScoutCard {
        ScoutCard {
            puuid: puuid.to_owned(),
            riot_id: Some(RiotId {
                game_name: name.to_owned(),
                tag_line: "EUW".to_owned(),
            }),
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
        let scouted = map_session(&ranked_session(), Some("me"), "euw1").expect("game");
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
        let scouted = map_session(&ranked_session(), Some("someone-else"), "euw1").expect("game");
        assert_eq!(scouted.game.allies[0].champion_id, Some(39));
        assert!(!scouted.game.allies.iter().any(|p| p.is_me));
    }

    #[test]
    fn no_game_no_view() {
        assert!(
            map_session(
                &json!({ "phase": "None", "gameData": { "gameId": 0 } }),
                None,
                "euw1"
            )
            .is_none()
        );
        assert!(map_session(&json!({}), None, "euw1").is_none());
    }

    #[test]
    fn cards_fill_their_seats_by_riot_id() {
        let mut scouted = map_session(&ranked_session(), Some("me"), "euw1").expect("game");
        // The backend spells names the account's way: matched case-insensitively. Its PUUIDs
        // are its API key's, unrelated to the client's.
        let mut enemy = card("api-puuid-1", "ENEMY");
        enemy.riot_id = Some(RiotId {
            game_name: "enemy".to_owned(),
            tag_line: "euw".to_owned(),
        });
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

        let mut failed = map_session(&ranked_session(), Some("me"), "euw1").expect("game");
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
}
