//! Build imports: MVP's rune page, item set and summoner spells written into the League client,
//! on a click (`import_build`), or by itself once, at the first lock-in of a champion select, for
//! the parts whose "Auto import" switch is on (Settings; see [`lock_in`]).
//!
//! Policy (docs/policy.md, "Build imports"): these are client writes, so they are user-triggered
//! or opted-in only, and the player's own things are never touched:
//! - rune pages: only MVP's page (named "MVP…") is replaced, a new one is created only when
//!   there is room, the player's pages are never modified or deleted (no DELETE at all);
//! - item sets: the player's sets are written back exactly as read, only MVP's set for the
//!   champion is replaced;
//! - summoner spells: during champion select only, never in its last seconds
//!   ([`LAST_SECONDS`]), Flash on the player's key.
//!
//! The server can pause each part for everyone (feature flag or kill switch, see
//! [`crate::remote`]): a paused part is skipped at once, even in the middle of a champion select.
//!
//! Builds come from a [`BuildSource`]: the published stats in the app, a fake in tests.

mod item_sets;
pub mod lock_in;
mod runes;
mod spells;

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use domain::{
    Bracket, BuildStats, BuildsFile, ClientStatus, FailReason, GameflowPhase, ImportOutcome,
    ImportPart, ImportRequest, ImportResult, Language, PartResult, RemoteConfig, Role, Settings,
    SkipReason,
};
use lcu::{LcuClient, LcuError};
use serde_json::Value;
use tokio::sync::{mpsc, watch};

pub use item_sets::{ItemBlock, item_blocks, item_set, merge_item_set, sets_path};
pub(crate) use lock_in::LockIn;
pub use lock_in::{LockTracker, locked};
pub use runes::{CURRENT_PAGE, INVENTORY, PAGES, RunePage};
pub use spells::{
    FLASH, KeyChoice, LAST_SECONDS, MY_SELECTION, Selection, arrange, flash_habit, selection,
    too_late,
};

/// Ranked solo/duo data: used for every Summoner's Rift mode.
pub const RANKED: u32 = 420;
/// ARAM data (Howling Abyss).
pub const ARAM: u32 = 450;
/// The game the client is in (queue and map).
pub const GAMEFLOW_SESSION: &str = "/lol-gameflow/v1/session";

/// A boxed build answer, so [`BuildSource`] stays object-safe without extra crates.
pub type BuildFuture<'a> = Pin<Box<dyn Future<Output = Option<BuildStats>> + Send + 'a>>;

/// Where builds come from: in the app, the current patch's published `BuildsFile`s (see
/// [`build_for_role`]); in tests, a fake.
pub trait BuildSource: Send + Sync {
    /// The build of `champion_id` in `role` for the stats `queue` (420 ranked, 450 ARAM) of
    /// the rank `bracket`. `role: None` (blind pick, ARAM): the champion's most played role.
    /// `None` when there is no such build: not published, no stats yet, or offline without a
    /// cached copy.
    fn build(
        &self,
        champion_id: u32,
        role: Option<Role>,
        queue: u32,
        bracket: Bracket,
    ) -> BuildFuture<'_>;
}

/// No stats in the app yet: every import answers "no build".
#[derive(Debug, Clone, Copy, Default)]
pub struct NoBuilds;

impl BuildSource for NoBuilds {
    fn build(
        &self,
        _champion_id: u32,
        _role: Option<Role>,
        _queue: u32,
        _bracket: Bracket,
    ) -> BuildFuture<'_> {
        Box::pin(std::future::ready(None))
    }
}

/// The build for `role` in a published file: the role's own, or the most played role's when
/// `role` is `None`. A role without a build gives `None`: another role's runes would be wrong.
pub fn build_for_role(file: &BuildsFile, role: Option<Role>) -> Option<&BuildStats> {
    match role {
        None => file.roles.first(),
        Some(role) => file.roles.iter().find(|b| b.role == Some(role)),
    }
}

