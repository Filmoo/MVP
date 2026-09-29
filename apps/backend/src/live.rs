//! `GET /v1/live/{platform}/{gameName}/{tagLine}?gameId=`: the game a player is in, as Riot
//! shows it to apps (Spectator-V5), with the cards of its visible players.
//!
//! Policy (docs/policy.md, "Loading-screen scouting"): the app asks it for the local player
//! only, once their game has started. Riot keeps players in streamer mode anonymous here (no
//! PUUID): they get no name and are never looked up, whatever else Riot sends with them.
//!
//! Caching: a game's participants are kept for its duration (an hour), under each visible
//! player's PUUID, so the other players of the same game and retries are answered without
//! asking Riot again. The app names the game it is in (`gameId`): a kept game is never served
//! for the next one. Their accounts go to the account cache, so the scouting batch that may
//! follow costs no account-v1 call. Cards come from the batch's cache; those not ready within a
//! few seconds are left to the batch (`cardsComplete: false`) while their lookups carry on.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use domain::{ActiveGame, ActiveParticipant, RiotId, ScoutCard};
use players::RiotSource as _;
use riot_api::{Account, CurrentGame, Platform};
use serde::Deserialize;
use tokio::time::Instant;

use crate::source::CachedRiot;
use crate::{AppState, Failure, card_for, platform, riot_id_in_path, with_timeout};

/// How long a game's participants are kept: longer than games last.
pub(crate) const LIVE_TTL: Duration = Duration::from_secs(60 * 60);
/// One entry per visible player: about 2,000 games at once.
pub(crate) const LIVE_MAX: usize = 20_000;
/// Without a `gameId` to check it against, a kept game is trusted this long only.
const UNCHECKED_FRESH: Duration = Duration::from_secs(2 * 60);
/// Cards not ready by then are left to the batch: names shouldn't wait for slow cards.
const CARDS_BUDGET: Duration = Duration::from_secs(5);

/// A live game as kept: Riot's participants, with our key's PUUIDs for visible players only.
#[derive(Debug)]
pub(crate) struct LiveEntry {
    game_id: u64,
    queue_id: u32,
    fetched: Instant,
    seats: Vec<Seat>,
}

#[derive(Debug)]
struct Seat {
    team_id: u32,
    champion_id: u32,
    bot: bool,
    spells: Vec<u32>,
    /// Visible players: our key's PUUID and the Riot ID Riot shows. `None`: anonymous or a bot.
    visible: Option<(String, RiotId)>,
}

/// `gameName#tagLine` as Spectator-V5 writes it.
fn parse_riot_id(text: &str) -> Option<RiotId> {
    let (name, tag) = text.trim().rsplit_once('#')?;
    let (name, tag) = (name.trim(), tag.trim());
    (!name.is_empty() && !tag.is_empty()).then(|| RiotId {
        game_name: name.to_owned(),
        tag_line: tag.to_owned(),
    })
}

impl LiveEntry {
    fn from_riot(game: CurrentGame) -> Self {
        let seats = game
            .participants
            .into_iter()
            .map(|p| {
                let puuid = p.puuid.filter(|id| !id.trim().is_empty());
                // Riot keeps anonymous players without a PUUID: a name sent with one is dropped.
                let visible = if p.bot {
                    None
                } else {
                    puuid.zip(p.riot_id.as_deref().and_then(parse_riot_id))
                };
                Seat {
                    team_id: p.team_id,
                    champion_id: p.champion_id,
                    bot: p.bot,
                    spells: [p.spell1_id, p.spell2_id]
                        .into_iter()
                        .filter(|&id| id != 0)
                        .collect(),
                    visible,
                }
            })
            .collect();
        Self {
            game_id: game.game_id,
            queue_id: game.game_queue_config_id,
            fetched: Instant::now(),
            seats,
        }
    }

    fn visible(&self) -> impl Iterator<Item = &(String, RiotId)> {
        self.seats.iter().filter_map(|s| s.visible.as_ref())
    }

