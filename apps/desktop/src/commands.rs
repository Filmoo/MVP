//! Commands the UI can invoke. Names and payloads mirror `ui/src/data/transport.ts`.

use companion::settings::SettingsStore;
use companion::stats::StatsClient;
use domain::{
    AppInfo, BackendError, Bracket, ChampionPage, ClientError, ClientStatus, DraftView, GameData,
    GradedMatch, ImportRequest, ImportResult, Language, LiveGame, MatchDetails, PlayerProfile,
    RankEmblems, RemoteConfig, RiotId, Settings, StatsIndex, TierList, UpdateStatus,
};
use tauri::{Emitter as _, Manager as _};
use tauri_plugin_autostart::ManagerExt as _;

use crate::core::{
    Backend, Core, Crashes, EmblemState, GameDataState, InstallId, LogFile, Remote, Stats,
    UiLanguage,
};
use crate::updater::Updates;
use crate::{diagnostics, logging};

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
        install_id: app.try_state::<InstallId>().map(|id| id.0.clone()),
    }
}

/// The server's remote config as last received (feature flags, kill switches, banners,
/// `updateRequired`); `remote-config` events follow changes.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn remote_config(app: tauri::AppHandle) -> RemoteConfig {
    app.try_state::<Remote>()
        .map_or_else(RemoteConfig::default, |remote| remote.0.get())
}

/// Opens a banner's "More info" link in the default browser. The webview only names the
/// banner: the link is the one our server sent, and only `https://` links open.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn open_banner_link(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let config = app
        .try_state::<Remote>()
        .map_or_else(RemoteConfig::default, |remote| remote.0.get());
    let link = config
        .banners
        .iter()
        .find(|banner| banner.id == id)
        .and_then(|banner| banner.link.as_deref())
        .ok_or("this notice has no link")?;
    let url = tauri::Url::parse(link)
        .ok()
        .filter(|url| url.scheme() == "https")
        .ok_or("only https links open")?;
    open::that_detached(url.as_str()).map_err(|error| format!("couldn't open the browser: {error}"))
}

/// Where the app's own update stands; `app-update` events follow changes.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn update_status(app: tauri::AppHandle) -> UpdateStatus {
    app.try_state::<Updates>()
        .map_or(UpdateStatus::Idle, |u| u.status())
}

/// Checks for an update now (the download waits for the end of a game); answers the status
/// right after, `app-update` events follow.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn check_for_updates(app: tauri::AppHandle) -> UpdateStatus {
    match app.try_state::<Updates>() {
        Some(updates) => updates.check().await,
        None => UpdateStatus::Idle,
    }
}

/// Restarts MVP into the downloaded update. Refused (with the reason) during champion select
/// or a game, or when nothing is downloaded.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    match app.try_state::<Updates>() {
        Some(updates) => updates.install().await,
        None => Err("the updater isn't running".to_owned()),
    }
}

/// An error in the UI, for the opt-in crash reports: dropped unless the player turned them on,
/// scrubbed before it leaves.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn report_error(app: tauri::AppHandle, message: String, stack: Option<String>) {
    let reporter = app
        .try_state::<Crashes>()
        .map(|c| std::sync::Arc::clone(&c.0));
    if let Some(reporter) = reporter {
        reporter.report_ui_error(&message, stack.as_deref()).await;
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
/// Games already read whole carry their grade (`match_grades` reads the others). Fails with a
/// `ClientError` the UI words (`notAnswering`: the client didn't answer at all).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn current_profile(app: tauri::AppHandle) -> Result<Option<PlayerProfile>, ClientError> {
    let Some(core) = app.try_state::<Core>() else {
        return Ok(None);
    };
    let client = core.client.borrow().clone();
    let Some(client) = client else {
        return Ok(None);
    };
    core.matches
        .profile(&client)
        .await
        .map(Some)
        .map_err(|error| companion::profile::client_error(&error))
}

/// Your grade in each of your listed games (`current_profile`'s ids): the League client's
/// whole games are read once, a few at a time, and kept. Other ids, remakes and games without
/// two teams of five answer no grade.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn match_grades(app: tauri::AppHandle, match_ids: Vec<String>) -> Vec<GradedMatch> {
    let core = app.try_state::<Core>();
    let client = core.as_ref().and_then(|core| core.client.borrow().clone());
    match (core, client) {
        (Some(core), Some(client)) => core.matches.grades(&client, &match_ids).await,
        _ => match_ids
            .into_iter()
            .map(|match_id| GradedMatch {
                match_id,
                grade: None,
                role: None,
            })
            .collect(),
    }
}