/// Champion names for page and set names (`MVP · Ahri Mid`); `None` when unknown.
pub type ChampionNames = Arc<dyn Fn(u32) -> Option<String> + Send + Sync>;

/// First word of everything MVP writes. A rune page or item set named like this is MVP's to
/// replace: the player can hand one of their pages to MVP by renaming it "MVP".
pub const NAME_PREFIX: &str = "MVP";
/// Longest name MVP gives a page or set (the client's rune page names are short).
pub const NAME_MAX_CHARS: usize = 25;

/// Whether `name` marks a page or set as MVP's: "MVP" as its first word, any case
/// (`MVP`, `MVP · Ahri Mid`, `mvp ahri`), not a longer word (`MVPlayer`).
pub fn is_mvp_name(name: &str) -> bool {
    let name = name.trim_start();
    name.get(..NAME_PREFIX.len())
        .is_some_and(|word| word.eq_ignore_ascii_case(NAME_PREFIX))
        && name
            .get(NAME_PREFIX.len()..)
            .and_then(|rest| rest.chars().next())
            .is_none_or(|next| !next.is_alphanumeric())
}

const fn role_words(role: Role) -> (&'static str, &'static str) {
    match role {
        Role::Top => ("Top", "Top"),
        Role::Jungle => ("Jungle", "Jgl"),
        Role::Middle => ("Mid", "Mid"),
        Role::Bottom => ("Bot", "Bot"),
        Role::Support => ("Support", "Sup"),
    }
}

/// The name of MVP's page and set: `MVP · Ahri Mid`, `MVP · Nunu & Willump Sup`,
/// `MVP · Ahri ARAM`, at most [`NAME_MAX_CHARS`] characters.
pub fn build_name(champion: Option<&str>, role: Option<Role>, queue: u32) -> String {
    let (long, short) = if queue == ARAM {
        ("ARAM", "ARAM")
    } else {
        role.map_or(("", ""), role_words)
    };
    let champion = champion.map(str::trim).unwrap_or_default();
    let join = |champion: &str, suffix: &str| {
        let body = [champion, suffix]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if body.is_empty() {
            NAME_PREFIX.to_owned()
        } else {
            format!("{NAME_PREFIX} · {body}")
        }
    };
    for suffix in [long, short] {
        let name = join(champion, suffix);
        if name.chars().count() <= NAME_MAX_CHARS {
            return name;
        }
    }
    // Still too long: shorten the champion's name, keep the role.
    let fixed = join("x", short).chars().count() - 1;
    let room = NAME_MAX_CHARS.saturating_sub(fixed + 1);
    let cut: String = champion.chars().take(room).collect();
    join(&format!("{}…", cut.trim_end()), short)
}

