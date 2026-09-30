//! Published stats in the app against a small fake backend: download, disk cache (`ETag`, 304,
//! restart, offline, pruning), coalescing, rate limits, the Champions page, and the draft helper
//! end to end (fake League client in champion select + fake backend). No network.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash as _, Hasher as _};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, ETAG, IF_NONE_MATCH, RETRY_AFTER};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use companion::Companion;
use companion::backend::{BackendClient, BackendConfig, INSTALL_HEADER};
use companion::stats::{ARAM, RANKED, StatsClient};
use domain::{
    BackendError, Bracket, BuildSection, BuildStats, BuildsFile, ChampionRoleStats, ChampionStats,
    ChampionsFile, ClientConnection, CompositionStats, CompositionsFile, DataSetIndex, DataSetInfo,
    DraftView, MatchupEntry, MatchupsFile, PairKind, PairPrior, PatchIndex, ReasonKind,
    RemoteConfig, Role, RoleMatchups, Settings, StatsIndex, TierEntry, TierGrade, TierList,
};
use lcu::ConnectorConfig;
use lcu::tls::pinned_client_config;
use mock_lcu::MockLcu;
use serde_json::json;
use tokio::sync::watch;

const INSTALL: &str = "0123456789abcdef0123456789abcdef";
const EMERALD: Bracket = Bracket::EmeraldPlus;

const MALPHITE: u32 = 54;
const ORNN: u32 = 516;
const SHEN: u32 = 98;
const CAMILLE: u32 = 164;
const IRELIA: u32 = 39;
const LEE_SIN: u32 = 64;
const AHRI: u32 = 103;
const THRESH: u32 = 412;
const YUUMI: u32 = 350;

// ── A fake backend serving published files ─────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
struct Request {
    path: String,
    if_none_match: Option<String>,
    install: Option<String>,
    status: u16,
}

#[derive(Default)]
struct Published {
    /// Path under `/v1/stats/` (`index`, `16.19/420/emeraldPlus/tierlist.json`) → body.
    files: HashMap<String, Vec<u8>>,
    requests: Vec<Request>,
    /// Answered 429 (with `Retry-After`).
    limited: Vec<String>,
    /// Answered after a pause.
    slow: Vec<String>,
}

type Server = Arc<Mutex<Published>>;

fn etag(body: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    body.hash(&mut h);
    format!("\"{:016x}\"", h.finish())
}

async fn serve(State(server): State<Server>, uri: Uri, headers: HeaderMap) -> Response {
    let path = uri.path().trim_start_matches("/v1/stats/").to_owned();
    let header = |name| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let slow = server.lock().unwrap().slow.contains(&path);
    if slow {
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    let mut server = server.lock().unwrap();
    let limited = server.limited.contains(&path);
    let body = server.files.get(&path).cloned();
    let if_none_match = header(IF_NONE_MATCH);
    let max_age = if path == "index" { "300" } else { "3600" };
    let response = match body {
        _ if limited => (
            StatusCode::TOO_MANY_REQUESTS,
            [(RETRY_AFTER, "7")],
            axum::Json(json!({ "error": "rateLimited", "message": "slow down", "retryAfter": 7 })),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            axum::Json(json!({ "error": "notFound", "message": "not found" })),
        )
            .into_response(),
        Some(body) => {
            let tag = etag(&body);
            let cache = format!("public, max-age={max_age}");
            if if_none_match.as_deref() == Some(tag.as_str()) {
                (
                    StatusCode::NOT_MODIFIED,
                    [(ETAG, tag), (CACHE_CONTROL, cache)],
                )
                    .into_response()
            } else {
                ([(ETAG, tag), (CACHE_CONTROL, cache)], body).into_response()
            }
        }
    };
    server.requests.push(Request {
        path,
        if_none_match,
        install: header(INSTALL_HEADER.parse().unwrap()),
        status: response.status().as_u16(),
    });
    response
}

async fn fake_backend() -> (String, Server) {
    let server = Server::default();
    let app = Router::new()
        .route("/v1/stats/{*rest}", get(serve))
        .with_state(Arc::clone(&server));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, server)
}

/// A base URL nobody listens on.
async fn dead_backend() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    base
}

fn stats_client(base: &str, dir: &Path) -> StatsClient {
    let mut config = BackendConfig::new(base, INSTALL);
    config.timeout = Duration::from_secs(2);
    StatsClient::new(BackendClient::new(&config).unwrap(), dir)
}

fn paths(server: &Server) -> Vec<String> {
    server
        .lock()
        .unwrap()
        .requests
        .iter()
        .map(|r| r.path.clone())
        .collect()
}

fn requests(server: &Server) -> Vec<Request> {
    server.lock().unwrap().requests.clone()
}

fn forget_requests(server: &Server) {
    server.lock().unwrap().requests.clear();
}

// ── Published data ─────────────────────────────────────────────────────────────────────────

fn info(patch: &str, queue: u32, updated_at: i64) -> DataSetInfo {
    DataSetInfo {
        schema: 1,
        patch: patch.to_owned(),
        queue,
        bracket: EMERALD,
        games: 120_000,
        updated_at,
    }
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "small positive test numbers"
)]
fn wins(games: u32, rate: f64) -> u32 {
    (f64::from(games) * rate).round() as u32
}

