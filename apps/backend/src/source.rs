//! The Riot client behind caches: accounts for a day, finished matches for good (LRU bounded).

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use players::RiotSource;
use riot_api::{Account, LeagueEntry, MatchQuery, Platform, RiotClient, RiotError, Summoner};
use serde_json::{Map, Value};

use crate::cache::Cache;

const ACCOUNT_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const ACCOUNTS_MAX: usize = 50_000;
/// Compacted matches weigh ~2 KB: 20,000 of them stay well under 100 MB.
const MATCHES_MAX: usize = 20_000;

#[derive(Debug)]
pub struct CachedRiot {
    client: RiotClient,
    /// Keyed by lower-cased `(gameName, tagLine)`: Riot IDs are case-insensitive.
    accounts_by_riot_id: Cache<(String, String), Account>,
    accounts_by_puuid: Cache<String, Account>,
    /// Match ids are globally unique (`EUW1_…`) and finished games never change.
    matches: Cache<String, Arc<Value>>,
}

impl CachedRiot {
    pub fn new(client: RiotClient) -> Self {
        Self {
            client,
            accounts_by_riot_id: Cache::new(Some(ACCOUNT_TTL), ACCOUNTS_MAX),
            accounts_by_puuid: Cache::new(Some(ACCOUNT_TTL), ACCOUNTS_MAX),
            matches: Cache::new(None, MATCHES_MAX),
        }
    }
}

const MATCH_INFO_FIELDS: [&str; 4] = [
    "gameDuration",
    "gameEndTimestamp",
    "gameStartTimestamp",
    "queueId",
];
const PARTICIPANT_FIELDS: [&str; 16] = [
    "puuid",
    "championId",
    "teamPosition",
    "win",
    "kills",
    "deaths",
    "assists",
    "totalMinionsKilled",
    "neutralMinionsKilled",
    "item0",
    "item1",
    "item2",
    "item3",
    "item4",
    "item5",
    "item6",
];

fn pick(from: &Value, fields: &[&str]) -> Value {
    let mut out = Map::new();
    for &f in fields {
        if let Some(v) = from.get(f) {
            out.insert(f.to_owned(), v.clone());
        }
    }
    Value::Object(out)
}

/// Keeps only what player views read from a Match-V5 document (~50× smaller).
pub fn compact_match(game: &Value) -> Value {
    let mut info = pick(game.get("info").unwrap_or(&Value::Null), &MATCH_INFO_FIELDS);
    let participants: Vec<Value> = game
        .pointer("/info/participants")
        .and_then(Value::as_array)
        .map(|ps| ps.iter().map(|p| pick(p, &PARTICIPANT_FIELDS)).collect())
        .unwrap_or_default();
    if let Value::Object(map) = &mut info {
        map.insert("participants".to_owned(), Value::Array(participants));
    }
    let mut metadata = Map::new();
    if let Some(id) = game.pointer("/metadata/matchId") {
        metadata.insert("matchId".to_owned(), id.clone());
    }
    let mut out = Map::new();
    out.insert("metadata".to_owned(), Value::Object(metadata));
    out.insert("info".to_owned(), info);
    Value::Object(out)
}

impl RiotSource for CachedRiot {
    fn account_by_riot_id(
        &self,
        platform: Platform,
        game_name: &str,
        tag_line: &str,
    ) -> impl Future<Output = Result<Account, RiotError>> + Send {
        let key = (game_name.to_lowercase(), tag_line.to_lowercase());
        self.accounts_by_riot_id.get_or_try_insert(key, move || {
            self.client
                .account_by_riot_id(platform, game_name, tag_line)
        })
    }

    fn account_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Account, RiotError>> + Send {
        self.accounts_by_puuid
            .get_or_try_insert(puuid.to_owned(), move || {
                self.client.account_by_puuid(platform, puuid)
            })
    }

    fn summoner_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Summoner, RiotError>> + Send {
        self.client.summoner_by_puuid(platform, puuid)
    }

    fn league_entries_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Vec<LeagueEntry>, RiotError>> + Send {
        self.client.league_entries_by_puuid(platform, puuid)
    }

    fn match_ids(
        &self,
        platform: Platform,
        puuid: &str,
        query: &MatchQuery,
    ) -> impl Future<Output = Result<Vec<String>, RiotError>> + Send {
        self.client.match_ids(platform, puuid, query)
    }

    fn match_by_id(
        &self,
        platform: Platform,
        match_id: &str,
    ) -> impl Future<Output = Result<Arc<Value>, RiotError>> + Send {
        self.matches
            .get_or_try_insert(match_id.to_owned(), move || async move {
                let game = self.client.match_by_id(platform, match_id).await?;
                Ok(Arc::new(compact_match(&game)))
            })
    }
}

// ---- Access for the disk snapshot (store.rs) and metrics (ops.rs) ----
pub(crate) type AccountCache = Cache<(String, String), Account>;

impl CachedRiot {
    pub(crate) fn client(&self) -> &RiotClient {
        &self.client
    }

    /// Accounts by Riot ID, accounts by PUUID, compacted matches.
    pub(crate) fn caches(
        &self,
    ) -> (
        &AccountCache,
        &Cache<String, Account>,
        &Cache<String, Arc<Value>>,
    ) {
        (
            &self.accounts_by_riot_id,
            &self.accounts_by_puuid,
            &self.matches,
        )
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn compaction_keeps_what_players_read() {
        let game = json!({
            "metadata": { "matchId": "EUW1_1", "participants": ["me"], "dataVersion": "2" },
            "info": {
                "gameDuration": 1742, "gameEndTimestamp": 1_790_000_000_000_i64, "queueId": 420,
                "gameMode": "CLASSIC", "teams": [{ "teamId": 100 }],
                "participants": [{
                    "puuid": "me", "championId": 103, "teamPosition": "MIDDLE", "win": true,
                    "kills": 9, "deaths": 2, "assists": 11, "totalMinionsKilled": 211,
                    "neutralMinionsKilled": 20, "item0": 6655, "item1": 3020, "item6": 3340,
                    "challenges": { "kda": 10 }, "perks": { "styles": [] }
                }]
            }
        });
        let small = compact_match(&game);
        assert_eq!(
            players::match_summary(&small, "me"),
            players::match_summary(&game, "me")
        );
        assert!(small.pointer("/info/participants/0/challenges").is_none());
        assert!(small.pointer("/info/teams").is_none());
    }
}
