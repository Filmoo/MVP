//! Riot Web API client for the stats backend (crawler and live lookups).
//!
//! The API key must stay on our servers: this crate is never linked into the desktop app.

mod client;
mod endpoints;
pub mod limits;
pub mod routing;

pub use client::{ApiKey, CallCounts, Config, RiotClient, RiotError};
pub use endpoints::{Account, LeagueEntry, LeagueList, MatchQuery, Summoner};
pub use routing::{Platform, Region, Route};