/// `(champion, [(role, games, win rate)])` rows of a champions file.
type Rows<'a> = &'a [(u32, &'a [(Role, u32, f64)])];

fn world() -> Rows<'static> {
    use Role::{Jungle, Middle, Support, Top};
    &[
        (MALPHITE, &[(Top, 30_000, 0.51)]),
        (ORNN, &[(Top, 20_000, 0.505)]),
        (SHEN, &[(Top, 20_000, 0.50), (Support, 4_000, 0.50)]),
        (CAMILLE, &[(Top, 25_000, 0.52)]),
        (IRELIA, &[(Top, 27_000, 0.49), (Middle, 3_000, 0.48)]),
        (LEE_SIN, &[(Jungle, 40_000, 0.49)]),
        (AHRI, &[(Middle, 35_000, 0.51)]),
        (THRESH, &[(Support, 30_000, 0.50)]),
        (YUUMI, &[(Support, 15_000, 0.48)]),
    ]
}

fn champions_file(info: &DataSetInfo, rows: Rows<'_>) -> ChampionsFile {
    ChampionsFile {
        info: info.clone(),
        champions: rows
            .iter()
            .map(|(id, roles)| {
                let roles: Vec<ChampionRoleStats> = roles
                    .iter()
                    .map(|&(role, g, wr)| ChampionRoleStats {
                        role: Some(role),
                        g,
                        w: wins(g, wr),
                        prev: None,
                    })
                    .collect();
                ChampionStats {
                    id: *id,
                    g: roles.iter().map(|r| r.g).sum(),
                    w: roles.iter().map(|r| r.w).sum(),
                    bans: 100,
                    roles,
                }
            })
            .collect(),
        priors: vec![PairPrior {
            kind: PairKind::Lane,
            roles: vec![Role::Top, Role::Top],
            tau: 0.0209,
            k: 572.3,
            pairs: 900,
        }],
    }
}

fn tier_list(info: &DataSetInfo, rows: Rows<'_>) -> TierList {
    let mut entries: Vec<TierEntry> = rows
        .iter()
        .flat_map(|(id, roles)| {
            roles.iter().map(move |&(role, g, wr)| TierEntry {
                id: *id,
                role: Some(role),
                tier: TierGrade::B,
                score: (wr - 0.5) * 100.0,
                g,
                w: wins(g, wr),
                win_rate: wr,
                pick_rate: 0.1,
                ban_rate: 0.01,
                share: Some(1.0),
            })
        })
        .collect();
    entries.sort_by(|a, b| b.score.total_cmp(&a.score));
    TierList {
        info: info.clone(),
        entries,
    }
}

fn matchups_file(
    info: &DataSetInfo,
    id: u32,
    role: Role,
    lane: &[(u32, Role, u32, u32)],
) -> MatchupsFile {
    MatchupsFile {
        info: info.clone(),
        id,
        roles: vec![RoleMatchups {
            role,
            g: 20_000,
            w: 10_000,
            lane: lane
                .iter()
                .map(|&(id, role, g, w)| MatchupEntry {
                    id,
                    role,
                    g,
                    w,
                    d: 0.0,
                })
                .collect(),
            jungle: vec![],
            duos: vec![],
        }],
    }
}

fn builds_file(info: &DataSetInfo, id: u32) -> BuildsFile {
    let section = BuildSection { n: 0, top: vec![] };
    BuildsFile {
        info: info.clone(),
        id,
        roles: vec![BuildStats {
            role: Some(Role::Top),
            g: 1,
            w: 1,
            runes: section.clone(),
            keystones: section.clone(),
            spells: section.clone(),
            skills: section.clone(),
            skill_start: section.clone(),
            starts: section.clone(),
            core: section.clone(),
            boots: section.clone(),
            item4: section.clone(),
            item5: section.clone(),
            item6: section,
        }],
    }
}

fn to_json(value: &impl serde::Serialize) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}

/// Publishes a patch like `mvp-crawler publish`: its files (ranked; ARAM tier list only),
/// then the index with `current` and every patch in `listed` (newest first).
fn publish(server: &Server, patch: &str, updated_at: i64, current: &str, listed: &[(&str, i64)]) {
    let ranked = info(patch, RANKED, updated_at);
    let dir = format!("{patch}/420/emeraldPlus");
    let mut s = server.lock().unwrap();
    s.files.insert(
        format!("{dir}/champions.json"),
        to_json(&champions_file(&ranked, world())),
    );
    s.files.insert(
        format!("{dir}/tierlist.json"),
        to_json(&tier_list(&ranked, world())),
    );
    s.files.insert(
        format!("{dir}/builds/{MALPHITE}.json"),
        to_json(&builds_file(&ranked, MALPHITE)),
    );
    s.files.insert(
        format!("{dir}/matchups/{MALPHITE}.json"),
        to_json(&matchups_file(
            &ranked,
            MALPHITE,
            Role::Top,
            &[(IRELIA, Role::Top, 3_000, 1_700)],
        )),
    );
    s.files.insert(
        format!("{dir}/matchups/{ORNN}.json"),
        to_json(&matchups_file(
            &ranked,
            ORNN,
            Role::Top,
            &[(IRELIA, Role::Top, 2_000, 900)],
        )),
    );
    let aram = info(patch, ARAM, updated_at);
    s.files.insert(
        format!("{patch}/450/emeraldPlus/tierlist.json"),
        to_json(&tier_list(&aram, &[(MALPHITE, &[])])),
    );
    let index = StatsIndex {
        schema: 1,
        current: Some(current.to_owned()),
        patches: listed
            .iter()
            .map(|&(patch, updated_at)| PatchIndex {
                patch: patch.to_owned(),
                name: format!("2{}", patch.trim_start_matches('1')),
                sets: vec![
                    DataSetIndex {
                        queue: RANKED,
                        bracket: EMERALD,
                        games: 120_000,
                    },
                    DataSetIndex {
                        queue: ARAM,
                        bracket: EMERALD,
                        games: 40_000,
                    },
                ],
                updated_at,
            })
            .collect(),
        updated_at,
    };
    s.files.insert("index".to_owned(), to_json(&index));
}

