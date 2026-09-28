//! App updates with `tauri-plugin-updater`, carrying out `companion::updates::UpdatePlan`:
//! check 30 s after start then every 6 h (at once when the remote config says this version is
//! no longer supported, or when the player asks), download outside ready checks, champion
//! select and games, restart when the player says so ("Update ready — Restart"), otherwise
//! install when MVP quits — never during a game.
//!
//! Sources, asked in order until one answers: our backend
//! (`{backend}/v1/updates/{{target}}/{{arch}}/{{current_version}}?channel=stable`, with
//! `X-MVP-Install`; HTTPS only), then the project's latest GitHub release (its `latest.json`,
//! made by `release.yml`; no install id sent). Downloads are verified with
//! `plugins.updater.pubkey` in `tauri.conf.json` (`node scripts/setup-updates.mjs` makes the key
//! pair). Debug builds and builds without that key don't update themselves.

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use companion::updates::{Offer, Step, UpdatePlan};
use domain::{ClientStatus, GameflowPhase, RemoteConfig, UpdateStatus};
use serde_json::Value;
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime, Url};
use tauri_plugin_updater::{Update, Updater, UpdaterExt as _};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::core::Core;

const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// A downloaded and verified update.
struct Downloaded {
    update: Update,
    bytes: Vec<u8>,
}

enum Request {
    Check(oneshot::Sender<UpdateStatus>),
    Install(oneshot::Sender<Result<(), String>>),
}

enum Event {
    Checked(Result<Option<Box<Update>>, String>),
    Progress(Option<u8>),
    Downloaded(Result<Vec<u8>, String>),
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The app's updates, for the commands and the quit handler.
pub struct Updates {
    status: watch::Receiver<UpdateStatus>,
    /// `None` when this build doesn't update itself.
    requests: Option<mpsc::UnboundedSender<Request>>,
    plan: Arc<Mutex<UpdatePlan>>,
    ready: Arc<Mutex<Option<Downloaded>>>,
}

impl fmt::Debug for Updates {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Updates")
            .field("status", &*self.status.borrow())
            .finish_non_exhaustive()
    }
}

impl Updates {
    pub fn status(&self) -> UpdateStatus {
        self.status.borrow().clone()
    }

    /// Checks now (unless a check runs or an update is on its way); answers the status then.
    pub async fn check(&self) -> UpdateStatus {
        let Some(requests) = &self.requests else {
            return self.status();
        };
        let (reply, answer) = oneshot::channel();
        if requests.send(Request::Check(reply)).is_err() {
            return self.status();
        }
        answer.await.unwrap_or_else(|_| self.status())
    }

    /// Restarts into the downloaded update (on Windows the installer takes over and this
    /// process ends). Refused during champion select or a game, or with nothing downloaded.
    pub async fn install(&self) -> Result<(), String> {
        let Some(requests) = &self.requests else {
            return Err("this build doesn't update itself".to_owned());
        };
        let (reply, answer) = oneshot::channel();
        requests
            .send(Request::Install(reply))
            .map_err(|_| "the updater stopped".to_owned())?;
        answer.await.map_err(|_| "the updater stopped".to_owned())?
    }
}

/// The update sources in the order they are asked (see the module docs), or why this build
/// doesn't update itself.
fn build<R: Runtime>(app: &AppHandle<R>, install_id: &str) -> Result<Vec<Updater>, String> {
    if cfg!(debug_assertions) {
        return Err("development build".to_owned());
    }
    let pubkey = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if pubkey.trim().is_empty() {
        return Err("no update key in this build".to_owned());
    }
    let mut sources = Vec::new();
    let base = companion::backend::base_url();
    if companion::updates::serves_updates(&base) {
        match backend_updater(app, &base, install_id) {
            Ok(updater) => sources.push(updater),
            Err(error) => tracing::warn!(%error, "no updates from MVP's server"),
        }
    }
    match github_updater(app) {
        Ok(updater) => sources.push(updater),
        Err(error) => tracing::warn!(%error, "no updates from GitHub"),
    }
    if sources.is_empty() {
        return Err("no update source".to_owned());
    }
    Ok(sources)
}

fn backend_updater<R: Runtime>(
    app: &AppHandle<R>,
    base: &str,
    install_id: &str,
) -> Result<Updater, String> {
    let endpoint = companion::updates::endpoint(base);
    let endpoint = Url::parse(&endpoint).map_err(|e| format!("update server URL: {e}"))?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("update server: {e}"))?
        .header(companion::backend::INSTALL_HEADER, install_id)
        .map_err(|e| format!("install id: {e}"))?
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// The latest GitHub release's `latest.json`: no install id (not our server).
fn github_updater<R: Runtime>(app: &AppHandle<R>) -> Result<Updater, String> {
    let endpoint =
        Url::parse(companion::updates::GITHUB_LATEST).map_err(|e| format!("GitHub URL: {e}"))?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("GitHub releases: {e}"))?
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// Asks each source in turn: the first that answers decides ("no update" included), a source
/// that can't be reached hands over to the next.
async fn check_sources(sources: &[Updater]) -> Result<Option<Update>, String> {
    let mut failure = "no update source".to_owned();
    for source in sources {
        match source.check().await {
            Ok(found) => return Ok(found),
            Err(error) => {
                tracing::info!(%error, "update source unavailable");
                failure = error.to_string();
            }
        }
    }
    Err(failure)
}

