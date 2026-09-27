//! `mvp-crawler`: builds the published stats server-side.
//!
//! ```text
//! RIOT_API_KEY=RGAPI-… mvp-crawler crawl --platform euw1 --max-matches 500   # resumable
//! mvp-crawler publish                  # → {data dir}/stats/v1/… (served by mvp-backend)
//! mvp-crawler status
//! ```
//! Crawl state and per-game facts live in `SQLite` (`{data dir}/crawl.sqlite`); publishing
//! rebuilds the aggregates from those facts, so it never calls Riot (only Data Dragon for the
//! patch's item classes).

pub mod crawl;
pub mod publish;
pub mod store;

use std::path::PathBuf;
use std::time::Duration;

use aggregate::{Patch, SeedBracket};
use riot_api::{Config, Platform};

pub use crawl::{CrawlConfig, CrawlError, CrawlReport, crawl};
pub use publish::{PublishConfig, PublishError, PublishReport, publish};
pub use store::Store;

pub const DEFAULT_DATA_DIR: &str = ".cache/crawler";

/// Riot client settings for crawling: patient (a development key waits minutes on a 429).
pub fn crawl_riot_config() -> Config {
    Config {
        max_retries: 5,
        max_retry_wait: Duration::from_secs(10 * 60),
        ..Config::default()
    }
}

/// A parsed command line.
#[derive(Debug, Clone)]
pub enum Command {
    Crawl {
        data_dir: PathBuf,
        config: CrawlConfig,
    },
    Publish {
        data_dir: PathBuf,
        config: PublishConfig,
        ddragon: Option<String>,
    },
    Status {
        data_dir: PathBuf,
    },
}

pub const USAGE: &str = "usage:
  mvp-crawler crawl   [--platform euw1] [--max-matches 500] [--data-dir DIR]
                      [--players-per-bracket 300] [--since-days 14] [--ids-per-player 20]
                      [--brackets emerald,diamond,master] [--concurrency 4] [--no-timelines]
  mvp-crawler publish [--data-dir DIR] [--out DIR] [--patch 16.19]... [--min-role-games 50]
                      [--min-pair-games 10] [--min-current-games 20000] [--ddragon URL|off]
  mvp-crawler status  [--data-dir DIR]
environment: RIOT_API_KEY (crawl), CRAWL_DATA_DIR, CRAWL_PLATFORM, CRAWL_MAX_MATCHES";

fn number<T: std::str::FromStr>(flag: &str, value: &str) -> Result<T, String> {
    value
        .parse()
        .map_err(|_| format!("{flag} expects a number, got {value:?}"))
}

/// Parses `args` (without the program name). Flags fall back to the environment (`env`).
pub fn parse_args(
    args: &[String],
    env: impl Fn(&str) -> Option<String>,
) -> Result<Command, String> {
    let (command, rest) = args.split_first().ok_or_else(|| USAGE.to_owned())?;
    let mut data_dir =
        PathBuf::from(env("CRAWL_DATA_DIR").unwrap_or_else(|| DEFAULT_DATA_DIR.to_owned()));
    let mut crawl = CrawlConfig::default();
    if let Some(p) = env("CRAWL_PLATFORM") {
        crawl.platform = Platform::from_id(&p).ok_or(format!("unknown platform {p:?}"))?;
    }
    if let Some(n) = env("CRAWL_MAX_MATCHES") {
        crawl.max_matches = number("CRAWL_MAX_MATCHES", &n)?;
    }
    let mut out: Option<PathBuf> = None;
    let mut patches = Vec::new();
    let mut options = aggregate::publish::Options::default();
    let mut ddragon = Some(static_data::DDRAGON.to_owned());

    let mut it = rest.iter();
    while let Some(flag) = it.next() {
        if flag == "--no-timelines" {
            crawl.timelines = false;
            continue;
        }
        let value = it
            .next()
            .ok_or_else(|| format!("{flag} needs a value\n{USAGE}"))?;
        match flag.as_str() {
            "--data-dir" => data_dir = PathBuf::from(value),
            "--platform" => {
                crawl.platform =
                    Platform::from_id(value).ok_or(format!("unknown platform {value:?}"))?;
            }
            "--max-matches" => crawl.max_matches = number(flag, value)?,
            "--players-per-bracket" => crawl.players_per_bracket = number(flag, value)?,
            "--since-days" => crawl.since_days = number(flag, value)?,
            "--ids-per-player" => crawl.ids_per_player = number(flag, value)?,
            "--concurrency" => crawl.concurrency = number(flag, value)?,
            "--brackets" => {
                crawl.brackets = value
                    .split(',')
                    .map(|b| SeedBracket::from_id(b.trim()).ok_or(format!("unknown bracket {b:?}")))
                    .collect::<Result<_, _>>()?;
            }
            "--out" => out = Some(PathBuf::from(value)),
            "--patch" => patches.push(value.parse::<Patch>()?),
            "--min-role-games" => options.min_role_games = number(flag, value)?,
            "--min-pair-games" => options.min_pair_games = number(flag, value)?,
            "--min-current-games" => options.min_current_games = number(flag, value)?,
            "--ddragon" => ddragon = (value != "off").then(|| value.clone()),
            _ => return Err(format!("unknown flag {flag}\n{USAGE}")),
        }
    }
    match command.as_str() {
        "crawl" => Ok(Command::Crawl {
            data_dir,
            config: crawl,
        }),
        "publish" => Ok(Command::Publish {
            config: PublishConfig {
                stats_dir: out.unwrap_or_else(|| data_dir.join("stats")),
                patches,
                options,
            },
            data_dir,
            ddragon,
        }),
        "status" => Ok(Command::Status { data_dir }),
        _ => Err(USAGE.to_owned()),
    }
}

/// The store of a data directory (created on first use).
pub fn open_store(data_dir: &std::path::Path) -> Result<Store, String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("cannot create {}: {e}", data_dir.display()))?;
    Store::open(&data_dir.join("crawl.sqlite")).map_err(|e| format!("crawl store: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_owned).collect()
    }

    #[test]
    fn parses_commands() {
        let no_env = |_: &str| None;
        let Ok(Command::Crawl { data_dir, config }) = parse_args(
            &args("crawl --platform KR --max-matches 50 --brackets diamond,master --no-timelines"),
            no_env,
        ) else {
            panic!("crawl");
        };
        assert_eq!(data_dir, PathBuf::from(DEFAULT_DATA_DIR));
        assert_eq!(config.platform, Platform::Kr);
        assert_eq!(config.max_matches, 50);
        assert!(!config.timelines);
        assert_eq!(config.brackets, [SeedBracket::Diamond, SeedBracket::Master]);

        let env = |k: &str| (k == "CRAWL_DATA_DIR").then(|| "/data".to_owned());
        let Ok(Command::Publish {
            config, ddragon, ..
        }) = parse_args(&args("publish --patch 16.19 --ddragon off"), env)
        else {
            panic!("publish");
        };
        assert_eq!(config.stats_dir, PathBuf::from("/data/stats"));
        assert_eq!(config.patches[0].to_string(), "16.19");
        assert_eq!(ddragon, None);

        assert!(parse_args(&args("crawl --platform mars"), no_env).is_err());
        assert!(parse_args(&args("crawl --max-matches"), no_env).is_err());
        assert!(parse_args(&args("dance"), no_env).is_err());
        assert!(parse_args(&[], no_env).is_err());
    }
}