// ── The stats client ───────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn downloads_caches_and_revalidates() {
    let (base, server) = fake_backend().await;
    publish(&server, "16.19", 1_000, "16.19", &[("16.19", 1_000)]);
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());
    assert!(stats.cached_index().is_none());

    let list = stats.current_tier_list(RANKED, EMERALD).await.unwrap();
    assert_eq!(list.info.patch, "16.19");
    assert_eq!(list.entries[0].id, CAMILLE, "best first");
    assert_eq!(
        paths(&server),
        ["index", "16.19/420/emeraldPlus/tierlist.json"]
    );
    assert!(
        requests(&server)
            .iter()
            .all(|r| r.install.as_deref() == Some(INSTALL) && r.if_none_match.is_none())
    );
    let cached = dir.path().join("v1/16.19/420/emeraldPlus/tierlist.json");
    assert!(
        cached.exists()
            && dir
                .path()
                .join("v1/16.19/420/emeraldPlus/tierlist.json.etag")
                .exists()
    );
    assert!(dir.path().join("v1/index.json.etag").exists());

    // Asked again: from memory.
    stats.current_tier_list(RANKED, EMERALD).await.unwrap();
    assert_eq!(paths(&server).len(), 2);

    // A restart: the index comes from disk, is revalidated (304), and the file of the same
    // publication is read from disk without a request.
    forget_requests(&server);
    let stats = stats_client(&base, dir.path());
    assert_eq!(
        stats
            .cached_index()
            .and_then(|i| i.current.clone())
            .as_deref(),
        Some("16.19")
    );
    let mut announced = stats.subscribe();
    stats.refresh_index().await.unwrap();
    assert!(
        !announced.has_changed().unwrap(),
        "same index: nothing to announce"
    );
    let again = stats.current_tier_list(RANKED, EMERALD).await.unwrap();
    assert_eq!(again, list);
    let seen = requests(&server);
    assert_eq!(seen.len(), 1);
    assert_eq!((seen[0].path.as_str(), seen[0].status), ("index", 304));
    assert!(seen[0].if_none_match.is_some());

    // A republication: the new index is announced; the file is revalidated with its ETag.
    publish(&server, "16.19", 2_000, "16.19", &[("16.19", 2_000)]);
    forget_requests(&server);
    stats.refresh_index().await.unwrap();
    assert!(announced.has_changed().unwrap());
    let fresh = announced.borrow_and_update().clone().unwrap();
    assert_eq!(fresh.updated_at, 2_000);
    let list = stats.current_tier_list(RANKED, EMERALD).await.unwrap();
    assert_eq!(list.info.updated_at, 2_000);
    let seen = requests(&server);
    assert_eq!(seen[1].path, "16.19/420/emeraldPlus/tierlist.json");
    assert!(seen[1].if_none_match.is_some() && seen[1].status == 200);

    // An index-only change (same files): the file answers 304 and the disk copy is used.
    {
        let mut s = server.lock().unwrap();
        let mut index: StatsIndex = serde_json::from_slice(&s.files["index"]).unwrap();
        index.patches[0].updated_at = 3_000;
        index.updated_at = 3_000;
        s.files.insert("index".to_owned(), to_json(&index));
    }
    forget_requests(&server);
    stats.refresh_index().await.unwrap();
    assert_eq!(
        stats.current_tier_list(RANKED, EMERALD).await.unwrap(),
        list
    );
    let seen = requests(&server);
    assert_eq!(
        seen.iter().map(|r| r.status).collect::<Vec<_>>(),
        [200, 304]
    );
    // … and then stands without asking again.
    stats.current_tier_list(RANKED, EMERALD).await.unwrap();
    assert_eq!(requests(&server).len(), 2);
}

#[tokio::test]
async fn answers_offline_from_disk() {
    let (base, server) = fake_backend().await;
    publish(&server, "16.19", 1_000, "16.19", &[("16.19", 1_000)]);
    let dir = tempfile::tempdir().unwrap();
    let online = stats_client(&base, dir.path());
    let page = online
        .champion_page(MALPHITE, RANKED, EMERALD)
        .await
        .unwrap();
    assert!(page.stats.is_some() && page.builds.is_some() && page.matchups.is_some());

    // Offline, after a restart: everything seen before still answers.
    let offline = stats_client(&dead_backend().await, dir.path());
    assert_eq!(
        offline
            .champion_page(MALPHITE, RANKED, EMERALD)
            .await
            .unwrap(),
        page
    );
    assert!(offline.current_tier_list(RANKED, EMERALD).await.is_ok());
    // What was never downloaded can't be answered.
    assert!(matches!(
        offline.champion_page(ORNN, RANKED, EMERALD).await,
        Err(BackendError::Network { .. })
    ));
    // Nothing cached at all: no index.
    let empty = tempfile::tempdir().unwrap();
    let nothing = stats_client(&dead_backend().await, empty.path());
    assert!(matches!(
        nothing.index().await,
        Err(BackendError::Network { .. })
    ));
}

#[tokio::test]
async fn keeps_two_patches_and_falls_back_to_the_previous_one() {
    let (base, server) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());
    publish(&server, "16.18", 1_000, "16.18", &[("16.18", 1_000)]);
    stats.current_tier_list(RANKED, EMERALD).await.unwrap();
    publish(
        &server,
        "16.19",
        2_000,
        "16.19",
        &[("16.19", 2_000), ("16.18", 1_000)],
    );
    stats.refresh_index().await.unwrap();
    stats.current_tier_list(RANKED, EMERALD).await.unwrap();
    let v1 = dir.path().join("v1");
    assert!(v1.join("16.18").exists() && v1.join("16.19").exists());

    // 16.20 becomes current: 16.18 goes, 16.19 (the previous patch) stays.
    publish(
        &server,
        "16.20",
        3_000,
        "16.20",
        &[("16.20", 3_000), ("16.19", 2_000), ("16.18", 1_000)],
    );
    stats.refresh_index().await.unwrap();
    assert!(!v1.join("16.18").exists(), "older patches are pruned");
    assert!(v1.join("16.19").exists());

    // Offline before 16.20's files were downloaded: 16.19's copy stands in.
    let offline = stats_client(&dead_backend().await, dir.path());
    let list = offline.current_tier_list(RANKED, EMERALD).await.unwrap();
    assert_eq!(list.info.patch, "16.19");
}

#[tokio::test]
async fn the_previous_patch_tier_list_for_trends() {
    let (base, server) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());
    // One patch: nothing to compare with.
    publish(&server, "16.18", 1_000, "16.18", &[("16.18", 1_000)]);
    assert_eq!(
        stats.previous_tier_list(RANKED, EMERALD).await.unwrap(),
        None
    );

    publish(
        &server,
        "16.19",
        2_000,
        "16.19",
        &[("16.19", 2_000), ("16.18", 1_000)],
    );
    stats.refresh_index().await.unwrap();
    let previous = stats
        .previous_tier_list(RANKED, EMERALD)
        .await
        .unwrap()
        .expect("16.18's list");
    assert_eq!(previous.info.patch, "16.18");
    let current = stats.current_tier_list(RANKED, EMERALD).await.unwrap();
    assert_eq!(current.info.patch, "16.19");

    // Offline, from the disk cache like the current patch's files.
    let offline = stats_client(&dead_backend().await, dir.path());
    let cached = offline.previous_tier_list(RANKED, EMERALD).await.unwrap();
    assert_eq!(cached.map(|l| l.info.patch), Some("16.18".to_owned()));
}

