//! After each game: its summary for Home (result, your grade and its why, your numbers against
//! your lane opponent's, the LP it was worth), once the League client has the game.
//!
//! When a game starts (loading screen), the core notes which game it is and, in ranked solo/duo
//! and flex, the standing before it (`lp`). When it ends, a task reads the whole game from the
//! client (`/lol-match-history/v1/games/{id}`, the read that grades it in the match list, kept for
//! it) and the standing again until the client has counted the game: at once, then when the
//! client says its ranked stats changed, else a few more times over about two minutes. Then
//! nothing until the next game.
//!
//! Your own games only, read from your own client; nothing about the other players is looked up.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use domain::{
    BackendError, GameflowPhase, LpGame, MatchDetails, MatchPlayer, MatchTeam, PostGame,
    RankedQueue,
};
use lcu::{ConnectorUpdate, LcuClient};
use serde_json::Value;
use stats::grade::REMAKE_MAX_SECONDS;
use tokio::sync::{Notify, watch};
use tokio::task::JoinHandle;

use crate::lp::{self, Counted, LpStore, Pending};
use crate::matches::MatchInsights;
use crate::{live, profile};

/// The ranked standing, also followed through its events.
pub const RANKED: &str = profile::RANKED;

/// Pauses between reads after a game while the client hasn't counted it (or doesn't list it
/// yet); the ranked stats' events cut them short. About two minutes in all.
pub const WAITS: [Duration; 8] = [
    Duration::from_secs(2),
    Duration::from_secs(3),
    Duration::from_secs(5),
    Duration::from_secs(8),
    Duration::from_secs(13),
    Duration::from_secs(20),
    Duration::from_secs(30),
    Duration::from_secs(45),
];

// ---- The summary ------------------------------------------------------------------------------

fn damage_share(player: &MatchPlayer, team: &MatchTeam) -> Option<f64> {
    let total: u32 = team.players.iter().map(|p| p.damage_to_champions).sum();
    (total > 0).then(|| f64::from(player.damage_to_champions) / f64::from(total))
}

/// Whom your numbers are set against: your role on the other team; in a mode without roles
/// (ARAM) the enemy whose share of their team's damage is closest to yours; else nobody.
fn opponent<'a>(
    game: &'a MatchDetails,
    mine: &MatchTeam,
    me: &MatchPlayer,
) -> Option<&'a MatchPlayer> {
    let enemies: Vec<(&'a MatchTeam, &'a MatchPlayer)> = game
        .teams
        .iter()
        .filter(|t| t.team_id != mine.team_id)
        .flat_map(|t| t.players.iter().map(move |p| (t, p)))
        .collect();
    if let Some(role) = me.role {
        let mut same = enemies.iter().filter(|(_, p)| p.role == Some(role));
        return match (same.next(), same.next()) {
            (Some(&(_, p)), None) => Some(p),
            _ => None,
        };
    }
    let roleless = game
        .teams
        .iter()
        .flat_map(|t| &t.players)
        .all(|p| p.role.is_none());
    if !roleless {
        return None;
    }
    let share = damage_share(me, mine)?;
    enemies
        .iter()
        .filter_map(|&(team, p)| Some((p, (damage_share(p, team)? - share).abs())))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(p, _)| p)
}

/// The summary of one of your games: `None` when your line isn't in it, or it isn't two teams.
pub fn summarize(game: &MatchDetails, lp: Option<LpGame>, lp_pending: bool) -> Option<PostGame> {
    if game.teams.len() != 2 {
        return None;
    }
    let (mine, me) = game
        .teams
        .iter()
        .find_map(|t| t.players.iter().find(|p| p.is_me).map(|p| (t, p)))?;
    Some(PostGame {
        match_id: game.match_id.clone(),
        queue_id: game.queue_id,
        duration_seconds: game.duration_seconds,
        ended_at: game.ended_at,
        win: mine.win,
        me: me.clone(),
        opponent: opponent(game, mine, me).cloned(),
        lp,
        lp_pending,
    })
}

// ---- Following the games ----------------------------------------------------------------------

/// The game being played, as the client's session names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Started {
    game_id: u64,
    queue_id: u32,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// What the commands use: the summary shown, dismissing it, the LP history. Cheap to clone.
#[derive(Debug, Clone)]
pub struct PostGameHandle {
    tx: Arc<watch::Sender<Option<PostGame>>>,
    lp: Arc<LpStore>,
    /// The game whose summary Home may show (0: none). A dismissed game, or one a new game
    /// replaced, is never shown again, whatever its task still learns.
    shown: Arc<AtomicU64>,
}

