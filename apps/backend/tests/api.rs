//! The service end to end against a local fake Riot API (no real network).
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use mvp_backend::{AppState, DEFAULT_ALLOWED_ORIGINS, app};
use riot_api::limits::parse_limits;
use riot_api::{ApiKey, Config, RiotClient};
use serde_json::{Value, json};

// ---------------------------------------------------------------------------------------------
// Fake Riot API

/// (champion id, teamPosition, win), newest game first.
type Game = (u32, &'static str, bool);

struct Player {
    puuid: &'static str,
    game_name: &'static str,
    tag_line: &'static str,
    wins: u32,
    losses: u32,
    games: Vec<Game>,
}

fn players() -> Vec<Player> {
    // 16 of 20 on Ahri (103) mid, newest 5 wins, 120 season games.
    let otp = (0..20)
        .map(|i| {
            (
                if i < 16 { 103 } else { 238 },
                "MIDDLE",
                i < 5 || i % 3 == 0,
            )
        })
        .collect();
    // Spread champions and roles, newest game lost, 40 season games.
    let flex = (0..20)
        .map(|i| {
            let role = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM"][i % 4];
            (u32::try_from(i % 5).unwrap() + 1, role, i % 2 == 1)
        })
        .collect();
    let night = (0..3).map(|i| (64, "JUNGLE", i != 1)).collect();
    vec![
        Player {
            puuid: "p-otp",
            game_name: "Foxfire",
            tag_line: "EUW",
            wins: 70,
            losses: 50,
            games: otp,
        },
        Player {
            puuid: "p-flex",
            game_name: "Allrounder",
            tag_line: "1234",
            wins: 20,
            losses: 20,
            games: flex,
        },
        Player {
            puuid: "p-night",
            game_name: "Nightfall",
            tag_line: "EUW",
            wins: 10,
            losses: 12,
            games: night,
        },
    ]
}

#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<String>>,
}

impl Fake {
    fn calls(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
    fn calls_to(&self, part: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.contains(part))
            .count()
    }
}

fn find(f: impl Fn(&Player) -> bool) -> Option<Player> {
    players().into_iter().find(|p| f(p))
}

fn account_json(p: &Player) -> Value {
    json!({ "puuid": p.puuid, "gameName": p.game_name, "tagLine": p.tag_line })
}

fn found(v: Option<Value>) -> Response {
    v.map_or_else(
        || StatusCode::NOT_FOUND.into_response(),
        |v| Json(v).into_response(),
    )
}

async fn by_riot_id(Path((name, tag)): Path<(String, String)>) -> Response {
    if name == "Busy" {
        return (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "30")]).into_response();
    }
    found(
        find(|p| p.game_name.eq_ignore_ascii_case(&name) && p.tag_line.eq_ignore_ascii_case(&tag))
            .map(|p| account_json(&p)),
    )
}

/// A PUUID of another API key (or the League client's): Riot can't decrypt it with ours and
/// answers 400.
fn undecryptable(puuid: &str) -> Option<Response> {
    let foreign = puuid.starts_with("other-key-");
    let client = puuid.len() == 36 && puuid.matches('-').count() == 4;
    (foreign || client).then(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "status": { "message": "Bad Request - Exception decrypting", "status_code": 400 } })),
        )
            .into_response()
    })
}

async fn by_puuid(Path(puuid): Path<String>) -> Response {
    if let Some(refused) = undecryptable(&puuid) {
        return refused;
    }
    found(find(|p| p.puuid == puuid).map(|p| account_json(&p)))
}

async fn summoner(Path(puuid): Path<String>) -> Response {
    found(
        find(|p| p.puuid == puuid)
            .map(|p| json!({ "puuid": p.puuid, "profileIconId": 4568, "summonerLevel": 312 })),
    )
}

async fn entries(Path(puuid): Path<String>) -> Response {
    if let Some(refused) = undecryptable(&puuid) {
        return refused;
    }
    found(find(|p| p.puuid == puuid).map(|p| {
        json!([{
            "queueType": "RANKED_SOLO_5x5", "tier": "EMERALD", "rank": "II", "leaguePoints": 42,
            "wins": p.wins, "losses": p.losses, "hotStreak": false
        }])
    }))
}

