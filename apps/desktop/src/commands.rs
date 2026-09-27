//! Commands the UI can invoke. Names and payloads mirror `ui/src/data/transport.ts`.

use domain::{AppInfo, ClientStatus, PlayerProfile};
use tauri::Manager as _;

use crate::core::Core;

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

#[tauri::command]
pub fn current_profile() -> Option<PlayerProfile> {
    None
}
