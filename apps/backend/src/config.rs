//! Remote config: `GET /v1/config?version=…&channel=stable|beta` → `domain::RemoteConfig`.
//!
//! Served from `config.json` in the data dir (validated at load, reloaded when it changes).
//! The answer is computed per request (active banners, `updateRequired` for the caller's
//! version) and carries a strong `ETag` of its bytes: `If-None-Match` → 304.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use domain::{Banner, FeatureFlags, KillSwitches, MinVersion, RemoteConfig};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::Failure;
use crate::updates::Channel;
use crate::watched::Watched;

pub const CONFIG_FILE: &str = "config.json";

/// `config.json`: `RemoteConfig` without the per-request `updateRequired`, and banners may be
/// limited to some channels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigFile {
    pub features: FeatureFlags,
    pub kill_switches: KillSwitches,
    pub min_version: Option<MinVersion>,
    pub banners: Vec<BannerEntry>,
    pub stats_index_url: Option<String>,
    pub poll_after_secs: u32,
}

impl Default for ConfigFile {
    fn default() -> Self {
        let d = RemoteConfig::default();
        Self {
            features: d.features,
            kill_switches: d.kill_switches,
            min_version: d.min_version,
            banners: Vec::new(),
            stats_index_url: d.stats_index_url,
            poll_after_secs: d.poll_after_secs,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BannerEntry {
    #[serde(flatten)]
    pub banner: Banner,
    /// Empty: every channel.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<Channel>,
}

const TOP_KEYS: [&str; 6] = [
    "features",
    "killSwitches",
    "minVersion",
    "banners",
    "statsIndexUrl",
    "pollAfterSecs",
];
const BANNER_KEYS: [&str; 8] = [
    "id",
    "severity",
    "text",
    "link",
    "startsAt",
    "endsAt",
    "dismissible",
    "channels",
];

/// Unknown keys are typos (a misspelled kill switch must not be silently ignored).
fn check_keys(value: &Value, allowed: &[&str], at: &str) -> Result<(), String> {
    if let Some(map) = value.as_object() {
        for key in map.keys() {
            if !allowed.contains(&key.as_str()) {
                return Err(format!("unknown key {at}{key}"));
            }
        }
    }
    Ok(())
}

fn keys_of<T: Serialize>(default: &T) -> Vec<String> {
    serde_json::to_value(default)
        .ok()
        .and_then(|v| v.as_object().map(|m| m.keys().cloned().collect()))
        .unwrap_or_default()
}

fn time(s: Option<&String>, what: &str) -> Result<Option<OffsetDateTime>, String> {
    s.map(|s| OffsetDateTime::parse(s, &Rfc3339).map_err(|e| format!("{what} {s:?}: {e}")))
        .transpose()
}

fn https(url: &str, what: &str) -> Result<(), String> {
    if url.starts_with("https://") && url.len() <= 512 {
        Ok(())
    } else {
        Err(format!("{what} must be an https:// URL"))
    }
}

impl ConfigFile {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let value: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        check_keys(&value, &TOP_KEYS, "")?;
        let features = keys_of(&FeatureFlags::default());
        let features: Vec<&str> = features.iter().map(String::as_str).collect();
        check_keys(&value["features"], &features, "features.")?;
        let switches = keys_of(&KillSwitches::default());
        let switches: Vec<&str> = switches.iter().map(String::as_str).collect();
        check_keys(&value["killSwitches"], &switches, "killSwitches.")?;
        for b in value["banners"].as_array().into_iter().flatten() {
            check_keys(b, &BANNER_KEYS, "banners[].")?;
        }
        let file: Self = serde_json::from_value(value).map_err(|e| e.to_string())?;
        file.validate()?;
        Ok(file)
    }

    fn validate(&self) -> Result<(), String> {
        if let Some(min) = &self.min_version {
            Version::parse(&min.version)
                .map_err(|e| format!("minVersion.version {:?}: {e}", min.version))?;
            if min.message.en.trim().is_empty() || min.message.fr.trim().is_empty() {
                return Err("minVersion.message needs en and fr".into());
            }
        }
        let mut ids = HashSet::new();
        for BannerEntry { banner: b, .. } in &self.banners {
            if b.id.is_empty() || b.id.len() > 64 || !ids.insert(&b.id) {
                return Err(format!(
                    "banner id {:?} is empty, too long or repeated",
                    b.id
                ));
            }
            for text in [&b.text.en, &b.text.fr] {
                if text.trim().is_empty() || text.chars().count() > 300 {
                    return Err(format!(
                        "banner {}: text must be 1–300 characters in en and fr",
                        b.id
                    ));
                }
            }
            if let Some(link) = &b.link {
                https(link, &format!("banner {} link", b.id))?;
            }
            let start = time(b.starts_at.as_ref(), "startsAt")?;
            let end = time(b.ends_at.as_ref(), "endsAt")?;
            if let (Some(s), Some(e)) = (start, end)
                && s >= e
            {
                return Err(format!("banner {}: startsAt must be before endsAt", b.id));
            }
        }
        if let Some(url) = &self.stats_index_url {
            https(url, "statsIndexUrl")?;
        }
        if !(60..=86_400).contains(&self.poll_after_secs) {
            return Err("pollAfterSecs must be 60–86400".into());
        }
        Ok(())
    }

    /// What an app on `version` (if known) and `channel` sees at `now`.
    pub fn resolve(
        &self,
        version: Option<&Version>,
        channel: Channel,
        now: OffsetDateTime,
    ) -> RemoteConfig {
        let active = |b: &Banner| {
            let starts = time(b.starts_at.as_ref(), "").ok().flatten();
            let ends = time(b.ends_at.as_ref(), "").ok().flatten();
            starts.is_none_or(|s| s <= now) && ends.is_none_or(|e| now < e)
        };
        let banners = self
            .banners
            .iter()
            .filter(|e| e.channels.is_empty() || e.channels.contains(&channel))
            .filter(|e| active(&e.banner))
            .map(|e| e.banner.clone())
            .collect();
        let update_required = match (version, &self.min_version) {
            (Some(v), Some(min)) => {
                Version::parse(&min.version).is_ok_and(|min| v.cmp_precedence(&min).is_lt())
            }
            _ => false,
        };
        RemoteConfig {
            features: self.features,
            kill_switches: self.kill_switches,
            min_version: self.min_version.clone(),
            update_required,
            banners,
            stats_index_url: self.stats_index_url.clone(),
            poll_after_secs: self.poll_after_secs,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct Params {
    version: Option<String>,
    channel: Option<String>,
}

/// Whether `If-None-Match` lists `etag` (or `*`); weak validators compare equal too.
fn matches(if_none_match: &str, etag: &str) -> bool {
    if_none_match
        .split(',')
        .map(str::trim)
        .any(|t| t == "*" || t.strip_prefix("W/").unwrap_or(t) == etag)
}

pub async fn get_config(
    State(config): State<Arc<Watched<ConfigFile>>>,
    Query(params): Query<Params>,
    headers: HeaderMap,
) -> Result<Response, Failure> {
    let version = params
        .version
        .as_deref()
        .filter(|v| !v.is_empty())
        .map(|v| Version::parse(v.strip_prefix('v').unwrap_or(v)))
        .transpose()
        .map_err(|_| Failure::bad_request("version is not semver"))?;
    let channel = match params.channel.as_deref() {
        None | Some("") => Channel::Stable,
        Some(c) => {
            Channel::parse(c).ok_or_else(|| Failure::bad_request("channel: stable or beta"))?
        }
    };
    let resolved = config
        .get()
        .resolve(version.as_ref(), channel, OffsetDateTime::now_utc());
    // Plain structs of strings and numbers: serializing cannot fail.
    let body = serde_json::to_vec(&resolved).unwrap_or_default();
    let digest = Sha256::digest(&body);
    let mut etag = String::from("\"");
    for b in &digest[..12] {
        let _ = write!(etag, "{b:02x}");
    }
    etag.push('"');
    let etag_value = HeaderValue::from_str(&etag).unwrap_or(HeaderValue::from_static("\"\""));
    let cache = HeaderValue::from_static("no-cache");
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|inm| matches(inm, &etag))
    {
        return Ok((
            StatusCode::NOT_MODIFIED,
            [(header::ETAG, etag_value), (header::CACHE_CONTROL, cache)],
        )
            .into_response());
    }
    Ok((
        [
            (header::ETAG, etag_value),
            (header::CACHE_CONTROL, cache),
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            ),
        ],
        Body::from(body),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use domain::BannerSeverity;
    use time::macros::datetime;

    use super::*;

    const SAMPLE: &str = r#"{
        "features": { "autoAccept": false },
        "killSwitches": { "runeImport": true },
        "minVersion": { "version": "0.2.0", "message": { "en": "Please update", "fr": "Merci de mettre à jour" } },
        "banners": [
            { "id": "patch-26.19", "severity": "info",
              "text": { "en": "Patch day: stats are warming up", "fr": "Jour de patch : les stats arrivent" },
              "link": null, "startsAt": "2026-09-30T08:00:00Z", "endsAt": "2026-10-01T08:00:00Z" },
            { "id": "beta-only", "severity": "warn", "channels": ["beta"], "dismissible": false,
              "text": { "en": "Beta build", "fr": "Version bêta" },
              "link": "https://status.example", "startsAt": null, "endsAt": null }
        ],
        "statsIndexUrl": "https://stats.example/index.json",
        "pollAfterSecs": 3600
    }"#;

    #[test]
    fn parses_and_resolves_per_request() {
        let file = ConfigFile::parse(SAMPLE.as_bytes()).expect("valid");
        assert!(!file.features.auto_accept);
        assert!(file.features.scouting, "missing flags default to on");
        assert!(file.kill_switches.rune_import);

        let before = file.resolve(
            Some(&Version::new(0, 1, 9)),
            Channel::Stable,
            datetime!(2026-09-29 12:00 UTC),
        );
        assert!(before.update_required);
        assert!(
            before.banners.is_empty(),
            "patch banner not started, beta banner hidden"
        );

        let during = file.resolve(
            Some(&Version::new(0, 2, 0)),
            Channel::Beta,
            datetime!(2026-09-30 12:00 UTC),
        );
        assert!(!during.update_required);
        let ids: Vec<&str> = during.banners.iter().map(|b| b.id.as_str()).collect();
        assert_eq!(ids, ["patch-26.19", "beta-only"]);
        assert_eq!(during.banners[1].severity, BannerSeverity::Warn);
        assert!(
            during.banners[0].dismissible,
            "dismissible unless said otherwise"
        );
        assert!(!during.banners[1].dismissible);

        let after = file.resolve(None, Channel::Stable, datetime!(2026-10-01 08:00 UTC));
        assert!(after.banners.is_empty(), "the end is exclusive");
        assert!(!after.update_required, "unknown version: not forced");
    }

    #[test]
    fn rejects_invalid_files() {
        for (bad, expected) in [
            (r#"{"killSwitch": {}}"#, "unknown key killSwitch"),
            (
                r#"{"killSwitches": {"autoAcept": true}}"#,
                "killSwitches.autoAcept",
            ),
            (r#"{"features": {"scoutin": true}}"#, "features.scoutin"),
            (
                r#"{"minVersion": {"version": "two", "message": {"en": "a", "fr": "b"}}}"#,
                "minVersion",
            ),
            (r#"{"pollAfterSecs": 5}"#, "pollAfterSecs"),
            (r#"{"statsIndexUrl": "http://x"}"#, "https"),
            (
                r#"{"banners": [{"id": "a", "severity": "info", "text": {"en": "x", "fr": "y"}, "link": null, "startsAt": "2026-10-02T00:00:00Z", "endsAt": "2026-10-01T00:00:00Z"}]}"#,
                "before endsAt",
            ),
            (
                r#"{"banners": [{"id": "a", "severity": "info", "text": {"en": "x", "fr": "y"}, "link": null, "startsAt": null, "endsAt": null, "colour": "red"}]}"#,
                "banners[].colour",
            ),
            (
                r#"{"banners": [{"id": "a", "severity": "critical", "text": {"en": "x", "fr": "y"}, "link": null, "startsAt": null, "endsAt": null}]}"#,
                "critical",
            ),
        ] {
            let err = ConfigFile::parse(bad.as_bytes()).expect_err(bad);
            assert!(
                err.contains(expected),
                "{err:?} should mention {expected:?}"
            );
        }
        assert_eq!(ConfigFile::parse(b"{}"), Ok(ConfigFile::default()));
    }

    #[test]
    fn if_none_match_forms() {
        assert!(matches("\"abc\"", "\"abc\""));
        assert!(matches("W/\"abc\"", "\"abc\""));
        assert!(matches("\"x\", \"abc\"", "\"abc\""));
        assert!(matches("*", "\"abc\""));
        assert!(!matches("\"abd\"", "\"abc\""));
    }
}