async fn match_ids(Path(puuid): Path<String>) -> Response {
    if let Some(refused) = undecryptable(&puuid) {
        return refused;
    }
    found(find(|p| p.puuid == puuid).map(|p| {
        (0..p.games.len())
            .map(|i| format!("EUW1_{}_{i}", p.puuid))
            .collect::<Vec<_>>()
            .into()
    }))
}

/// The whole game `EUW1_9000000001` (30 minutes, blue wins), in Match-V5's shape: every
/// participant's stats, names, spells and runes. Red's jungler plays in streamer mode (Riot
/// withholds the name).
fn full_game() -> Value {
    let positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
    let participants: Vec<Value> = (0..10_u32)
        .map(|i| {
            let blue = i < 5;
            let lane = usize::try_from(i % 5).unwrap();
            let name = if i == 6 {
                String::new()
            } else {
                format!("Player {i}")
            };
            json!({
                "puuid": format!("full-{i}"), "riotIdGameName": name, "riotIdTagline": "EUW",
                "teamId": if blue { 100 } else { 200 }, "win": blue,
                "teamPosition": positions[lane], "championId": 100 + i, "champLevel": 15,
                "kills": if i == 2 { 12 } else { 4 }, "deaths": if i == 2 { 1 } else { 5 },
                "assists": 7, "totalMinionsKilled": 170 + i, "neutralMinionsKilled": 8,
                "goldEarned": 11_000 + 100 * i, "totalDamageDealtToChampions": 15_000 + 1_000 * i,
                "totalDamageTaken": 20_000, "damageSelfMitigated": 7_000, "visionScore": 20 + i,
                "damageDealtToObjectives": 4_000, "summoner1Id": 4, "summoner2Id": 7,
                "item0": 3031, "item1": 3006, "item6": 3363,
                "challenges": { "kda": 3 },
                "perks": { "styles": [
                    { "style": 8000, "selections": [{ "perk": 8008 }, { "perk": 9111 }] },
                    { "style": 8100, "selections": [{ "perk": 8143 }] }
                ] }
            })
        })
        .collect();
    json!({
        "metadata": { "matchId": "EUW1_9000000001" },
        "info": { "gameDuration": 1800, "gameEndTimestamp": 1_790_000_000_000_i64, "queueId": 420,
                  "gameMode": "CLASSIC", "participants": participants }
    })
}

async fn match_by_id(Path(id): Path<String>) -> Response {
    if id == "EUW1_9000000001" {
        return Json(full_game()).into_response();
    }
    let game = id.strip_prefix("EUW1_").and_then(|rest| {
        let (puuid, i) = rest.rsplit_once('_')?;
        let i: usize = i.parse().ok()?;
        let p = find(|p| p.puuid == puuid)?;
        let &(champion, position, win) = p.games.get(i)?;
        let ended = 1_790_000_000_000_i64 - i64::try_from(i).ok()? * 3_600_000;
        Some(json!({
            "metadata": { "matchId": id, "participants": [puuid] },
            "info": {
                "gameDuration": 1800, "gameEndTimestamp": ended, "queueId": 420,
                "participants": [{
                    "puuid": puuid, "championId": champion, "teamPosition": position, "win": win,
                    "kills": 6, "deaths": 3, "assists": 9, "totalMinionsKilled": 190,
                    "neutralMinionsKilled": 10, "item0": 3157, "challenges": { "kda": 5 }
                }]
            }
        }))
    });
    found(game)
}

async fn record(
    State(fake): State<Arc<Fake>>,
    uri: Uri,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    fake.calls.lock().unwrap().push(uri.path().to_owned());
    next.run(req).await
}

async fn start_fake() -> (Arc<Fake>, String) {
    let fake = Arc::new(Fake::default());
    let router = Router::new()
        .route(
            "/riot/account/v1/accounts/by-riot-id/{name}/{tag}",
            get(by_riot_id),
        )
        .route("/riot/account/v1/accounts/by-puuid/{puuid}", get(by_puuid))
        .route("/lol/summoner/v4/summoners/by-puuid/{puuid}", get(summoner))
        .route("/lol/league/v4/entries/by-puuid/{puuid}", get(entries))
        .route("/lol/match/v5/matches/by-puuid/{puuid}/ids", get(match_ids))
        .route("/lol/match/v5/matches/{id}", get(match_by_id))
        .layer(axum::middleware::from_fn_with_state(
            Arc::clone(&fake),
            record,
        ));
    (fake, serve(router).await)
}

