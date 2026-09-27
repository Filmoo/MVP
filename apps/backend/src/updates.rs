//! App updates for the Tauri v2 updater plugin.
//!
//! `GET /v1/updates/{target}/{arch}/{current_version}?channel=stable|beta&install_id=…&lang=en|fr`
//! answers 204 when the app is up to date, else 200 with the updater's JSON:
//! `{ version, notes, pub_date, platforms: { "windows-x86_64": { signature, url } } }` plus two
//! fields the plugin ignores but the app can read from `Update.rawJson`: `mandatory` and
//! `notesI18n` (`{ en, fr }`).
//!
//! Releases live in `releases.json` in the data dir (edited by `mvp-backend release …`).
//!
//! Selection rules, for an install on version `current`:
//! 1. A release is a candidate when it is not `blocked`, is on a channel the install follows
//!    (`stable` follows stable; `beta` follows beta **and** stable), has an artifact for the
//!    platform, and is strictly newer than `current` (semver precedence: build metadata is
//!    ignored, `0.3.0-beta.1 < 0.3.0`).
//! 2. …and the install is in the release's rollout: `bucket(install_id, version) < rollout %`,
//!    where the bucket is a SHA-256 of both (stable per install and release, independent
//!    across releases). Without an install id only 100 % releases are offered.
//!    The rollout is bypassed when `current < forceBelow` of that release, or when `current`
//!    is itself a blocked release (rescue installs on a bad build first).
//! 3. The newest candidate wins. `mandatory` is true when any candidate forces `current`
//!    (`current < forceBelow`) or `current` is blocked.
//! 4. **No downgrades.** Blocking the newest release stops it from spreading, but installs
//!    already on it are only moved by a newer fixed release (they get it regardless of its
//!    rollout, rule 2). The Tauri plugin refuses older versions by default anyway.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::Failure;
use crate::limits::{INSTALL_HEADER, valid_install_id};
use crate::watched::Watched;

pub const RELEASES_FILE: &str = "releases.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Beta,
}

impl Channel {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "stable" => Some(Self::Stable),
            "beta" => Some(Self::Beta),
            _ => None,
        }
    }

    /// Whether an install on `self` is offered releases published on `release`.
    pub fn follows(self, release: Self) -> bool {
        self == Self::Beta || release == Self::Stable
    }
}

/// `releases.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Releases {
    #[serde(default)]
    pub releases: Vec<Release>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Release {
    pub version: Version,
    pub channel: Channel,
    /// RFC 3339.
    pub pub_date: String,
    pub notes: Notes,
    /// Keyed `{target}-{arch}` as Tauri names them, e.g. `windows-x86_64`.
    pub platforms: BTreeMap<String, Artifact>,
    /// Percentage of installs offered this release (0–100).
    #[serde(default = "full_rollout")]
    pub rollout: u8,
    /// Installs below this version get the release whatever the rollout, flagged mandatory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force_below: Option<Version>,
    /// Pulled: never offered again.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub blocked: bool,
}