impl PostGameHandle {
    /// The summary of the game that just ended, until dismissed or the next game.
    pub fn current(&self) -> Option<PostGame> {
        self.tx.borrow().clone()
    }

    /// Follows the summary (a `post-game` event for the UI).
    pub fn subscribe(&self) -> watch::Receiver<Option<PostGame>> {
        self.tx.subscribe()
    }

    /// Hides the summary of `match_id` for good (the player closed it).
    pub fn dismiss(&self, match_id: &str) {
        self.tx.send_if_modified(|current| {
            let this = current.as_ref().is_some_and(|p| p.match_id == match_id);
            if this {
                *current = None;
                self.shown.store(0, Ordering::SeqCst);
            }
            this
        });
    }

    /// The LP of every tracked ranked game, newest first.
    pub fn lp_history(&self) -> Vec<LpGame> {
        self.lp.history()
    }

    fn hide(&self) {
        self.shown.store(0, Ordering::SeqCst);
        self.tx.send_if_modified(|current| current.take().is_some());
    }

    fn publish(&self, game_id: u64, summary: PostGame) {
        if self.shown.load(Ordering::SeqCst) != game_id {
            return;
        }
        self.tx.send_if_modified(|current| {
            let changed = current.as_ref() != Some(&summary);
            if changed {
                *current = Some(summary);
            }
            changed
        });
    }
}

/// Follows the games from the core's loop: notes each game as it starts, sums it up as it ends.
#[derive(Debug)]
pub struct PostGames {
    handle: PostGameHandle,
    client: watch::Receiver<Option<LcuClient>>,
    insights: MatchInsights,
    /// Woken when the client's ranked stats change.
    ranked: Arc<Notify>,
    started: Arc<Mutex<Option<Started>>>,
    in_game: bool,
    waits: &'static [Duration],
    start: Option<JoinHandle<()>>,
    resolve: Option<JoinHandle<()>>,
}

impl PostGames {
    /// Keeps the LP of your ranked games in `lp_file` (in memory only without one).
    pub fn new(
        client: watch::Receiver<Option<LcuClient>>,
        insights: MatchInsights,
        lp_file: Option<PathBuf>,
    ) -> Self {
        Self {
            handle: PostGameHandle {
                tx: Arc::new(watch::channel(None).0),
                lp: Arc::new(LpStore::load(lp_file)),
                shown: Arc::new(AtomicU64::new(0)),
            },
            client,
            insights,
            ranked: Arc::new(Notify::new()),
            started: Arc::new(Mutex::new(None)),
            in_game: false,
            waits: &WAITS,
            start: None,
            resolve: None,
        }
    }

    pub fn handle(&self) -> PostGameHandle {
        self.handle.clone()
    }

    /// The client says its ranked stats changed: a game waiting for its LP reads them now.
    pub fn on_ranked_stats(&self) {
        self.ranked.notify_one();
    }

    /// Every update of the connector: the ranked stats' events wake a game waiting for its LP.
    pub fn on_update(&self, update: &ConnectorUpdate) {
        if let ConnectorUpdate::Event(event) = update
            && event.uri == RANKED
        {
            self.on_ranked_stats();
        }
    }

    /// A new gameflow phase.
    pub fn on_phase(&mut self, phase: GameflowPhase) {
        match phase {
            GameflowPhase::Loading | GameflowPhase::InGame => {
                if !self.in_game {
                    self.in_game = true;
                    self.handle.hide();
                    self.note_start();
                }
            }
            // A new game on its way: the last one's summary goes (its LP is still counted).
            GameflowPhase::ChampSelect => self.handle.hide(),
            GameflowPhase::PostGame
            | GameflowPhase::Idle
            | GameflowPhase::Lobby
            | GameflowPhase::Matchmaking
            | GameflowPhase::ReadyCheck => {
                if std::mem::take(&mut self.in_game) {
                    self.sum_up();
                } else if phase == GameflowPhase::PostGame {
                    // Started after the game began (a restart): the game on file, if any.
                    self.sum_up();
                }
            }
        }
    }

