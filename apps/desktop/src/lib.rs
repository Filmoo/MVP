//! Desktop shell. Keeps the Rust core running (tray) and hosts the UI window.

mod commands;
mod core;
mod diagnostics;
mod logging;
mod tray;
mod updater;
mod window;

use companion::settings::SettingsStore;
use tauri::{Manager as _, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

/// Passed by the startup entry: start in the tray, without a window.
const AUTOSTART_ARG: &str = "--autostart";

pub fn run() {
    let app = tauri::Builder::default()
        // A second launch focuses the existing window instead of starting another app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::open(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        // Driven from the core (`updater.rs`); the webview has no updater permission.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // First: a release build has no console, the log file is all there is.
            let log = logging::init(app.path().app_log_dir().ok().as_deref());
            app.manage(core::LogFile(log));
            let settings = SettingsStore::load(
                app.path()
                    .app_config_dir()?
                    .join(companion::settings::FILE_NAME),
            );
            tracing::debug!(path = %settings.path().display(), "settings loaded");
            core::start(app.handle(), &settings);
            app.manage(settings);
            app.manage(window::PendingRoute::default());
            tray::install(app.handle())?;
            if !std::env::args().any(|arg| arg == AUTOSTART_ARG) {
                window::open(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::client_status,
            commands::current_profile,
            commands::match_grades,
            commands::match_details,
            commands::game_data,
            commands::rank_emblems,
            commands::draft_state,
            commands::get_settings,
            commands::update_settings,
            commands::view_changed,
            commands::search_player,
            commands::live_game,
            commands::retry_scouting,
            commands::stats_index,
            commands::tier_list,
            commands::champion_stats,
            commands::import_build,
            commands::remote_config,
            commands::open_banner_link,
            commands::update_status,
            commands::check_for_updates,
            commands::install_update,
            commands::report_error,
            commands::diagnostics,
            commands::open_logs
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the Tauri application");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { code, api, .. } = event {
            // The window was closed (not "Quit"): stay in the tray if the player wants that.
            let to_tray = code.is_none()
                && app
                    .try_state::<SettingsStore>()
                    .is_some_and(|settings| settings.get().close_to_tray);
            if to_tray {
                api.prevent_exit();
            } else {
                // Quitting for real: a downloaded update installs now (never during a game).
                updater::install_on_quit(app);
            }
        }
    });
}
