//! The game's own Live Client Data API (`https://127.0.0.1:2999`): its player list names
//! everyone once the game has loaded. Served by the game while it runs, on the League client's
//! root (no auth, loopback only). Asked only while a game runs and until it answers.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use domain::{GameData, RiotId};
use serde::Deserialize;

use super::seats::{Listed, Side, Who};
use super::{role, same_riot_id};

/// Where the game serves it.
pub const GAME_CLIENT_URL: &str = "https://127.0.0.1:2999";
/// The whole game's data: only its player list is read.
pub const ALL_GAME_DATA: &str = "/liveclientdata/allgamedata";
/// After this long without an answer the game is asked less often (it may never load: a
/// crash, a spectated game…); the game's end stops the asking anyway.
const PATIENT_FOR: Duration = Duration::from_secs(90);

/// Numeric ids of what the game names in words: champions by Data Dragon key (`MonkeyKing`,
/// the game's `rawChampionName`) or name (`Wukong`), summoner spells by key (`SummonerFlash`)
/// or name. The shell answers from the loaded game data.
pub trait GameIds: Send + Sync {
    fn champion(&self, name: &str) -> Option<u32>;
    fn spell(&self, name: &str) -> Option<u32>;
}

/// No game data (yet): the game's players can't be matched to seats by champion.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoGameIds;

impl GameIds for NoGameIds {
    fn champion(&self, _: &str) -> Option<u32> {
        None
    }

    fn spell(&self, _: &str) -> Option<u32> {
        None
    }
}

impl GameIds for GameData {
    fn champion(&self, name: &str) -> Option<u32> {
        let name = name.trim();
        self.champions
            .iter()
            .find(|c| c.key.eq_ignore_ascii_case(name) || c.name.eq_ignore_ascii_case(name))
            .map(|c| c.id)
    }

    fn spell(&self, name: &str) -> Option<u32> {
        let name = name.trim();
        self.summoner_spells
            .iter()
            .find(|s| s.key.eq_ignore_ascii_case(name) || s.name.eq_ignore_ascii_case(name))
            .map(|s| s.id)
    }
}

/// `/liveclientdata/allgamedata`, only what naming the seats needs.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AllGameData {
    all_players: Vec<GamePlayer>,
}

/// One player as the game lists them.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GamePlayer {
    /// Display name in the game's language (`Wukong`).
    pub champion_name: String,
    /// `game_character_displayname_MonkeyKing`: the Data Dragon key after the prefix.
    pub raw_champion_name: String,
    pub is_bot: bool,
    /// `gameName#tagLine`.
    pub riot_id: String,
    pub riot_id_game_name: String,
    pub riot_id_tag_line: String,
    /// `ORDER` (blue) or `CHAOS` (red).
    pub team: String,
    /// `TOP`… on Summoner's Rift, `NONE` or empty elsewhere.
    pub position: String,
    pub summoner_spells: GameSpells,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GameSpells {
    pub summoner_spell_one: GameSpell,
    pub summoner_spell_two: GameSpell,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GameSpell {
    pub display_name: String,
    /// `GeneratedTip_SummonerSpell_SummonerFlash_DisplayName`.
    pub raw_display_name: String,
}

/// Asks the game for its players (cheap to clone).
#[derive(Clone)]
pub struct GameClient {
    http: reqwest::Client,
    base: String,
    poll: Duration,
}

impl fmt::Debug for GameClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GameClient")
            .field("base", &self.base)
            .field("poll", &self.poll)
            .finish_non_exhaustive()
    }
}