/// Starts following the plan. `phase` is the client status (no update during a game),
/// `remote` the remote config (`updateRequired` asks for a check at once).
pub fn start<R: Runtime>(
    app: &AppHandle<R>,
    install_id: &str,
    phase: watch::Receiver<ClientStatus>,
    remote: watch::Receiver<RemoteConfig>,
) -> Updates {
    let ready = Arc::new(Mutex::new(None));
    let sources = match build(app, install_id) {
        Ok(sources) => sources,
        Err(reason) => {
            tracing::info!(%reason, "app updates off");
            let plan = UpdatePlan::unavailable(reason);
            let (_, status) = watch::channel(plan.status());
            return Updates {
                status,
                requests: None,
                plan: Arc::new(Mutex::new(plan)),
                ready,
            };
        }
    };
    let plan = Arc::new(Mutex::new(UpdatePlan::new(Instant::now())));
    let (status_tx, status) = watch::channel(lock(&plan).status());
    let (requests_tx, requests) = mpsc::unbounded_channel();
    let (events_tx, events) = mpsc::unbounded_channel();
    let task = Task {
        app: app.clone(),
        sources: Arc::new(sources),
        plan: Arc::clone(&plan),
        ready: Arc::clone(&ready),
        status: status_tx,
        offered: None,
        download: None,
        events: events_tx,
    };
    tauri::async_runtime::spawn(task.run(requests, events, phase, remote));
    Updates {
        status,
        requests: Some(requests_tx),
        plan,
        ready,
    }
}

/// MVP is quitting: installs a downloaded update on the way out (unless a game runs), without
/// reopening MVP. On Windows the installer takes over and this process ends here.
pub fn install_on_quit<R: Runtime>(app: &AppHandle<R>) {
    let Some(updates) = app.try_state::<Updates>() else {
        return;
    };
    let phase = app
        .try_state::<Core>()
        .map_or(GameflowPhase::Idle, |core| core.status.borrow().phase);
    if lock(&updates.plan).on_quit(phase).is_none() {
        return;
    }
    let Some(downloaded) = lock(&updates.ready).take() else {
        return;
    };
    tracing::info!(version = %downloaded.update.version, "installing the update on quit");
    let update = downloaded.update.restart_after_install(false);
    if let Err(error) = update.install(&downloaded.bytes) {
        tracing::warn!(%error, "cannot install the update");
    }
}

