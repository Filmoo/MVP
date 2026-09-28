//! Runs the app core next to the window and bridges it to the UI.

use std::path::Path;
use std::sync::{Arc, RwLock};

use companion::automation::CoreEvent;
use companion::backend::{BackendClient, BackendConfig};
use companion::crash::{self, CrashReporter};
use companion::imports::{BuildSource, ChampionNames, Importer, NoBuilds};
use companion::remote::{self, RemoteConfigStore};
use companion::settings::SettingsStore;
use companion::stats::StatsClient;
use companion::{ScoutingHandle, Services, ViewReporter};
use domain::{
    ClientStatus, DraftView, GameData, Language, LiveGame, RankEmblem, RankEmblems, StatsIndex,
};
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
    pub matches: companion::matches::MatchInsights,
}

/// Game data of the current patch in the UI's language (Data Dragon locale), once loaded.
#[derive(Debug)]
pub struct GameDataState {
    /// The data loaded for the locale asked for last (English names when that locale can't be
    /// had, e.g. offline before its first download).
    loaded: RwLock<Option<(&'static str, GameData)>>,
    /// The locale the UI asked for last: the loader follows it.
    wanted: watch::Sender<&'static str>,
}

impl GameDataState {
    fn new(locale: &'static str) -> Self {
        Self {
            loaded: RwLock::new(None),
            wanted: watch::Sender::new(locale),
        }
    }

    /// Asks for game data in `locale` (`fr_FR`…): a new one loads, then `game-data` follows.
    pub fn want(&self, locale: &'static str) {
        self.wanted.send_if_modified(|current| {
            let changed = *current != locale;
            *current = locale;
            changed
        });
    }

    /// The data loaded for `locale`, if it is.
    pub fn get(&self, locale: &str) -> Option<GameData> {
        let loaded = self.loaded.read().ok()?;
        loaded
            .as_ref()
            .filter(|(asked, _)| *asked == locale)
            .map(|(_, data)| data.clone())
    }

    /// The Data Dragon version and locale loaded, if any (for diagnostics).
    pub fn loaded(&self) -> Option<(String, &'static str)> {
        self.loaded
            .read()
            .ok()?
            .as_ref()
            .map(|(locale, data)| (data.version.clone(), *locale))
    }

    /// Whatever is loaded, in any language (champion names for MVP's page and set names).
    fn any(&self) -> Option<GameData> {
        self.loaded
            .read()
            .ok()?
            .as_ref()
            .map(|(_, data)| data.clone())
    }
}

/// The UI's language with `auto` resolved (the UI knows the system's): the core's own words
/// follow it (the tray menu, MVP's item set blocks in the League client). English until the UI
/// says, unless French was chosen.
#[derive(Debug)]
pub struct UiLanguage(watch::Sender<Language>);

impl UiLanguage {
    fn new(chosen: Language) -> Self {
        Self(watch::Sender::new(Self::resolved(chosen)))
    }

    const fn resolved(language: Language) -> Language {
        match language {
            Language::Fr => Language::Fr,
            Language::Auto | Language::En => Language::En,
        }
    }

    /// The UI shows `language` (resolved: English or French).
    pub fn set(&self, language: Language) {
        let resolved = Self::resolved(language);
        self.0.send_if_modified(|current| {
            let changed = *current != resolved;
            *current = resolved;
            changed
        });
    }

    pub fn subscribe(&self) -> watch::Receiver<Language> {
        self.0.subscribe()
    }
}

/// This run's log file (`None` when it couldn't be written): see `logging`.
#[derive(Debug)]
pub struct LogFile(pub Option<std::path::PathBuf>);

/// Riot's ranked emblems, once downloaded (or read from the cache).
#[derive(Debug, Default)]
pub struct EmblemState(pub RwLock<Option<RankEmblems>>);

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

/// The server's remote config (feature flags, kill switches, banners, minimum version).
#[derive(Debug)]
pub struct Remote(pub Arc<RemoteConfigStore>);

/// Opt-in crash reports.
#[derive(Debug)]
pub struct Crashes(pub Arc<CrashReporter>);

/// This installation's random id (`X-MVP-Install`), shown in Settings for deletion requests.
#[derive(Debug)]
pub struct InstallId(pub String);

/// Builds the backend client: base URL from the build (see `companion::backend`).
fn backend(install_id: &str) -> Option<BackendClient> {
    let config = BackendConfig::new(companion::backend::base_url(), install_id);
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
        state
            .any()?
            .champions
            .into_iter()
            .find(|c| c.id == id)
            .map(|c| c.name)
    })
}

/// `windows x86_64, webview 131.0.2903.70`: the OS and the webview, for crash reports.
pub fn os_version() -> String {
    let os = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);
    match tauri::webview_version() {
        Ok(webview) => format!("{os}, webview {webview}"),
        Err(_) => os,
    }
}

/// The remote config (from its last answer on disk, then the server's) and the crash reports,
/// both kept next to the settings.
fn platform_services<R: Runtime>(
    app: &AppHandle<R>,
    dir: &Path,
    install_id: &str,
    backend: Option<&BackendClient>,
    settings: &SettingsStore,
) -> Arc<RemoteConfigStore> {
    let version = app.package_info().version.to_string();
    let remote = Arc::new(RemoteConfigStore::load(
        dir.join(remote::FILE_NAME),
        &version,
    ));
    forward(app, remote.subscribe(), "remote-config");
    if let Some(backend) = backend {
        tauri::async_runtime::spawn(Arc::clone(&remote).follow(backend.clone()));
    }
    app.manage(Remote(Arc::clone(&remote)));

    let crashes = CrashReporter::new(
        dir.join(crash::DIR_NAME),
        &version,
        &os_version(),
        install_id,
        backend.cloned(),
    );
    // Before the hook: a panic right at start is already covered (the follower runs async).
    crashes.set_enabled(settings.get().crash_reports);
    crashes.install_panic_hook();
    tauri::async_runtime::spawn(Arc::clone(&crashes).run(settings.subscribe()));
    app.manage(Crashes(crashes));
    remote
}

