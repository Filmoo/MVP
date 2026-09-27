//! Admin commands (no web admin): edit `releases.json` atomically, check `config.json`,
//! prune or erase crash reports. They work on `DATA_DIR` and are safe to run while the service
//! is up (it picks up `releases.json`/`config.json` changes by itself).
//!
//! ```text
//! mvp-backend release add --version 0.3.0 --channel stable \
//!     --url https://…/MVP_0.3.0_x64-setup.exe --signature-file MVP_0.3.0_x64-setup.exe.sig \
//!     (or --signature "<the .sig file's contents>") \
//!     --notes-en "…" --notes-fr "…" [--rollout 10] [--force-below 0.2.0] [--platform windows-x86_64]
//! mvp-backend release promote --version 0.3.0 [--rollout 100] [--channel stable]
//! mvp-backend release block|unblock --version 0.3.0
//! mvp-backend release list
//! mvp-backend config check
//! mvp-backend reports prune [--days 30]
//! mvp-backend reports forget --install-id <id>
//! ```

use std::collections::{BTreeMap, HashMap};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use semver::Version;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::config::{CONFIG_FILE, ConfigFile};
use crate::limits::valid_install_id;
use crate::reports::{self, REPORTS_DIR, RETENTION_DAYS};
use crate::updates::{Artifact, Channel, Notes, RELEASES_FILE, Release, Releases};
use crate::watched::{read, write_atomic};

pub const USAGE: &str = "\
usage:
  mvp-backend                       serve (see README for the environment)
  mvp-backend healthcheck
  mvp-backend release add --version V --channel stable|beta --url URL
                          (--signature-file FILE | --signature SIG)
                          --notes-en TEXT --notes-fr TEXT [--rollout 0-100] [--force-below V]
                          [--platform windows-x86_64] [--pub-date RFC3339]
  mvp-backend release promote --version V [--rollout 0-100] [--channel stable|beta]
  mvp-backend release block|unblock --version V
  mvp-backend release list
  mvp-backend config check
  mvp-backend reports prune [--days N]
  mvp-backend reports forget --install-id ID";

/// Whether `args` (without the program name) is an admin command.
pub fn is_admin(args: &[String]) -> bool {
    matches!(
        args.first().map(String::as_str),
        Some("release" | "config" | "reports" | "help" | "--help")
    )
}