    /// Whether this kept game answers for `wanted` (the game the app says it is in).
    fn fits(&self, wanted: Option<u64>) -> bool {
        wanted.map_or_else(
            || self.fetched.elapsed() < UNCHECKED_FRESH,
            |id| id == self.game_id,
        )
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct LiveQuery {
    #[serde(rename = "gameId")]
    game_id: Option<u64>,
}

pub(crate) async fn live_game(
    State(state): State<AppState>,
    Path((platform_id, game_name, tag_line)): Path<(String, String, String)>,
    query: Result<Query<LiveQuery>, QueryRejection>,
) -> Result<Json<ActiveGame>, Failure> {
    let platform = platform(&platform_id)?;
    let riot_id = riot_id_in_path(&game_name, &tag_line)?;
    let Query(query) = query.map_err(|e| Failure::bad_request(e.body_text()))?;
    let riot = state.riot()?;
    let account =
        with_timeout(riot.account_by_riot_id(platform, &riot_id.game_name, &riot_id.tag_line))
            .await?;
    let entry = entry_for(&state, riot, platform, &account.puuid, query.game_id).await?;
    let (cards, complete) = cards(&state, platform, &entry).await;
    Ok(Json(answer(&entry, cards, complete)))
}

/// The game `puuid` is in: kept, or asked of Riot and kept for everyone visible in it.
async fn entry_for(
    state: &AppState,
    riot: &CachedRiot,
    platform: Platform,
    puuid: &str,
    wanted: Option<u64>,
) -> Result<Arc<LiveEntry>, Failure> {
    let key = (platform, puuid.to_owned());
    if let Some(kept) = state.0.live.get(&key)
        && kept.fits(wanted)
    {
        return Ok(kept);
    }
    let game = with_timeout(riot.current_game(platform, puuid)).await?;
    let entry = Arc::new(LiveEntry::from_riot(game));
    if wanted.is_some_and(|id| id != entry.game_id) {
        // Riot lists another game for them: not the one being played (yet).
        return Err(Failure::not_found());
    }
    state.0.live.insert(key, Arc::clone(&entry));
    for (puuid, id) in entry.visible() {
        state
            .0
            .live
            .insert((platform, puuid.clone()), Arc::clone(&entry));
        riot.remember_account(&account(puuid, id));
    }
    Ok(entry)
}

fn account(puuid: &str, id: &RiotId) -> Account {
    Account {
        puuid: puuid.to_owned(),
        game_name: Some(id.game_name.clone()),
        tag_line: Some(id.tag_line.clone()),
    }
}

/// Cards of the visible players, by PUUID, and whether every one was asked for in time. The
/// lookups run on their own: one that outlasts the budget still fills the card cache.
async fn cards(
    state: &AppState,
    platform: Platform,
    entry: &LiveEntry,
) -> (HashMap<String, ScoutCard>, bool) {
    let deadline = Instant::now() + CARDS_BUDGET;
    let lookups: Vec<_> = entry
        .visible()
        .map(|(puuid, id)| {
            let state = state.clone();
            let account = account(puuid, id);
            let lookup = tokio::spawn(async move {
                let riot = state.riot().ok()?;
                Some(card_for(&state, riot, platform, account).await)
            });
            (puuid.clone(), lookup)
        })
        .collect();
    let mut cards = HashMap::new();
    let mut complete = true;
    for (puuid, lookup) in lookups {
        match tokio::time::timeout_at(deadline, lookup).await {
            Ok(Ok(Some(Ok(Some(card))))) => {
                cards.insert(puuid, card);
            }
            // Riot doesn't know them: no card.
            Ok(Ok(Some(Ok(None)))) => {}
            Ok(Ok(Some(Err(error)))) => {
                tracing::info!(%error, "live game: a card is left to the batch");
                complete = false;
            }
            // No key any more, a panic, or still running (it carries on).
            Ok(Ok(None) | Err(_)) | Err(_) => complete = false,
        }
    }
    (cards, complete)
}

fn answer(entry: &LiveEntry, mut cards: HashMap<String, ScoutCard>, complete: bool) -> ActiveGame {
    ActiveGame {
        game_id: entry.game_id,
        queue_id: entry.queue_id,
        participants: entry
            .seats
            .iter()
            .map(|seat| ActiveParticipant {
                team_id: seat.team_id,
                champion_id: seat.champion_id,
                riot_id: seat.visible.as_ref().map(|(_, id)| id.clone()),
                bot: seat.bot,
                spells: seat.spells.clone(),
                card: seat
                    .visible
                    .as_ref()
                    .and_then(|(puuid, _)| cards.remove(puuid)),
            })
            .collect(),
        cards_complete: complete,
    }
}

#[cfg(test)]
mod tests {
    use riot_api::CurrentGameParticipant;

    use super::*;

    fn participant(
        puuid: Option<&str>,
        riot_id: Option<&str>,
        bot: bool,
    ) -> CurrentGameParticipant {
        CurrentGameParticipant {
            puuid: puuid.map(str::to_owned),
            riot_id: riot_id.map(str::to_owned),
            team_id: 100,
            champion_id: 103,
            bot,
            spell1_id: 4,
            spell2_id: 0,
        }
    }

    #[tokio::test]
    async fn anonymous_players_and_bots_get_no_name() {
        let entry = LiveEntry::from_riot(CurrentGame {
            game_id: 1,
            game_queue_config_id: 420,
            participants: vec![
                participant(Some("p1"), Some("Quiet Storm#0412"), false),
                // Riot withheld the PUUID: whatever name comes with it isn't used.
                participant(None, Some("Streamer#LIVE"), false),
                participant(Some(""), Some("Streamer#LIVE"), false),
                participant(Some("p2"), Some("no tag"), false),
                participant(None, Some("Annie Bot#BOT"), true),
            ],
        });
        let visible: Vec<&str> = entry.visible().map(|(p, _)| p.as_str()).collect();
        assert_eq!(visible, ["p1"]);
        let game = answer(&entry, HashMap::new(), true);
        assert_eq!(
            game.participants[0]
                .riot_id
                .as_ref()
                .map(|r| r.tag_line.as_str()),
            Some("0412")
        );
        assert!(game.participants[1].hidden() && game.participants[2].hidden());
        assert!(game.participants[3].hidden(), "no Riot ID: anonymous");
        assert!(game.participants[4].bot && !game.participants[4].hidden());
        assert_eq!(game.participants[0].spells, [4], "no second spell");
    }

    #[tokio::test(start_paused = true)]
    async fn kept_games_answer_their_own_game_only() {
        let entry = LiveEntry::from_riot(CurrentGame {
            game_id: 7,
            game_queue_config_id: 420,
            participants: Vec::new(),
        });
        assert!(entry.fits(Some(7)));
        assert!(!entry.fits(Some(8)));
        assert!(entry.fits(None));
        tokio::time::advance(UNCHECKED_FRESH).await;
        assert!(!entry.fits(None), "unchecked, too old");
        assert!(entry.fits(Some(7)), "the game itself, for its duration");
    }

    #[test]
    fn reads_riot_ids() {
        assert_eq!(
            parse_riot_id(" Blade Dancer#IRE "),
            Some(RiotId {
                game_name: "Blade Dancer".to_owned(),
                tag_line: "IRE".to_owned()
            })
        );
        for bad in ["", "#EUW", "Name#", "Name"] {
            assert_eq!(parse_riot_id(bad), None, "{bad}");
        }
    }
}