fn full_rollout() -> u8 {
    100
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Notes {
    pub en: String,
    pub fr: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artifact {
    /// HTTPS URL of the NSIS installer (`*-setup.exe`) the updater downloads.
    pub url: String,
    /// Contents of the `.sig` file Tauri's bundler wrote next to it (minisign, base64).
    pub signature: String,
}

pub fn valid_platform_key(key: &str) -> bool {
    let mut parts = key.split('-');
    let ok = |p: Option<&str>| {
        p.is_some_and(|p| {
            (1..=16).contains(&p.len())
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        })
    };
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
}

impl Releases {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let releases: Self = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        releases.validate()?;
        Ok(releases)
    }

    pub fn validate(&self) -> Result<(), String> {
        for (i, r) in self.releases.iter().enumerate() {
            let v = &r.version;
            if self.releases[..i]
                .iter()
                .any(|o| o.version.cmp_precedence(v).is_eq())
            {
                return Err(format!("version {v} is listed twice"));
            }
            if r.rollout > 100 {
                return Err(format!("{v}: rollout must be 0–100"));
            }
            if r.channel == Channel::Stable && !v.pre.is_empty() {
                return Err(format!("{v}: pre-releases belong on the beta channel"));
            }
            OffsetDateTime::parse(&r.pub_date, &Rfc3339)
                .map_err(|e| format!("{v}: pubDate is not RFC 3339: {e}"))?;
            if r.notes.en.trim().is_empty() || r.notes.fr.trim().is_empty() {
                return Err(format!("{v}: notes need English and French"));
            }
            if r.platforms.is_empty() {
                return Err(format!("{v}: no platform"));
            }
            for (key, a) in &r.platforms {
                if !valid_platform_key(key) {
                    return Err(format!(
                        "{v}: bad platform key {key:?} (e.g. windows-x86_64)"
                    ));
                }
                if !a.url.starts_with("https://") {
                    return Err(format!("{v}/{key}: url must be https://"));
                }
                if a.signature.trim().is_empty() || a.signature.contains(char::is_whitespace) {
                    return Err(format!(
                        "{v}/{key}: signature must be the .sig file's single line"
                    ));
                }
            }
            if let Some(f) = &r.force_below
                && f.cmp_precedence(v).is_gt()
            {
                return Err(format!("{v}: forceBelow {f} is above the release itself"));
            }
        }
        Ok(())
    }

    pub fn find_mut(&mut self, version: &Version) -> Option<&mut Release> {
        self.releases
            .iter_mut()
            .find(|r| r.version.cmp_precedence(version).is_eq())
    }

    pub fn to_json(&self) -> Vec<u8> {
        let mut sorted = self.clone();
        sorted
            .releases
            .sort_by(|a, b| b.version.cmp_precedence(&a.version));
        let mut bytes = serde_json::to_vec_pretty(&sorted).unwrap_or_default();
        bytes.push(b'\n');
        bytes
    }
}

/// Stable bucket in `0..10_000` for an install and a release version.
pub fn bucket(install_id: &str, version: &Version) -> u16 {
    let digest = Sha256::new()
        .chain_update(install_id.as_bytes())
        .chain_update([0])
        .chain_update(version.to_string().as_bytes())
        .finalize();
    let mut first = [0u8; 8];
    first.copy_from_slice(&digest[..8]);
    u16::try_from(u64::from_be_bytes(first) % 10_000).unwrap_or_default()
}

pub fn in_rollout(install_id: Option<&str>, release: &Release) -> bool {
    match (release.rollout, install_id) {
        (100.., _) => true,
        (0, _) | (_, None) => false,
        (pct, Some(id)) => bucket(id, &release.version) < u16::from(pct) * 100,
    }
}

#[derive(Debug, Clone, Copy)]
pub struct UpdateQuery<'a> {
    pub platform: &'a str,
    pub current: &'a Version,
    pub channel: Channel,
    pub install_id: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Offer<'r> {
    pub release: &'r Release,
    pub mandatory: bool,
}

/// The release to offer, if any (rules in the module doc).
pub fn select<'r>(releases: &'r Releases, q: &UpdateQuery<'_>) -> Option<Offer<'r>> {
    let on_blocked = releases
        .releases
        .iter()
        .any(|r| r.blocked && r.version.cmp_precedence(q.current).is_eq());
    let forces = |r: &Release| {
        r.force_below
            .as_ref()
            .is_some_and(|f| q.current.cmp_precedence(f).is_lt())
    };
    let candidates = releases.releases.iter().filter(|r| {
        !r.blocked
            && q.channel.follows(r.channel)
            && r.platforms.contains_key(q.platform)
            && r.version.cmp_precedence(q.current).is_gt()
            && (on_blocked || forces(r) || in_rollout(q.install_id, r))
    });
    let mut best: Option<&Release> = None;
    let mut mandatory = on_blocked;
    for r in candidates {
        mandatory |= forces(r);
        if best.is_none_or(|b| r.version.cmp_precedence(&b.version).is_gt()) {
            best = Some(r);
        }
    }
    best.map(|release| Offer { release, mandatory })
}