async fn serve(router: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    base
}

// ---------------------------------------------------------------------------------------------
// The service under test

struct Env {
    fake: Arc<Fake>,
    base: String,
    http: reqwest::Client,
}

fn http() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::new()
}

async fn start(with_key: bool) -> Env {
    let (fake, riot_base) = start_fake().await;
    let client = with_key.then(|| {
        RiotClient::new(
            ApiKey::new("RGAPI-test"),
            Config {
                fixed_base_url: Some(riot_base),
                default_app_limits: parse_limits("1000:1"),
                max_retry_wait: Duration::from_secs(5),
                ..Config::default()
            },
        )
        .unwrap()
    });
    let origins: Vec<String> = DEFAULT_ALLOWED_ORIGINS.map(str::to_owned).to_vec();
    let base = serve(app(AppState::new(client), &origins)).await;
    Env {
        fake,
        base,
        http: http(),
    }
}

impl Env {
    async fn get(&self, path: &str) -> (StatusCode, Value) {
        let res = self
            .http
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .unwrap();
        let status = StatusCode::from_u16(res.status().as_u16()).unwrap();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    async fn batch(&self, body: &Value) -> (StatusCode, Value) {
        let res = self
            .http
            .post(format!("{}/v1/players/batch", self.base))
            .json(body)
            .send()
            .await
            .unwrap();
        let status = StatusCode::from_u16(res.status().as_u16()).unwrap();
        (status, res.json().await.unwrap_or(Value::Null))
    }
}

// ---------------------------------------------------------------------------------------------
// Tests

#[tokio::test]
async fn health_reports_the_key() {
    let env = start(true).await;
    let (status, body) = env.get("/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["riotKey"], true);
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn profile_happy_path_then_cache_hit() {
    let env = start(true).await;
    let (status, body) = env.get("/v1/players/euw1/Nightfall/EUW").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["riotId"],
        json!({ "gameName": "Nightfall", "tagLine": "EUW" })
    );
    assert_eq!(body["region"], "EUW");
    assert_eq!(body["level"], 312);
    assert_eq!(body["soloQueue"]["tier"], "emerald");
    assert_eq!(body["soloQueue"]["division"], "II");
    let recent = body["recentMatches"].as_array().unwrap();
    assert_eq!(recent.len(), 3);
    assert_eq!(recent[0]["matchId"], "EUW1_p-night_0");
    assert_eq!(recent[0]["championId"], 64);
    assert_eq!(recent[1]["win"], false);

    // Same player again (Riot IDs are case-insensitive): served from cache.
    let calls = env.fake.calls();
    assert_eq!(calls, 7, "account, summoner, league, ids, 3 matches");
    let (status, again) = env.get("/v1/players/EUW1/nightfall/euw").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again, body);
    assert_eq!(env.fake.calls(), calls, "no upstream call on a cache hit");
}

#[tokio::test]
async fn profile_errors() {
    let env = start(true).await;

    let (status, body) = env.get("/v1/players/euw1/Nobody/000").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "notFound");

    let (status, body) = env.get("/v1/players/xx9/Nightfall/EUW").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "badPlatform");
    assert_eq!(
        env.fake.calls_to("Nightfall"),
        0,
        "rejected before any Riot call"
    );

    let res = env
        .http
        .get(format!("{}/v1/players/euw1/Busy/EUW", env.base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 429);
    assert_eq!(res.headers()["retry-after"], "30");
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["error"], "rateLimited");
    assert_eq!(body["retryAfter"], 30);

    let (status, body) = env.get("/v2/nothing").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "notFound");
}

