//! Configuration: the environment (`/etc/mvp/roadmap.env` on the server), then the command
//! line's flags.
//!
//! | Variable | Meaning |
//! | --- | --- |
//! | `ROADMAP_BIND` | address to listen on (`127.0.0.1:8790`) |
//! | `ROADMAP_DB` | the `SQLite` file (debug builds: `.cache/roadmap/roadmap.db`) |
//! | `ROADMAP_PUBLIC_URL` | where browsers see it, `https://dev.mvpgg.com` |
//! | `ROADMAP_GITHUB_CLIENT_ID`, `ROADMAP_GITHUB_CLIENT_SECRET` | the GitHub OAuth App |
//! | `ROADMAP_SESSION_KEY` | 32+ random bytes, hex or base64 (`mvp-roadmap key`) |
//! | `ROADMAP_REPO` | whose admins may sign in (`Filmoo/MVP`) |
//! | `ROADMAP_TRUST_PROXY` | `1` behind Caddy: the client address is `X-Forwarded-For` |
//! | `ROADMAP_WEB_DIR` | serve the UI from this folder instead of the built-in one |
//! | `ROADMAP_SEED` | a seed file instead of the built-in `seed/roadmap.json` |
//! | `ROADMAP_GITHUB_URL`, `ROADMAP_GITHUB_API_URL` | GitHub's addresses (tests) |

use std::net::SocketAddr;
use std::path::PathBuf;

use crate::crypto;
use crate::github::{GitHubConfig, Secret};
use crate::{DEFAULT_BIND, DEFAULT_REPO, Settings};

/// Flags of `mvp-roadmap serve` (and the database flag of the other commands).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Flags {
    pub dev_login: bool,
    pub bind: Option<String>,
    pub db: Option<String>,
    pub seed: Option<String>,
    pub public_url: Option<String>,
}

impl Flags {
    /// Reads `--dev-login`, `--bind ADDR`, `--db PATH`, `--seed FILE`, `--public-url URL`.
    pub fn parse(args: &[String]) -> Result<Self, String> {
        let mut flags = Self::default();
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            let mut value = || {
                args.next()
                    .cloned()
                    .ok_or_else(|| format!("{arg} needs a value"))
            };
            match arg.as_str() {
                "--dev-login" => flags.dev_login = true,
                "--bind" => flags.bind = Some(value()?),
                "--db" => flags.db = Some(value()?),
                "--seed" => flags.seed = Some(value()?),
                "--public-url" => flags.public_url = Some(value()?),
                other => return Err(format!("unknown flag {other}")),
            }
        }
        Ok(flags)
    }
}

/// The `SQLite` file: `--db`, else `ROADMAP_DB`, else (debug builds) `.cache/roadmap/roadmap.db`.
pub fn db_path(flags: &Flags, env: &dyn Fn(&str) -> Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = flags.db.clone().or_else(|| env("ROADMAP_DB")) {
        return Ok(PathBuf::from(path));
    }
    if cfg!(debug_assertions) {
        Ok(PathBuf::from(".cache/roadmap/roadmap.db"))
    } else {
        Err("set ROADMAP_DB (or --db) to the database file".into())
    }
}

/// Everything `serve` needs, checked.
#[derive(Debug)]
pub struct ServeConfig {
    pub bind: SocketAddr,
    pub db: PathBuf,
    pub settings: Settings,
    pub github: Option<GitHubConfig>,
    /// `None` only with `--dev-login` (a random key then: sessions end with the process).
    pub session_key: Option<Vec<u8>>,
    pub seed: Option<PathBuf>,
    pub web_dir: Option<PathBuf>,
}

impl ServeConfig {
    pub fn load(flags: &Flags, env: &dyn Fn(&str) -> Option<String>) -> Result<Self, String> {
        let bind_text = flags
            .bind
            .clone()
            .or_else(|| env("ROADMAP_BIND"))
            .unwrap_or_else(|| DEFAULT_BIND.to_owned());
        let bind: SocketAddr = bind_text
            .parse()
            .map_err(|e| format!("{bind_text:?} is not an address: {e}"))?;
        if flags.dev_login {
            if !cfg!(debug_assertions) {
                return Err("--dev-login only exists in debug builds".into());
            }
            if !bind.ip().is_loopback() {
                return Err(format!(
                    "--dev-login only listens on a loopback address (127.0.0.1 or ::1), not {bind}"
                ));
            }
        }
        let flag = |value: &Option<String>, name: &str| {
            value
                .clone()
                .or_else(|| env(name))
                .filter(|v| !v.trim().is_empty())
        };
        let public_url = match flag(&flags.public_url, "ROADMAP_PUBLIC_URL") {
            Some(url) => url,
            None if flags.dev_login => format!("http://{bind}"),
            None => return Err("set ROADMAP_PUBLIC_URL (https://dev.mvpgg.com)".into()),
        };
        let repo = env("ROADMAP_REPO").unwrap_or_else(|| DEFAULT_REPO.to_owned());
        let trust_proxy =
            env("ROADMAP_TRUST_PROXY").is_some_and(|v| matches!(v.trim(), "1" | "true" | "yes"));
        let settings = Settings::new(&public_url, &repo, flags.dev_login, trust_proxy)?;
        if !settings.https && !flags.dev_login && !loopback_url(&settings.public_url) {
            return Err(format!(
                "{} must be https:// (only a loopback address may use http://)",
                settings.public_url
            ));
        }

        let client_id = env("ROADMAP_GITHUB_CLIENT_ID").filter(|v| !v.trim().is_empty());
        let client_secret = env("ROADMAP_GITHUB_CLIENT_SECRET").filter(|v| !v.trim().is_empty());
        let github = match (client_id, client_secret) {
            (Some(client_id), Some(client_secret)) => Some(GitHubConfig {
                client_id: client_id.trim().to_owned(),
                client_secret: Secret::new(client_secret.trim()),
                web_url: env("ROADMAP_GITHUB_URL").unwrap_or_else(|| "https://github.com".into()),
                api_url: env("ROADMAP_GITHUB_API_URL")
                    .unwrap_or_else(|| "https://api.github.com".into()),
                repo: settings.repo.clone(),
            }),
            (None, None) if flags.dev_login => None,
            _ => {
                return Err(
                    "set ROADMAP_GITHUB_CLIENT_ID and ROADMAP_GITHUB_CLIENT_SECRET (the GitHub OAuth App)".into(),
                );
            }
        };
        let session_key = match env("ROADMAP_SESSION_KEY").filter(|v| !v.trim().is_empty()) {
            Some(text) => Some(crypto::parse_session_key(&text)?),
            None if flags.dev_login => None,
            None => return Err("set ROADMAP_SESSION_KEY (mvp-roadmap key makes one)".into()),
        };
        Ok(Self {
            bind,
            db: db_path(flags, env)?,
            settings,
            github,
            session_key,
            seed: flag(&flags.seed, "ROADMAP_SEED").map(PathBuf::from),
            web_dir: env("ROADMAP_WEB_DIR")
                .filter(|v| !v.trim().is_empty())
                .map(PathBuf::from),
        })
    }
}