#[tokio::test]
async fn one_request_per_file_at_a_time() {
    let (base, server) = fake_backend().await;
    publish(&server, "16.19", 1_000, "16.19", &[("16.19", 1_000)]);
    server
        .lock()
        .unwrap()
        .slow
        .push("16.19/420/emeraldPlus/tierlist.json".to_owned());
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());
    let calls: Vec<_> = (0..6)
        .map(|_| {
            let stats = stats.clone();
            tokio::spawn(async move { stats.current_tier_list(RANKED, EMERALD).await })
        })
        .collect();
    for call in calls {
        assert!(call.await.unwrap().is_ok());
    }
    assert_eq!(
        paths(&server),
        ["index", "16.19/420/emeraldPlus/tierlist.json"]
    );
}

#[tokio::test]
async fn champion_pages_leave_missing_parts_empty() {
    let (base, server) = fake_backend().await;
    publish(&server, "16.19", 1_000, "16.19", &[("16.19", 1_000)]);
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());

    let page = stats
        .champion_page(MALPHITE, RANKED, EMERALD)
        .await
        .unwrap();
    assert_eq!(page.info.patch, "16.19");
    assert_eq!(page.stats.as_ref().map(|s| s.id), Some(MALPHITE));
    assert_eq!(page.tiers.len(), 1);
    assert_eq!(page.builds.as_ref().map(|b| b.id), Some(MALPHITE));
    assert_eq!(page.matchups.as_ref().map(|m| m.id), Some(MALPHITE));

    // Shen: no builds or matchups published → empty parts; best role first.
    let shen = stats.champion_page(SHEN, RANKED, EMERALD).await.unwrap();
    assert!(shen.builds.is_none() && shen.matchups.is_none());
    assert_eq!(shen.tiers.len(), 2);
    assert!(shen.tiers[0].score >= shen.tiers[1].score);
    // Asked again: the misses are remembered for this publication.
    forget_requests(&server);
    stats.champion_page(SHEN, RANKED, EMERALD).await.unwrap();
    assert!(paths(&server).is_empty(), "{:?}", paths(&server));

    // A champion without games: no builds/matchups requests at all.
    stats.champion_page(999, RANKED, EMERALD).await.unwrap();
    assert!(paths(&server).is_empty());

    // ARAM: only the tier list is published here, and matchups are never asked for.
    let aram = stats.champion_page(MALPHITE, ARAM, EMERALD).await.unwrap();
    assert_eq!(aram.info.queue, ARAM);
    assert!(aram.stats.is_none() && aram.matchups.is_none());
    assert!(
        !paths(&server)
            .iter()
            .any(|p| p.contains("450/emeraldPlus/matchups"))
    );

    // Data sets that aren't published.
    assert_eq!(
        stats
            .champion_page(MALPHITE, RANKED, Bracket::MasterPlus)
            .await
            .unwrap_err(),
        BackendError::NotFound
    );
    assert_eq!(
        stats.current_tier_list(440, EMERALD).await.unwrap_err(),
        BackendError::NotFound
    );
    server.lock().unwrap().files.retain(|k, _| k == "index");
    let empty = tempfile::tempdir().unwrap();
    let fresh = stats_client(&base, empty.path());
    assert_eq!(
        fresh
            .champion_page(MALPHITE, RANKED, EMERALD)
            .await
            .unwrap_err(),
        BackendError::NotFound,
        "listed but gone"
    );
}

#[tokio::test]
async fn a_rate_limit_pauses_requests() {
    let (base, server) = fake_backend().await;
    publish(&server, "16.19", 1_000, "16.19", &[("16.19", 1_000)]);
    server
        .lock()
        .unwrap()
        .limited
        .push("16.19/420/emeraldPlus/tierlist.json".to_owned());
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());
    assert_eq!(
        stats.current_tier_list(RANKED, EMERALD).await.unwrap_err(),
        BackendError::RateLimited {
            retry_after: Some(7)
        }
    );
    forget_requests(&server);
    // Paused: nothing is sent, the wait is passed on.
    assert!(matches!(
        stats.champion_page(MALPHITE, RANKED, EMERALD).await,
        Err(BackendError::RateLimited {
            retry_after: Some(1..=7)
        })
    ));
    assert!(paths(&server).is_empty());
}

#[tokio::test]
async fn nothing_published_means_no_index() {
    let (base, _server) = fake_backend().await;
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());
    assert_eq!(stats.index().await.unwrap_err(), BackendError::NotFound);
    assert!(stats.cached_index().is_none());
}

// ── The draft helper, end to end ───────────────────────────────────────────────────────────

fn config_for(mock: &MockLcu) -> ConnectorConfig {
    let lockfile = mock.lockfile();
    ConnectorConfig {
        discover: Box::new(move || {
            lcu::Lockfile::parse(&lockfile)
                .ok()
                .map(|l| l.credentials())
        }),
        tls: pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
        paths: vec![],
        poll_interval: Duration::from_millis(50),
        startup_grace: Duration::from_secs(1),
    }
}

/// You (top) hover `hover`; Lee Sin and Ahri are locked, Thresh hovered; the enemy has
/// `enemies` locked.
fn session(hover: u32, enemies: &[u32]) -> serde_json::Value {
    let their: Vec<_> = (0..5)
        .map(|i| json!({ "cellId": 5 + i, "championId": enemies.get(i).copied().unwrap_or(0) }))
        .collect();
    json!({
        "localPlayerCellId": 0,
        "myTeam": [
            { "cellId": 0, "assignedPosition": "top", "championId": 0, "championPickIntent": hover },
            { "cellId": 1, "assignedPosition": "jungle", "championId": LEE_SIN },
            { "cellId": 2, "assignedPosition": "middle", "championId": AHRI },
            { "cellId": 3, "assignedPosition": "bottom", "championId": 0 },
            { "cellId": 4, "assignedPosition": "utility", "championId": 0, "championPickIntent": THRESH }
        ],
        "theirTeam": their,
        "actions": [[{ "actorCellId": 0, "isInProgress": true, "type": "pick" }]],
        "bans": { "myTeamBans": [], "theirTeamBans": [] },
        "timer": { "phase": "BAN_PICK", "adjustedTimeLeftInPhase": 25_000 }
    })
}

