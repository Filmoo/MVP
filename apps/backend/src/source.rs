//! The Riot client behind caches: accounts for a day, finished matches for good (LRU bounded).
//!
//! Matches are kept compacted (what player views, grades and match details read) as JSON text
//! and parsed when read: a few KB each, several times less than the same document held as a
//! `serde_json::Value` tree.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use players::RiotSource;
use riot_api::{
    Account, CurrentGame, LeagueEntry, MatchQuery, Platform, RiotClient, RiotError, Summoner,
};
use serde_json::{Map, Value};

use crate::cache::Cache;

const ACCOUNT_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const ACCOUNTS_MAX: usize = 50_000;
/// Compacted matches weigh under 11 KB as text (their end-of-game stats doubled them; a test
/// checks it on a whole game): 12,000 of them stay around 130 MB.
const MATCHES_MAX: usize = 12_000;

#[derive(Debug)]
pub struct CachedRiot {
    client: RiotClient,
    /// Keyed by lower-cased `(gameName, tagLine)`: Riot IDs are case-insensitive.
    accounts_by_riot_id: Cache<(String, String), Account>,
    accounts_by_puuid: Cache<String, Account>,
    /// Match ids are globally unique (`EUW1_…`) and finished games never change. Compacted
    /// JSON text (see [`compact_match`]).
    matches: Cache<String, Arc<str>>,
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
/// What a player's history, the grades and the match details (their end-of-game stats included)
/// read, for every participant. `perks` is rebuilt with the keystone and the secondary tree only.
const PARTICIPANT_FIELDS: [&str; 45] = [
    "puuid",
    "riotIdGameName",
    "riotIdTagline",
    "teamId",
    "championId",
    "champLevel",
    "teamPosition",
    "win",
    "kills",
    "deaths",
    "assists",
    "totalMinionsKilled",
    "neutralMinionsKilled",
    "goldEarned",
    "totalDamageDealtToChampions",
    "totalDamageTaken",
    "damageSelfMitigated",
    "visionScore",
    "damageDealtToObjectives",
    "summoner1Id",
    "summoner2Id",
    "item0",
    "item1",
    "item2",
    "item3",
    "item4",
    "item5",
    "item6",
    // The end-of-game stats (`domain::EndOfGameStats`).
    "largestKillingSpree",
    "largestMultiKill",
    "firstBloodKill",
    "physicalDamageDealtToChampions",
    "magicDamageDealtToChampions",
    "trueDamageDealtToChampions",
    "damageDealtToTurrets",
    "totalHeal",
    "totalHealsOnTeammates",
    "totalDamageShieldedOnTeammates",
    "wardsPlaced",
    "wardsKilled",
    "visionWardsBoughtInGame",
    "goldSpent",
    "timeCCingOthers",
    "turretKills",
    "inhibitorKills",
];

fn pick(from: &Value, fields: &[&str]) -> Map<String, Value> {
    let mut out = Map::new();
    for &f in fields {
        if let Some(v) = from.get(f) {
            out.insert(f.to_owned(), v.clone());
        }
    }
    out
}

fn object(entries: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// The rune page as the match details show it, in Match-V5's shape: the keystone
/// (`styles[0].selections[0].perk`) and the secondary tree (`styles[1].style`).
fn compact_perks(perks: &Value) -> Option<Value> {
    let primary = perks.pointer("/styles/0/style")?.clone();
    let mut first = vec![("style", primary)];
    if let Some(keystone) = perks.pointer("/styles/0/selections/0/perk") {
        first.push((
            "selections",
            Value::Array(vec![object([("perk", keystone.clone())])]),
        ));
    }
    let mut styles = vec![object(first)];
    if let Some(secondary) = perks.pointer("/styles/1/style") {
        styles.push(object([("style", secondary.clone())]));
    }
    Some(object([("styles", Value::Array(styles))]))
}

/// Keeps only what player views, grades and match details read from a Match-V5 document
/// (~20× smaller).
pub fn compact_match(game: &Value) -> Value {
    let mut info = pick(game.get("info").unwrap_or(&Value::Null), &MATCH_INFO_FIELDS);
    let participants: Vec<Value> = game
        .pointer("/info/participants")
        .and_then(Value::as_array)
        .map(|ps| {
            ps.iter()
                .map(|p| {
                    let mut kept = pick(p, &PARTICIPANT_FIELDS);
                    if let Some(perks) = p.get("perks").and_then(compact_perks) {
                        kept.insert("perks".to_owned(), perks);
                    }
                    Value::Object(kept)
                })
                .collect()
        })
        .unwrap_or_default();
    info.insert("participants".to_owned(), Value::Array(participants));
    let mut metadata = Map::new();
    if let Some(id) = game.pointer("/metadata/matchId") {
        metadata.insert("matchId".to_owned(), id.clone());
    }
    object([
        ("metadata", Value::Object(metadata)),
        ("info", Value::Object(info)),
    ])
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

    async fn match_by_id(
        &self,
        platform: Platform,
        match_id: &str,
    ) -> Result<Arc<Value>, RiotError> {
        let text = self
            .matches
            .get_or_try_insert(match_id.to_owned(), move || async move {
                let game = self.client.match_by_id(platform, match_id).await?;
                Ok::<_, RiotError>(Arc::<str>::from(compact_match(&game).to_string()))
            })
            .await?;
        serde_json::from_str(&text)
            .map(Arc::new)
            .map_err(|source| RiotError::Decode {
                path: format!("cached match {match_id}"),
                source,
            })
    }
}

// ---- Access for the disk snapshot (store.rs) and metrics (ops.rs) ----
pub(crate) type AccountCache = Cache<(String, String), Account>;
/// Compacted matches, as JSON text.
pub(crate) type MatchCache = Cache<String, Arc<str>>;

impl CachedRiot {
    pub(crate) fn client(&self) -> &RiotClient {
        &self.client
    }

    /// The live game of a player (our key's PUUID), from Spectator-V5 (cached by `live`).
    pub(crate) async fn current_game(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> Result<CurrentGame, RiotError> {
        self.client.current_game(platform, puuid).await
    }

    /// An account Riot just showed with its Riot ID (a live game's players): the scouting batch
    /// that may follow finds it without an account-v1 call.
    pub(crate) fn remember_account(&self, account: &Account) {
        if let (Some(name), Some(tag)) = (&account.game_name, &account.tag_line) {
            self.accounts_by_riot_id
                .insert((name.to_lowercase(), tag.to_lowercase()), account.clone());
        }
    }

    /// Accounts by Riot ID, accounts by PUUID, compacted matches.
    pub(crate) fn caches(&self) -> (&AccountCache, &Cache<String, Account>, &MatchCache) {
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
        let perks = json!({ "statPerks": { "defense": 5011 }, "styles": [
            { "description": "primaryStyle", "style": 8100,
              "selections": [{ "perk": 8112, "var1": 1200 }, { "perk": 8139 }] },
            { "description": "subStyle", "style": 8200, "selections": [{ "perk": 8233 }] }
        ] });
        let mut me = json!({
            "puuid": "me", "riotIdGameName": "Fillmo", "riotIdTagline": "7272",
            "teamId": 100, "championId": 103, "champLevel": 17, "teamPosition": "MIDDLE",
            "win": true, "kills": 9, "deaths": 2, "assists": 11, "totalMinionsKilled": 211,
            "neutralMinionsKilled": 20, "goldEarned": 14_200,
            "totalDamageDealtToChampions": 31_000, "totalDamageTaken": 16_000,
            "damageSelfMitigated": 9_000, "visionScore": 22,
            "damageDealtToObjectives": 4_000, "summoner1Id": 4, "summoner2Id": 14,
            "item0": 6655, "item1": 3020, "item6": 3340,
            "challenges": { "kda": 10 }, "perks": perks
        });
        // The end-of-game stats (one `json!` would be too deep for the macro).
        let end_of_game = json!({
            "largestKillingSpree": 5, "largestMultiKill": 2, "firstBloodKill": true,
            "physicalDamageDealtToChampions": 2_000, "magicDamageDealtToChampions": 27_500,
            "trueDamageDealtToChampions": 1_500, "damageDealtToTurrets": 3_100, "totalHeal": 1_900,
            "totalHealsOnTeammates": 0, "totalDamageShieldedOnTeammates": 0, "wardsPlaced": 9,
            "wardsKilled": 2, "visionWardsBoughtInGame": 1, "goldSpent": 13_450,
            "timeCCingOthers": 17, "turretKills": 2, "inhibitorKills": 1
        });
        if let (Some(me), Value::Object(more)) = (me.as_object_mut(), end_of_game) {
            me.extend(more);
        }
        let game = json!({
            "metadata": { "matchId": "EUW1_1", "participants": ["me"], "dataVersion": "2" },
            "info": {
                "gameDuration": 1742, "gameEndTimestamp": 1_790_000_000_000_i64, "queueId": 420,
                "gameMode": "CLASSIC", "teams": [{ "teamId": 100 }], "participants": [me.clone()]
            }
        });
        // Ten such players with Riot's 78-character PUUIDs: what the cache's bound counts on.
        let mut ten = game.clone();
        ten["info"]["participants"] = (0..10)
            .map(|i| {
                let mut player = me.clone();
                player["puuid"] = json!(format!("{i:0>78}"));
                player
            })
            .collect();
        let size = compact_match(&ten).to_string().len();
        assert!(size < 11_000, "{size} bytes: see MATCHES_MAX");
        let small = compact_match(&game);
        assert_eq!(
            players::match_summary(&small, "me"),
            players::match_summary(&game, "me")
        );
        let details = players::match_details(&small);
        assert_eq!(details, players::match_details(&game));
        // The end-of-game stats are kept too.
        let stats = details
            .map(|d| d.teams[0].players[0].stats.clone())
            .unwrap_or_default();
        assert_eq!(
            (stats.crowd_control_seconds, stats.turrets_destroyed, stats.healing_on_teammates),
            (Some(17), Some(2), Some(0))
        );
        assert!(small.pointer("/info/participants/0/challenges").is_none());
        assert!(small.pointer("/info/teams").is_none());
        assert_eq!(
            small.pointer("/info/participants/0/perks"),
            Some(&json!({ "styles": [
                { "style": 8100, "selections": [{ "perk": 8112 }] },
                { "style": 8200 }
            ] }))
        );
    }
}
