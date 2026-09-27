//! Crawl → store → publish → served by the backend, against a local fake Riot API and Data
//! Dragon (synthetic games only, no network).
#![allow(clippy::unwrap_used, reason = "tests")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aggregate::synthetic::{Game, typical_build};
use axum::extract::{Path, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use domain::{BuildsFile, ChampionsFile, MatchupsFile, StatsIndex};
use mvp_crawler::publish::PublishConfig;
use mvp_crawler::{CrawlConfig, Store, crawl, publish};
use riot_api::limits::parse_limits;
use riot_api::{ApiKey, Config, Platform, RiotClient};
use serde_json::{Value, json};
use static_data::DataDragon;

// ---------------------------------------------------------------------------------------------
// Fake Riot API + Data Dragon

/// Every synthetic game by id.
fn games() -> HashMap<String, Game> {
    let blue = [1, 2, 3, 4, 5];
    let reds = [
        [11, 12, 13, 14, 15],
        [21, 12, 13, 14, 15],
        [11, 22, 13, 14, 25],
    ];
    let mut all = HashMap::new();
    for (i, id) in (100..=105).enumerate() {
        let mut champions = [0u16; 10];
        champions[..5].copy_from_slice(&blue);
        champions[5..].copy_from_slice(&reds[i % 3]);
        let g = Game::ranked(&format!("EUW1_{id}"), champions, i % 3 != 2);
        all.insert(g.id.clone(), g);
    }
    let mut remake = Game::ranked("EUW1_106", [1, 2, 3, 4, 5, 11, 12, 13, 14, 15], true);
    remake.duration = 200;
    let aram = Game::aram("EUW1_200", [31, 32, 33, 34, 35, 41, 42, 43, 44, 45], false);
    let mut old = Game::ranked("EUW1_099", [1, 2, 3, 4, 5, 11, 12, 13, 14, 15], false);
    "16.18.700.1".clone_into(&mut old.version);
    for g in [remake, aram, old] {
        all.insert(g.id.clone(), g);
    }
    all
}

/// (puuid, ranked ids, ARAM ids). e-1 and e-2 share two games.
fn history(puuid: &str) -> Option<(Vec<&'static str>, Vec<&'static str>)> {
    Some(match puuid {
        "e-1" => (vec!["EUW1_100", "EUW1_101", "EUW1_102"], vec!["EUW1_200"]),
        "e-2" => (vec!["EUW1_101", "EUW1_102", "EUW1_103", "EUW1_099"], vec![]),
        "d-1" => (vec!["EUW1_104"], vec![]),
        "m-1" => (vec!["EUW1_105", "EUW1_106"], vec![]),
        _ => return None,
    })
}

fn entry(puuid: &str, tier: &str) -> Value {
    json!({ "puuid": puuid, "queueType": "RANKED_SOLO_5x5", "tier": tier, "rank": "I",
            "leaguePoints": 50, "wins": 60, "losses": 50 })
}

/// A query parameter (the fake doesn't need decoding).
fn param(uri: &Uri, key: &str) -> Option<String> {
    uri.query()?.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| v.to_owned())
    })
}

async fn league_page(
    Path((_, tier, division)): Path<(String, String, String)>,
    uri: Uri,
) -> Json<Value> {
    let page = param(&uri, "page").unwrap_or_else(|| "1".to_owned());
    Json(match (tier.as_str(), division.as_str(), page.as_str()) {
        ("EMERALD", "I", "1") => json!([entry("e-1", "EMERALD"), entry("e-2", "EMERALD")]),
        ("DIAMOND", "II", "1") => json!([entry("d-1", "DIAMOND")]),
        _ => json!([]),
    })
}

async fn apex(Path((league, _)): Path<(String, String)>) -> Response {
    if league == "masterleagues" {
        Json(json!({ "tier": "MASTER", "entries": [entry("m-1", "MASTER")] })).into_response()
    } else {
        Json(json!({ "tier": "CHALLENGER", "entries": [] })).into_response()
    }
}

async fn match_ids(Path(puuid): Path<String>, uri: Uri) -> Response {
    let Some((ranked, aram)) = history(&puuid) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let ids = if param(&uri, "queue").as_deref() == Some("450") {
        aram
    } else {
        ranked
    };
    Json(ids).into_response()
}