/// The local player's own data in their client: mastery, recent games, what they can pick.
fn local_player(mock: &MockLcu) {
    mock.set(
        companion::draft::MASTERY,
        json!([
            { "championId": YUUMI, "championLevel": 9, "championPoints": 900_000 },
            { "championId": ORNN, "championLevel": 7, "championPoints": 250_000 },
            { "championId": MALPHITE, "championLevel": 5, "championPoints": 40_000 }
        ]),
    );
    mock.set(
        companion::draft::PICKABLE,
        json!([MALPHITE, ORNN, SHEN, IRELIA, YUUMI, THRESH, AHRI, LEE_SIN]),
    );
    mock.set(
        "/lol-match-history/v1/products/lol/current-summoner/matches",
        json!({ "games": { "games": [
            { "gameId": 1, "queueId": 420, "gameCreation": 1,
              "participants": [{ "championId": SHEN, "stats": { "win": true }, "timeline": { "lane": "TOP" } }] },
            { "gameId": 2, "queueId": 420, "gameCreation": 2,
              "participants": [{ "championId": SHEN, "stats": { "win": false }, "timeline": { "lane": "TOP" } }] }
        ] } }),
    );
}

/// A core reading `stats`, connected to `mock` (event subscriptions in place).
async fn core_with(mock: &MockLcu, stats: StatsClient) -> Companion {
    core_following(mock, stats, watch::channel(RemoteConfig::default()).1).await
}

/// [`core_with`], following the server's `remote` config.
async fn core_following(
    mock: &MockLcu,
    stats: StatsClient,
    remote: watch::Receiver<RemoteConfig>,
) -> Companion {
    let (_settings, settings_rx) = watch::channel(quiet_settings());
    core_for(mock, stats, remote, settings_rx).await
}

/// Settings that never move the window (tests run headless).
fn quiet_settings() -> Settings {
    Settings {
        auto_switch_view: false,
        bring_to_front_on_champ_select: false,
        ..Settings::default()
    }
}

/// [`core_following`], with the player's `settings`.
async fn core_for(
    mock: &MockLcu,
    stats: StatsClient,
    remote: watch::Receiver<RemoteConfig>,
    settings_rx: watch::Receiver<Settings>,
) -> Companion {
    let core = companion::start_with_services(
        config_for(mock),
        settings_rx,
        companion::Services {
            remote,
            stats: Some(stats),
            ..companion::Services::default()
        },
    );
    let mut client = core.status.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        client.wait_for(|s| s.connection == ClientConnection::Connected),
    )
    .await
    .unwrap()
    .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    core
}

/// The first draft view that is `ready`.
async fn draft_where(core: &Companion, ready: impl Fn(&DraftView) -> bool) -> DraftView {
    let mut draft = core.draft.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        draft.wait_for(|d| d.as_ref().is_some_and(&ready)),
    )
    .await
    .unwrap()
    .unwrap()
    .clone()
    .unwrap()
}

#[tokio::test]
async fn the_draft_helper_flag_takes_the_numbers_away_at_once() {
    let (base, server) = fake_backend().await;
    publish(&server, "16.19", 1_000, "16.19", &[("16.19", 1_000)]);
    let dir = tempfile::tempdir().unwrap();
    let mock = MockLcu::start().await.unwrap();
    local_player(&mock);
    let (remote_tx, remote_rx) = watch::channel(RemoteConfig::default());
    let core = core_following(&mock, stats_client(&base, dir.path()), remote_rx).await;
    mock.set(companion::champ_select::SESSION, session(0, &[]));
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    draft_where(&core, |v| v.data.is_some() && !v.suggestions.is_empty()).await;

    // Turned off by the server in the middle of the champion select: the teams stay.
    remote_tx.send_modify(|config| config.features.draft_helper = false);
    let teams = draft_where(&core, |v| v.data.is_none()).await;
    assert!(teams.suggestions.is_empty() && teams.team.is_none());
    assert_eq!(teams.allies.len(), 5);

    // And back.
    remote_tx.send_modify(|config| config.features.draft_helper = true);
    draft_where(&core, |v| v.data.is_some() && !v.suggestions.is_empty()).await;
}

