//! Desktop shell. Keeps the Rust core running (tray) and hosts the UI window.

mod commands;
mod tray;

use tauri::Manager as _;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,scout_desktop=debug".into()),
        )
        .init();

    tauri::Builder::default()
        // A second launch focuses the existing window instead of starting another app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        .setup(|app| {
            tray::install(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                tracing::debug!(label = window.label(), "main window created");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::client_status,
            commands::current_profile
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the Tauri application");
}