async fn match_by_id(Path(id): Path<String>) -> Response {
    games().get(&id).map_or_else(
        || StatusCode::NOT_FOUND.into_response(),
        |g| Json(g.match_json()).into_response(),
    )
}

async fn timeline(Path(id): Path<String>) -> Response {
    games().get(&id).map_or_else(
        || StatusCode::NOT_FOUND.into_response(),
        |g| Json(g.timeline_json(&typical_build(1, &[3031, 3072, 6672, 3036]))).into_response(),
    )
}

fn items() -> Value {
    let legendary = |gold: u32| json!({ "gold": { "total": gold, "purchasable": true } });
    json!({ "data": {
        "3031": legendary(3450), "3072": legendary(3400), "6672": legendary(3000), "3036": legendary(3000),
        "1055": { "gold": { "total": 450, "purchasable": true } },
        "2003": { "tags": ["Consumable"], "gold": { "total": 50, "purchasable": true } },
        "3006": { "tags": ["Boots"], "gold": { "total": 1100, "purchasable": true } }
    }})
}

#[derive(Default)]
struct Calls(Mutex<Vec<String>>);

impl Calls {
    fn to(&self, part: &str) -> usize {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.contains(part))
            .count()
    }
}

async fn record(
    State(calls): State<Arc<Calls>>,
    uri: Uri,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    calls.0.lock().unwrap().push(uri.path().to_owned());
    next.run(req).await
}

async fn serve(router: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    base
}

async fn start_fake() -> (Arc<Calls>, String) {
    let calls = Arc::new(Calls::default());
    let router = Router::new()
        .route(
            "/lol/league/v4/entries/{queue}/{tier}/{division}",
            get(league_page),
        )
        .route("/lol/league/v4/{league}/by-queue/{queue}", get(apex))
        .route("/lol/match/v5/matches/by-puuid/{puuid}/ids", get(match_ids))
        .route("/lol/match/v5/matches/{id}", get(match_by_id))
        .route("/lol/match/v5/matches/{id}/timeline", get(timeline))
        .route(
            "/api/versions.json",
            get(|| async { Json(json!(["16.19.1", "16.18.1"])) }),
        )
        .route(
            "/cdn/16.19.1/data/en_US/item.json",
            get(|| async { Json(items()) }),
        )
        .layer(axum::middleware::from_fn_with_state(
            Arc::clone(&calls),
            record,
        ));
    (calls, serve(router).await)
}

fn client(base: &str) -> RiotClient {
    RiotClient::new(
        ApiKey::new("RGAPI-test"),
        Config {
            fixed_base_url: Some(base.to_owned()),
            default_app_limits: parse_limits("1000:1"),
            max_retry_wait: Duration::from_secs(5),
            ..Config::default()
        },
    )
    .unwrap()
}

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("mvp-crawler-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn crawls_publishes_and_serves() {
    let (calls, base) = start_fake().await;
    let riot = client(&base);
    let tmp = TempDir::new("e2e");
    let db = tmp.0.join("crawl.sqlite");
    let cfg = CrawlConfig {
        platform: Platform::Euw1,
        max_matches: 3,
        players_per_bracket: 10,
        ..CrawlConfig::default()
    };

    // A first, short run stops after 3 matches…
    let mut store = Store::open(&db).unwrap();
    let first = crawl(&riot, &mut store, &cfg).await.unwrap();
    assert_eq!(first.players_added, 4);
    assert_eq!(first.fetched, 3);
    drop(store);

    // …and the next one resumes from the saved state until every history is read.
    let mut store = Store::open(&db).unwrap();
    let cfg = CrawlConfig {
        max_matches: 100,
        ..cfg
    };
    let second = crawl(&riot, &mut store, &cfg).await.unwrap();
    assert!(second.exhausted);
    assert_eq!(second.players_added, 0, "ladder pages are not read twice");
    assert_eq!(
        first.fetched + second.fetched,
        9,
        "8 games + the shared ones once + a remake"
    );
    let counts = store.counts().unwrap();
    assert_eq!((counts.matches, counts.counted, counts.pending), (9, 8, 0));
    // Each shared game was downloaded once; the remake needed no timeline.
    assert_eq!(calls.to("/matches/EUW1_101"), 2, "match + timeline");
    assert_eq!(calls.to("/matches/EUW1_106"), 1);

    // Idempotent: another run fetches nothing new.
    let third = crawl(&riot, &mut store, &cfg).await.unwrap();
    assert_eq!((third.fetched, third.exhausted), (0, true));

    // Publish: newest two patches, items classified from (fake) Data Dragon.
    let stats_dir = tmp.0.join("stats");
    let dd = DataDragon::new(base.clone(), tmp.0.join("ddragon"), "en_US").unwrap();
    let pcfg = PublishConfig {
        stats_dir: stats_dir.clone(),
        patches: Vec::new(),
        options: aggregate::publish::Options {
            min_role_games: 1,
            min_pair_games: 1,
            min_current_games: 1,
            ..aggregate::publish::Options::default()
        },
    };
    let report = publish(&store, Some(&dd), &pcfg).await.unwrap();
    assert_eq!(report.patches, ["16.19", "16.18"]);
    assert_eq!(report.current.as_deref(), Some("16.19"));
    // Republishing replaces files in place.
    publish(&store, Some(&dd), &pcfg).await.unwrap();

    check_served(&stats_dir).await;
}

