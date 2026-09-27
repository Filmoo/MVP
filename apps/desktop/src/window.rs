//! The main window. Closing it frees the webview (the core keeps running in the tray), so it is
//! created on demand: at launch, from the tray, or when champion select wants it in front.

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use companion::automation::WindowIntent;
use domain::ViewRoute;
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const MAIN: &str = "main";

/// Where the UI should open next, when the core switched views while the window was closed.
#[derive(Debug, Default)]
pub struct PendingRoute(Mutex<Option<ViewRoute>>);

impl PendingRoute {
    fn set(&self, route: ViewRoute) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(route);
    }

    fn take(&self) -> Option<ViewRoute> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).take()
    }
}

/// Shows, unminimizes and focuses the main window, creating it if it was closed.
pub fn open<R: Runtime>(app: &AppHandle<R>) {
    let pending = app.try_state::<PendingRoute>().and_then(|p| p.take());
    open_at(app, pending);
}

fn open_at<R: Runtime>(app: &AppHandle<R>, route: Option<ViewRoute>) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(route) = route {
            navigate(app, route);
        }
        return;
    }
    if let Err(error) = create(app, route) {
        tracing::error!(%error, "cannot open the main window");
    }
}

/// Builds the main window from `tauri.conf.json`, opening the UI on `route`.
fn create<R: Runtime>(app: &AppHandle<R>, route: Option<ViewRoute>) -> tauri::Result<()> {
    let Some(mut config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN)
        .cloned()
    else {
        tracing::error!("no main window in tauri.conf.json");
        return Ok(());
    };
    if let Some(route) = route {
        // Hash router: the UI starts on this view.
        config.url = WebviewUrl::App(PathBuf::from(format!("index.html#{}", route.path())));
    }
    let window = WebviewWindowBuilder::from_config(app, &config)?.build()?;
    let _ = window.set_focus();
    Ok(())
}

fn navigate<R: Runtime>(app: &AppHandle<R>, route: ViewRoute) {
    if let Err(error) = app.emit_to(MAIN, "navigate", route) {
        tracing::warn!(%error, "cannot send navigation to the UI");
    }
}

/// Applies what the core asked for after a gameflow phase change.
pub fn apply<R: Runtime>(app: &AppHandle<R>, intent: WindowIntent) {
    let open = app.get_webview_window(MAIN).is_some();
    tracing::debug!(?intent, open, "window intent");
    match (intent.focus, intent.navigate, open) {
        (true, route, _) => open_at(app, route),
        (false, Some(route), true) => navigate(app, route),
        // Closed to the tray: no window pops up uninvited; the UI opens there next time.
        (false, Some(route), false) => {
            if let Some(pending) = app.try_state::<PendingRoute>() {
                pending.set(route);
            }
        }
        (false, None, _) => {}
    }
}