    /// Notes the game that starts and, in ranked, the standing before it.
    fn note_start(&mut self) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        if let Some(task) = self.start.take() {
            task.abort();
        }
        *self.started.lock().unwrap_or_else(PoisonError::into_inner) = None;
        let (started, lp) = (Arc::clone(&self.started), Arc::clone(&self.handle.lp));
        self.start = Some(tokio::spawn(async move {
            let Some(game) = started_game(&client).await else {
                return;
            };
            *started.lock().unwrap_or_else(PoisonError::into_inner) = Some(game);
            let Some(queue) = RankedQueue::from_queue_id(game.queue_id) else {
                return;
            };
            if lp.pending().is_some_and(|p| p.game_id == game.game_id) {
                return; // read when it started, before a restart
            }
            match client.get::<Value>(RANKED).await {
                Ok(stats) => {
                    if let Some(before) = profile::map_queue(&stats, queue) {
                        lp.start(Pending {
                            game_id: game.game_id,
                            queue,
                            before,
                        });
                    }
                }
                Err(error) => tracing::info!(%error, "ranked standing unread at the game's start"),
            }
        }));
    }

    /// The game ended: its summary once the client has it, its LP once counted.
    fn sum_up(&mut self) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let noted = *self.started.lock().unwrap_or_else(PoisonError::into_inner);
        let pending = self.handle.lp.pending();
        let Some(game_id) = noted
            .map(|g| g.game_id)
            .or_else(|| pending.as_ref().map(|p| p.game_id))
        else {
            return;
        };
        if let Some(task) = self.resolve.take() {
            task.abort();
        }
        self.handle.shown.store(game_id, Ordering::SeqCst);
        let resolve = Resolve {
            client,
            insights: self.insights.clone(),
            handle: self.handle.clone(),
            ranked: Arc::clone(&self.ranked),
            game_id,
            waits: self.waits,
        };
        self.resolve = Some(tokio::spawn(resolve.run()));
    }
}

impl Drop for PostGames {
    fn drop(&mut self) {
        for task in [self.start.take(), self.resolve.take()]
            .into_iter()
            .flatten()
        {
            task.abort();
        }
    }
}

/// The game in the client's gameflow session (loading screen, in game).
async fn started_game(client: &LcuClient) -> Option<Started> {
    let session: Value = client.get(live::SESSION).await.ok()?;
    let data = session.get("gameData")?;
    let game_id = data.get("gameId")?.as_u64().filter(|&id| id != 0)?;
    let queue_id = data
        .pointer("/queue/id")
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok())
        .unwrap_or(0);
    Some(Started { game_id, queue_id })
}

/// One game's end: reads until its summary and LP are known, or the waits run out.
struct Resolve {
    client: LcuClient,
    insights: MatchInsights,
    handle: PostGameHandle,
    ranked: Arc<Notify>,
    game_id: u64,
    waits: &'static [Duration],
}

impl Resolve {
    async fn run(self) {
        let game_id = self.game_id;
        let lp = Arc::clone(&self.handle.lp);
        let pending = lp
            .pending()
            .filter(|p| p.game_id == game_id && lp.game(game_id).is_none());
        let mut open = pending.is_some();
        let mut game: Option<Arc<MatchDetails>> = None;
        let mut waits = self.waits.iter();
        loop {
            if game.is_none() {
                match self.insights.after_game(&self.client, game_id).await {
                    Ok(read) => {
                        if read.duration_seconds <= REMAKE_MAX_SECONDS && open {
                            // A remake counts for nothing: no LP to wait for.
                            open = false;
                            lp.drop_pending(game_id);
                        }
                        game = Some(read);
                    }
                    Err(BackendError::NotFound) => {
                        tracing::debug!(game_id, "game not in the history yet");
                    }
                    Err(error) => tracing::info!(%error, game_id, "game unread after its end"),
                }
            }
            if open && let Some(pending) = &pending {
                open = self.count(pending).await;
            }
            if let Some(game) = &game
                && let Some(summary) = summarize(game, lp.game(game_id), open)
            {
                self.handle.publish(game_id, summary);
            }
            if game.is_some() && !open {
                break;
            }
            let Some(&wait) = waits.next() else { break };
            tokio::select! {
                () = tokio::time::sleep(wait) => {}
                () = self.ranked.notified() => {}
            }
        }
        if open {
            tracing::info!(
                game_id,
                "the client didn't count the game in time: its LP stays unknown"
            );
            lp.drop_pending(game_id);
            if let Some(summary) = game.as_deref().and_then(|g| summarize(g, None, false)) {
                self.handle.publish(game_id, summary);
            }
        }
    }

