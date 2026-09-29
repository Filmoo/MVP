//! `mvp-roadmap`: the roadmap service and its admin commands (README.md has the deploy).
//!
//! ```text
//! mvp-roadmap [serve] [--dev-login] [--bind ADDR] [--db PATH] [--seed FILE] [--public-url URL]
//! mvp-roadmap seed [--db PATH] [--seed FILE]       the seed into an empty database, else nothing
//! mvp-roadmap token create --name NAME [--db PATH] a machine token for Claude, shown once
//! mvp-roadmap token list [--db PATH]
//! mvp-roadmap token revoke --name NAME [--db PATH]
//! mvp-roadmap backup --out FILE|DIR [--keep N] [--db PATH]   a consistent copy, safe while serving
//! mvp-roadmap key                                  a new ROADMAP_SESSION_KEY
//! mvp-roadmap healthcheck [--bind ADDR]            exit 0 when /health answers (Docker)
//! ```

use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use mvp_roadmap::config::{Flags, db_path};
use mvp_roadmap::model::Actor;
use mvp_roadmap::seed::{self, SeedFile};
use mvp_roadmap::store::{SeedOutcome, Store};
use mvp_roadmap::{AppState, GitHub, Keys, Parts, ServeConfig, SystemClock, Web, crypto, router};
use time::OffsetDateTime;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tracing_subscriber::EnvFilter;

const USAGE: &str = "\
usage:
  mvp-roadmap [serve] [--dev-login] [--bind ADDR] [--db PATH] [--seed FILE] [--public-url URL]
  mvp-roadmap seed [--db PATH] [--seed FILE]
  mvp-roadmap token create --name NAME [--db PATH]
  mvp-roadmap token list [--db PATH]
  mvp-roadmap token revoke --name NAME [--db PATH]
  mvp-roadmap backup --out FILE|DIR [--keep N] [--db PATH]
  mvp-roadmap key
  mvp-roadmap healthcheck [--bind ADDR]
The environment: ROADMAP_DB, ROADMAP_PUBLIC_URL, ROADMAP_GITHUB_CLIENT_ID,
ROADMAP_GITHUB_CLIENT_SECRET, ROADMAP_SESSION_KEY, ROADMAP_BIND… (apps/roadmap/README.md)";

type Outcome = Result<(), String>;

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

fn init_logging() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let json = env("LOG_FORMAT").is_some_and(|f| f.eq_ignore_ascii_case("json"));
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr);
    if json {
        builder.json().flatten_event(true).init();
    } else {
        builder.init();
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    init_logging();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (command, rest) = match args.split_first() {
        Some((first, rest)) if !first.starts_with("--") => (first.as_str(), rest),
        _ => ("serve", args.as_slice()),
    };
    let mut out = std::io::stdout();
    let result = match command {
        "serve" => serve(rest).await,
        "seed" => seed_command(rest, &mut out),
        "token" => token_command(rest, &mut out),
        "backup" => backup(rest, &mut out),
        "key" => say(&mut out, &crypto::new_session_key()),
        "healthcheck" => healthcheck(rest).await,
        "help" => say(&mut out, USAGE),
        other => Err(format!("unknown command {other:?}\n{USAGE}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn say(out: &mut dyn Write, text: &str) -> Outcome {
    writeln!(out, "{text}").map_err(|e| e.to_string())
}

/// Splits `--name NAME`, `--out FILE` from the database flags.
fn take(args: &[String], name: &str) -> Result<(Option<String>, Vec<String>), String> {
    let mut rest = Vec::new();
    let mut found = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == name {
            found = Some(
                iter.next()
                    .cloned()
                    .ok_or_else(|| format!("{name} needs a value"))?,
            );
        } else {
            rest.push(arg.clone());
        }
    }
    Ok((found, rest))
}

fn open_store(flags: &Flags) -> Result<Store, String> {
    let path = db_path(flags, &env)?;
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    Store::open(&path).map_err(|e| format!("{}: {e}", path.display()))
}

fn seed_text(path: Option<&Path>) -> Result<String, String> {
    match path {
        Some(path) => std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display())),
        None => Ok(seed::DEFAULT.to_owned()),
    }
}