#[tokio::test]
async fn missing_key_answers_503() {
    let env = start(false).await;
    let (status, body) = env.get("/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["riotKey"], false);

    let (status, body) = env.get("/v1/players/euw1/Nightfall/EUW").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "riotKeyMissing");

    for request in [
        json!({ "platform": "euw1", "puuids": ["p-otp"] }),
        json!({ "platform": "euw1", "players": [{ "gameName": "Foxfire", "tagLine": "EUW" }] }),
    ] {
        let (status, body) = env.batch(&request).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["error"], "riotKeyMissing");
    }
    assert_eq!(env.fake.calls(), 0);
}

#[tokio::test]
async fn batch_builds_cards_with_tags() {
    let env = start(true).await;
    let request = json!({ "platform": "euw1", "puuids": ["p-otp", "p-unknown", "p-flex"] });
    let (status, body) = env.batch(&request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let cards = body.as_array().unwrap();
    assert_eq!(cards.len(), 2, "unknown PUUIDs get no card");

    let otp = &cards[0];
    assert_eq!(otp["puuid"], "p-otp");
    assert_eq!(
        otp["riotId"],
        json!({ "gameName": "Foxfire", "tagLine": "EUW" })
    );
    assert_eq!(otp["soloQueue"]["wins"], 70);
    assert_eq!(otp["gamesSampled"], 20);
    assert_eq!(otp["topChampions"][0]["championId"], 103);
    assert_eq!(otp["topChampions"][0]["games"], 16);
    assert_eq!(otp["topChampions"][0]["kda"], 5.0);
    assert_eq!(otp["recentResults"].as_array().unwrap().len(), 10);
    assert_eq!(otp["mainRoles"], json!(["middle"]));
    assert_eq!(
        otp["tags"],
        json!([
            { "kind": "otp", "championId": 103, "share": 0.8 },
            { "kind": "mainRole", "role": "middle" },
            { "kind": "hotStreak", "wins": 5 },
            { "kind": "veteran", "games": 120 },
        ])
    );

    let flex = &cards[1];
    assert_eq!(flex["riotId"]["gameName"], "Allrounder");
    assert_eq!(flex["tags"], json!([]), "no tag below the thresholds");
    assert_eq!(flex["recentResults"][0], false);

    // The same lobby again: nothing goes to Riot. Unknown PUUIDs aren't cached, so leave it out.
    let calls = env.fake.calls();
    let (status, again) = env
        .batch(&json!({ "platform": "euw1", "puuids": ["p-otp", "p-flex"] }))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(&again, &body);
    assert_eq!(env.fake.calls(), calls, "cards come from the cache");
}

#[tokio::test]
async fn concurrent_batches_share_upstream_calls() {
    let env = start(true).await;
    let request = json!({ "platform": "euw1", "puuids": ["p-otp", "p-flex"] });
    let (a, b) = tokio::join!(env.batch(&request), env.batch(&request));
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(a, b);
    assert_eq!(env.fake.calls_to("/accounts/by-puuid/"), 2);
    assert_eq!(
        env.fake.calls_to("/matches/EUW1_"),
        40,
        "each match fetched once"
    );

    // A profile reuses the match documents the cards already fetched.
    let before = env.fake.calls_to("/matches/EUW1_");
    let (status, _) = env.get("/v1/players/euw1/Foxfire/EUW").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(env.fake.calls_to("/matches/EUW1_"), before);
}

#[tokio::test]
async fn batch_validation() {
    let env = start(true).await;
    let (status, body) = env
        .batch(&json!({ "platform": "moon1", "puuids": ["p-otp"] }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "badPlatform");

    let eleven: Vec<String> = (0..11).map(|i| format!("p-{i}")).collect();
    let (status, body) = env
        .batch(&json!({ "platform": "euw1", "puuids": eleven }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "badRequest");

    for bad in [
        json!({ "platform": "euw1", "puuids": [] }),
        json!({ "puuids": 3 }),
    ] {
        let (status, body) = env.batch(&bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(body["error"], "badRequest");
    }
    let (status, _) = env
        .batch(&json!({ "platform": "euw1", "puuids": ["../../etc"] }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Riot IDs: both parts, bounded, printable; 10 players at most across both lists.
    let riot_id = |name: &str, tag: &str| json!({ "gameName": name, "tagLine": tag });
    let six: Vec<Value> = (0..6)
        .map(|i| riot_id(&format!("Player{i}"), "EUW"))
        .collect();
    let five: Vec<String> = (0..5).map(|i| format!("p-{i}")).collect();
    for bad in [
        json!({ "platform": "euw1", "players": [riot_id("", "EUW")] }),
        json!({ "platform": "euw1", "players": [riot_id("Name", " ")] }),
        json!({ "platform": "euw1", "players": [riot_id("..", "EUW")] }),
        json!({ "platform": "euw1", "players": [riot_id("Bell\u{7}", "EUW")] }),
        json!({ "platform": "euw1", "players": [riot_id(&"W".repeat(65), "EUW")] }),
        json!({ "platform": "euw1", "players": [{ "gameName": "NoTag" }] }),
        json!({ "platform": "euw1", "players": six, "puuids": five }),
        json!({ "platform": "euw1", "players": [], "puuids": [] }),
    ] {
        let (status, body) = env.batch(&bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(body["error"], "badRequest", "{bad}");
    }
    assert_eq!(env.fake.calls(), 0);
}

#[tokio::test]
async fn batch_by_riot_id_resolves_each_player() {
    let env = start(true).await;
    let request = json!({ "platform": "euw1", "players": [
        { "gameName": "foxfire", "tagLine": "euw" },
        { "gameName": "Nobody", "tagLine": "000" },
        { "gameName": " Allrounder ", "tagLine": "1234" },
        { "gameName": "FOXFIRE", "tagLine": "EUW" },
    ] });
    let (status, body) = env.batch(&request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let cards = body.as_array().unwrap();
    assert_eq!(
        cards.len(),
        2,
        "nobody by that name: no card; repeats count once"
    );
    assert_eq!(
        cards[0]["riotId"],
        json!({ "gameName": "Foxfire", "tagLine": "EUW" }),
        "the account's own Riot ID, to match back case-insensitively"
    );
    assert_eq!(cards[0]["puuid"], "p-otp", "our key's PUUID");
    assert_eq!(cards[0]["tags"][0]["kind"], "otp");
    assert_eq!(cards[0]["gamesSampled"], 20);
    assert_eq!(cards[1]["riotId"]["gameName"], "Allrounder");
    assert_eq!(
        env.fake.calls_to("/accounts/by-riot-id/"),
        3,
        "one account-v1 lookup per distinct player"
    );
    assert_eq!(
        env.fake.calls_to("/accounts/by-puuid/"),
        0,
        "the Riot ID lookup already gave the account"
    );

    // The same lobby again: accounts (a day) and cards (2 min) come from the caches.
    let calls = env.fake.calls();
    let (status, again) = env
        .batch(&json!({ "platform": "euw1", "players": [
            { "gameName": "Foxfire", "tagLine": "EUW" },
            { "gameName": "Allrounder", "tagLine": "1234" },
        ] }))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again, body);
    assert_eq!(
        env.fake.calls(),
        calls,
        "no Riot call for a lobby seen before"
    );

    // A card built from a PUUID earlier is shared with the Riot ID path, and the other way.
    let (status, legacy) = env
        .batch(&json!({ "platform": "euw1", "puuids": ["p-otp"] }))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(legacy[0], body[0]);
    assert_eq!(env.fake.calls(), calls);
}

#[tokio::test]
async fn batch_answers_riot_ids_then_puuids() {
    let env = start(true).await;
    let (status, body) = env
        .batch(&json!({
            "platform": "euw1",
            "puuids": ["p-flex"],
            "players": [{ "gameName": "Nightfall", "tagLine": "EUW" }],
        }))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let names: Vec<&str> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["riotId"]["gameName"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Nightfall", "Allrounder"]);
}

#[tokio::test]
async fn unreadable_puuids_get_no_card_instead_of_failing_the_batch() {
    let env = start(true).await;
    let (status, body) = env
        .batch(&json!({ "platform": "euw1", "puuids": [
            // What apps up to 0.1.0 sent: the League client's PUUID (a UUID). Never readable
            // with our key, so it isn't even asked.
            "0f8e2a7c-1b2d-4c3e-9f10-aa11bb22cc33",
            // Another key's PUUID: Riot answers 400.
            "other-key-puuid",
            "p-flex",
        ] }))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let cards = body.as_array().unwrap();
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["puuid"], "p-flex");
    assert_eq!(
        env.fake.calls_to("0f8e2a7c"),
        0,
        "no Riot call for a client PUUID"
    );
    assert!(env.fake.calls_to("other-key-puuid") > 0);
}

#[tokio::test]
async fn cors_allows_the_app_origins_only() {
    let env = start(true).await;
    for origin in ["tauri://localhost", "http://tauri.localhost"] {
        let res = env
            .http
            .get(format!("{}/health", env.base))
            .header("Origin", origin)
            .send()
            .await
            .unwrap();
        assert_eq!(res.headers()["access-control-allow-origin"], origin);
    }

    let preflight = env
        .http
        .request(
            reqwest::Method::OPTIONS,
            format!("{}/v1/players/batch", env.base),
        )
        .header("Origin", "https://tauri.localhost")
        .header("Access-Control-Request-Method", "POST")
        .header("Access-Control-Request-Headers", "content-type")
        .send()
        .await
        .unwrap();
    assert!(preflight.status().is_success());
    assert_eq!(
        preflight.headers()["access-control-allow-origin"],
        "https://tauri.localhost"
    );
    let methods = preflight.headers()["access-control-allow-methods"]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(methods.contains("POST"), "{methods}");

    let foreign = env
        .http
        .get(format!("{}/health", env.base))
        .header("Origin", "https://evil.example")
        .send()
        .await
        .unwrap();
    assert!(
        foreign
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );
}

#[tokio::test]
async fn match_details_come_from_the_match_cache() {
    let env = start(true).await;
    let (status, body) = env.get("/v1/matches/euw1/EUW1_9000000001").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["matchId"], "EUW1_9000000001");
    assert_eq!(body["durationSeconds"], 1800);
    let teams = body["teams"].as_array().unwrap();
    assert_eq!(teams.len(), 2);
    assert_eq!(
        (teams[0]["teamId"].as_u64(), teams[0]["win"].as_bool()),
        (Some(100), Some(true))
    );
    let mid = &teams[0]["players"][2];
    assert_eq!(
        mid["riotId"],
        json!({ "gameName": "Player 2", "tagLine": "EUW" })
    );
    assert_eq!(mid["grade"]["badge"], "mvp");
    assert_eq!(mid["items"], json!([3031, 3006]));
    assert_eq!(mid["trinket"], 3363);
    assert_eq!(
        (mid["keystone"].as_u64(), mid["secondaryTree"].as_u64()),
        (Some(8008), Some(8100))
    );
    assert!(mid.get("puuid").is_none(), "no PUUIDs go out");
    // Riot withheld the name: it stays hidden.
    let jungler = &teams[1]["players"][1];
    assert_eq!(jungler["riotId"], Value::Null);
    assert_eq!(jungler["hidden"], true);
    let graded = teams
        .iter()
        .flat_map(|t| t["players"].as_array().unwrap())
        .filter(|p| p["grade"]["letter"].is_string())
        .count();
    assert_eq!(graded, 10);

    // Finished games never change: the second look is the cache's, whatever the id's case.
    let calls = env.fake.calls();
    let (status, again) = env.get("/v1/matches/EUW1/euw1_9000000001").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again, body);
    assert_eq!(env.fake.calls(), calls);
}

#[tokio::test]
async fn match_details_validate_before_asking_riot() {
    let env = start(true).await;
    for (path, error) in [
        ("/v1/matches/xx9/EUW1_9000000001", "badPlatform"),
        ("/v1/matches/euw1/NA1_9000000001", "badRequest"),
        ("/v1/matches/euw1/EUW1_", "badRequest"),
        ("/v1/matches/euw1/EUW1_12ab", "badRequest"),
        ("/v1/matches/euw1/9000000001", "badRequest"),
    ] {
        let (status, body) = env.get(path).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body["error"], error, "{path}");
    }
    assert_eq!(env.fake.calls(), 0);

    let (status, body) = env.get("/v1/matches/euw1/EUW1_1234").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "notFound");

    let keyless = start(false).await;
    let (status, body) = keyless.get("/v1/matches/euw1/EUW1_9000000001").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "riotKeyMissing");
}