#[tokio::test]
async fn champion_select_gets_pool_first_suggestions() {
    let (base, server) = fake_backend().await;
    publish(&server, "16.19", 1_000, "16.19", &[("16.19", 1_000)]);
    let dir = tempfile::tempdir().unwrap();
    let mock = MockLcu::start().await.unwrap();
    local_player(&mock);
    let core = core_with(&mock, stats_client(&base, dir.path())).await;

    mock.set(companion::champ_select::SESSION, session(0, &[]));
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    let blind = draft_where(&core, |v| {
        v.data.is_some() && v.suggestions.iter().any(|s| s.mine.is_some())
    })
    .await;
    let data = blind.data.clone().unwrap();
    assert_eq!(
        (data.bracket.as_str(), data.patch.as_str()),
        ("Emerald+", "26.19")
    );
    assert!(blind.team.is_some());
    let picks: Vec<u32> = blind.suggestions.iter().map(|s| s.champion_id).collect();
    assert!(picks.contains(&ORNN) && picks.contains(&MALPHITE) && picks.contains(&SHEN));
    assert!(!picks.contains(&CAMILLE), "not pickable: {picks:?}");
    assert!(!picks.contains(&YUUMI), "not a top laner: {picks:?}");
    let shen = blind
        .suggestions
        .iter()
        .find(|s| s.champion_id == SHEN)
        .unwrap();
    assert_eq!(shen.mine.map(|m| (m.games, m.wins)), Some((2, 1)));
    let ornn = blind
        .suggestions
        .iter()
        .find(|s| s.champion_id == ORNN)
        .unwrap();
    assert_eq!(ornn.mastery.map(|m| m.level), Some(7));

    // Irelia locks top: the lane matchups are loaded and explain the ranking.
    mock.set(
        companion::champ_select::SESSION,
        session(MALPHITE, &[IRELIA]),
    );
    let view = draft_where(&core, |v| {
        v.suggestions.first().is_some_and(|s| {
            s.reasons
                .iter()
                .any(|r| r.kind == ReasonKind::Lane && r.champion_id == Some(IRELIA))
        })
    })
    .await;
    assert_eq!(view.suggestions[0].champion_id, MALPHITE);
    assert_eq!(view.enemies[0].role, Some(Role::Top));
    assert!(view.enemies[0].role_odds[0].probability > 0.85);
    assert_eq!(
        view.allies[0].champion_id,
        Some(MALPHITE),
        "the teams stay as mapped"
    );
    let fetched = paths(&server);
    for file in [
        "16.19/420/emeraldPlus/champions.json",
        "16.19/420/emeraldPlus/tierlist.json",
        "16.19/420/emeraldPlus/matchups/54.json",
        "16.19/420/emeraldPlus/matchups/39.json",
    ] {
        assert_eq!(
            fetched.iter().filter(|p| *p == file).count(),
            1,
            "{file} once: {fetched:?}"
        );
    }

    // Champion select ends: the view goes away.
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    let mut draft = core.draft.clone();
    tokio::time::timeout(Duration::from_secs(5), draft.wait_for(Option::is_none))
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn without_stats_the_draft_still_shows_the_teams() {
    let mock = MockLcu::start().await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    let offline = stats_client(&dead_backend().await, dir.path());
    let core = core_with(&mock, offline).await;
    mock.set(
        companion::champ_select::SESSION,
        session(MALPHITE, &[IRELIA]),
    );
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    let view = draft_where(&core, |_| true).await;
    assert_eq!(view.enemies[0].champion_id, Some(IRELIA));
    // Give the (failing) stats load time to come back: still teams only.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let view = core.draft.borrow().clone().unwrap();
    assert!(view.suggestions.is_empty() && view.data.is_none() && view.team.is_none());
    assert_eq!(view.allies[0].champion_id, Some(MALPHITE));
}

// ── Compositions, the stats bracket, ARAM ──────────────────────────────────────────────────

/// A compositions file: every champion of `rows` in its first role (none in ARAM), over 4,000
/// games with an even record, and each role's usual pick.
fn compositions_file(info: &DataSetInfo, rows: Rows<'_>, aram: bool) -> CompositionsFile {
    let stats = |id: u32, role: Option<Role>| CompositionStats {
        id,
        role,
        n: 4_000,
        dmg: [300.0 + f64::from(id % 7) * 50.0, 300.0, 30.0],
        front: if id == 0 {
            0.2
        } else {
            0.15 + f64::from(id % 5) * 0.03
        },
        cc: 20.0,
        len: if id == 0 {
            vec![]
        } else {
            vec![(1_000, 500), (2_000, 1_000), (1_000, 500)]
        },
    };
    let roles = if aram {
        vec![None]
    } else {
        [
            Role::Top,
            Role::Jungle,
            Role::Middle,
            Role::Bottom,
            Role::Support,
        ]
        .map(Some)
        .to_vec()
    };
    CompositionsFile {
        info: info.clone(),
        lengths: if aram { vec![17, 22] } else { vec![25, 35] },
        roles: roles.into_iter().map(|role| stats(0, role)).collect(),
        champions: rows
            .iter()
            .map(|(id, roles)| {
                let role = if aram {
                    None
                } else {
                    roles.first().map(|r| r.0)
                };
                stats(*id, role)
            })
            .collect(),
    }
}

const LUX: u32 = 99;
const JINX: u32 = 222;
const BRAND: u32 = 63;
const SION: u32 = 14;

/// ARAM champions: their rows carry no role.
fn aram_rows() -> Rows<'static> {
    &[
        (LUX, &[]),
        (JINX, &[]),
        (MALPHITE, &[]),
        (THRESH, &[]),
        (AHRI, &[]),
        (BRAND, &[]),
        (SION, &[]),
    ]
}

fn aram_champions(info: &DataSetInfo) -> ChampionsFile {
    let rates = [0.52, 0.5, 0.55, 0.51, 0.5, 0.54, 0.49];
    ChampionsFile {
        info: info.clone(),
        champions: aram_rows()
            .iter()
            .zip(rates)
            .map(|(&(id, _), rate)| ChampionStats {
                id,
                g: 20_000,
                w: wins(20_000, rate),
                bans: 0,
                roles: vec![ChampionRoleStats {
                    role: None,
                    g: 20_000,
                    w: wins(20_000, rate),
                    prev: None,
                }],
            })
            .collect(),
        priors: vec![],
    }
}

/// Ranked at Emerald+ (with compositions) and Diamond+, and ARAM at Emerald+ (with
/// compositions), for patch 16.19.
fn publish_every_set(server: &Server) {
    let mut s = server.lock().unwrap();
    let mut sets = Vec::new();
    for (queue, bracket) in [
        (RANKED, EMERALD),
        (RANKED, Bracket::DiamondPlus),
        (ARAM, EMERALD),
    ] {
        let info = DataSetInfo {
            bracket,
            games: if bracket == EMERALD { 120_000 } else { 30_000 },
            ..info("16.19", queue, 1_000)
        };
        let dir = format!("16.19/{queue}/{}", bracket.slug());
        let mut put = |file: &str, body: Vec<u8>| s.files.insert(format!("{dir}/{file}"), body);
        if queue == ARAM {
            put("champions.json", to_json(&aram_champions(&info)));
            let comps = compositions_file(&info, aram_rows(), true);
            put("compositions.json", to_json(&comps));
        } else {
            put("champions.json", to_json(&champions_file(&info, world())));
            put("tierlist.json", to_json(&tier_list(&info, world())));
            if bracket == EMERALD {
                let comps = compositions_file(&info, world(), false);
                put("compositions.json", to_json(&comps));
            }
        }
        sets.push(DataSetIndex {
            queue,
            bracket,
            games: info.games,
        });
    }
    let index = StatsIndex {
        schema: 1,
        current: Some("16.19".to_owned()),
        patches: vec![PatchIndex {
            patch: "16.19".to_owned(),
            name: "26.19".to_owned(),
            sets,
            updated_at: 1_000,
        }],
        updated_at: 1_000,
    };
    s.files.insert("index".to_owned(), to_json(&index));
}

fn bracket_is(view: &DraftView, label: &str) -> bool {
    view.data.as_ref().is_some_and(|d| d.bracket == label)
}

