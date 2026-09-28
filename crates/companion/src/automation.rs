//! Client automations: accepting the ready check (opt-in) and following the game with the window.
//! Build imports on lock-in live in `imports`.
//!
//! Policy (docs/policy.md): automation is opt-in or clearly user-visible. Auto-accept is off by
//! default and waits a visible delay; it never overrides an answer the player already gave.

use std::time::Duration;

use domain::{AutoAcceptEvent, GameflowPhase, ImportResult, RemoteConfig, Settings, ViewRoute};
use lcu::{LcuClient, LcuError};
use serde::Deserialize;
use tokio::sync::{mpsc, watch};

/// The current ready check (404 when there is none).
pub const READY_CHECK: &str = "/lol-matchmaking/v1/ready-check";
/// Accepts the current ready check.
pub const READY_CHECK_ACCEPT: &str = "/lol-matchmaking/v1/ready-check/accept";

/// What the shell should do with the window after a phase change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowIntent {
    /// Show, unminimize and focus the window.
    pub focus: bool,
    /// Send the UI to this view.
    pub navigate: Option<ViewRoute>,
}

/// Something the core did or wants the shell to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreEvent {
    Window(WindowIntent),
    AutoAccept(AutoAcceptEvent),
    /// An automatic import on lock-in finished (a toast in the UI).
    Import(ImportResult),
}

/// Decides where the window goes as the game moves on, without fighting the user: it switches
/// views only when a phase starts, and takes the player back Home after the game only if they
/// stayed on the view it opened for them.
#[derive(Debug, Default)]
pub struct Autopilot {
    phase: Option<GameflowPhase>,
    /// The view the autopilot last sent the UI to, while that game step lasts.
    auto_route: Option<ViewRoute>,
    /// The user went elsewhere since.
    manual: bool,
}

impl Autopilot {
    /// A new gameflow phase; `None` when nothing should happen.
    pub fn on_phase(&mut self, phase: GameflowPhase, settings: &Settings) -> Option<WindowIntent> {
        if self.phase == Some(phase) {
            return None;
        }
        self.phase = Some(phase);
        let focus = phase == GameflowPhase::ChampSelect && settings.bring_to_front_on_champ_select;
        let navigate = if settings.auto_switch_view {
            self.route_for(phase)
        } else {
            None
        };
        (focus || navigate.is_some()).then_some(WindowIntent { focus, navigate })
    }

    /// The UI shows `path` (every navigation, the autopilot's own included).
    pub fn on_view(&mut self, path: &str) {
        if self.auto_route.is_some_and(|route| route.path() != path) {
            self.manual = true;
        }
    }