/// One finished game in full, every player's grade included: yours from the League client,
/// anyone else's from our backend. Fails with a `BackendError` the UI words.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn match_details(
    app: tauri::AppHandle,
    match_id: String,
) -> Result<MatchDetails, BackendError> {
    let core = app
        .try_state::<Core>()
        .ok_or_else(|| BackendError::Unavailable {
            message: "MVP is still starting, try again in a moment".to_owned(),
        })?;
    let client = core.client.borrow().clone();
    let backend = app.try_state::<Backend>().and_then(|b| b.0.clone());
    core.matches
        .details(client.as_ref(), backend.as_ref(), match_id.trim())
        .await
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

/// Game data of the current patch in the UI's `language` (`auto` resolved by the UI: it knows
/// the system's language); `None` until loaded in it (a `game-data` event follows). Asking in
/// another language reloads the names in it.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn game_data(app: tauri::AppHandle, language: Option<Language>) -> Option<GameData> {
    // The UI asks in its language: the core's own words follow it too.
    if let (Some(language), Some(ui)) = (language, app.try_state::<UiLanguage>()) {
        ui.set(language);
    }
    let state = app.try_state::<GameDataState>()?;
    let locale = language.unwrap_or_default().data_dragon_locale();
    state.want(locale);
    state.get(locale)
}

/// Riot's ranked emblems, `None` until downloaded or read from the cache (`rank-emblems` follows).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn rank_emblems(app: tauri::AppHandle) -> Option<RankEmblems> {
    app.try_state::<EmblemState>()
        .and_then(|state| state.0.read().ok().and_then(|emblems| emblems.clone()))
}

/// The player's settings.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn get_settings(store: tauri::State<'_, SettingsStore>) -> Settings {
    store.get()
}

/// Saves new settings and applies them; answers what was saved (a `settings` event follows).
/// On failure nothing changes and the error says why.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn update_settings(
    app: tauri::AppHandle,
    store: tauri::State<'_, SettingsStore>,
    settings: Settings,
) -> Result<Settings, String> {
    let before = store.get();
    if settings.launch_at_startup != before.launch_at_startup {
        let autolaunch = app.autolaunch();
        let result = if settings.launch_at_startup {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        result.map_err(|error| format!("couldn't change the Windows startup entry: {error}"))?;
    }
    let saved = store.update(settings).map_err(|error| error.to_string())?;
    if let Err(error) = app.emit("settings", &saved) {
        tracing::warn!(%error, "cannot emit settings");
    }
    Ok(saved)
}

/// The UI shows `path`: automatic view switches never fight a user who went elsewhere.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn view_changed(app: tauri::AppHandle, path: String) {
    if let Some(core) = app.try_state::<Core>() {
        core.views.report(&path);
    }
}

/// Another player's profile from our backend (`platform`: `euw1`, `na1`…). Fails with a
/// `BackendError` the UI words (not found, rate limited, unavailable, unreachable).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn search_player(
    app: tauri::AppHandle,
    riot_id: RiotId,
    platform: String,
) -> Result<PlayerProfile, BackendError> {
    let backend = app.try_state::<Backend>().and_then(|b| b.0.clone());
    let Some(backend) = backend else {
        return Err(BackendError::Unavailable {
            message: "no backend configured".to_owned(),
        });
    };
    let searchable = app
        .try_state::<Remote>()
        .is_none_or(|remote| remote.0.get().features.player_search);
    if !searchable {
        return Err(BackendError::Unavailable {
            message: "player search is turned off for now".to_owned(),
        });
    }
    let riot_id = RiotId {
        game_name: riot_id.game_name.trim().to_owned(),
        tag_line: riot_id.tag_line.trim().trim_start_matches('#').to_owned(),
    };
    if riot_id.game_name.is_empty() || riot_id.tag_line.is_empty() {
        return Err(BackendError::NotFound);
    }
    backend
        .player(&platform.trim().to_ascii_lowercase(), &riot_id)
        .await
}

/// The game being loaded or played with its scouting cards, `None` outside of a game
/// (`live` events follow changes).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn live_game(app: tauri::AppHandle) -> Option<LiveGame> {
    app.try_state::<Core>()
        .and_then(|core| core.live.borrow().clone())
}

/// Asks for the scouting cards of the current game again (after a failure).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn retry_scouting(app: tauri::AppHandle) {
    if let Some(core) = app.try_state::<Core>() {
        core.scouting.retry();
    }
}