/// Starts following the League client and pushes every status change to the UI.
pub fn start<R: Runtime>(app: &AppHandle<R>, settings: &SettingsStore) {
    // The chosen language's names; `auto` waits for the UI to say which (English until then).
    let game_data = GameDataState::new(settings.get().language.data_dragon_locale());
    let wanted = game_data.wanted.subscribe();
    app.manage(game_data);
    follow_game_data(app, wanted);
    let ui_language = UiLanguage::new(settings.get().language);
    let language = ui_language.subscribe();
    app.manage(ui_language);
    app.manage(EmblemState::default());
    load_rank_emblems(app);
    let dir = app.path().app_config_dir().unwrap_or_else(|error| {
        tracing::error!(%error, "no config directory, using the temporary one");
        std::env::temp_dir().join(&app.config().identifier)
    });
    let install_id = companion::backend::install_id(&dir);
    let backend = backend(&install_id);
    app.manage(Backend(backend.clone()));
    let published = stats_client(app, backend.as_ref());
    app.manage(Stats(published.clone()));
    if let Some(stats) = &published {
        follow_stats(app, stats);
    }
    let remote = platform_services(app, &dir, &install_id, backend.as_ref(), settings);
    // The client status, for the updater: never during a game.
    let (phase_tx, phase) = watch::channel(ClientStatus::not_running());
    app.manage(crate::updater::start(
        app,
        &install_id,
        phase,
        remote.subscribe(),
    ));
    app.manage(InstallId(install_id));

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
            remote: remote.subscribe(),
            stats: published,
            builds,
            names,
            language,
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
            matches: companion.matches.clone(),
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
            phase_tx.send_replace(current.clone());
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

/// Loads Riot's ranked emblems (downloaded once, cropped and cached) and hands them to the UI.
fn load_rank_emblems<R: Runtime>(app: &AppHandle<R>) {
    use base64::Engine as _;
    let cache = match app.path().app_cache_dir() {
        Ok(dir) => dir.join("emblems"),
        Err(error) => {
            tracing::error!(%error, "no cache directory for ranked emblems");
            return;
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let emblems =
            match static_data::emblems::RankEmblems::new(static_data::emblems::CDRAGON, cache) {
                Ok(source) => source.load().await,
                Err(error) => {
                    tracing::warn!(%error, "ranked emblems unavailable");
                    return;
                }
            };
        if emblems.is_empty() {
            return;
        }
        let emblems = RankEmblems {
            emblems: emblems
                .into_iter()
                .map(|(tier, png)| RankEmblem {
                    tier,
                    url: format!(
                        "data:image/png;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(png)
                    ),
                })
                .collect(),
        };
        tracing::info!(tiers = emblems.emblems.len(), "ranked emblems ready");
        if let Some(state) = app.try_state::<EmblemState>()
            && let Ok(mut slot) = state.0.write()
        {
            *slot = Some(emblems.clone());
        }
        if let Err(error) = app.emit("rank-emblems", emblems) {
            tracing::warn!(%error, "cannot emit ranked emblems");
        }
    });
}

/// Loads champion/item/spell data (cached per patch and locale) in the language the UI asks for,
/// and hands it to the UI; again whenever it asks for another language.
fn follow_game_data<R: Runtime>(app: &AppHandle<R>, mut wanted: watch::Receiver<&'static str>) {
    let cache = match app.path().app_cache_dir() {
        Ok(dir) => dir.join("ddragon"),
        Err(error) => {
            tracing::error!(%error, "no cache directory for game data");
            return;
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let locale = *wanted.borrow_and_update();
            let mut result = load_game_data(&cache, locale).await;
            if let Err(error) = &result
                && locale != ENGLISH
            {
                // Offline before this language's first download: English names beat none.
                tracing::warn!(%error, locale, "game data unavailable, trying English");
                result = load_game_data(&cache, ENGLISH).await;
            }
            match result {
                // The UI asked for another language meanwhile: that one loads next.
                Ok(_) if *wanted.borrow() != locale => {}
                Ok(data) => {
                    tracing::info!(
                        version = data.version,
                        locale,
                        champions = data.champions.len(),
                        "game data ready"
                    );
                    if let Some(state) = app.try_state::<GameDataState>()
                        && let Ok(mut slot) = state.loaded.write()
                    {
                        *slot = Some((locale, data.clone()));
                    }
                    if let Err(error) = app.emit("game-data", data) {
                        tracing::warn!(%error, "cannot emit game data");
                    }
                }
                Err(error) => tracing::warn!(%error, locale, "game data unavailable"),
            }
            if wanted.changed().await.is_err() {
                break;
            }
        }
    });
}

/// Data Dragon's locale for English, the fallback.
const ENGLISH: &str = "en_US";

async fn load_game_data(
    cache: &Path,
    locale: &str,
) -> Result<GameData, static_data::StaticDataError> {
    static_data::DataDragon::new(static_data::DDRAGON, cache, locale)?
        .load()
        .await
}
