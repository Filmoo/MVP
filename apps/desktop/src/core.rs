//! Runs the app core next to the window and bridges it to the UI.

use std::sync::RwLock;

use domain::{ClientStatus, GameData};
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime};
use tokio::sync::watch;

/// Shared with commands.
#[derive(Debug)]
pub struct Core {
    pub status: watch::Receiver<ClientStatus>,
}

/// Game data of the current patch, once loaded.
#[derive(Debug, Default)]
pub struct GameDataState(pub RwLock<Option<GameData>>);

/// Starts following the League client and pushes every status change to the UI.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    app.manage(GameDataState::default());
    load_game_data(app);

    let config = match lcu::ConnectorConfig::for_league_client(Vec::new()) {
        Ok(config) => config,
        Err(error) => {
            tracing::error!(%error, "cannot build the League client TLS config");
            return;
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let companion = companion::start(config);
        let mut status = companion.status.clone();
        app.manage(Core {
            status: companion.status.clone(),
        });
        while status.changed().await.is_ok() {
            let current = status.borrow_and_update().clone();
            tracing::debug!(?current, "client status");
            if let Err(error) = app.emit("client-status", current) {
                tracing::warn!(%error, "cannot emit client status");
            }
        }
    });
}

/// Loads champion/item/spell data (cached per patch) and hands it to the UI.
fn load_game_data<R: Runtime>(app: &AppHandle<R>) {
    let cache = match app.path().app_cache_dir() {
        Ok(dir) => dir.join("ddragon"),
        Err(error) => {
            tracing::error!(%error, "no cache directory for game data");
            return;
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = match static_data::DataDragon::new(static_data::DDRAGON, cache, "en_US") {
            Ok(dd) => dd.load().await,
            Err(error) => Err(error),
        };
        match result {
            Ok(data) => {
                tracing::info!(
                    version = data.version,
                    champions = data.champions.len(),
                    "game data ready"
                );
                if let Some(state) = app.try_state::<GameDataState>()
                    && let Ok(mut slot) = state.0.write()
                {
                    *slot = Some(data.clone());
                }
                if let Err(error) = app.emit("game-data", data) {
                    tracing::warn!(%error, "cannot emit game data");
                }
            }
            Err(error) => tracing::warn!(%error, "game data unavailable"),
        }
    });
}