/// The updater plugin's JSON (static format, one platform).
#[derive(Debug, Serialize)]
struct Manifest<'a> {
    version: String,
    notes: &'a str,
    pub_date: &'a str,
    platforms: BTreeMap<&'a str, &'a Artifact>,
    mandatory: bool,
    #[serde(rename = "notesI18n")]
    notes_i18n: &'a Notes,
}

#[derive(Debug, Deserialize)]
pub struct Params {
    channel: Option<String>,
    install_id: Option<String>,
    lang: Option<String>,
}

pub async fn check(
    State(releases): State<Arc<Watched<Releases>>>,
    Path((target, arch, current)): Path<(String, String, String)>,
    Query(params): Query<Params>,
    headers: HeaderMap,
) -> Result<Response, Failure> {
    let platform = format!("{target}-{arch}");
    if !valid_platform_key(&platform) {
        return Err(Failure::bad_request(
            "expected /v1/updates/{target}/{arch}/{version}",
        ));
    }
    let current = Version::parse(current.strip_prefix('v').unwrap_or(&current))
        .map_err(|_| Failure::bad_request("current version is not semver"))?;
    let channel = match params.channel.as_deref() {
        None | Some("") => Channel::Stable,
        Some(c) => {
            Channel::parse(c).ok_or_else(|| Failure::bad_request("channel: stable or beta"))?
        }
    };
    let install_id = params
        .install_id
        .as_deref()
        .or_else(|| headers.get(INSTALL_HEADER).and_then(|v| v.to_str().ok()))
        .filter(|id| valid_install_id(id));
    let releases = releases.get();
    let query = UpdateQuery {
        platform: &platform,
        current: &current,
        channel,
        install_id,
    };
    let Some(offer) = select(&releases, &query) else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };
    let r = offer.release;
    let Some((key, artifact)) = r.platforms.get_key_value(platform.as_str()) else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };
    let notes = match params.lang.as_deref() {
        Some("fr") => &r.notes.fr,
        _ => &r.notes.en,
    };
    let manifest = Manifest {
        version: r.version.to_string(),
        notes,
        pub_date: &r.pub_date,
        platforms: BTreeMap::from([(key.as_str(), artifact)]),
        mandatory: offer.mandatory,
        notes_i18n: &r.notes,
    };
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(manifest)).into_response())
}

