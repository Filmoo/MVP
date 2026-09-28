//! Remote config from our backend (`GET /v1/config`): feature flags, kill switches, banners and
//! the oldest supported version.
//!
//! Fetched at start and again after each answer's `pollAfterSecs` (one timer, here in the core,
//! never in the UI), revalidated with its `ETag`. The last answer is kept on disk, so it applies
//! from the next start on, before the network answers or when it doesn't: a kill switch stays
//! on while offline. The core applies kill switches as soon as they change (see `lib.rs`); the
//! UI gets the config through the `remote_config` command and `remote-config` events.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use domain::{BackendError, ImportPart, RemoteConfig};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::backend::{BackendClient, ConfigFetch};
use crate::settings::write_atomic;

/// File next to `settings.json` holding the last answer.
pub const FILE_NAME: &str = "remote-config.json";
/// Release channel of this build (config and updates).
pub const CHANNEL: &str = "stable";
/// Bounds on the server's `pollAfterSecs` (the server validates the same range).
const MIN_POLL: Duration = Duration::from_secs(60);
const MAX_POLL: Duration = Duration::from_secs(24 * 60 * 60);
/// Next try after a failed fetch (offline, server down), unless the config asks sooner.
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(10 * 60);

/// What `FILE_NAME` holds.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    /// The app version it was fetched for: `updateRequired` depends on it.
    app_version: String,
    etag: Option<String>,
    config: RemoteConfig,
}

/// Whether `version` is below the config's `minVersion` (unreadable versions never are).
pub fn below_min_version(version: &str, config: &RemoteConfig) -> bool {
    config.min_version.as_ref().is_some_and(|min| {
        match (
            semver::Version::parse(version),
            semver::Version::parse(&min.version),
        ) {
            (Ok(version), Ok(min)) => version.cmp_precedence(&min).is_lt(),
            _ => false,
        }
    })
}

/// Auto-accept may run: its feature is on and its kill switch off.
pub fn auto_accept_allowed(config: &RemoteConfig) -> bool {
    config.features.auto_accept && !config.kill_switches.auto_accept
}

/// A build import part may run: its feature is on and its kill switch off.
pub const fn import_allowed(config: &RemoteConfig, part: ImportPart) -> bool {
    let (feature, killed) = match part {
        ImportPart::Runes => (
            config.features.rune_import,
            config.kill_switches.rune_import,
        ),
        ImportPart::ItemSet => (config.features.item_sets, config.kill_switches.item_sets),
        ImportPart::Spells => (
            config.features.summoner_spells,
            config.kill_switches.summoner_spells,
        ),
    };
    feature && !killed
}

/// How long to wait before asking again after an answer.
pub fn poll_interval(config: &RemoteConfig) -> Duration {
    Duration::from_secs(config.poll_after_secs.into()).clamp(MIN_POLL, MAX_POLL)
}

/// The remote config as last received, published on a watch channel.
#[derive(Debug)]
pub struct RemoteConfigStore {
    path: PathBuf,
    app_version: String,
    etag: Mutex<Option<String>>,
    tx: watch::Sender<RemoteConfig>,
}