/// Runs an admin command; human-readable results go to `out`.
pub fn run(args: &[String], data_dir: &Path, out: &mut dyn Write) -> Result<(), String> {
    let (group, action) = (
        args.first().map_or("", String::as_str),
        args.get(1).map_or("", String::as_str),
    );
    let rest = args.get(2..).unwrap_or_default();
    let say =
        |out: &mut dyn Write, line: String| writeln!(out, "{line}").map_err(|e| e.to_string());
    match (group, action) {
        ("release", "add") => {
            let o = options(
                rest,
                &[
                    "version",
                    "channel",
                    "url",
                    "signature-file",
                    "signature",
                    "notes-en",
                    "notes-fr",
                    "rollout",
                    "force-below",
                    "platform",
                    "pub-date",
                ],
            )?;
            let release = new_release(&o)?;
            let summary = format!(
                "added {} ({:?}, rollout {} %)",
                release.version, release.channel, release.rollout
            );
            edit_releases(data_dir, |rs| add(rs, release))?;
            say(out, summary)
        }
        ("release", "promote") => {
            let o = options(rest, &["version", "rollout", "channel"])?;
            let version = version(&o, "version")?;
            let rollout = o.get("rollout").map_or(Ok(100), |r| rollout(r))?;
            let channel = o.get("channel").map(|c| channel(c)).transpose()?;
            edit_releases(data_dir, |rs| {
                let r = rs
                    .find_mut(&version)
                    .ok_or(format!("no release {version}"))?;
                r.rollout = rollout;
                if let Some(c) = channel {
                    r.channel = c;
                }
                Ok(())
            })?;
            say(out, format!("{version}: rollout {rollout} %"))
        }
        ("release", verb @ ("block" | "unblock")) => {
            let o = options(rest, &["version"])?;
            let version = version(&o, "version")?;
            let blocked = verb == "block";
            edit_releases(data_dir, |rs| {
                rs.find_mut(&version)
                    .ok_or(format!("no release {version}"))?
                    .blocked = blocked;
                Ok(())
            })?;
            say(out, format!("{version}: {verb}ed"))
        }
        ("release", "list") => list(data_dir, out),
        ("config", "check") => {
            let path = data_dir.join(CONFIG_FILE);
            match read(&path, ConfigFile::parse)? {
                Some(_) => say(out, format!("{} is valid", path.display())),
                None => say(
                    out,
                    format!("{} is missing: defaults are served", path.display()),
                ),
            }
        }
        ("reports", "prune") => {
            let o = options(rest, &["days"])?;
            let days = o.get("days").map_or(Ok(RETENTION_DAYS), |d| {
                d.parse().map_err(|_| "--days: a number".to_owned())
            })?;
            let today = OffsetDateTime::now_utc().date();
            let n = reports::prune(&data_dir.join(REPORTS_DIR), today, days)
                .map_err(|e| e.to_string())?;
            say(
                out,
                format!("deleted {n} day file(s) older than {days} days"),
            )
        }
        ("reports", "forget") => {
            let o = options(rest, &["install-id"])?;
            let id = required(&o, "install-id")?;
            if !valid_install_id(id) {
                return Err("--install-id: 8–64 of [A-Za-z0-9-]".into());
            }
            let n = reports::forget(&data_dir.join(REPORTS_DIR), id).map_err(|e| e.to_string())?;
            say(out, format!("erased {n} report(s) of {id}"))
        }
        _ => Err(USAGE.to_owned()),
    }
}

fn list(data_dir: &Path, out: &mut dyn Write) -> Result<(), String> {
    let releases = read(&data_dir.join(RELEASES_FILE), Releases::parse)?.unwrap_or_default();
    let mut sorted = releases.releases;
    sorted.sort_by(|a, b| b.version.cmp_precedence(&a.version));
    for r in &sorted {
        let platforms: Vec<&str> = r.platforms.keys().map(String::as_str).collect();
        let forces = r
            .force_below
            .as_ref()
            .map_or(String::new(), |f| format!("  forces <{f}"));
        writeln!(
            out,
            "{:<16} {:<6} rollout {:>3} %{forces}{}  {}  [{}]",
            r.version.to_string(),
            format!("{:?}", r.channel).to_lowercase(),
            r.rollout,
            if r.blocked { "  BLOCKED" } else { "" },
            r.pub_date,
            platforms.join(", ")
        )
        .map_err(|e| e.to_string())?;
    }
    if sorted.is_empty() {
        writeln!(out, "no releases").map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn options<'a>(args: &'a [String], allowed: &[&str]) -> Result<HashMap<&'a str, &'a str>, String> {
    let mut map = HashMap::new();
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let name = flag
            .strip_prefix("--")
            .filter(|n| allowed.contains(n))
            .ok_or_else(|| format!("unexpected {flag:?}\n{USAGE}"))?;
        let value = it.next().ok_or_else(|| format!("--{name} needs a value"))?;
        if map.insert(name, value.as_str()).is_some() {
            return Err(format!("--{name} given twice"));
        }
    }
    Ok(map)
}

fn required<'a>(o: &HashMap<&str, &'a str>, name: &str) -> Result<&'a str, String> {
    o.get(name)
        .copied()
        .ok_or_else(|| format!("--{name} is required"))
}

fn version(o: &HashMap<&str, &str>, name: &str) -> Result<Version, String> {
    let v = required(o, name)?;
    Version::parse(v.strip_prefix('v').unwrap_or(v)).map_err(|e| format!("--{name} {v:?}: {e}"))
}