/// The stats queue for the game in `session` (`/lol-gameflow/v1/session`): ARAM data on
/// Howling Abyss, ranked data on Summoner's Rift (and outside of a game), `None` elsewhere
/// (Arena and other modes without published builds).
pub fn stats_queue(session: &Value) -> Option<u32> {
    let queue = session.pointer("/gameData/queue");
    let map = queue
        .and_then(|q| q.get("mapId"))
        .and_then(Value::as_u64)
        .or_else(|| session.pointer("/map/id").and_then(Value::as_u64))
        .unwrap_or(0);
    let id = queue
        .and_then(|q| q.get("id"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    match (map, id) {
        (12, _) | (_, 450) => Some(ARAM),
        (11 | 0, _) => Some(RANKED),
        _ => None,
    }
}

/// The client refused (its own words, for the player) or didn't answer at all.
pub(crate) fn client_failure(error: &LcuError) -> ImportOutcome {
    if let LcuError::Transport(detail) = error {
        // Seen on a real PC: another app held every connection the client takes.
        tracing::warn!(error = %detail, "the League client didn't answer an import");
        return failed(FailReason::NotAnswering);
    }
    let message = match error {
        LcuError::Http {
            status, message, ..
        } if !message.trim().is_empty() => format!("{} (HTTP {})", message.trim(), status.as_u16()),
        LcuError::Http { status, .. } => format!("HTTP {}", status.as_u16()),
        other => other.to_string(),
    };
    ImportOutcome::Failed {
        reason: FailReason::Client { message },
    }
}

const fn failed(reason: FailReason) -> ImportOutcome {
    ImportOutcome::Failed { reason }
}

const fn skipped(reason: SkipReason) -> ImportOutcome {
    ImportOutcome::Skipped { reason }
}

/// Unix epoch milliseconds (the champion select timer's clock).
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// Imports builds into the League client, for `import_build` clicks and the automatic import.
#[derive(Clone)]
pub struct Importer {
    client: watch::Receiver<Option<LcuClient>>,
    status: watch::Receiver<ClientStatus>,
    settings: watch::Receiver<Settings>,
    remote: watch::Receiver<RemoteConfig>,
    builds: Arc<dyn BuildSource>,
    names: ChampionNames,
    language: watch::Receiver<Language>,
    /// Every finished import, for Draft's warning after the automatic import ([`LockIn`]):
    /// set by the core.
    done: Option<mpsc::UnboundedSender<ImportResult>>,
}

impl fmt::Debug for Importer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Importer").finish_non_exhaustive()
    }
}

impl Importer {
    /// `language`: the UI's (`auto` resolved), for the words MVP writes into the client.
    pub fn new(
        client: watch::Receiver<Option<LcuClient>>,
        status: watch::Receiver<ClientStatus>,
        settings: watch::Receiver<Settings>,
        remote: watch::Receiver<RemoteConfig>,
        builds: Arc<dyn BuildSource>,
        names: ChampionNames,
        language: watch::Receiver<Language>,
    ) -> Self {
        Self {
            client,
            status,
            settings,
            remote,
            builds,
            names,
            language,
            done: None,
        }
    }

    /// Tells `done` about every import once it has run, whoever asked.
    #[must_use]
    pub(crate) fn reporting(mut self, done: mpsc::UnboundedSender<ImportResult>) -> Self {
        self.done = Some(done);
        self
    }

    pub(crate) fn settings(&self) -> Settings {
        self.settings.borrow().clone()
    }

    fn in_champ_select(&self) -> bool {
        self.status.borrow().phase == GameflowPhase::ChampSelect
    }

    /// Whether the champion select an import was for is over: the core left it, the client has
    /// no session any more, or the game is starting (nothing can change then).
    async fn champ_select_over(&self, lcu: &LcuClient) -> bool {
        if !self.in_champ_select() {
            return true;
        }
        match lcu.get::<Value>(crate::champ_select::SESSION).await {
            Ok(session) => {
                session.pointer("/timer/phase").and_then(Value::as_str) == Some("GAME_STARTING")
            }
            Err(error) => error.is_not_found(),
        }
    }

    /// Whether the server lets `part` run right now.
    pub(crate) fn allowed(&self, part: ImportPart) -> bool {
        crate::remote::import_allowed(&self.remote.borrow(), part)
    }

    /// The build to import: for the request's queue (else the game's, else ranked), its role
    /// (none in ARAM) and bracket (else the player's, else Emerald+ when theirs has no build
    /// yet). `result` takes the queue and role used.
    async fn build_for(
        &self,
        lcu: &LcuClient,
        request: &ImportRequest,
        result: &mut ImportResult,
    ) -> Result<BuildStats, FailReason> {
        let queue = match request.queue {
            Some(queue) => Some(queue),
            None => match lcu.get::<Value>(GAMEFLOW_SESSION).await {
                Ok(session) => stats_queue(&session),
                Err(_) => Some(RANKED),
            },
        };
        let Some(queue) = queue else {
            return Err(FailReason::UnsupportedMode);
        };
        result.queue = queue;
        // ARAM has no roles.
        if queue == ARAM {
            result.role = None;
        }
        let chosen = self.settings.borrow().stats_bracket;
        let bracket = request.bracket.unwrap_or(chosen);
        if let Some(build) = self
            .builds
            .build(request.champion_id, result.role, queue, bracket)
            .await
        {
            return Ok(build);
        }
        // The player's bracket may not be published (yet): the widest one's build.
        if request.bracket.is_none() && bracket != Bracket::EmeraldPlus {
            return self
                .builds
                .build(
                    request.champion_id,
                    result.role,
                    queue,
                    Bracket::EmeraldPlus,
                )
                .await
                .ok_or(FailReason::NoBuild);
        }
        Err(FailReason::NoBuild)
    }