fn import(store: &mut Store, text: &str) -> Result<SeedOutcome, String> {
    let seed = SeedFile::parse(text)?;
    store.import_seed(&seed, now()).map_err(|e| e.to_string())
}

fn seed_command(args: &[String], out: &mut dyn Write) -> Outcome {
    let flags = Flags::parse(args)?;
    let mut store = open_store(&flags)?;
    let text = seed_text(flags.seed.as_deref().map(Path::new))?;
    match import(&mut store, &text)? {
        SeedOutcome::Imported {
            areas,
            versions,
            features,
        } => say(
            out,
            &format!("imported {versions} versions, {features} features and {areas} areas"),
        ),
        SeedOutcome::NotEmpty => say(
            out,
            "the database already holds a roadmap: nothing imported",
        ),
    }
}

fn token_command(args: &[String], out: &mut dyn Write) -> Outcome {
    let (action, rest) = args
        .split_first()
        .ok_or_else(|| format!("token create|list|revoke\n{USAGE}"))?;
    let (name, rest) = take(rest, "--name")?;
    let flags = Flags::parse(&rest)?;
    let mut store = open_store(&flags)?;
    let by = Actor::system("cli");
    match (action.as_str(), name) {
        ("create", Some(name)) => {
            let token = crypto::new_token();
            store
                .create_token(&name, &crypto::sha256(token.as_bytes()), &by, now())
                .map_err(|e| e.to_string())?;
            say(
                out,
                &format!(
                    "Machine token {name:?} (shown once: store it now, only its hash is kept):\n\
                     {token}\n\
                     Claude reads it from MVP_ROADMAP_TOKEN or .cache/roadmap-token (scripts/roadmap.mjs)."
                ),
            )
        }
        ("list", None) => {
            let tokens = store.tokens().map_err(|e| e.to_string())?;
            if tokens.is_empty() {
                return say(out, "no machine tokens");
            }
            for token in tokens {
                let day = |at: i64| {
                    OffsetDateTime::from_unix_timestamp(at)
                        .map_or_else(|_| at.to_string(), |t| t.date().to_string())
                };
                let state = match (token.revoked_at, token.last_used_at) {
                    (Some(at), _) => format!("revoked {}", day(at)),
                    (None, Some(at)) => format!("last used {}", day(at)),
                    (None, None) => "never used".to_owned(),
                };
                say(
                    out,
                    &format!(
                        "{:<16} created {}  {state}",
                        token.name,
                        day(token.created_at)
                    ),
                )?;
            }
            Ok(())
        }
        ("revoke", Some(name)) => {
            if store
                .revoke_token(&name, &by, now())
                .map_err(|e| e.to_string())?
            {
                say(out, &format!("revoked {name:?}"))
            } else {
                Err(format!("no active token named {name:?}"))
            }
        }
        _ => Err(format!(
            "token create --name NAME | list | revoke --name NAME\n{USAGE}"
        )),
    }
}