fn stats(app: &tauri::AppHandle) -> Result<StatsClient, BackendError> {
    app.try_state::<Stats>()
        .and_then(|stats| stats.0.clone())
        .ok_or_else(|| BackendError::Unavailable {
            message: "no backend configured".to_owned(),
        })
}

/// What our backend has published, as last fetched (a stale copy is revalidated in the
/// background: a `stats-index` event follows when it changed); `None` when nothing is published
/// yet, or offline without a cached copy.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn stats_index(app: tauri::AppHandle) -> Option<StatsIndex> {
    let index = stats(&app).ok()?.index().await.ok()?;
    Some(StatsIndex::clone(&index))
}

/// The current patch's tier list for `queue` × `bracket`, from the disk cache when current.
/// Fails with a `BackendError` (`notFound` when neither published nor cached).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn tier_list(
    app: tauri::AppHandle,
    queue: u32,
    bracket: Bracket,
) -> Result<TierList, BackendError> {
    stats(&app)?.current_tier_list(queue, bracket).await
}

/// The previous patch's tier list for `queue` × `bracket` (trends), `None` when there is none.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn previous_tier_list(
    app: tauri::AppHandle,
    queue: u32,
    bracket: Bracket,
) -> Result<Option<TierList>, BackendError> {
    stats(&app)?.previous_tier_list(queue, bracket).await
}

/// One champion's page for `queue` × `bracket`, current patch: missing files leave their part
/// empty; fails with `notFound` only when the data set doesn't exist.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn champion_stats(
    app: tauri::AppHandle,
    champion_id: u32,
    queue: u32,
    bracket: Bracket,
) -> Result<ChampionPage, BackendError> {
    stats(&app)?
        .champion_page(champion_id, queue, bracket)
        .await
}

/// Imports (parts of) a build into the League client: MVP's rune page, its item set, the
/// summoner spells (champion select only). Answers what happened to each part; parts turned off
/// in Settings are skipped. Rejects only while the app is still starting.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn import_build(
    app: tauri::AppHandle,
    request: ImportRequest,
) -> Result<ImportResult, String> {
    let importer = app
        .try_state::<Core>()
        .map(|core| core.imports.clone())
        .ok_or_else(|| "MVP is still starting, try again in a moment".to_owned())?;
    Ok(importer.import(&request, false).await)
}

/// A plain-text report for bug reports (Settings → About → "Copy diagnostics"): versions, the
/// League client's state, MVP's data and settings, and the end of the log, scrubbed.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn diagnostics(app: tauri::AppHandle) -> String {
    let version = app.package_info().version.to_string();
    let system = crate::core::os_version();
    let install_id = app.try_state::<InstallId>().map(|id| id.0.clone());
    let client = client_status(app.clone());
    let backend = app
        .try_state::<Backend>()
        .and_then(|backend| backend.0.as_ref().map(|b| b.base_url().to_owned()));
    let stats_patch = app
        .try_state::<Stats>()
        .and_then(|stats| stats.0.as_ref().and_then(StatsClient::cached_index))
        .and_then(|index| index.current.clone());
    let game_data = app.try_state::<GameDataState>().and_then(|g| g.loaded());
    let emblems = app
        .try_state::<EmblemState>()
        .and_then(|state| {
            state
                .0
                .read()
                .ok()
                .map(|e| e.as_ref().map_or(0, |e| e.emblems.len()))
        })
        .unwrap_or(0);
    let settings = app
        .try_state::<SettingsStore>()
        .map(|store| store.get())
        .unwrap_or_default();
    let log_path = app.try_state::<LogFile>().and_then(|log| log.0.clone());
    let lines = log_path
        .as_deref()
        .and_then(|path| logging::tail(path, diagnostics::LOG_LINES).ok())
        .unwrap_or_default();
    let shown = log_path.as_ref().map(|path| path.display().to_string());
    diagnostics::report(&diagnostics::Facts {
        version: &version,
        system: &system,
        install_id: install_id.as_deref(),
        client: &client,
        backend: backend.as_deref(),
        stats_patch: stats_patch.as_deref(),
        game_data: game_data.as_ref().map(|(v, locale)| (v.as_str(), *locale)),
        emblems,
        settings: &settings,
        log: shown.as_deref().map(|path| (path, lines.as_slice())),
    })
}

/// Opens the folder holding MVP's log files (Settings → About).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn open_logs(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    open::that_detached(&dir).map_err(|error| format!("couldn't open the folder: {error}"))
}