fn offer(update: &Update) -> Offer {
    Offer {
        version: update.version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
        // Our backend's manifest adds it; the plugin ignores it.
        mandatory: update
            .raw_json
            .get("mandatory")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

fn percent(received: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|&t| t > 0)?;
    u8::try_from((received.saturating_mul(100) / total).min(100)).ok()
}

async fn wait_until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

/// The updater's loop: owns the checks and downloads, follows the plan.
struct Task<R: Runtime> {
    app: AppHandle<R>,
    /// Where updates come from, in order (see [`build`]).
    sources: Arc<Vec<Updater>>,
    plan: Arc<Mutex<UpdatePlan>>,
    ready: Arc<Mutex<Option<Downloaded>>>,
    status: watch::Sender<UpdateStatus>,
    /// The update the last check found.
    offered: Option<Update>,
    download: Option<JoinHandle<()>>,
    events: mpsc::UnboundedSender<Event>,
}

impl<R: Runtime> Task<R> {
    async fn run(
        mut self,
        mut requests: mpsc::UnboundedReceiver<Request>,
        mut events: mpsc::UnboundedReceiver<Event>,
        mut phase: watch::Receiver<ClientStatus>,
        mut remote: watch::Receiver<RemoteConfig>,
    ) {
        if remote.borrow_and_update().update_required {
            let step = lock(&self.plan).check_now();
            self.execute(step);
            self.publish();
        }
        loop {
            let next = lock(&self.plan).next_check();
            let current = phase.borrow().phase;
            let step = tokio::select! {
                () = wait_until(next) => lock(&self.plan).tick(Instant::now()),
                Ok(()) = phase.changed() => {
                    let now = phase.borrow_and_update().phase;
                    lock(&self.plan).phase(now)
                }
                Ok(()) = remote.changed() => {
                    let required = remote.borrow_and_update().update_required;
                    if required { lock(&self.plan).check_now() } else { None }
                }
                Some(request) = requests.recv() => self.request(request, current),
                Some(event) = events.recv() => self.event(event, current),
            };
            self.execute(step);
            self.publish();
        }
    }

    fn request(&mut self, request: Request, phase: GameflowPhase) -> Option<Step> {
        match request {
            Request::Check(reply) => {
                let step = lock(&self.plan).check_now();
                self.execute(step);
                self.publish();
                let _ = reply.send(lock(&self.plan).status());
                None
            }
            Request::Install(reply) => {
                let decided = lock(&self.plan).install(phase);
                let _ = reply.send(match decided {
                    Ok(Step::Install { restart }) => self.install(restart),
                    Ok(_) => Err("nothing to install".to_owned()),
                    Err(refusal) => Err(refusal.to_string()),
                });
                None
            }
        }
    }

    /// Installs the downloaded update. On Windows the installer takes over and this process
    /// ends; elsewhere the files are replaced and MVP restarts (`restart`).
    fn install(&self, restart: bool) -> Result<(), String> {
        let downloaded = lock(&self.ready).take().ok_or("nothing downloaded")?;
        tracing::info!(version = %downloaded.update.version, "installing the update");
        let update = downloaded.update.clone().restart_after_install(restart);
        if let Err(error) = update.install(&downloaded.bytes) {
            let message = error.to_string();
            // Keep it for the next try (or the quit).
            *lock(&self.ready) = Some(downloaded);
            return Err(message);
        }
        if restart {
            self.app.restart();
        }
        Ok(())
    }

    fn event(&mut self, event: Event, phase: GameflowPhase) -> Option<Step> {
        let now = Instant::now();
        match event {
            Event::Checked(result) => {
                let result = result.map(|found| {
                    found.map(|update| {
                        let offer = offer(&update);
                        self.offered = Some(*update);
                        offer
                    })
                });
                lock(&self.plan).checked(result, phase, now)
            }
            Event::Progress(percent) => {
                lock(&self.plan).progress(percent);
                None
            }
            Event::Downloaded(result) => {
                self.download = None;
                let mut plan = lock(&self.plan);
                match result {
                    Ok(bytes) => {
                        plan.downloaded(Ok(()), now);
                        // Not Ready: a game started as it finished; it downloads again after.
                        if let (UpdateStatus::Ready { .. }, Some(update)) =
                            (plan.status(), self.offered.clone())
                        {
                            *lock(&self.ready) = Some(Downloaded { update, bytes });
                        }
                    }
                    Err(message) => plan.downloaded(Err(message), now),
                }
                None
            }
        }
    }

    fn execute(&mut self, step: Option<Step>) {
        match step {
            None | Some(Step::Install { .. }) => {}
            Some(Step::Check) => {
                let sources = Arc::clone(&self.sources);
                let events = self.events.clone();
                tauri::async_runtime::spawn(async move {
                    let found = check_sources(&sources)
                        .await
                        .map(|found| found.map(Box::new));
                    if let Err(error) = &found {
                        tracing::info!(%error, "update check failed");
                    }
                    let _ = events.send(Event::Checked(found));
                });
            }
            Some(Step::Download) => {
                let Some(mut update) = self.offered.clone() else {
                    return;
                };
                update.timeout = Some(DOWNLOAD_TIMEOUT);
                let events = self.events.clone();
                self.download = Some(tokio::spawn(async move {
                    let (mut received, mut shown) = (0_u64, None);
                    let progress = |chunk: usize, total: Option<u64>| {
                        received = received.saturating_add(chunk as u64);
                        let now = percent(received, total);
                        if now != shown {
                            shown = now;
                            let _ = events.send(Event::Progress(now));
                        }
                    };
                    let bytes = update
                        .download(progress, || {})
                        .await
                        .map_err(|e| e.to_string());
                    if let Err(error) = &bytes {
                        tracing::info!(%error, "update download failed");
                    }
                    let _ = events.send(Event::Downloaded(bytes));
                }));
            }
            Some(Step::StopDownload) => {
                if let Some(download) = self.download.take() {
                    tracing::info!("a game starts: update download stopped");
                    download.abort();
                }
            }
        }
    }

    /// Tells the UI when what it shows changes.
    fn publish(&self) {
        let next = lock(&self.plan).status();
        let changed = self.status.send_if_modified(|current| {
            let changed = *current != next;
            current.clone_from(&next);
            changed
        });
        if changed && let Err(error) = self.app.emit("app-update", next) {
            tracing::warn!(%error, "cannot emit the update status");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_percentages() {
        assert_eq!(percent(0, Some(200)), Some(0));
        assert_eq!(percent(50, Some(200)), Some(25));
        assert_eq!(percent(250, Some(200)), Some(100));
        assert_eq!(percent(50, None), None);
        assert_eq!(percent(50, Some(0)), None);
    }
}