/// `backup --out FILE`, or `--out DIR/` (a dated file in it) with `--keep N` (the newest N
/// `roadmap-*.db` there stay, older ones go).
fn backup(args: &[String], out: &mut dyn Write) -> Outcome {
    let (to, rest) = take(args, "--out")?;
    let (keep, rest) = take(&rest, "--keep")?;
    let to = PathBuf::from(to.ok_or("backup --out FILE|DIR [--keep N]")?);
    let keep = keep
        .map(|k| {
            k.parse::<usize>()
                .map_err(|_| format!("--keep {k:?} isn't a number"))
        })
        .transpose()?;
    let store = open_store(&Flags::parse(&rest)?)?;
    let folder = to.is_dir() || to.to_string_lossy().ends_with(['/', '\\']);
    let file = if folder {
        std::fs::create_dir_all(&to).map_err(|e| format!("{}: {e}", to.display()))?;
        let stamp = OffsetDateTime::now_utc();
        to.join(format!(
            "roadmap-{:04}-{:02}-{:02}-{:02}{:02}{:02}{:03}.db",
            stamp.year(),
            u8::from(stamp.month()),
            stamp.day(),
            stamp.hour(),
            stamp.minute(),
            stamp.second(),
            stamp.millisecond()
        ))
    } else {
        to.clone()
    };
    store.backup(&file).map_err(|e| e.to_string())?;
    say(out, &format!("saved {}", file.display()))?;
    if let (true, Some(keep)) = (folder, keep) {
        let mut old: Vec<PathBuf> = std::fs::read_dir(&to)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|entry| entry.path())
            .filter(|p| {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                name.starts_with("roadmap-") && p.extension().is_some_and(|e| e == "db")
            })
            .collect();
        // The names sort by time: the newest come last.
        old.sort();
        let extra = old.len().saturating_sub(keep.max(1));
        for path in old.into_iter().take(extra) {
            std::fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            say(out, &format!("removed {}", path.display()))?;
        }
    }
    Ok(())
}

async fn serve(args: &[String]) -> Outcome {
    let flags = Flags::parse(args)?;
    let config = ServeConfig::load(&flags, &env)?;
    let mut store = open_store(&Flags {
        db: Some(config.db.to_string_lossy().into_owned()),
        ..Flags::default()
    })?;
    let text = seed_text(config.seed.as_deref())?;
    if let SeedOutcome::Imported {
        versions, features, ..
    } = import(&mut store, &text)?
    {
        tracing::info!(versions, features, "empty database: imported the seed");
    }
    let github = config.github.map(GitHub::new).transpose()?;
    let keys = config
        .session_key
        .as_deref()
        .map_or_else(Keys::ephemeral, Keys::new);
    let web = config
        .web_dir
        .map_or_else(Web::default_for_build, Web::Folder);
    let dev_login = config.settings.dev_login;
    let public_url = config.settings.public_url.clone();
    let state = AppState::new(Parts {
        store,
        settings: config.settings,
        github,
        keys,
        clock: Arc::new(SystemClock),
        web,
        dev_seed: dev_login.then_some(text),
    });
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|e| format!("{}: {e}", config.bind))?;
    if dev_login {
        tracing::warn!("--dev-login: whoever opens {public_url} is signed in as a fake admin");
    }
    tracing::info!(addr = %config.bind, %public_url, db = %config.db.display(), "mvp-roadmap listening");
    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .map_err(|e| e.to_string())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}

/// HTTP/1.0 probe of `/health` (the runtime image has no curl).
async fn healthcheck(args: &[String]) -> Outcome {
    let flags = Flags::parse(args)?;
    let bind = flags
        .bind
        .or_else(|| env("ROADMAP_BIND"))
        .unwrap_or_else(|| mvp_roadmap::DEFAULT_BIND.to_owned());
    let mut addr: SocketAddr = bind.parse().map_err(|e| format!("{bind:?}: {e}"))?;
    if addr.ip().is_unspecified() {
        addr.set_ip(std::net::Ipv4Addr::LOCALHOST.into());
    }
    let probe = async {
        let mut stream = tokio::net::TcpStream::connect(addr).await?;
        stream
            .write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n")
            .await?;
        let mut response = String::new();
        stream.read_to_string(&mut response).await?;
        Ok::<_, std::io::Error>(response)
    };
    let response = tokio::time::timeout(Duration::from_secs(3), probe)
        .await
        .map_err(|_| "no answer within 3 s".to_owned())?
        .map_err(|e| e.to_string())?;
    if response.starts_with("HTTP/1.0 200") || response.starts_with("HTTP/1.1 200") {
        Ok(())
    } else {
        Err(format!(
            "unhealthy: {}",
            response.lines().next().unwrap_or_default()
        ))
    }
}
