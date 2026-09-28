//! When the app updates itself: the policy, free of Tauri so it can be tested. The shell's
//! updater (`apps/desktop/src/updater.rs`) carries out the [`Step`]s this plan asks for.
//!
//! - Check shortly after start, then every 6 hours (sooner when the remote config says this
//!   version is no longer supported, or when the player asks).
//! - Download only while no ready check, champion select or game is running, and stop a
//!   download when one starts: bandwidth, CPU and focus belong to the game.
//! - Never install by surprise: the player restarts when they choose ("Update ready —
//!   Restart"); otherwise the update installs when MVP quits. Never during a game either way.

use std::time::Duration;

use domain::{GameflowPhase, UpdateStatus};
use tokio::time::Instant;

/// First check after start: let the app settle first.
pub const FIRST_CHECK_AFTER: Duration = Duration::from_secs(30);
pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// After a failed check or download.
pub const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(60 * 60);

/// The project's latest GitHub release (`release.yml` attaches its `latest.json`: version, notes,
/// installer URL and signature). Updates come from there while MVP's own server isn't reachable,
/// so builds update themselves before any server of ours exists.
pub const GITHUB_LATEST: &str =
    "https://github.com/Filmoo/MVP/releases/latest/download/latest.json";

/// Our backend can serve updates only over HTTPS (the updater refuses plain HTTP, and a local
/// development server is no update source).
pub fn serves_updates(base: &str) -> bool {
    base.trim().starts_with("https://")
}

/// The updater endpoint on our backend `base`, stable channel. Tauri fills in `{{target}}`,
/// `{{arch}}` and `{{current_version}}` (e.g. `windows/x86_64/0.1.0`).
pub fn endpoint(base: &str) -> String {
    format!(
        "{}/v1/updates/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}?channel={}",
        base.trim_end_matches('/'),
        crate::remote::CHANNEL
    )
}

/// The player is about to play or playing: no download, no install.
pub const fn in_game(phase: GameflowPhase) -> bool {
    matches!(
        phase,
        GameflowPhase::ReadyCheck
            | GameflowPhase::ChampSelect
            | GameflowPhase::Loading
            | GameflowPhase::InGame
    )
}

/// An update the server offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub version: String,
    pub notes: Option<String>,
    /// The server flagged it (this version is pulled, or below the release's `forceBelow`).
    pub mandatory: bool,
}

/// What the updater should do now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Ask the server whether there is an update.
    Check,
    /// Download (and verify) the offered update.
    Download,
    /// Stop the download in progress: a game is starting.
    StopDownload,
    /// Install the downloaded update; `restart`: open MVP again afterwards.
    Install { restart: bool },
}

/// Why an install asked for can't happen now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    NothingReady,
    /// Champion select or a game is running: after it.
    InGame,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::NothingReady => "no update is ready to install",
            Self::InGame => "MVP updates after your game",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Stage {
    Unavailable(String),
    Idle,
    Checking,
    UpToDate,
    Available(Offer),
    Downloading(Offer, Option<u8>),
    Ready(Offer),
    Failed(String),
}

/// Where the update stands, and what to do on each event.
#[derive(Debug)]
pub struct UpdatePlan {
    stage: Stage,
    next_check: Option<Instant>,
}

impl UpdatePlan {
    /// A build that updates itself: first check at `now + FIRST_CHECK_AFTER`.
    pub fn new(now: Instant) -> Self {
        Self {
            stage: Stage::Idle,
            next_check: Some(now + FIRST_CHECK_AFTER),
        }
    }

