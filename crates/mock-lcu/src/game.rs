//! A fake in-game Live Client Data API: what the game itself serves on
//! `https://127.0.0.1:2999` while it runs (no auth, the League client's root). Documents at
//! paths, 404 until set: the real one only answers once the game has loaded. Every request is
//! counted, for tests that check nobody asks it outside a game.
//!
//! [`player`] and [`all_game_data`] build documents in the real shape (2026-09 client):
//! `allPlayers[]` with Riot IDs, champions as `championName` and `rawChampionName`, `team`
//! `ORDER`/`CHAOS`, `isBot`, spells by their raw names.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::{MockError, lock, serve};

/// The whole game's data; its `allPlayers` list names every player.
pub const ALL_GAME_DATA: &str = "/liveclientdata/allgamedata";
/// The players only.
pub const PLAYER_LIST: &str = "/liveclientdata/playerlist";

#[derive(Debug, Default)]
struct Shared {
    docs: Mutex<HashMap<String, Value>>,
    requests: Mutex<Vec<String>>,
}

/// A running fake game API. Dropping it stops the server.
#[derive(Debug)]
pub struct MockGame {
    addr: SocketAddr,
    shared: Arc<Shared>,
    server: JoinHandle<()>,
}

impl Drop for MockGame {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl MockGame {
    pub(crate) async fn start(tls: Arc<rustls::ServerConfig>) -> Result<Self, MockError> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let addr = listener.local_addr()?;
        let shared = Arc::new(Shared::default());
        let app = Router::new()
            .fallback(handle)
            .with_state(Arc::clone(&shared));
        Ok(Self {
            addr,
            shared,
            server: serve(listener, tls, app),
        })
    }

    /// `https://127.0.0.1:{port}`: where the app should look for the game.
    pub fn url(&self) -> String {
        format!("https://127.0.0.1:{}", self.addr.port())
    }

    /// Serves `value` at `path` (e.g. [`ALL_GAME_DATA`]): the game has loaded.
    pub fn set(&self, path: &str, value: Value) {
        lock(&self.shared.docs).insert(path.to_owned(), value);
    }

    /// Serves the players at [`ALL_GAME_DATA`] and [`PLAYER_LIST`].
    pub fn set_players(&self, players: &[Value]) {
        self.set(ALL_GAME_DATA, all_game_data(players));
        self.set(PLAYER_LIST, Value::Array(players.to_vec()));
    }

    /// Nothing served any more (the game ended).
    pub fn clear(&self) {
        lock(&self.shared.docs).clear();
    }

    /// Requests for `path` so far.
    pub fn count(&self, path: &str) -> usize {
        lock(&self.shared.requests)
            .iter()
            .filter(|p| *p == path)
            .count()
    }

    /// Every request so far, whatever the path.
    pub fn total(&self) -> usize {
        lock(&self.shared.requests).len()
    }
}

async fn handle(State(shared): State<Arc<Shared>>, uri: Uri) -> Response {
    lock(&shared.requests).push(uri.path().to_owned());
    let doc = lock(&shared.docs).get(uri.path()).cloned();
    match doc {
        Some(doc) => (StatusCode::OK, axum::Json(doc)).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            axum::Json(json!({
                "errorCode": "RESOURCE_NOT_FOUND", "httpStatus": 404,
                "implementationDetails": {}, "message": "No game data yet"
            })),
        )
            .into_response(),
    }
}

/// One player as the game lists them. `riot_id` is `None` for a player in streamer mode: the
/// game shows their champion's name instead, with no tag. `champion` is the Data Dragon key
/// (`MonkeyKing`), also used as the display name; `spells` are Data Dragon keys
/// (`SummonerFlash`); `team` is `ORDER` (blue) or `CHAOS` (red).
pub fn player(
    riot_id: Option<&str>,
    champion: &str,
    team: &str,
    position: &str,
    spells: [&str; 2],
    bot: bool,
) -> Value {
    let (game_name, tag_line) = riot_id
        .and_then(|id| id.split_once('#'))
        .unwrap_or((champion, ""));
    let shown = if tag_line.is_empty() {
        game_name.to_owned()
    } else {
        format!("{game_name}#{tag_line}")
    };
    let spell = |key: &str| {
        json!({
            "displayName": key.trim_start_matches("Summoner"),
            "rawDescription": format!("GeneratedTip_SummonerSpell_{key}_Description"),
            "rawDisplayName": format!("GeneratedTip_SummonerSpell_{key}_DisplayName"),
        })
    };
    json!({
        "championName": champion,
        "isBot": bot,
        "isDead": false,
        "items": [],
        "level": 1,
        "position": position,
        "rawChampionName": format!("game_character_displayname_{champion}"),
        "rawSkinName": format!("game_character_skin_displayname_{champion}_0"),
        "respawnTimer": 0.0,
        "riotId": shown,
        "riotIdGameName": game_name,
        "riotIdTagLine": tag_line,
        "runes": {},
        "scores": { "assists": 0, "creepScore": 0, "deaths": 0, "kills": 0, "wardScore": 0.0 },
        "skinID": 0,
        "summonerName": shown,
        "summonerSpells": { "summonerSpellOne": spell(spells[0]), "summonerSpellTwo": spell(spells[1]) },
        "team": team,
    })
}

/// `/liveclientdata/allgamedata` a few seconds into a game, around `players`.
pub fn all_game_data(players: &[Value]) -> Value {
    json!({
        "activePlayer": { "level": 1, "currentGold": 500.0 },
        "allPlayers": players,
        "events": { "Events": [{ "EventID": 0, "EventName": "GameStart", "EventTime": 0.05 }] },
        "gameData": { "gameMode": "CLASSIC", "gameTime": 8.2, "mapName": "Map11", "mapNumber": 11, "mapTerrain": "Default" },
    })
}
