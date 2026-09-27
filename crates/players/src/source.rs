//! Where player data comes from: the Riot client itself, or a caching layer in front of it.

use std::future::Future;
use std::sync::Arc;

use riot_api::{Account, LeagueEntry, MatchQuery, Platform, RiotClient, RiotError, Summoner};
use serde_json::Value;

/// The Riot API calls player lookups need. `RiotClient` implements it directly; the backend
/// wraps it with caches (accounts, match documents) without changing the mapping code.
pub trait RiotSource: Sync {
    fn account_by_riot_id(
        &self,
        platform: Platform,
        game_name: &str,
        tag_line: &str,
    ) -> impl Future<Output = Result<Account, RiotError>> + Send;

    fn account_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Account, RiotError>> + Send;

    fn summoner_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Summoner, RiotError>> + Send;

    fn league_entries_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Vec<LeagueEntry>, RiotError>> + Send;

    fn match_ids(
        &self,
        platform: Platform,
        puuid: &str,
        query: &MatchQuery,
    ) -> impl Future<Output = Result<Vec<String>, RiotError>> + Send;

    /// A Match-V5 document (shared: caches hand out the same one to every caller).
    fn match_by_id(
        &self,
        platform: Platform,
        match_id: &str,
    ) -> impl Future<Output = Result<Arc<Value>, RiotError>> + Send;
}

impl RiotSource for RiotClient {
    fn account_by_riot_id(
        &self,
        platform: Platform,
        game_name: &str,
        tag_line: &str,
    ) -> impl Future<Output = Result<Account, RiotError>> + Send {
        Self::account_by_riot_id(self, platform, game_name, tag_line)
    }

    fn account_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Account, RiotError>> + Send {
        Self::account_by_puuid(self, platform, puuid)
    }

    fn summoner_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Summoner, RiotError>> + Send {
        Self::summoner_by_puuid(self, platform, puuid)
    }

    fn league_entries_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> impl Future<Output = Result<Vec<LeagueEntry>, RiotError>> + Send {
        Self::league_entries_by_puuid(self, platform, puuid)
    }

    fn match_ids(
        &self,
        platform: Platform,
        puuid: &str,
        query: &MatchQuery,
    ) -> impl Future<Output = Result<Vec<String>, RiotError>> + Send {
        Self::match_ids(self, platform, puuid, query)
    }

    async fn match_by_id(
        &self,
        platform: Platform,
        match_id: &str,
    ) -> Result<Arc<Value>, RiotError> {
        Self::match_by_id(self, platform, match_id)
            .await
            .map(Arc::new)
    }
}