impl RemoteConfigStore {
    /// Starts from the last saved answer; defaults (everything on, no kill switch) when there is
    /// none or it can't be read.
    pub fn load(path: PathBuf, app_version: &str) -> Self {
        let saved = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Saved>(&bytes).ok());
        let (config, etag) = match saved {
            Some(saved) if saved.app_version == app_version => (saved.config, saved.etag),
            // Fetched for the version before an update: its `updateRequired` no longer holds.
            Some(mut saved) => {
                saved.config.update_required = below_min_version(app_version, &saved.config);
                (saved.config, None)
            }
            None => (RemoteConfig::default(), None),
        };
        Self {
            path,
            app_version: app_version.to_owned(),
            etag: Mutex::new(etag),
            tx: watch::channel(config).0,
        }
    }

    /// The config in force.
    pub fn get(&self) -> RemoteConfig {
        self.tx.borrow().clone()
    }

    /// Follows every change.
    pub fn subscribe(&self) -> watch::Receiver<RemoteConfig> {
        self.tx.subscribe()
    }

    fn etag(&self) -> Option<String> {
        self.etag
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// A new answer: in force at once, and saved for the next start.
    fn accept(&self, config: RemoteConfig, etag: Option<String>) {
        let saved = Saved {
            app_version: self.app_version.clone(),
            etag: etag.clone(),
            config: config.clone(),
        };
        *self.etag.lock().unwrap_or_else(PoisonError::into_inner) = etag;
        self.tx.send_if_modified(|current| {
            let changed = *current != config;
            *current = config;
            changed
        });
        let written = serde_json::to_vec_pretty(&saved)
            .map_err(std::io::Error::other)
            .and_then(|json| write_atomic(&self.path, &json));
        if let Err(error) = written {
            tracing::warn!(%error, path = %self.path.display(), "cannot save the remote config");
        }
    }

    /// Asks the backend once. `Ok(true)`: a new config arrived (`false`: ours is current).
    pub async fn refresh(&self, backend: &BackendClient) -> Result<bool, BackendError> {
        let etag = self.etag();
        match backend
            .remote_config(&self.app_version, CHANNEL, etag.as_deref())
            .await?
        {
            ConfigFetch::NotModified => Ok(false),
            ConfigFetch::Modified { config, etag } => {
                self.accept(config, etag);
                Ok(true)
            }
        }
    }

    /// Fetches now, then again after each answer's `pollAfterSecs`, for as long as the task
    /// runs. A failed fetch keeps the config in force and tries again later.
    pub async fn follow(self: Arc<Self>, backend: BackendClient) {
        loop {
            let wait = match self.refresh(&backend).await {
                Ok(changed) => {
                    tracing::debug!(changed, "remote config checked");
                    poll_interval(&self.get())
                }
                Err(error) => {
                    tracing::info!(%error, "remote config unavailable, keeping the last one");
                    RETRY_AFTER_FAILURE.min(poll_interval(&self.get()))
                }
            };
            tokio::time::sleep(wait).await;
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use domain::{LocalizedText, MinVersion};

    use super::*;

    fn with_min(version: &str) -> RemoteConfig {
        RemoteConfig {
            min_version: Some(MinVersion {
                version: version.to_owned(),
                message: LocalizedText {
                    en: "Update".into(),
                    fr: "Mettez à jour".into(),
                },
            }),
            ..RemoteConfig::default()
        }
    }

    #[test]
    fn compares_with_the_minimum_version() {
        assert!(below_min_version("0.1.0", &with_min("0.2.0")));
        assert!(!below_min_version("0.2.0", &with_min("0.2.0")));
        assert!(!below_min_version("0.10.0", &with_min("0.2.0")));
        assert!(below_min_version("0.2.0-beta.1", &with_min("0.2.0")));
        assert!(!below_min_version("garbage", &with_min("0.2.0")));
        assert!(!below_min_version("0.1.0", &RemoteConfig::default()));
    }

    #[test]
    fn auto_accept_needs_its_feature_and_no_kill_switch() {
        let mut config = RemoteConfig::default();
        assert!(auto_accept_allowed(&config));
        config.kill_switches.auto_accept = true;
        assert!(!auto_accept_allowed(&config));
        config.kill_switches.auto_accept = false;
        config.features.auto_accept = false;
        assert!(!auto_accept_allowed(&config));
    }

    #[test]
    fn polls_within_bounds() {
        let mut config = RemoteConfig::default();
        assert_eq!(poll_interval(&config), Duration::from_secs(6 * 60 * 60));
        config.poll_after_secs = 1;
        assert_eq!(poll_interval(&config), MIN_POLL);
        config.poll_after_secs = u32::MAX;
        assert_eq!(poll_interval(&config), MAX_POLL);
    }

    #[test]
    fn starts_from_the_last_answer_and_forgets_a_stale_update_required() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let fresh = RemoteConfigStore::load(path.clone(), "0.1.0");
        assert_eq!(fresh.get(), RemoteConfig::default(), "nothing saved yet");

        let mut answer = with_min("0.2.0");
        answer.update_required = true;
        answer.kill_switches.auto_accept = true;
        fresh.accept(answer.clone(), Some("\"abc\"".into()));

        let again = RemoteConfigStore::load(path.clone(), "0.1.0");
        assert_eq!(again.get(), answer, "offline start: the kill switch holds");
        assert_eq!(again.etag().as_deref(), Some("\"abc\""));

        let updated = RemoteConfigStore::load(path.clone(), "0.2.0");
        assert!(!updated.get().update_required, "updated since");
        assert!(updated.get().kill_switches.auto_accept);
        assert_eq!(updated.etag(), None, "fetched for another version");

        std::fs::write(&path, b"{ not json").unwrap();
        assert_eq!(
            RemoteConfigStore::load(path, "0.1.0").get(),
            RemoteConfig::default()
        );
    }
}