    /// Reads the standing once: `true` while the game isn't counted yet.
    async fn count(&self, pending: &Pending) -> bool {
        let stats = match self.client.get::<Value>(RANKED).await {
            Ok(stats) => stats,
            Err(error) => {
                tracing::info!(%error, "ranked standing unread after the game");
                return true;
            }
        };
        let after = profile::map_queue(&stats, pending.queue);
        let lp = &self.handle.lp;
        match lp::count(
            pending.game_id,
            pending.queue,
            &pending.before,
            after.as_ref(),
            now_ms(),
        ) {
            Counted::NotYet => true,
            Counted::Game(game) => {
                tracing::info!(delta = game.delta, "LP of the game");
                lp.record(game);
                false
            }
            Counted::Unknown => {
                lp.drop_pending(pending.game_id);
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use domain::{Division, RankedEntry, Role, Tier};
    use mock_lcu::MockLcu;
    use mock_lcu::history::{self, Game, Local};
    use serde_json::json;

    use super::*;
    use crate::matches::{Me, details_from_client};

    fn local() -> Local {
        Local {
            puuid: "local-puuid".into(),
            game_name: "Fillmo".into(),
            tag_line: "7272".into(),
            summoner_id: 42,
        }
    }

    fn game(game_id: u64, lane: &'static str, map_id: u32, duration: u32) -> Game {
        Game {
            game_id,
            queue_id: if map_id == 12 { 450 } else { 420 },
            map_id,
            created: 1_790_500_000_000,
            duration,
            champion: 103,
            lane,
            spells: [14, 4],
            win: true,
        }
    }

    fn details(game: &Game) -> MatchDetails {
        let me = Me::from_summoner(&json!({ "puuid": "local-puuid", "summonerId": 42 }));
        details_from_client(&game.document(&local()), &me, "EUW1").unwrap()
    }

    #[test]
    fn your_lane_opponent_is_your_role_on_the_other_team() {
        let summary = summarize(&details(&game(7, "MIDDLE", 11, 1742)), None, true).unwrap();
        assert_eq!(summary.match_id, "EUW1_7");
        assert!(summary.win && summary.lp_pending);
        assert_eq!(summary.me.role, Some(Role::Middle));
        assert!(summary.me.grade.is_some());
        let opponent = summary.opponent.unwrap();
        assert_eq!(opponent.role, Some(Role::Middle));
        assert!(!opponent.is_me);
    }

    #[test]
    fn aram_sets_you_against_the_closest_damage_share() {
        let game = details(&game(8, "MIDDLE", 12, 1300));
        let summary = summarize(&game, None, false).unwrap();
        let opponent = summary.opponent.unwrap();
        let share = |p: &MatchPlayer, team: usize| {
            f64::from(p.damage_to_champions)
                / f64::from(
                    game.teams[team]
                        .players
                        .iter()
                        .map(|q| q.damage_to_champions)
                        .sum::<u32>(),
                )
        };
        let mine = share(&summary.me, 0);
        let closest = game.teams[1]
            .players
            .iter()
            .map(|p| (share(p, 1) - mine).abs())
            .fold(f64::INFINITY, f64::min);
        assert!(((share(&opponent, 1) - mine).abs() - closest).abs() < 1e-12);
    }

    #[test]
    fn no_opponent_without_a_single_one_in_your_role() {
        let mut game = details(&game(9, "TOP", 11, 1800));
        for p in &mut game.teams[1].players {
            if p.role == Some(Role::Top) {
                p.role = None;
            }
        }
        assert!(summarize(&game, None, false).unwrap().opponent.is_none());
        game.teams.truncate(1);
        assert!(summarize(&game, None, false).is_none(), "not two teams");
    }

    fn entry(lp: u32, games: u32) -> RankedEntry {
        RankedEntry {
            tier: Tier::Emerald,
            division: Some(Division::II),
            league_points: lp,
            wins: games,
            losses: 0,
        }
    }

    fn ranked(entry: &RankedEntry) -> Value {
        json!({ "queueMap": { "RANKED_SOLO_5x5": {
            "tier": "EMERALD", "division": "II", "leaguePoints": entry.league_points,
            "wins": entry.wins, "losses": entry.losses } } })
    }

    fn client_for(mock: &MockLcu) -> LcuClient {
        let creds = lcu::Lockfile::parse(&mock.lockfile())
            .unwrap()
            .credentials();
        LcuClient::new(
            &creds,
            lcu::tls::pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
        )
        .unwrap()
    }

    const SHORT_WAITS: [Duration; 2] = [Duration::from_millis(20), Duration::from_millis(20)];

    async fn resolve(mock: &MockLcu, lp: &Arc<LpStore>, game_id: u64) -> PostGameHandle {
        let handle = PostGameHandle {
            tx: Arc::new(watch::channel(None).0),
            lp: Arc::clone(lp),
            shown: Arc::new(AtomicU64::new(game_id)),
        };
        mock.set(
            profile::CURRENT_SUMMONER,
            json!({ "puuid": "local-puuid", "summonerId": 42, "gameName": "Fillmo", "tagLine": "7272" }),
        );
        Resolve {
            client: client_for(mock),
            insights: MatchInsights::default(),
            handle: handle.clone(),
            ranked: Arc::new(Notify::new()),
            game_id,
            waits: &SHORT_WAITS,
        }
        .run()
        .await;
        handle
    }

    #[tokio::test]
    async fn a_ranked_game_ends_with_its_summary_and_lp() {
        let mock = MockLcu::start().await.unwrap();
        let played = game(7_000_000_010, "MIDDLE", 11, 1742);
        mock.set(
            &history::game_path(played.game_id),
            played.document(&local()),
        );
        mock.set(RANKED, ranked(&entry(67, 11)));
        let lp = Arc::new(LpStore::default());
        lp.start(Pending {
            game_id: played.game_id,
            queue: RankedQueue::Solo,
            before: entry(46, 10),
        });
        let handle = resolve(&mock, &lp, played.game_id).await;
        let summary = handle.current().unwrap();
        assert_eq!(summary.match_id, "EUW1_7000000010");
        assert!(!summary.lp_pending);
        assert_eq!(summary.lp.map(|g| g.delta), Some(21));
        assert_eq!(lp.history().len(), 1);
        assert!(lp.pending().is_none());

        // Dismissed: gone, and never shown again.
        handle.dismiss("EUW1_7000000010");
        assert!(handle.current().is_none());
        handle.publish(
            played.game_id,
            summarize(&details(&played), None, false).unwrap(),
        );
        assert!(handle.current().is_none());
    }

    #[tokio::test]
    async fn a_standing_never_counted_leaves_the_lp_unknown() {
        let mock = MockLcu::start().await.unwrap();
        let played = game(7_000_000_011, "TOP", 11, 1810);
        mock.set(
            &history::game_path(played.game_id),
            played.document(&local()),
        );
        mock.set(RANKED, ranked(&entry(46, 10)));
        let lp = Arc::new(LpStore::default());
        lp.start(Pending {
            game_id: played.game_id,
            queue: RankedQueue::Solo,
            before: entry(46, 10),
        });
        let handle = resolve(&mock, &lp, played.game_id).await;
        let summary = handle.current().unwrap();
        assert!(summary.lp.is_none() && !summary.lp_pending);
        assert!(lp.pending().is_none() && lp.history().is_empty());
        assert_eq!(
            mock.count("GET", RANKED),
            3,
            "read at once, then after each wait, then no more"
        );
    }

    #[tokio::test]
    async fn a_remake_has_no_lp_to_wait_for() {
        let mock = MockLcu::start().await.unwrap();
        let played = game(7_000_000_012, "MIDDLE", 11, 200);
        mock.set(
            &history::game_path(played.game_id),
            played.document(&local()),
        );
        let lp = Arc::new(LpStore::default());
        lp.start(Pending {
            game_id: played.game_id,
            queue: RankedQueue::Solo,
            before: entry(46, 10),
        });
        let handle = resolve(&mock, &lp, played.game_id).await;
        let summary = handle.current().unwrap();
        assert!(summary.me.grade.is_none(), "remakes get no grade");
        assert!(summary.lp.is_none() && !summary.lp_pending);
        assert_eq!(mock.count("GET", RANKED), 0);
    }

    #[tokio::test]
    async fn a_game_the_client_never_lists_shows_nothing() {
        let mock = MockLcu::start().await.unwrap();
        let lp = Arc::new(LpStore::default());
        let handle = resolve(&mock, &lp, 7_000_000_013).await;
        assert!(handle.current().is_none());
        assert_eq!(
            mock.count("GET", &history::game_path(7_000_000_013)),
            3,
            "asked again after each wait"
        );
    }
}
