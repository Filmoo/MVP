//! Runs the app core next to the window and bridges it to the UI.

use std::sync::{Arc, RwLock};

use companion::automation::CoreEvent;
use companion::backend::{BackendClient, BackendConfig};
use companion::imports::{BuildSource, ChampionNames, Importer, NoBuilds};
use companion::settings::SettingsStore;
use companion::stats::StatsClient;
use companion::{ScoutingHandle, Services, ViewReporter};
use domain::{ClientStatus, DraftView, GameData, LiveGame, StatsIndex};
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime};
use tokio::sync::watch;

/// Shared with commands.
#[derive(Debug)]
pub struct Core {
    pub status: watch::Receiver<ClientStatus>,
    pub draft: watch::Receiver<Option<DraftView>>,
    pub live: watch::Receiver<Option<LiveGame>>,
    pub scouting: ScoutingHandle,
    pub client: watch::Receiver<Option<lcu::LcuClient>>,
    pub views: ViewReporter,
    pub imports: Importer,
}

/// Game data of the current patch, once loaded.
#[derive(Debug, Default)]
pub struct GameDataState(pub RwLock<Option<GameData>>);

/// Our backend (player lookups, scouting), `None` when the client couldn't be built.
#[derive(Debug)]
pub struct Backend(pub Option<BackendClient>);

/// Published champion stats (disk-cached), `None` without a backend or a cache directory.
#[derive(Debug)]
pub struct Stats(pub Option<StatsClient>);

/// The stats client: our backend, cached under `{app cache}/stats`.
fn stats_client<R: Runtime>(
    app: &AppHandle<R>,
    backend: Option<&BackendClient>,
) -> Option<StatsClient> {
    let backend = backend?.clone();
    match app.path().app_cache_dir() {
        Ok(dir) => Some(StatsClient::new(backend, dir.join("stats"))),
        Err(error) => {
            tracing::error!(%error, "no cache directory for stats");
            None
        }
    }
}

/// Builds the backend client: base URL from the build (see `companion::backend`), install id
/// from the config directory, next to the settings.
fn backend<R: Runtime>(app: &AppHandle<R>) -> Option<BackendClient> {
    let dir = match app.path().app_config_dir() {
        Ok(dir) => dir,
        Err(error) => {
            tracing::error!(%error, "no config directory for the install id");
            return None;
        }
    };
    let config = BackendConfig::new(
        companion::backend::base_url(),
        companion::backend::install_id(&dir),
    );
    match BackendClient::new(&config) {
        Ok(client) => {
            tracing::info!(url = client.base_url(), "backend");
            Some(client)
        }
        Err(error) => {
            tracing::error!(%error, "cannot build the backend client");
            None
        }
    }
}

/// Champion names of the loaded game data (Data Dragon), for MVP's rune page and item set names.
fn champion_names<R: Runtime>(app: &AppHandle<R>) -> ChampionNames {
    let app = app.clone();
    Arc::new(move |id| {
        let state = app.try_state::<GameDataState>()?;
        let data = state.0.read().ok()?;
        data.as_ref()?
            .champions
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.name.clone())
    })
}

/// Starts following the League client and pushes every status change to the UI.
pub fn start<R: Runtime>(app: &AppHandle<R>, settings: &SettingsStore) {
    app.manage(GameDataState::default());
    load_game_data(app);
    let backend = backend(app);
    app.manage(Backend(backend.clone()));
    let published = stats_client(app, backend.as_ref());
    app.manage(Stats(published.clone()));
    if let Some(stats) = &published {
        follow_stats(app, stats);
    }

    let config = match lcu::ConnectorConfig::for_league_client(Vec::new()) {
        Ok(config) => config,
        Err(error) => {
            tracing::error!(%error, "cannot build the League client TLS config");
            return;
        }
    };
    let settings = settings.subscribe();
    let names = champion_names(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // The published stats feed both the draft helper and the build imports.
        let builds: Arc<dyn BuildSource> = match &published {
            Some(stats) => Arc::new(stats.clone()),
            None => Arc::new(NoBuilds),
        };
        let services = Services {
            backend,
            stats: published,
            builds,
            names,
        };
        let companion = companion::start_with_services(config, settings, services);
        app.manage(Core {
            status: companion.status.clone(),
            draft: companion.draft.clone(),
            live: companion.live.clone(),
            scouting: companion.scouting.clone(),
            client: companion.client.clone(),
            views: companion.views.clone(),
            imports: companion.imports.clone(),
        });
        forward(&app, companion.draft.clone(), "draft");
        forward(&app, companion.live.clone(), "live");
        let events_app = app.clone();
        let mut events = companion.events;
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                handle(&events_app, event);
            }
        });
        let mut status = companion.status.clone();
        while status.changed().await.is_ok() {
            let current = status.borrow_and_update().clone();
            tracing::debug!(?current, "client status");
            if let Err(error) = app.emit("client-status", current) {
                tracing::warn!(%error, "cannot emit client status");
            }
        }
    });
}

/// Carries out what the core asks for: window moves and automation notices for the UI.
fn handle<R: Runtime>(app: &AppHandle<R>, event: CoreEvent) {
    match event {
        CoreEvent::Window(intent) => crate::window::apply(app, intent),
        CoreEvent::AutoAccept(outcome) => {
            if let Err(error) = app.emit("auto-accept", outcome) {
                tracing::warn!(%error, "cannot emit auto-accept");
            }
        }
        CoreEvent::Import(result) => {
            if let Err(error) = app.emit("import", result) {
                tracing::warn!(%error, "cannot emit import");
            }
        }
    }
}

/// Revalidates the stats index once at startup, then tells the UI whenever a different one
/// arrives (`stats-index`: the stats views fetch again). Nothing else runs until asked.
fn follow_stats<R: Runtime>(app: &AppHandle<R>, stats: &StatsClient) {
    let mut index: watch::Receiver<Option<Arc<StatsIndex>>> = stats.subscribe();
    let startup = stats.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = startup.refresh_index().await {
            tracing::info!(%error, "stats index unavailable");
        }
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while index.changed().await.is_ok() {
            let Some(current) = index.borrow_and_update().clone() else {
                continue;
            };
            if let Err(error) = app.emit("stats-index", &*current) {
                tracing::warn!(%error, "cannot emit the stats index");
            }
        }
    });
}

/// Pushes every change of `rx` to the UI as `event`.
fn forward<R: Runtime, T: Clone + serde::Serialize + Send + Sync + 'static>(
    app: &AppHandle<R>,
    mut rx: watch::Receiver<T>,
    event: &'static str,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while rx.changed().await.is_ok() {
            let current = rx.borrow_and_update().clone();
            if let Err(error) = app.emit(event, current) {
                tracing::warn!(%error, event, "cannot emit");
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