    fn route_for(&mut self, phase: GameflowPhase) -> Option<ViewRoute> {
        let target = match phase {
            GameflowPhase::ChampSelect => ViewRoute::Draft,
            GameflowPhase::Loading | GameflowPhase::InGame => ViewRoute::Live,
            GameflowPhase::Idle
            | GameflowPhase::Lobby
            | GameflowPhase::Matchmaking
            | GameflowPhase::PostGame => ViewRoute::Home,
            GameflowPhase::ReadyCheck => return None,
        };
        if target == ViewRoute::Home {
            let ours = self.auto_route.is_some() && !self.manual;
            self.auto_route = None;
            self.manual = false;
            return ours.then_some(ViewRoute::Home);
        }
        // Loading → in game: same view, and a manual switch during loading stands.
        if self.auto_route == Some(target) {
            return None;
        }
        self.auto_route = Some(target);
        self.manual = false;
        Some(target)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyCheck {
    state: String,
    player_response: String,
}

/// Accepts the current ready check unless the player already answered it.
/// `Ok(false)`: nothing to accept (answered, over, or no ready check).
pub async fn accept_ready_check(client: &LcuClient) -> Result<bool, LcuError> {
    let check = match client.get::<ReadyCheck>(READY_CHECK).await {
        Ok(check) => check,
        Err(error) if error.is_not_found() => return Ok(false),
        Err(error) => return Err(error),
    };
    if check.state != "InProgress" || check.player_response != "None" {
        tracing::debug!(
            state = check.state,
            response = check.player_response,
            "ready check already answered"
        );
        return Ok(false);
    }
    client.post(READY_CHECK_ACCEPT, None).await?;
    Ok(true)
}

/// Waits the delay the player chose, then accepts (if still enabled, and not killed by the
/// remote config). Aborted by the core when the phase leaves the ready check.
pub(crate) async fn accept_after_delay(
    client: watch::Receiver<Option<LcuClient>>,
    settings: watch::Receiver<Settings>,
    remote: watch::Receiver<RemoteConfig>,
    events: mpsc::Sender<CoreEvent>,
) {
    let delay = settings.borrow().auto_accept_delay_seconds;
    tokio::time::sleep(Duration::from_secs(delay.into())).await;
    if !settings.borrow().auto_accept || !crate::remote::auto_accept_allowed(&remote.borrow()) {
        return;
    }
    let Some(lcu) = client.borrow().clone() else {
        return;
    };
    let event = match accept_ready_check(&lcu).await {
        Ok(true) => {
            tracing::info!("ready check accepted");
            AutoAcceptEvent::Accepted
        }
        Ok(false) => return,
        Err(error) => {
            tracing::warn!(%error, "auto-accept failed");
            AutoAcceptEvent::Failed {
                message: error.to_string(),
            }
        }
    };
    let _ = events.try_send(CoreEvent::AutoAccept(event));
}

#[cfg(test)]
mod tests {
    use super::*;
    use GameflowPhase as P;

    fn run(autopilot: &mut Autopilot, phases: &[GameflowPhase]) -> Vec<Option<WindowIntent>> {
        phases
            .iter()
            .map(|p| autopilot.on_phase(*p, &Settings::default()))
            .collect()
    }

    #[allow(clippy::unnecessary_wraps, reason = "compared with on_phase's results")]
    const fn go(route: ViewRoute) -> Option<WindowIntent> {
        Some(WindowIntent {
            focus: false,
            navigate: Some(route),
        })
    }

    #[test]
    fn follows_a_whole_game() {
        let mut autopilot = Autopilot::default();
        let intents = run(
            &mut autopilot,
            &[
                P::Idle,
                P::Lobby,
                P::Matchmaking,
                P::ReadyCheck,
                P::ChampSelect,
                P::Loading,
                P::InGame,
                P::PostGame,
                P::Lobby,
            ],
        );
        assert_eq!(
            intents,
            vec![
                None,
                None,
                None,
                None,
                Some(WindowIntent {
                    focus: true,
                    navigate: Some(ViewRoute::Draft)
                }),
                go(ViewRoute::Live),
                None,
                go(ViewRoute::Home),
                None,
            ]
        );
    }

    #[test]
    fn a_dodge_goes_back_home() {
        let mut autopilot = Autopilot::default();
        let intents = run(&mut autopilot, &[P::Lobby, P::ChampSelect, P::Lobby]);
        assert_eq!(intents[2], go(ViewRoute::Home));
    }

    #[test]
    fn never_fights_the_user() {
        let mut autopilot = Autopilot::default();
        run(&mut autopilot, &[P::Lobby, P::ChampSelect]);
        autopilot.on_view("/draft");
        assert_eq!(
            run(&mut autopilot, &[P::Loading]),
            vec![go(ViewRoute::Live)]
        );
        autopilot.on_view("/live");
        // The player opens a build page while loading: in game and after it, they stay there.
        autopilot.on_view("/champions");
        assert_eq!(
            run(&mut autopilot, &[P::InGame, P::PostGame]),
            vec![None, None]
        );
        // The next game starts fresh.
        assert_eq!(run(&mut autopilot, &[P::Lobby]), vec![None]);
        assert_eq!(
            autopilot.on_phase(P::ChampSelect, &Settings::default()),
            Some(WindowIntent {
                focus: true,
                navigate: Some(ViewRoute::Draft)
            })
        );
    }

    #[test]
    fn nothing_when_disabled() {
        let settings = Settings {
            auto_switch_view: false,
            bring_to_front_on_champ_select: false,
            ..Settings::default()
        };
        let mut autopilot = Autopilot::default();
        for phase in [P::Lobby, P::ChampSelect, P::InGame, P::PostGame] {
            assert_eq!(autopilot.on_phase(phase, &settings), None);
        }
    }

    #[test]
    fn focus_without_switching_views() {
        let settings = Settings {
            auto_switch_view: false,
            ..Settings::default()
        };
        let mut autopilot = Autopilot::default();
        assert_eq!(
            autopilot.on_phase(P::ChampSelect, &settings),
            Some(WindowIntent {
                focus: true,
                navigate: None
            })
        );
    }

    #[test]
    fn app_started_mid_game_opens_live() {
        let mut autopilot = Autopilot::default();
        assert_eq!(run(&mut autopilot, &[P::InGame]), vec![go(ViewRoute::Live)]);
    }
}