fn rollout(r: &str) -> Result<u8, String> {
    r.parse::<u8>()
        .ok()
        .filter(|r| *r <= 100)
        .ok_or_else(|| format!("--rollout {r:?}: 0–100"))
}

fn channel(c: &str) -> Result<Channel, String> {
    Channel::parse(c).ok_or_else(|| format!("--channel {c:?}: stable or beta"))
}

fn new_release(o: &HashMap<&str, &str>) -> Result<Release, String> {
    let signature = match (o.get("signature"), o.get("signature-file")) {
        (Some(sig), None) => (*sig).trim().to_owned(),
        (None, Some(file)) => {
            let file = PathBuf::from(file);
            std::fs::read_to_string(&file)
                .map_err(|e| format!("{}: {e}", file.display()))?
                .trim()
                .to_owned()
        }
        _ => return Err("give one of --signature-file FILE or --signature SIG".into()),
    };
    let pub_date = match o.get("pub-date") {
        Some(d) => (*d).to_owned(),
        None => OffsetDateTime::now_utc()
            .replace_nanosecond(0)
            .map_err(|e| e.to_string())?
            .format(&Rfc3339)
            .map_err(|e| e.to_string())?,
    };
    let platform = o.get("platform").copied().unwrap_or("windows-x86_64");
    Ok(Release {
        version: version(o, "version")?,
        channel: channel(required(o, "channel")?)?,
        pub_date,
        notes: Notes {
            en: required(o, "notes-en")?.to_owned(),
            fr: required(o, "notes-fr")?.to_owned(),
        },
        platforms: BTreeMap::from([(
            platform.to_owned(),
            Artifact {
                url: required(o, "url")?.to_owned(),
                signature,
            },
        )]),
        rollout: o.get("rollout").map_or(Ok(100), |r| rollout(r))?,
        force_below: o
            .contains_key("force-below")
            .then(|| version(o, "force-below"))
            .transpose()?,
        blocked: false,
    })
}

/// A new version, or another platform of an existing one (same channel and notes).
fn add(rs: &mut Releases, release: Release) -> Result<(), String> {
    if let Some(existing) = rs.find_mut(&release.version) {
        for (platform, artifact) in release.platforms {
            if existing.platforms.contains_key(&platform) {
                return Err(format!("{} already has {platform}", existing.version));
            }
            existing.platforms.insert(platform, artifact);
        }
        return Ok(());
    }
    rs.releases.push(release);
    Ok(())
}