impl GameClient {
    /// `base` without a trailing slash (`GAME_CLIENT_URL`); `tls` trusts the League client's
    /// root, which the game's certificate chains to.
    pub fn new(
        base: &str,
        poll: Duration,
        tls: Arc<rustls::ClientConfig>,
    ) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(Arc::unwrap_or_clone(tls))
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(4))
            .no_proxy()
            .build()?;
        Ok(Self {
            http,
            base: base.trim().trim_end_matches('/').to_owned(),
            poll,
        })
    }

    /// The game's players, or why it doesn't list them now (not before it has loaded).
    pub async fn players(&self) -> Result<Vec<GamePlayer>, String> {
        let url = format!("{}{ALL_GAME_DATA}", self.base);
        let response = self.http.get(url).send().await.map_err(|e| {
            if e.is_connect() {
                "not listening".to_owned()
            } else {
                // TLS or transport: worth knowing when the game never answers.
                format!("{e:?}")
            }
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let data: AllGameData = response
            .json()
            .await
            .map_err(|e| format!("unexpected answer: {e}"))?;
        if data.all_players.is_empty() {
            return Err("no players listed".to_owned());
        }
        Ok(data.all_players)
    }

    /// Asks until the game answers, then never again: every `poll`, five times less often
    /// after a minute and a half. Stopped (dropped) when the game ends. Logs each new reason it
    /// gets no answer for (not every attempt).
    pub async fn wait_for_players(&self) -> Vec<GamePlayer> {
        let started = tokio::time::Instant::now();
        let mut last_reason = String::new();
        loop {
            match self.players().await {
                Ok(players) => return players,
                Err(reason) if reason != last_reason => {
                    tracing::info!(%reason, "the game's API doesn't list the players yet");
                    last_reason = reason;
                }
                Err(_) => {}
            }
            let pause = if started.elapsed() < PATIENT_FOR {
                self.poll
            } else {
                self.poll * 5
            };
            tokio::time::sleep(pause).await;
        }
    }
}

const RAW_CHAMPION: &str = "game_character_displayname_";
const RAW_SPELL: (&str, &str) = ("GeneratedTip_SummonerSpell_", "_DisplayName");

/// `MonkeyKing` out of `game_character_displayname_MonkeyKing`.
fn raw_champion(player: &GamePlayer) -> Option<&str> {
    player
        .raw_champion_name
        .trim()
        .strip_prefix(RAW_CHAMPION)
        .filter(|key| !key.is_empty())
}

fn champion(player: &GamePlayer, ids: &dyn GameIds) -> Option<u32> {
    raw_champion(player)
        .and_then(|key| ids.champion(key))
        .or_else(|| ids.champion(&player.champion_name))
}

fn spell(spell: &GameSpell, ids: &dyn GameIds) -> Option<u32> {
    spell
        .raw_display_name
        .trim()
        .strip_prefix(RAW_SPELL.0)
        .and_then(|rest| rest.strip_suffix(RAW_SPELL.1))
        .and_then(|key| ids.spell(key))
        .or_else(|| ids.spell(&spell.display_name))
}

/// The Riot ID the game shows, if it shows a whole one.
fn shown_riot_id(player: &GamePlayer) -> Option<RiotId> {
    let (name, tag) = if player.riot_id_game_name.trim().is_empty() {
        player.riot_id.trim().rsplit_once('#')?
    } else {
        (
            player.riot_id_game_name.as_str(),
            player.riot_id_tag_line.as_str(),
        )
    };
    let (name, tag) = (name.trim(), tag.trim());
    (!name.is_empty() && !tag.is_empty()).then(|| RiotId {
        game_name: name.to_owned(),
        tag_line: tag.to_owned(),
    })
}

/// Streamer mode shows a champion's name where the player's would be.
fn champion_as_name(id: &RiotId, player: &GamePlayer) -> bool {
    let name = id.game_name.trim();
    [
        player.champion_name.trim(),
        raw_champion(player).unwrap_or(""),
    ]
    .iter()
    .any(|champion| !champion.is_empty() && name.eq_ignore_ascii_case(champion))
}

/// The game's list as seats can be named from it. Riot gives no reliable identifier for players
/// in streamer mode here: a missing or partial Riot ID, a champion's name in its place, or a
/// name several players share is a stand-in, never taken for a Riot ID (those players stay
/// hidden). Bots are bots.
pub(crate) fn listed(players: &[GamePlayer], ids: &dyn GameIds) -> Vec<Listed> {
    let names: Vec<Option<RiotId>> = players.iter().map(shown_riot_id).collect();
    let shared = |id: &RiotId| {
        names
            .iter()
            .flatten()
            .filter(|other| same_riot_id(other, id))
            .count()
            > 1
    };
    players
        .iter()
        .zip(&names)
        .map(|(player, name)| {
            let who = if player.is_bot {
                Who::Bot
            } else {
                match name {
                    Some(id) if !champion_as_name(id, player) && !shared(id) => {
                        Who::Named(id.clone())
                    }
                    _ => Who::Hidden,
                }
            };
            Listed {
                side: if player.team.trim().eq_ignore_ascii_case("CHAOS") {
                    Side::Red
                } else {
                    Side::Blue
                },
                champion_id: champion(player, ids),
                who,
                spells: [
                    &player.summoner_spells.summoner_spell_one,
                    &player.summoner_spells.summoner_spell_two,
                ]
                .into_iter()
                .filter_map(|s| spell(s, ids))
                .collect(),
                role: role(&player.position),
                card: None,
            }
        })
        .collect()
}

#[cfg(test)]
pub(super) mod tests {
    use domain::{ChampionInfo, SpellInfo};
    use serde_json::json;

    use super::*;

    /// A few champions and spells, as Data Dragon names them.
    pub(crate) fn game_data() -> GameData {
        let champion = |id, key: &str, name: &str| ChampionInfo {
            id,
            key: key.to_owned(),
            name: name.to_owned(),
            tags: Vec::new(),
        };
        let spell = |id, key: &str, name: &str| SpellInfo {
            id,
            key: key.to_owned(),
            name: name.to_owned(),
        };
        GameData {
            version: "16.19.1".to_owned(),
            asset_base: String::new(),
            art_base: String::new(),
            champions: vec![
                champion(62, "MonkeyKing", "Wukong"),
                champion(103, "Ahri", "Ahri"),
                champion(1, "Annie", "Annie"),
                champion(9, "Fiddlesticks", "Fiddlesticks"),
                champion(54, "Malphite", "Malphite"),
                champion(39, "Irelia", "Irelia"),
                champion(234, "Viego", "Viego"),
            ],
            items: Vec::new(),
            summoner_spells: vec![
                spell(4, "SummonerFlash", "Flash"),
                spell(14, "SummonerDot", "Ignite"),
            ],
            runes: Vec::new(),
        }
    }

    fn player(value: serde_json::Value) -> GamePlayer {
        serde_json::from_value(value).expect("a player")
    }

    #[test]
    fn reads_champions_and_spells_by_their_raw_names() {
        let ids = game_data();
        let wukong = player(json!({
            "championName": "Wukong", "rawChampionName": "game_character_displayname_MonkeyKing",
            "riotIdGameName": "Treeline Tom", "riotIdTagLine": "EUW", "team": "CHAOS", "position": "JUNGLE",
            "summonerSpells": {
                "summonerSpellOne": { "displayName": "Flash", "rawDisplayName": "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" },
                "summonerSpellTwo": { "displayName": "Allumage", "rawDisplayName": "GeneratedTip_SummonerSpell_SummonerDot_DisplayName" }
            }
        }));
        // The raw name's case differs from Data Dragon's for some champions.
        let fiddle = player(json!({
            "championName": "Fiddlesticks", "rawChampionName": "game_character_displayname_FiddleSticks",
            "riotId": "Quiet Storm#0412", "team": "ORDER"
        }));
        let listed = listed(&[wukong, fiddle], &ids);
        assert_eq!(listed[0].champion_id, Some(62));
        assert_eq!(listed[0].side, Side::Red);
        assert_eq!(
            listed[0].spells,
            vec![4, 14],
            "by key, whatever the game's language"
        );
        assert_eq!(listed[0].role, Some(domain::Role::Jungle));
        assert_eq!(listed[1].champion_id, Some(9));
        assert_eq!(listed[1].side, Side::Blue);
        assert_eq!(
            listed[1].who,
            Who::Named(RiotId {
                game_name: "Quiet Storm".to_owned(),
                tag_line: "0412".to_owned()
            }),
            "from riotId when the parts are missing"
        );
        let unknown = super::listed(
            &[player(json!({ "championName": "Nobody", "team": "ORDER" }))],
            &NoGameIds,
        );
        assert_eq!(unknown[0].champion_id, None);
    }

    #[test]
    fn stand_in_names_are_never_taken_for_riot_ids() {
        let ids = game_data();
        let entry = |name: &str, tag: &str, champion: &str| {
            player(json!({
                "championName": champion, "rawChampionName": format!("game_character_displayname_{champion}"),
                "riotIdGameName": name, "riotIdTagLine": tag, "riotId": format!("{name}#{tag}"), "team": "ORDER"
            }))
        };
        let players = [
            entry("Blade Dancer", "IRE", "Ahri"),
            // Streamer mode: the champion's name, with or without a tag, or nothing at all.
            entry("Annie", "", "Annie"),
            entry("ahri", "EUW", "Ahri"),
            entry("", "", "Annie"),
            // One stand-in name for two players: neither is a Riot ID.
            entry("Player", "0000", "Annie"),
            entry("Player", "0000", "MonkeyKing"),
        ];
        let who: Vec<Who> = listed(&players, &ids).into_iter().map(|l| l.who).collect();
        assert!(matches!(&who[0], Who::Named(id) if id.game_name == "Blade Dancer"));
        assert!(who[1..].iter().all(|w| *w == Who::Hidden), "{who:?}");

        let bot = player(
            json!({ "championName": "Annie", "isBot": true, "riotId": "Annie Bot", "team": "CHAOS" }),
        );
        assert_eq!(listed(&[bot], &ids)[0].who, Who::Bot);
    }
}
