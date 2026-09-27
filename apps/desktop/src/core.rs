//! Runs the app core next to the window and bridges it to the UI.

use domain::ClientStatus;
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime};
use tokio::sync::watch;

/// Shared with commands.
#[derive(Debug)]
pub struct Core {
    pub status: watch::Receiver<ClientStatus>,
}

/// Starts following the League client and pushes every status change to the UI.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
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