    /// Imports the requested parts, in order, and says what happened to each. An import for the
    /// champion select ([`ImportRequest::champ_select`]) that comes as it ends tries nothing.
    pub async fn import(&self, request: &ImportRequest, automatic: bool) -> ImportResult {
        let result = self.run(request, automatic).await;
        if let Some(done) = &self.done {
            // Nobody listening any more (the core stopped): nothing to warn about either.
            let _ = done.send(result.clone());
        }
        result
    }

    async fn run(&self, request: &ImportRequest, automatic: bool) -> ImportResult {
        let settings = self.settings();
        let mut parts: Vec<ImportPart> = Vec::new();
        for part in &request.parts {
            if !parts.contains(part) {
                parts.push(*part);
            }
        }
        let mut result = ImportResult {
            champion_id: request.champion_id,
            role: request.role,
            queue: request.queue.unwrap_or(RANKED),
            automatic,
            parts: Vec::new(),
        };
        let lcu = self.client.borrow().clone();
        // What each part can't do before anything is read (asked again before each part).
        let early = |part: ImportPart| -> Option<ImportOutcome> {
            if !self.allowed(part) {
                return Some(skipped(SkipReason::Paused));
            }
            if lcu.is_none() {
                return Some(failed(FailReason::NoClient));
            }
            let in_champ_select = self.in_champ_select();
            if request.champ_select && !in_champ_select {
                return Some(skipped(SkipReason::ChampSelectEnded));
            }
            (part == ImportPart::Spells && !in_champ_select)
                .then_some(skipped(SkipReason::NotInChampSelect))
        };
        let pending: Vec<ImportPart> = parts
            .iter()
            .copied()
            .filter(|p| early(*p).is_none())
            .collect();
        let (Some(lcu), false) = (lcu.as_ref(), pending.is_empty()) else {
            result.parts = parts
                .iter()
                .map(|&part| PartResult {
                    part,
                    outcome: early(part).unwrap_or(failed(FailReason::NoClient)),
                })
                .collect();
            return result;
        };

        let build = self.build_for(lcu, request, &mut result).await;
        // Finding the build takes a moment: the champion select may have ended meanwhile, and
        // then a missing build (the game is starting) isn't the news, and nothing can apply.
        let over = request.champ_select && self.champ_select_over(lcu).await;
        let name = build_name(
            (self.names)(request.champion_id).as_deref(),
            result.role,
            result.queue,
        );
        for part in parts {
            let outcome = match (early(part), &build) {
                (Some(outcome), _) => outcome,
                _ if over => skipped(SkipReason::ChampSelectEnded),
                (None, Err(reason)) => failed(reason.clone()),
                (None, Ok(build)) => match part {
                    ImportPart::Runes => runes::import(lcu, build, &name).await,
                    ImportPart::ItemSet => {
                        let language = *self.language.borrow();
                        item_sets::import(
                            lcu,
                            build,
                            request.champion_id,
                            &name,
                            result.queue,
                            language,
                        )
                        .await
                    }
                    ImportPart::Spells => spells::import(lcu, build, settings.flash_key).await,
                },
            };
            if let ImportOutcome::Failed { reason } = &outcome {
                tracing::warn!(?part, ?reason, "import failed");
            }
            result.parts.push(PartResult { part, outcome });
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn recognises_mvp_names() {
        for name in [
            "MVP",
            "MVP · Ahri Mid",
            "mvp ahri",
            "  Mvp",
            "MVP·Ahri",
            "MVP-2",
        ] {
            assert!(is_mvp_name(name), "{name}");
        }
        for name in ["MVPlayer", "My MVP page", "", "Ahri", "MV", "MVP2"] {
            assert!(!is_mvp_name(name), "{name}");
        }
    }

    #[test]
    fn names_fit_the_client() {
        assert_eq!(
            build_name(Some("Ahri"), Some(Role::Middle), RANKED),
            "MVP · Ahri Mid"
        );
        assert_eq!(
            build_name(Some("Ahri"), Some(Role::Middle), ARAM),
            "MVP · Ahri ARAM"
        );
        assert_eq!(build_name(Some("Ahri"), None, RANKED), "MVP · Ahri");
        assert_eq!(build_name(None, Some(Role::Jungle), RANKED), "MVP · Jungle");
        assert_eq!(build_name(None, None, RANKED), "MVP");
        // Long names fall back to short roles, then shorten the champion's name.
        assert_eq!(
            build_name(Some("Nunu & Willump"), Some(Role::Jungle), RANKED),
            "MVP · Nunu & Willump Jgl"
        );
        let long = build_name(
            Some("A Very Long Champion Name"),
            Some(Role::Support),
            RANKED,
        );
        assert_eq!(long, "MVP · A Very Long Ch… Sup");
        for champion in [
            "Nunu & Willump",
            "Aurelion Sol",
            "Kog'Maw",
            "A Very Long Champion Name",
        ] {
            for role in [
                Role::Top,
                Role::Jungle,
                Role::Middle,
                Role::Bottom,
                Role::Support,
            ] {
                let name = build_name(Some(champion), Some(role), RANKED);
                assert!(name.chars().count() <= NAME_MAX_CHARS, "{name}");
                assert!(is_mvp_name(&name), "{name}");
            }
        }
    }

    #[test]
    fn picks_the_stats_queue_from_the_game() {
        let game = |map: u64, queue: u64| json!({ "gameData": { "queue": { "id": queue, "mapId": map } } });
        assert_eq!(stats_queue(&game(11, 420)), Some(RANKED));
        assert_eq!(stats_queue(&game(11, 400)), Some(RANKED));
        assert_eq!(stats_queue(&game(12, 450)), Some(ARAM));
        assert_eq!(stats_queue(&game(30, 1700)), None, "Arena");
        assert_eq!(stats_queue(&json!({})), Some(RANKED), "no game");
        assert_eq!(stats_queue(&json!({ "map": { "id": 12 } })), Some(ARAM));
    }

    #[test]
    fn picks_the_build_of_the_role() {
        let build = |role| BuildStats {
            role,
            g: 10,
            w: 5,
            runes: domain::BuildSection::default(),
            keystones: domain::BuildSection::default(),
            spells: domain::BuildSection::default(),
            skills: domain::BuildSection::default(),
            skill_start: domain::BuildSection::default(),
            starts: domain::BuildSection::default(),
            core: domain::BuildSection::default(),
            boots: domain::BuildSection::default(),
            item4: domain::BuildSection::default(),
            item5: domain::BuildSection::default(),
            item6: domain::BuildSection::default(),
        };
        let file = BuildsFile {
            info: domain::DataSetInfo {
                schema: 1,
                patch: "16.19".into(),
                queue: RANKED,
                bracket: Bracket::EmeraldPlus,
                games: 100,
                updated_at: 0,
            },
            id: 103,
            roles: vec![build(Some(Role::Middle)), build(Some(Role::Support))],
        };
        assert_eq!(
            build_for_role(&file, Some(Role::Support)).and_then(|b| b.role),
            Some(Role::Support)
        );
        assert_eq!(
            build_for_role(&file, None).and_then(|b| b.role),
            Some(Role::Middle)
        );
        assert!(build_for_role(&file, Some(Role::Top)).is_none());
    }
}
