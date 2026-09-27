//! Typed endpoints used by the stats backend and live lookups.
//! DTOs keep only what we use; unknown fields are ignored so Riot additions never break us.

use std::fmt::Write as _;

use serde::Deserialize;

use crate::client::{RiotClient, RiotError};
use crate::routing::{Platform, Route};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub puuid: String,
    pub game_name: Option<String>,
    pub tag_line: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summoner {
    pub puuid: String,
    pub profile_icon_id: u32,
    pub summoner_level: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeagueEntry {
    pub puuid: Option<String>,
    pub queue_type: String,
    pub tier: Option<String>,
    pub rank: Option<String>,
    pub league_points: u32,
    pub wins: u32,
    pub losses: u32,
    #[serde(default)]
    pub hot_streak: bool,
    #[serde(default)]
    pub veteran: bool,
    #[serde(default)]
    pub fresh_blood: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeagueList {
    pub tier: String,
    pub entries: Vec<LeagueEntry>,
}

/// Filters for match id lists.
#[derive(Debug, Clone, Default)]
pub struct MatchQuery {
    pub queue: Option<u32>,
    /// Epoch seconds.
    pub start_time: Option<i64>,
    pub start: u32,
    /// 1–100.
    pub count: u32,
}

impl MatchQuery {
    fn to_query(&self) -> String {
        let mut q = format!("?start={}&count={}", self.start, self.count.clamp(1, 100));
        if let Some(queue) = self.queue {
            let _ = write!(q, "&queue={queue}");
        }
        if let Some(t) = self.start_time {
            let _ = write!(q, "&startTime={t}");
        }
        q
    }
}

/// Percent-encodes a path segment (Riot IDs contain spaces and non-ASCII letters).
fn segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(b));
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

impl RiotClient {
    pub async fn account_by_riot_id(
        &self,
        platform: Platform,
        game_name: &str,
        tag_line: &str,
    ) -> Result<Account, RiotError> {
        let path = format!(
            "/riot/account/v1/accounts/by-riot-id/{}/{}",
            segment(game_name),
            segment(tag_line)
        );
        self.get(
            Route::Region(platform.account_region()),
            "account-v1.by-riot-id",
            &path,
        )
        .await
    }

    pub async fn summoner_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> Result<Summoner, RiotError> {
        let path = format!("/lol/summoner/v4/summoners/by-puuid/{}", segment(puuid));
        self.get(Route::Platform(platform), "summoner-v4.by-puuid", &path)
            .await
    }

    pub async fn league_entries_by_puuid(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> Result<Vec<LeagueEntry>, RiotError> {
        let path = format!("/lol/league/v4/entries/by-puuid/{}", segment(puuid));
        self.get(
            Route::Platform(platform),
            "league-v4.entries-by-puuid",
            &path,
        )
        .await
    }

    /// Challenger/grandmaster/master league (`tier` = `challengerleagues`…).
    pub async fn apex_league(
        &self,
        platform: Platform,
        tier: &str,
        queue: &str,
    ) -> Result<LeagueList, RiotError> {
        let path = format!("/lol/league/v4/{tier}/by-queue/{queue}");
        self.get(Route::Platform(platform), "league-v4.apex", &path)
            .await
    }

    /// One page of a division ladder (e.g. `RANKED_SOLO_5x5`, `EMERALD`, `I`), for crawl seeding.
    pub async fn league_page(
        &self,
        platform: Platform,
        queue: &str,
        tier: &str,
        division: &str,
        page: u32,
    ) -> Result<Vec<LeagueEntry>, RiotError> {
        let path = format!("/lol/league/v4/entries/{queue}/{tier}/{division}?page={page}");
        self.get(Route::Platform(platform), "league-v4.entries", &path)
            .await
    }

    pub async fn match_ids(
        &self,
        platform: Platform,
        puuid: &str,
        query: &MatchQuery,
    ) -> Result<Vec<String>, RiotError> {
        let path = format!(
            "/lol/match/v5/matches/by-puuid/{}/ids{}",
            segment(puuid),
            query.to_query()
        );
        self.get(Route::Region(platform.region()), "match-v5.ids", &path)
            .await
    }

    /// Full match; kept as JSON so the crawler can store the raw document.
    pub async fn match_by_id(
        &self,
        platform: Platform,
        match_id: &str,
    ) -> Result<serde_json::Value, RiotError> {
        let path = format!("/lol/match/v5/matches/{}", segment(match_id));
        self.get(Route::Region(platform.region()), "match-v5.match", &path)
            .await
    }

    pub async fn match_timeline(
        &self,
        platform: Platform,
        match_id: &str,
    ) -> Result<serde_json::Value, RiotError> {
        let path = format!("/lol/match/v5/matches/{}/timeline", segment(match_id));
        self.get(Route::Region(platform.region()), "match-v5.timeline", &path)
            .await
    }

    /// Live game of a player; `NotFound` when not in game.
    pub async fn active_game(
        &self,
        platform: Platform,
        puuid: &str,
    ) -> Result<serde_json::Value, RiotError> {
        let path = format!(
            "/lol/spectator/v5/active-games/by-summoner/{}",
            segment(puuid)
        );
        self.get(Route::Platform(platform), "spectator-v5.active-game", &path)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_riot_ids() {
        assert_eq!(segment("Kiin Fan"), "Kiin%20Fan");
        assert_eq!(segment("Élise#1"), "%C3%89lise%231");
        assert_eq!(segment("abc-_.~"), "abc-_.~");
    }

    #[test]
    fn builds_match_queries() {
        let q = MatchQuery {
            queue: Some(420),
            start_time: Some(1_790_000_000),
            start: 0,
            count: 500,
        };
        assert_eq!(
            q.to_query(),
            "?start=0&count=100&queue=420&startTime=1790000000"
        );
    }
}