/// Removes the lock file when the edit is over (also on error).
struct Lock(PathBuf);

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Read → change → validate → atomic write, under a lock file against concurrent edits.
fn edit_releases(
    data_dir: &Path,
    change: impl FnOnce(&mut Releases) -> Result<(), String>,
) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| format!("{}: {e}", data_dir.display()))?;
    let path = data_dir.join(RELEASES_FILE);
    let lock_path = data_dir.join(format!("{RELEASES_FILE}.lock"));
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|e| {
            format!(
                "{}: {e} (another edit running? delete the lock file if not)",
                lock_path.display()
            )
        })?;
    let _lock = Lock(lock_path);
    let mut releases = read(&path, Releases::parse)?.unwrap_or_default();
    change(&mut releases)?;
    releases.validate()?;
    write_atomic(&path, &releases.to_json()).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cli(dir: &Path, line: &str) -> Result<String, String> {
        let args: Vec<String> = shell_words(line);
        let mut out = Vec::new();
        run(&args, dir, &mut out)?;
        Ok(String::from_utf8_lossy(&out).into_owned())
    }

    /// Splits on spaces, keeping "quoted parts" together.
    fn shell_words(line: &str) -> Vec<String> {
        line.split('"')
            .enumerate()
            .flat_map(|(i, part)| {
                if i % 2 == 1 {
                    vec![part.to_owned()]
                } else {
                    part.split_whitespace().map(str::to_owned).collect()
                }
            })
            .collect()
    }

    #[test]
    fn release_lifecycle() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let sig = dir.path().join("MVP_0.3.0_x64-setup.exe.sig");
        std::fs::write(&sig, "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==\n")
            .map_err(|e| e.to_string())?;
        let add = format!(
            "release add --version 0.3.0 --channel stable --url https://dl.example/MVP_0.3.0_x64-setup.exe \
             --signature-file {} --notes-en \"Faster draft\" --notes-fr \"Draft plus rapide\" --rollout 10",
            sig.display()
        );
        assert!(cli(dir.path(), &add)?.contains("added 0.3.0"));
        assert!(cli(dir.path(), &add).is_err(), "same platform twice");
        let arm = "release add --version 0.3.0 --channel stable --platform windows-aarch64 \
                   --url https://dl.example/MVP_0.3.0_arm64-setup.exe --signature c2ln \
                   --notes-en x --notes-fr y";
        cli(dir.path(), arm)?;

        let path = dir.path().join(RELEASES_FILE);
        let read_back = || read(&path, Releases::parse).map(Option::unwrap_or_default);
        let rs = read_back()?;
        let r = &rs.releases[0];
        assert_eq!(r.rollout, 10);
        assert_eq!(
            r.platforms["windows-aarch64"].signature, "c2ln",
            "second platform merged"
        );
        assert_eq!(r.notes.fr, "Draft plus rapide");
        assert_eq!(
            r.platforms["windows-x86_64"].signature,
            "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ=="
        );
        assert!(OffsetDateTime::parse(&r.pub_date, &Rfc3339).is_ok());

        cli(dir.path(), "release promote --version 0.3.0 --rollout 50")?;
        assert_eq!(read_back()?.releases[0].rollout, 50);
        cli(dir.path(), "release promote --version 0.3.0")?;
        assert_eq!(read_back()?.releases[0].rollout, 100);
        cli(dir.path(), "release block --version 0.3.0")?;
        assert!(read_back()?.releases[0].blocked);
        assert!(cli(dir.path(), "release list")?.contains("BLOCKED"));
        cli(dir.path(), "release unblock --version v0.3.0")?;
        assert!(!read_back()?.releases[0].blocked);

        assert!(cli(dir.path(), "release promote --version 9.9.9").is_err());
        assert!(cli(dir.path(), "release promote --version 0.3.0 --rollout 101").is_err());
        assert!(cli(dir.path(), "release block --version 0.3.0 --force").is_err());
        assert!(
            !dir.path().join("releases.json.lock").exists(),
            "lock released"
        );
        Ok(())
    }

    #[test]
    fn invalid_edits_leave_the_file_untouched() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let sig = dir.path().join("x.sig");
        std::fs::write(&sig, "c2ln").map_err(|e| e.to_string())?;
        let bad = format!(
            "release add --version 0.3.0-beta.1 --channel stable --url https://x/y.exe \
             --signature-file {} --notes-en a --notes-fr b",
            sig.display()
        );
        let err = cli(dir.path(), &bad).expect_err("pre-release on stable");
        assert!(err.contains("beta channel"), "{err}");
        assert!(!dir.path().join(RELEASES_FILE).exists());
        Ok(())
    }

    #[test]
    fn config_check_and_reports_forget() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        assert!(cli(dir.path(), "config check")?.contains("missing"));
        std::fs::write(dir.path().join(CONFIG_FILE), r#"{"pollAfterSecs": 1}"#)
            .map_err(|e| e.to_string())?;
        assert!(cli(dir.path(), "config check").is_err());
        assert!(cli(dir.path(), "reports forget --install-id 0f8e2a7c-1b2d")?.contains("erased 0"));
        assert!(cli(dir.path(), "reports forget --install-id ../../x").is_err());
        assert!(cli(dir.path(), "reports prune")?.contains("deleted 0"));
        Ok(())
    }
}
