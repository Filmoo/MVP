//! Captures a real profile from the Riot API into a local fixture for UI development.
//!
//! ```text
//! RIOT_API_KEY=RGAPI-… cargo run -p players --bin capture-profile -- "Fillmo#7272" [euw1] [games]
//! ```
//!
//! Writes `.cache/fixtures/profile.json` (git-ignored: personal data never goes in the repo).
//! The UI's `?scenario=me` then shows it, e.g. <http://127.0.0.1:1420/?scenario=me>.

use std::path::PathBuf;

use riot_api::{ApiKey, Config, Platform, RiotClient};

fn platform(id: &str) -> Option<Platform> {
    Some(match id.to_lowercase().as_str() {
        "euw1" | "euw" => Platform::Euw1,
        "eun1" | "eune" => Platform::Eun1,
        "na1" | "na" => Platform::Na1,
        "kr" => Platform::Kr,
        "tr1" | "tr" => Platform::Tr1,
        "br1" | "br" => Platform::Br1,
        _ => return None,
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let mut args = std::env::args().skip(1);
    let riot_id = players::parse_riot_id(
        &args
            .next()
            .ok_or("usage: capture-profile \"Name#TAG\" [euw1] [games]")?,
    )?;
    let platform =
        platform(&args.next().unwrap_or_else(|| "euw1".into())).ok_or("unknown platform")?;
    let games: u32 = args.next().map_or(Ok(20), |g| g.parse())?;
    let key = ApiKey::from_env()
        .ok_or("set RIOT_API_KEY (developer key from developer.riotgames.com)")?;

    let client = RiotClient::new(key, Config::default())?;
    let profile = players::fetch_profile(&client, platform, &riot_id, games).await?;
    let dir = PathBuf::from(".cache/fixtures");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("profile.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&profile)?)?;
    tracing::info!(games = profile.recent_matches.len(), path = %path.display(), "profile captured");
    Ok(())
}
