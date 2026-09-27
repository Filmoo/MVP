//! `mvp-crawler`: see the crate docs and `apps/backend/README.md` (Stats pipeline).

use std::process::ExitCode;

use mvp_crawler::{Command, crawl_riot_config, open_store, parse_args};
use riot_api::{ApiKey, RiotClient};
use static_data::DataDragon;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match parse_args(&args, |k| std::env::var(k).ok()) {
        Ok(command) => run(command).await,
        Err(e) => Err(e),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!("{e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(command: Command) -> Result<(), String> {
    match command {
        Command::Crawl { data_dir, config } => {
            let key = ApiKey::from_env().ok_or("RIOT_API_KEY is not set")?;
            let client = RiotClient::new(key, crawl_riot_config()).map_err(|e| e.to_string())?;
            let mut store = open_store(&data_dir)?;
            let report = mvp_crawler::crawl(&client, &mut store, &config)
                .await
                .map_err(|e| e.to_string())?;
            let counts = store.counts().map_err(|e| e.to_string())?;
            tracing::info!(?report, ?counts, "crawl finished");
        }
        Command::Publish {
            data_dir,
            config,
            ddragon,
        } => {
            let store = open_store(&data_dir)?;
            let dd = ddragon
                .map(|base| DataDragon::new(base, data_dir.join("ddragon"), "en_US"))
                .transpose()
                .map_err(|e| e.to_string())?;
            let report = mvp_crawler::publish(&store, dd.as_ref(), &config)
                .await
                .map_err(|e| e.to_string())?;
            tracing::info!(?report, dir = %config.stats_dir.display(), "publish finished");
        }
        Command::Status { data_dir } => {
            let store = open_store(&data_dir)?;
            let counts = store.counts().map_err(|e| e.to_string())?;
            let patches: Vec<String> = store
                .patches()
                .map_err(|e| e.to_string())?
                .iter()
                .map(ToString::to_string)
                .collect();
            tracing::info!(?counts, ?patches, "crawl store");
        }
    }
    Ok(())
}