/// The published files, through the backend's stats routes.
async fn check_served(stats_dir: &std::path::Path) {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let backend = serve(mvp_backend::app(
        mvp_backend::AppState::with_stats(None, Some(stats_dir.to_path_buf())),
        &[],
    ))
    .await;
    let http = reqwest::Client::new();
    let get = |path: &str| http.get(format!("{backend}{path}")).send();

    let res = get("/v1/stats/index").await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    assert_eq!(res.headers()["cache-control"], "public, max-age=300");
    let etag = res.headers()["etag"].to_str().unwrap().to_owned();
    let index: StatsIndex = res.json().await.unwrap();
    assert_eq!(index.current.as_deref(), Some("16.19"));
    let p = &index.patches[0];
    assert_eq!((p.patch.as_str(), p.name.as_str()), ("16.19", "26.19"));
    let games: Vec<(u32, &str, u32)> = p
        .sets
        .iter()
        .map(|s| (s.queue, s.bracket.slug(), s.games))
        .collect();
    assert_eq!(
        games,
        [
            (420, "emeraldPlus", 6),
            (420, "diamondPlus", 2),
            (420, "masterPlus", 1),
            (450, "emeraldPlus", 1)
        ]
    );
    let not_modified = http
        .get(format!("{backend}/v1/stats/index"))
        .header("if-none-match", &etag)
        .send()
        .await
        .unwrap();
    assert_eq!(not_modified.status().as_u16(), 304);

    let champions: ChampionsFile = get("/v1/stats/16.19/420/emeraldPlus/champions.json")
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let top = champions.champions.iter().find(|c| c.id == 1).unwrap();
    assert_eq!((top.g, top.w), (6, 4));
    assert_eq!(
        top.roles[0].prev.map(|p| (p.g, p.w)),
        Some((1, 0)),
        "16.18 as the base prior"
    );

    let builds: BuildsFile = get("/v1/stats/16.19/420/emeraldPlus/builds/1.json")
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let b = &builds.roles[0];
    assert_eq!(b.core.top[0].ids, [3031, 3072, 6672]);
    assert_eq!(b.item4.top[0].ids, [3036]);
    assert_eq!(b.boots.top[0].ids, [3006]);
    assert_eq!(b.starts.top[0].ids, [1055, 2003]);
    assert_eq!(b.skills.top[0].ids, [1, 3, 2]);

    let res = get("/v1/stats/16.19/420/masterPlus/matchups/1.json")
        .await
        .unwrap();
    assert_eq!(res.headers()["cache-control"], "public, max-age=3600");
    let matchups: MatchupsFile = res.json().await.unwrap();
    assert_eq!(matchups.roles[0].lane[0].id, 11);

    let aram: ChampionsFile = get("/v1/stats/16.19/450/emeraldPlus/champions.json")
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(aram.info.games, 1);
    assert!(aram.priors.is_empty());

    for missing in [
        "/v1/stats/16.19/420/emeraldPlus/builds/999.json",
        "/v1/stats/16.19/420/..%2F..%2Fcrawl.sqlite",
        "/v1/stats/16.19/420/.staging-16.19/champions.json",
        "/v1/stats/16.19/450/emeraldPlus/matchups/31.json",
    ] {
        assert_eq!(
            get(missing).await.unwrap().status().as_u16(),
            404,
            "{missing}"
        );
    }
}
