//! Desktop shell. Keeps the Rust core running (tray) and hosts the UI window.

mod commands;
mod core;
mod tray;
mod window;

use companion::settings::SettingsStore;
use tauri::{Manager as _, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

/// Passed by the startup entry: start in the tray, without a window.
const AUTOSTART_ARG: &str = "--autostart";

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,scout_desktop=debug".into()),
        )
        .init();

    let app = tauri::Builder::default()
        // A second launch focuses the existing window instead of starting another app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::open(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .setup(|app| {
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
            commands::game_data,
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
            commands::import_build
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the Tauri application");

    app.run(|app, event| {
        // The window was closed (not "Quit"): stay in the tray if the player wants that.
        if let RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            let to_tray = app
                .try_state::<SettingsStore>()
                .is_some_and(|settings| settings.get().close_to_tray);
            if to_tray {
                api.prevent_exit();
            }
        }
    });
}