fn loopback_url(url: &str) -> bool {
    let host = url.split("://").nth(1).unwrap_or_default();
    host.starts_with("127.") || host.starts_with("localhost") || host.starts_with("[::1]")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |name| map.get(name).cloned()
    }

    fn production() -> Vec<(&'static str, &'static str)> {
        vec![
            ("ROADMAP_PUBLIC_URL", "https://dev.mvpgg.com/"),
            ("ROADMAP_GITHUB_CLIENT_ID", "Ov23li"),
            ("ROADMAP_GITHUB_CLIENT_SECRET", "secret"),
            (
                "ROADMAP_SESSION_KEY",
                "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            ),
            ("ROADMAP_DB", "/data/roadmap.db"),
            ("ROADMAP_TRUST_PROXY", "1"),
        ]
    }

    #[test]
    fn production_needs_github_and_a_session_key() {
        let config = ServeConfig::load(&Flags::default(), &env_of(&production()));
        let Ok(config) = config else {
            panic!("{config:?}");
        };
        assert_eq!(config.settings.public_url, "https://dev.mvpgg.com");
        assert_eq!(
            config.settings.redirect_uri(),
            "https://dev.mvpgg.com/auth/callback"
        );
        assert!(config.settings.https && config.settings.trust_proxy);
        assert_eq!(config.settings.session_cookie(), "__Host-mvp_roadmap");
        assert_eq!(config.bind.to_string(), DEFAULT_BIND);
        assert_eq!(config.session_key.map(|k| k.len()), Some(32));
        for missing in [
            "ROADMAP_PUBLIC_URL",
            "ROADMAP_GITHUB_CLIENT_SECRET",
            "ROADMAP_SESSION_KEY",
        ] {
            let env: Vec<_> = production()
                .into_iter()
                .filter(|(k, _)| *k != missing)
                .collect();
            assert!(
                ServeConfig::load(&Flags::default(), &env_of(&env)).is_err(),
                "{missing}"
            );
        }
        let mut plain = production();
        plain[0] = ("ROADMAP_PUBLIC_URL", "http://dev.mvpgg.com");
        assert!(ServeConfig::load(&Flags::default(), &env_of(&plain)).is_err());
        let mut path = production();
        path[0] = ("ROADMAP_PUBLIC_URL", "https://mvpgg.com/roadmap");
        assert!(ServeConfig::load(&Flags::default(), &env_of(&path)).is_err());
    }

    #[test]
    fn dev_login_stays_on_the_loopback() {
        let flags = Flags::parse(&["--dev-login".into()]).unwrap_or_default();
        let config = ServeConfig::load(&flags, &env_of(&[]));
        let Ok(config) = config else {
            panic!("{config:?}");
        };
        assert!(
            config.settings.dev_login && config.github.is_none() && config.session_key.is_none()
        );
        assert_eq!(config.settings.public_url, "http://127.0.0.1:8790");
        assert_eq!(config.settings.session_cookie(), "mvp_roadmap");
        for bind in ["0.0.0.0:8790", "192.168.1.10:8790", "[::]:8790"] {
            let flags = Flags {
                dev_login: true,
                bind: Some(bind.into()),
                ..Flags::default()
            };
            let refused = ServeConfig::load(&flags, &env_of(&[]))
                .err()
                .unwrap_or_default();
            assert!(refused.contains("loopback"), "{bind}: {refused}");
        }
    }

    #[test]
    fn flags_are_read_strictly() {
        let args: Vec<String> = [
            "--db",
            "x.db",
            "--bind",
            "127.0.0.1:4272",
            "--seed",
            "s.json",
        ]
        .map(String::from)
        .to_vec();
        let flags = Flags::parse(&args).unwrap_or_default();
        assert_eq!(flags.db.as_deref(), Some("x.db"));
        assert_eq!(flags.bind.as_deref(), Some("127.0.0.1:4272"));
        assert!(Flags::parse(&["--db".into()]).is_err());
        assert!(Flags::parse(&["--nope".into()]).is_err());
    }
}