#[tokio::test]
async fn the_draft_follows_the_stats_bracket_at_once() {
    let (base, server) = fake_backend().await;
    publish_every_set(&server);
    let dir = tempfile::tempdir().unwrap();
    let mock = MockLcu::start().await.unwrap();
    local_player(&mock);
    let (settings_tx, settings_rx) = watch::channel(quiet_settings());
    let remote = watch::channel(RemoteConfig::default()).1;
    let stats = stats_client(&base, dir.path());
    let core = core_for(&mock, stats, remote, settings_rx).await;
    let hovering = session(MALPHITE, &[IRELIA]);
    mock.set(companion::champ_select::SESSION, hovering);
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));

    // Emerald+: the numbers and both teams' compositions, hovers shown as such.
    let view = draft_where(&core, |v| v.comps.is_some() && !v.suggestions.is_empty()).await;
    assert_eq!(view.queue, Some(RANKED));
    let data = view.data.clone().unwrap();
    assert_eq!((data.queue, data.bracket.as_str()), (RANKED, "Emerald+"));
    let comps = view.comps.unwrap();
    assert_eq!(comps.lengths, [25, 35]);
    let malphite = &comps.allies.members[0];
    assert!(malphite.champion_id == MALPHITE && malphite.hovering);
    assert_eq!(comps.enemies.counted, 1);
    assert!(view.suggestions.iter().all(|s| s.comp.is_some()));

    // The player picks Diamond+ in Settings: the draft switches in the middle of the champion
    // select (no compositions published there yet).
    settings_tx.send_modify(|s| s.stats_bracket = Bracket::DiamondPlus);
    let view = draft_where(&core, |v| bracket_is(v, "Diamond+")).await;
    assert_eq!(view.data.unwrap().games, 30_000);
    assert!(view.comps.is_none() && !view.suggestions.is_empty());

    // Master+ isn't published: Emerald+, which the data line says.
    settings_tx.send_modify(|s| s.stats_bracket = Bracket::MasterPlus);
    draft_where(&core, |v| bracket_is(v, "Emerald+")).await;
}

/// An ARAM champion select: you have Lux, Sion and Brand are on the bench, one reroll left.
fn aram_session() -> serde_json::Value {
    json!({
        "localPlayerCellId": 0,
        "myTeam": [
            { "cellId": 0, "assignedPosition": "", "championId": LUX },
            { "cellId": 1, "assignedPosition": "", "championId": JINX },
            { "cellId": 2, "assignedPosition": "", "championId": MALPHITE },
            { "cellId": 3, "assignedPosition": "", "championId": THRESH },
            { "cellId": 4, "assignedPosition": "", "championId": AHRI }
        ],
        "theirTeam": [],
        "actions": [],
        "benchEnabled": true,
        "benchChampions": [{ "championId": SION }, { "championId": BRAND }],
        "allowRerolling": true,
        "rerollsRemaining": 1,
        "timer": { "phase": "FINALIZATION", "adjustedTimeLeftInPhase": 50_000 }
    })
}

#[tokio::test]
async fn aram_ranks_your_champion_and_the_bench() {
    let (base, server) = fake_backend().await;
    publish_every_set(&server);
    let dir = tempfile::tempdir().unwrap();
    let mock = MockLcu::start().await.unwrap();
    local_player(&mock);
    let core = core_with(&mock, stats_client(&base, dir.path())).await;
    let game =
        json!({ "phase": "ChampSelect", "gameData": { "queue": { "id": 450, "mapId": 12 } } });
    mock.set(companion::imports::GAMEFLOW_SESSION, game);
    mock.set(companion::champ_select::SESSION, aram_session());
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    let view = draft_where(&core, |v| !v.suggestions.is_empty()).await;
    assert_eq!(view.queue, Some(ARAM));
    assert_eq!(view.data.as_ref().map(|d| d.queue), Some(ARAM));
    assert_eq!(view.bench, Some(vec![SION, BRAND]));
    assert_eq!(view.rerolls, Some(1));
    let order: Vec<u32> = view.suggestions.iter().map(|s| s.champion_id).collect();
    assert_eq!(order, [BRAND, LUX, SION]);
    assert!(
        view.suggestions[1].gain.abs() < 1e-9,
        "yours: the team as it is"
    );
    assert!(view.team.is_some());
    let comps = view.comps.unwrap();
    assert_eq!((comps.allies.counted, comps.enemies.counted), (5, 0));
    assert_eq!(comps.lengths, [17, 22]);
    let fetched = paths(&server);
    assert!(
        fetched
            .iter()
            .any(|p| p == "16.19/450/emeraldPlus/champions.json")
    );
    assert!(fetched.iter().all(|p| !p.contains("/420/")), "{fetched:?}");
}

// ── Against the real publisher ─────────────────────────────────────────────────────────────

/// Deterministic pseudo-random numbers (no extra dependency).
struct Lcg(u64);

impl Lcg {
    fn below(&mut self, n: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        usize::try_from((self.0 >> 33) % u64::try_from(n).unwrap()).unwrap()
    }
}

/// Publishes `games` synthetic ranked games of 16.19 with the crawler's pipeline
/// (`aggregate::publish`) into the fake backend: champion 1 beats champion 2 in the top lane.
fn publish_synthetic(server: &Server, games: usize, updated_at: i64) {
    let pools: [&[u16]; 5] = [&[1, 2, 3], &[11, 12], &[21, 22], &[31, 32], &[41, 42]];
    let mut rng = Lcg(7);
    let mut ds = aggregate::Dataset::default();
    for i in 0..games {
        let mut champions = [0u16; 10];
        for (role, pool) in pools.iter().enumerate() {
            let blue = pool[rng.below(pool.len())];
            let red = loop {
                let c = pool[rng.below(pool.len())];
                if c != blue {
                    break c;
                }
            };
            champions[role] = blue;
            champions[5 + role] = red;
        }
        let blue_wins_in_100 = match (champions[0], champions[5]) {
            (1, 2) => 70,
            (2, 1) => 30,
            _ => 50,
        };
        let blue_wins = rng.below(100) < blue_wins_in_100;
        let game = aggregate::synthetic::Game::ranked(&format!("EUW1_{i}"), champions, blue_wins);
        let facts = aggregate::extract(&game.match_json(), None).unwrap();
        ds.add(
            &facts,
            aggregate::SeedBracket::Emerald,
            &aggregate::ItemCatalog::default(),
        );
    }
    let opts = aggregate::publish::Options {
        min_role_games: 1,
        min_pair_games: 1,
        tier_min_pick_rate: 0.0,
        min_current_games: 1,
        ..aggregate::publish::Options::default()
    };
    let patch = "16.19".parse().unwrap();
    let (files, entry) = aggregate::publish::publish_patch(&ds, patch, &opts, updated_at).unwrap();
    let index =
        aggregate::publish::build_index(None, entry.into_iter().collect(), &opts, updated_at);
    let mut s = server.lock().unwrap();
    for file in files {
        s.files
            .insert(file.path.trim_start_matches("v1/").to_owned(), file.body);
    }
    s.files.insert("index".to_owned(), to_json(&index));
}