    /// A build that can't update itself (`reason` is shown in Settings).
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            stage: Stage::Unavailable(reason.into()),
            next_check: None,
        }
    }

    pub fn status(&self) -> UpdateStatus {
        match &self.stage {
            Stage::Unavailable(reason) => UpdateStatus::Unavailable {
                reason: reason.clone(),
            },
            Stage::Idle => UpdateStatus::Idle,
            Stage::Checking => UpdateStatus::Checking,
            Stage::UpToDate => UpdateStatus::UpToDate,
            Stage::Available(offer) => UpdateStatus::Available {
                version: offer.version.clone(),
                notes: offer.notes.clone(),
                mandatory: offer.mandatory,
            },
            Stage::Downloading(offer, percent) => UpdateStatus::Downloading {
                version: offer.version.clone(),
                percent: *percent,
            },
            Stage::Ready(offer) => UpdateStatus::Ready {
                version: offer.version.clone(),
                notes: offer.notes.clone(),
                mandatory: offer.mandatory,
            },
            Stage::Failed(message) => UpdateStatus::Failed {
                message: message.clone(),
            },
        }
    }

    /// When the next periodic check is due; `None` while one is running, an update is on its
    /// way or ready, or this build doesn't update.
    pub fn next_check(&self) -> Option<Instant> {
        match self.stage {
            Stage::Idle | Stage::UpToDate | Stage::Failed(_) => self.next_check,
            _ => None,
        }
    }

    /// The timer fired.
    pub fn tick(&mut self, now: Instant) -> Option<Step> {
        if self.next_check().is_some_and(|due| now >= due) {
            self.check_now()
        } else {
            None
        }
    }

    /// Check right away (the player asked, or this version is no longer supported). Nothing
    /// to do while a check runs or an update is already on its way.
    pub fn check_now(&mut self) -> Option<Step> {
        match self.stage {
            Stage::Idle | Stage::UpToDate | Stage::Failed(_) => {
                self.stage = Stage::Checking;
                self.next_check = None;
                Some(Step::Check)
            }
            _ => None,
        }
    }

    /// The server answered (`Ok(None)`: up to date). An offer downloads now unless a game runs.
    pub fn checked(
        &mut self,
        result: Result<Option<Offer>, String>,
        phase: GameflowPhase,
        now: Instant,
    ) -> Option<Step> {
        if self.stage != Stage::Checking {
            return None;
        }
        match result {
            Ok(None) => {
                self.stage = Stage::UpToDate;
                self.next_check = Some(now + CHECK_EVERY);
                None
            }
            Ok(Some(offer)) if in_game(phase) => {
                self.stage = Stage::Available(offer);
                None
            }
            Ok(Some(offer)) => {
                self.stage = Stage::Downloading(offer, None);
                Some(Step::Download)
            }
            Err(message) => {
                self.stage = Stage::Failed(message);
                self.next_check = Some(now + RETRY_AFTER_FAILURE);
                None
            }
        }
    }

    /// Download progress; `true` when what the player sees changed.
    pub fn progress(&mut self, percent: Option<u8>) -> bool {
        match &mut self.stage {
            Stage::Downloading(_, shown) if *shown != percent => {
                *shown = percent;
                true
            }
            _ => false,
        }
    }

    /// The download finished (verified) or failed.
    pub fn downloaded(&mut self, result: Result<(), String>, now: Instant) {
        let Stage::Downloading(offer, _) = &self.stage else {
            return;
        };
        match result {
            Ok(()) => self.stage = Stage::Ready(offer.clone()),
            Err(message) => {
                self.stage = Stage::Failed(message);
                self.next_check = Some(now + RETRY_AFTER_FAILURE);
            }
        }
    }

    /// The gameflow phase changed: a waiting download starts after the game, a running one
    /// stops when a game starts (and resumes after it).
    pub fn phase(&mut self, phase: GameflowPhase) -> Option<Step> {
        match &self.stage {
            Stage::Available(offer) if !in_game(phase) => {
                self.stage = Stage::Downloading(offer.clone(), None);
                Some(Step::Download)
            }
            Stage::Downloading(offer, _) if in_game(phase) => {
                self.stage = Stage::Available(offer.clone());
                Some(Step::StopDownload)
            }
            _ => None,
        }
    }

    /// The player asked to restart into the update.
    pub fn install(&self, phase: GameflowPhase) -> Result<Step, Refusal> {
        match self.stage {
            Stage::Ready(_) if in_game(phase) => Err(Refusal::InGame),
            Stage::Ready(_) => Ok(Step::Install { restart: true }),
            _ => Err(Refusal::NothingReady),
        }
    }

    /// MVP is quitting: install a ready update on the way out, unless a game runs.
    pub fn on_quit(&self, phase: GameflowPhase) -> Option<Step> {
        match self.stage {
            Stage::Ready(_) if !in_game(phase) => Some(Step::Install { restart: false }),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use GameflowPhase as P;

    use super::*;

    #[test]
    fn only_an_https_backend_serves_updates() {
        assert!(serves_updates("https://api.mvp.gg"));
        assert!(!serves_updates("http://127.0.0.1:8787"));
        assert!(!serves_updates(""));
        assert!(GITHUB_LATEST.starts_with("https://github.com/"));
        assert!(GITHUB_LATEST.ends_with("/releases/latest/download/latest.json"));
    }

    fn offer() -> Offer {
        Offer {
            version: "0.2.0".into(),
            notes: Some("Faster draft helper".into()),
            mandatory: false,
        }
    }

    /// A plan whose first check ran and found `offer()` while in `phase`.
    fn found_in(phase: GameflowPhase, now: Instant) -> (UpdatePlan, Option<Step>) {
        let mut plan = UpdatePlan::new(now);
        assert_eq!(plan.tick(now + FIRST_CHECK_AFTER), Some(Step::Check));
        let step = plan.checked(Ok(Some(offer())), phase, now + FIRST_CHECK_AFTER);
        (plan, step)
    }

    #[test]
    fn asks_our_backend_on_the_stable_channel() {
        assert_eq!(
            endpoint("https://api.example.com/"),
            "https://api.example.com/v1/updates/{{target}}/{{arch}}/{{current_version}}?channel=stable"
        );
    }

    #[test]
    fn checks_after_start_then_every_six_hours() {
        let start = Instant::now();
        let mut plan = UpdatePlan::new(start);
        assert_eq!(plan.status(), UpdateStatus::Idle);
        assert_eq!(plan.tick(start), None, "not right at start");
        let first = start + FIRST_CHECK_AFTER;
        assert_eq!(plan.next_check(), Some(first));
        assert_eq!(plan.tick(first), Some(Step::Check));
        assert_eq!(plan.status(), UpdateStatus::Checking);
        assert_eq!(plan.next_check(), None, "no second check while one runs");
        assert_eq!(plan.check_now(), None);
        assert_eq!(plan.checked(Ok(None), P::Idle, first), None);
        assert_eq!(plan.status(), UpdateStatus::UpToDate);
        assert_eq!(plan.next_check(), Some(first + CHECK_EVERY));
        assert_eq!(plan.tick(first + CHECK_EVERY), Some(Step::Check));
    }

    #[test]
    fn downloads_at_once_when_no_game_runs() {
        let now = Instant::now();
        for phase in [P::Idle, P::Lobby, P::Matchmaking, P::PostGame] {
            let (plan, step) = found_in(phase, now);
            assert_eq!(step, Some(Step::Download), "{phase:?}");
            assert!(matches!(plan.status(), UpdateStatus::Downloading { .. }));
        }
    }

    #[test]
    fn an_update_found_in_game_waits_for_the_end_of_it() {
        let now = Instant::now();
        for phase in [P::ReadyCheck, P::ChampSelect, P::Loading, P::InGame] {
            let (mut plan, step) = found_in(phase, now);
            assert_eq!(step, None, "{phase:?}: no download during a game");
            assert!(matches!(plan.status(), UpdateStatus::Available { .. }));
            assert_eq!(plan.next_check(), None, "no more checks: one is waiting");
            assert_eq!(plan.phase(P::InGame), None);
            assert_eq!(plan.phase(P::PostGame), Some(Step::Download));
        }
    }

    #[test]
    fn a_game_starting_stops_the_download_until_it_ends() {
        let now = Instant::now();
        let (mut plan, _) = found_in(P::Lobby, now);
        assert!(plan.progress(Some(40)));
        assert!(!plan.progress(Some(40)), "same percentage: nothing to show");
        assert_eq!(plan.phase(P::ReadyCheck), Some(Step::StopDownload));
        assert!(matches!(plan.status(), UpdateStatus::Available { .. }));
        assert_eq!(plan.phase(P::ChampSelect), None);
        assert_eq!(plan.phase(P::Lobby), Some(Step::Download), "a dodge");
        assert_eq!(
            plan.status(),
            UpdateStatus::Downloading {
                version: "0.2.0".into(),
                percent: None
            }
        );
    }

    #[test]
    fn restarts_only_when_asked_and_never_in_game() {
        let now = Instant::now();
        let (mut plan, _) = found_in(P::Idle, now);
        assert_eq!(plan.install(P::Idle), Err(Refusal::NothingReady));
        plan.downloaded(Ok(()), now);
        assert_eq!(
            plan.status(),
            UpdateStatus::Ready {
                version: "0.2.0".into(),
                notes: Some("Faster draft helper".into()),
                mandatory: false
            }
        );
        assert_eq!(plan.next_check(), None, "ready: nothing more to check");
        for phase in [P::ReadyCheck, P::ChampSelect, P::Loading, P::InGame] {
            assert_eq!(plan.install(phase), Err(Refusal::InGame), "{phase:?}");
            assert_eq!(plan.on_quit(phase), None, "quitting mid-game: not now");
        }
        assert_eq!(plan.install(P::Lobby), Ok(Step::Install { restart: true }));
        assert_eq!(
            plan.on_quit(P::Idle),
            Some(Step::Install { restart: false }),
            "quitting: installs without reopening"
        );
    }

    #[test]
    fn failures_are_retried_later() {
        let now = Instant::now();
        let mut plan = UpdatePlan::new(now);
        plan.check_now();
        plan.checked(Err("offline".into()), P::Idle, now);
        assert_eq!(
            plan.status(),
            UpdateStatus::Failed {
                message: "offline".into()
            }
        );
        assert_eq!(plan.next_check(), Some(now + RETRY_AFTER_FAILURE));
        assert_eq!(plan.check_now(), Some(Step::Check), "the player may retry");

        let (mut plan, _) = found_in(P::Idle, now);
        plan.downloaded(Err("bad signature".into()), now);
        assert!(matches!(plan.status(), UpdateStatus::Failed { .. }));
        assert_eq!(plan.on_quit(P::Idle), None, "nothing to install");
        assert_eq!(plan.next_check(), Some(now + RETRY_AFTER_FAILURE));
    }

    #[test]
    fn a_build_without_updates_never_checks() {
        let mut plan = UpdatePlan::unavailable("development build");
        assert_eq!(plan.next_check(), None);
        assert_eq!(plan.check_now(), None);
        assert_eq!(plan.tick(Instant::now() + CHECK_EVERY), None);
        assert_eq!(plan.install(P::Idle), Err(Refusal::NothingReady));
        assert_eq!(
            plan.status(),
            UpdateStatus::Unavailable {
                reason: "development build".into()
            }
        );
    }

    #[test]
    fn late_answers_are_ignored() {
        let now = Instant::now();
        let mut plan = UpdatePlan::new(now);
        assert_eq!(plan.checked(Ok(Some(offer())), P::Idle, now), None);
        assert_eq!(plan.status(), UpdateStatus::Idle);
        plan.downloaded(Ok(()), now);
        assert_eq!(plan.status(), UpdateStatus::Idle);
    }
}
