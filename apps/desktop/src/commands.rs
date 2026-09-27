//! Commands the UI can invoke. Names and payloads mirror `ui/src/data/transport.ts`.

use companion::settings::SettingsStore;
use domain::{AppInfo, ClientStatus, DraftView, GameData, PlayerProfile, Settings};
use tauri::{Emitter as _, Manager as _};
use tauri_plugin_autostart::ManagerExt as _;

use crate::core::{Core, GameDataState};

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    let pkg = app.package_info();
    AppInfo {
        name: pkg.name.clone(),
        version: pkg.version.to_string(),
        platform: std::env::consts::OS.to_owned(),
    }
}

#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn client_status(app: tauri::AppHandle) -> ClientStatus {
    app.try_state::<Core>()
        .map_or_else(ClientStatus::not_running, |core| {
            core.status.borrow().clone()
        })
}

/// The logged-in player's own profile from the League client; `None` while it isn't running.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn current_profile(app: tauri::AppHandle) -> Result<Option<PlayerProfile>, String> {
    let client = app
        .try_state::<Core>()
        .and_then(|core| core.client.borrow().clone());
    let Some(client) = client else {
        return Ok(None);
    };
    companion::profile::local_profile(&client)
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

/// Current champion select, `None` outside of it (`draft` events follow changes).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn draft_state(app: tauri::AppHandle) -> Option<DraftView> {
    app.try_state::<Core>()
        .and_then(|core| core.draft.borrow().clone())
}

/// Game data of the current patch; `None` until loaded (a `game-data` event follows).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn game_data(app: tauri::AppHandle) -> Option<GameData> {
    app.try_state::<GameDataState>()
        .and_then(|state| state.0.read().ok().and_then(|data| data.clone()))
}

/// The player's settings.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn get_settings(store: tauri::State<'_, SettingsStore>) -> Settings {
    store.get()
}

/// Saves new settings and applies them; answers what was saved (a `settings` event follows).
/// On failure nothing changes and the error says why.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn update_settings(
    app: tauri::AppHandle,
    store: tauri::State<'_, SettingsStore>,
    settings: Settings,
) -> Result<Settings, String> {
    let before = store.get();
    if settings.launch_at_startup != before.launch_at_startup {
        let autolaunch = app.autolaunch();
        let result = if settings.launch_at_startup {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        result.map_err(|error| format!("couldn't change the Windows startup entry: {error}"))?;
    }
    let saved = store.update(settings).map_err(|error| error.to_string())?;
    if let Err(error) = app.emit("settings", &saved) {
        tracing::warn!(%error, "cannot emit settings");
    }
    Ok(saved)
}

/// The UI shows `path`: automatic view switches never fight a user who went elsewhere.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn view_changed(app: tauri::AppHandle, path: String) {
    if let Some(core) = app.try_state::<Core>() {
        core.views.report(&path);
    }
}