#[tokio::test]
async fn reads_what_the_publisher_writes() {
    let (base, server) = fake_backend().await;
    publish_synthetic(&server, 600, 5_000);
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());
    let page = stats.champion_page(1, RANKED, EMERALD).await.unwrap();
    assert_eq!(page.info.patch, "16.19");
    assert!(page.builds.is_some() && !page.tiers.is_empty());
    let top = page
        .matchups
        .as_ref()
        .and_then(|m| m.roles.iter().find(|r| r.role == Role::Top))
        .unwrap();
    let against_2 = top.lane.iter().find(|e| e.id == 2).unwrap();
    assert!(
        against_2.g > 100 && against_2.w * 10 > against_2.g * 6,
        "1 beats 2: {against_2:?}"
    );

    // Every published file carries its publication: after a restart only the index is asked.
    forget_requests(&server);
    let restarted = stats_client(&base, dir.path());
    restarted.refresh_index().await.unwrap();
    assert_eq!(
        restarted.champion_page(1, RANKED, EMERALD).await.unwrap(),
        page
    );
    assert_eq!(paths(&server), ["index"]);

    // The draft model over the published files: against 2, 1 is the pick, and says why.
    let set = restarted.data_set(RANKED, EMERALD).await.unwrap();
    let champions = restarted.champions(&set).await.unwrap().unwrap();
    let mut model = companion::stats::DraftStats::new(&champions);
    for id in [1, 2, 3] {
        if let Some(file) = restarted.matchups(&set, id).await.unwrap() {
            model.add_matchups(&file);
        }
    }
    let data = companion::draft::SessionData {
        info: domain::DataInfo {
            queue: RANKED,
            bracket: EMERALD.label().to_owned(),
            patch: set.name.clone(),
            games: set.games,
            updated_at: set.generation,
        },
        tiers: restarted.tier_list(&set).await.unwrap(),
        comps: restarted
            .compositions(&set)
            .await
            .unwrap()
            .map(|file| Arc::new(companion::stats::comp::CompStats::new(&file))),
        set,
    };
    let view = companion::champ_select::map_session(&json!({
        "localPlayerCellId": 0,
        "myTeam": [{ "cellId": 0, "assignedPosition": "top", "championId": 0 }],
        "theirTeam": [{ "cellId": 5, "championId": 2 }],
        "timer": { "phase": "BAN_PICK" }
    }))
    .unwrap();
    let e = companion::draft::enrich(&view, &model, &data, None);
    assert_eq!(e.enemies[0].0, Some(Role::Top));
    let first = &e.suggestions[0];
    assert_eq!(first.champion_id, 1, "{:?}", e.suggestions);
    let lane = first
        .reasons
        .iter()
        .find(|r| r.kind == ReasonKind::Lane)
        .unwrap();
    assert_eq!(lane.champion_id, Some(2));
    assert!(lane.games > 100, "{lane:?}");
}

// ── Your games' roles ──────────────────────────────────────────────────────────────────────

/// Your games' roles lean on this patch's published role shares: an Ahri the client calls TOP,
/// next to an Annie it calls MIDDLE, stays top on the built-in prior (both named lanes agree);
/// this patch's stats, where Annie plays top a third of the time, put Ahri back mid. Without a
/// backend, the prior.
#[tokio::test]
async fn your_games_roles_lean_on_the_published_stats() {
    use companion::matches::MatchInsights;
    use mock_lcu::history::{self, Game, Local};

    const ANNIE: u32 = 1;
    let (base, server) = fake_backend().await;
    publish(&server, "16.19", 1_000, "16.19", &[("16.19", 1_000)]);
    let ranked = info("16.19", RANKED, 1_000);
    let rows: Rows<'_> = &[
        (AHRI, &[(Role::Middle, 30_000, 0.5)]),
        (
            ANNIE,
            &[(Role::Middle, 7_000, 0.5), (Role::Top, 3_000, 0.5)],
        ),
    ];
    server.lock().unwrap().files.insert(
        "16.19/420/emeraldPlus/champions.json".to_owned(),
        to_json(&champions_file(&ranked, rows)),
    );

    let mock = MockLcu::start().await.unwrap();
    let me = Local {
        puuid: "local-puuid".into(),
        game_name: "Fillmo".into(),
        tag_line: "7272".into(),
        summoner_id: 42,
    };
    mock.set(
        companion::profile::CURRENT_SUMMONER,
        json!({ "gameName": "Fillmo", "tagLine": "7272", "puuid": "local-puuid", "summonerId": 42 }),
    );
    // Your team's mid laner in this game is the mock's Annie.
    let game = Game {
        game_id: 7_000_000_003,
        queue_id: RANKED,
        map_id: 11,
        created: 1_790_500_000_000,
        duration: 1800,
        champion: AHRI,
        lane: "TOP",
        spells: [14, 4],
        win: true,
    };
    history::serve(&mock, &me, std::slice::from_ref(&game));
    let credentials = lcu::Lockfile::parse(&mock.lockfile())
        .unwrap()
        .credentials();
    let lcu = lcu::LcuClient::new(
        &credentials,
        pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap();
    let ids = ["EUW1_7000000003".to_owned()];

    // The index read at startup, like the app does.
    let dir = tempfile::tempdir().unwrap();
    let stats = stats_client(&base, dir.path());
    stats.refresh_index().await.unwrap();
    let published = MatchInsights::new(Some(stats));
    published.profile(&lcu).await.unwrap();
    assert_eq!(
        published.grades(&lcu, &ids).await[0].role,
        Some(Role::Middle)
    );
    assert!(
        paths(&server).contains(&"16.19/420/emeraldPlus/champions.json".to_owned()),
        "{:?}",
        paths(&server)
    );

    // No index at hand (no server yet): the prior, without asking for one.
    let (idle_base, idle) = fake_backend().await;
    let offline = tempfile::tempdir().unwrap();
    let prior = MatchInsights::new(Some(stats_client(&idle_base, offline.path())));
    prior.profile(&lcu).await.unwrap();
    assert_eq!(prior.grades(&lcu, &ids).await[0].role, Some(Role::Top));
    assert!(paths(&idle).is_empty(), "{:?}", paths(&idle));
}