#[cfg(test)]
mod tests {
    type Change = fn(&mut Release);

    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap_or_else(|_| Version::new(0, 0, 0))
    }

    fn release(version: &str, channel: Channel, rollout: u8) -> Release {
        Release {
            version: v(version),
            channel,
            pub_date: "2026-09-27T12:00:00Z".into(),
            notes: Notes {
                en: format!("Version {version}"),
                fr: format!("Version {version} (fr)"),
            },
            platforms: BTreeMap::from([(
                "windows-x86_64".to_owned(),
                Artifact {
                    url: format!("https://dl.example/MVP_{version}_x64-setup.exe"),
                    signature: "dW50cnVzdGVkIGNvbW1lbnQ=".into(),
                },
            )]),
            rollout,
            force_below: None,
            blocked: false,
        }
    }

    fn offer(
        releases: &Releases,
        current: &str,
        channel: Channel,
        id: Option<&str>,
    ) -> Option<(String, bool)> {
        let current = v(current);
        select(
            releases,
            &UpdateQuery {
                platform: "windows-x86_64",
                current: &current,
                channel,
                install_id: id,
            },
        )
        .map(|o| (o.release.version.to_string(), o.mandatory))
    }

    const ID: Option<&str> = Some("0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33");

    #[test]
    fn newest_newer_release_wins() {
        let rs = Releases {
            releases: vec![
                release("0.2.0", Channel::Stable, 100),
                release("0.3.0", Channel::Stable, 100),
                release("0.1.0", Channel::Stable, 100),
            ],
        };
        assert_eq!(
            offer(&rs, "0.1.0", Channel::Stable, ID),
            Some(("0.3.0".into(), false))
        );
        assert_eq!(offer(&rs, "0.3.0", Channel::Stable, ID), None, "up to date");
        assert_eq!(
            offer(&rs, "0.4.0", Channel::Stable, ID),
            None,
            "never downgrade"
        );
        let current = v("0.1.0");
        let other_platform = UpdateQuery {
            platform: "darwin-aarch64",
            current: &current,
            channel: Channel::Stable,
            install_id: ID,
        };
        assert!(select(&rs, &other_platform).is_none());
    }

    #[test]
    fn channels() {
        let rs = Releases {
            releases: vec![
                release("0.2.0", Channel::Stable, 100),
                release("0.3.0-beta.1", Channel::Beta, 100),
            ],
        };
        assert_eq!(
            offer(&rs, "0.1.0", Channel::Stable, ID).map(|o| o.0),
            Some("0.2.0".into())
        );
        assert_eq!(
            offer(&rs, "0.1.0", Channel::Beta, ID).map(|o| o.0),
            Some("0.3.0-beta.1".into())
        );
        // Beta sees stable too: once 0.3.0 ships stable, beta testers move to it.
        let mut rs = rs;
        rs.releases.push(release("0.3.0", Channel::Stable, 100));
        assert_eq!(
            offer(&rs, "0.3.0-beta.1", Channel::Beta, ID).map(|o| o.0),
            Some("0.3.0".into())
        );
        // A beta build switched back to stable gets the stable release above it.
        assert_eq!(
            offer(&rs, "0.3.0-beta.1", Channel::Stable, ID).map(|o| o.0),
            Some("0.3.0".into())
        );
    }

    #[test]
    fn semver_edge_cases() {
        assert!(v("0.3.0-beta.1") < v("0.3.0-beta.2"));
        assert!(v("0.3.0-beta.2") < v("0.3.0-rc.1"));
        assert!(v("0.3.0-rc.1") < v("0.3.0"));
        assert!(v("0.10.0") > v("0.9.9"), "numeric, not lexicographic");
        let rs = Releases {
            releases: vec![release("0.3.0+build.7", Channel::Stable, 100)],
        };
        assert_eq!(
            offer(&rs, "0.3.0", Channel::Stable, ID),
            None,
            "build metadata ignored"
        );
        assert_eq!(offer(&rs, "0.3.0+other", Channel::Stable, ID), None);
        assert!(offer(&rs, "0.2.99", Channel::Stable, ID).is_some());
    }

    #[test]
    fn rollout_buckets_are_stable_and_proportional() {
        let version = v("1.4.0");
        let ids: Vec<String> = (0..20_000).map(|i| format!("install-{i:08}")).collect();
        for id in ids.iter().take(50) {
            assert_eq!(bucket(id, &version), bucket(id, &version), "stable");
        }
        for pct in [1_u8, 10, 25, 50, 90] {
            let r = release("1.4.0", Channel::Stable, pct);
            let hits = ids.iter().filter(|id| in_rollout(Some(id), &r)).count();
            let share = hits as f64 / ids.len() as f64 * 100.0;
            assert!(
                (share - f64::from(pct)).abs() < 1.0,
                "{pct}% rollout reached {share:.2}%"
            );
        }
        // Growing a rollout keeps everyone already in (monotonic).
        let r10 = release("1.4.0", Channel::Stable, 10);
        let r20 = release("1.4.0", Channel::Stable, 20);
        assert!(
            ids.iter()
                .filter(|id| in_rollout(Some(id), &r10))
                .all(|id| in_rollout(Some(id), &r20))
        );
        // Different releases draw different samples.
        let other = v("1.5.0");
        let same = ids
            .iter()
            .take(1000)
            .filter(|id| (bucket(id, &version) < 1000) == (bucket(id, &other) < 1000))
            .count();
        assert!(same < 1000, "independent across releases");
        // 0 % and no install id.
        assert!(!in_rollout(ID, &release("1.4.0", Channel::Stable, 0)));
        assert!(!in_rollout(None, &release("1.4.0", Channel::Stable, 99)));
        assert!(in_rollout(None, &release("1.4.0", Channel::Stable, 100)));
    }

    #[test]
    fn staged_release_falls_back_to_the_previous_one() {
        let rs = Releases {
            releases: vec![
                release("0.2.0", Channel::Stable, 100),
                release("0.3.0", Channel::Stable, 0),
            ],
        };
        assert_eq!(
            offer(&rs, "0.1.0", Channel::Stable, ID).map(|o| o.0),
            Some("0.2.0".into())
        );
        assert_eq!(offer(&rs, "0.2.0", Channel::Stable, ID), None);
    }

    #[test]
    fn force_below_bypasses_the_rollout() {
        let mut r = release("0.3.0", Channel::Stable, 0);
        r.force_below = Some(v("0.2.0"));
        let rs = Releases { releases: vec![r] };
        assert_eq!(
            offer(&rs, "0.1.5", Channel::Stable, None),
            Some(("0.3.0".into(), true))
        );
        assert_eq!(
            offer(&rs, "0.2.0", Channel::Stable, ID),
            None,
            "0 % and not forced"
        );
    }

    #[test]
    fn blocked_releases() {
        let mut bad = release("0.3.0", Channel::Stable, 100);
        bad.blocked = true;
        let rs = Releases {
            releases: vec![release("0.2.0", Channel::Stable, 100), bad],
        };
        assert_eq!(
            offer(&rs, "0.1.0", Channel::Stable, ID),
            Some(("0.2.0".into(), false)),
            "the previous good release"
        );
        assert_eq!(
            offer(&rs, "0.3.0", Channel::Stable, ID),
            None,
            "no downgrade"
        );
        // The fix ships at 5 %: installs on the blocked build get it first, mandatory.
        let mut rs = rs;
        rs.releases.push(release("0.3.1", Channel::Stable, 0));
        assert_eq!(
            offer(&rs, "0.3.0", Channel::Stable, ID),
            Some(("0.3.1".into(), true))
        );
        assert_eq!(
            offer(&rs, "0.2.0", Channel::Stable, ID),
            None,
            "others wait for the rollout"
        );
    }

    #[test]
    fn validation() {
        let ok = Releases {
            releases: vec![release("0.2.0", Channel::Stable, 100)],
        };
        assert!(Releases::parse(&ok.to_json()).is_ok());
        let cases: [(&str, Change); 6] = [
            ("rollout", |r| r.rollout = 101),
            ("pre-release", |r| r.version = v("0.2.0-beta.1")),
            ("RFC 3339", |r| r.pub_date = "yesterday".into()),
            ("French", |r| r.notes.fr = " ".into()),
            ("https", |r| {
                if let Some(a) = r.platforms.get_mut("windows-x86_64") {
                    a.url = "http://x".into();
                }
            }),
            ("forceBelow", |r| r.force_below = Some(v("9.0.0"))),
        ];
        for (expected, change) in cases {
            let mut bad = ok.clone();
            change(&mut bad.releases[0]);
            let err = bad.validate().expect_err(expected);
            assert!(err.contains(expected), "{err} should mention {expected}");
        }
        let mut twice = ok.clone();
        twice.releases.push(release("0.2.0", Channel::Beta, 100));
        assert!(twice.validate().is_err());
        assert!(
            Releases::parse(br#"{"releases":[],"extra":1}"#).is_err(),
            "typos are errors"
        );
    }
}
