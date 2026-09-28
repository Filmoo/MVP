//! Commands the UI can invoke. Names and payloads mirror `ui/src/data/transport.ts`.

use companion::settings::SettingsStore;
use companion::stats::StatsClient;
use domain::{
    AppInfo, BackendError, Bracket, ChampionPage, ClientStatus, DraftView, GameData, ImportRequest,
    ImportResult, LiveGame, PlayerProfile, RiotId, Settings, StatsIndex, TierList,
};
use tauri::{Emitter as _, Manager as _};
use tauri_plugin_autostart::ManagerExt as _;

use crate::core::{Backend, Core, GameDataState, Stats};

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

/// The logged-in player's own profile from the League client; `None` while it isn't running.
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub async fn current_profile(app: tauri::AppHandle) -> Result<Option<PlayerProfile>, String> {
    let client = app
        .try_state::<Core>()
        .and_then(|core| core.client.borrow().clone());
    let Some(client) = client else {
        return Ok(None);
    };
    companion::profile::local_profile(&client)
        .await
        .map(Some)
        .map_err(|error| error.to_string())
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

/// Game data of the current patch; `None` until loaded (a `game-data` event follows).
#[tauri::command]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn game_data(app: tauri::AppHandle) -> Option<GameData> {
    app.try_state::<GameDataState>()
        .and_then(|state| state.0.read().ok().and_then(|data| data.clone()))
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
