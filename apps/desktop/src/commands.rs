//! Commands the UI can invoke. Names and payloads mirror `ui/src/data/transport.ts`.

use domain::{AppInfo, ClientStatus, PlayerProfile};

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
pub fn client_status() -> ClientStatus {
    // Wired to the LCU connector once it lands; until then the client is never found.
    ClientStatus::not_running()
}

#[tauri::command]
pub fn current_profile() -> Option<PlayerProfile> {
    None
}
