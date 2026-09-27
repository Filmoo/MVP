//! Commands the UI can invoke. Names and payloads mirror `ui/src/data/transport.ts`.

use domain::{AppInfo, ClientStatus, DraftView, GameData, PlayerProfile};
use tauri::Manager as _;

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
