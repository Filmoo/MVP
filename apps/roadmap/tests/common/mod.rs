//! The service in process (tower's `oneshot`), with a fake GitHub on a local port and a clock
//! moved by hand.
#![allow(clippy::unwrap_used, dead_code, reason = "test helpers")]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use http_body_util::BodyExt as _;
use mvp_roadmap::model::Actor;
use mvp_roadmap::seed::SeedFile;
use mvp_roadmap::{
    AppState, GitHub, GitHubConfig, Keys, ManualClock, Parts, Secret, Settings, Store, Web, crypto,
    router,
};
use serde_json::{Value, json};
use tower::ServiceExt as _;

pub const PUBLIC_URL: &str = "https://dev.mvpgg.com";
pub const SESSION_KEY: [u8; 32] = [42; 32];
/// 2026-09-29 12:00 UTC.
pub const T0: i64 = 1_790_683_200;

/// A small roadmap: two versions, two areas, four features (one of them Claude's proposal).
pub const SEED: &str = r#"{
  "areas": [
    { "key": "draft", "name": "Draft", "color": "rank-diamond" },
    { "key": "live", "name": "Live", "color": "rank-platinum" }
  ],
  "versions": [
    { "name": "0.3", "goal": "This batch", "releasedOn": null },
    { "name": "0.4", "goal": "Next" }
  ],
  "features": [
    { "key": "a", "title": "Settings search", "description": "Find settings.", "version": "0.3", "status": "done", "area": "draft", "proposedBy": "owner", "links": [{ "url": "https://github.com/Filmoo/MVP/commit/143afc9", "label": "143afc9" }] },
    { "key": "b", "title": "Live names", "description": "From Spectator-V5.", "version": "0.3", "status": "in_progress", "area": "live", "proposedBy": "owner" },
    { "key": "c", "title": "Tier list trends", "description": "Arrows.", "version": "0.4", "status": "accepted", "area": "draft", "proposedBy": "owner" },
    { "key": "d", "title": "Uptime alerts", "description": "Know when the API is down.", "version": "0.4", "status": "proposed", "area": "live", "proposedBy": "claude" }
  ]
}"#;

/// What the fake GitHub knows: logins by code and token, their permission on the repository.
#[derive(Debug, Default)]
pub struct GitHubWorld {
    /// login → permission (`admin`, `write`, `read`; absent: not a collaborator, 403).
    pub permissions: HashMap<String, String>,
    /// code → the PKCE challenge the authorize URL carried.
    pub challenges: HashMap<String, String>,
    /// Codes already traded.
    pub used: Vec<String>,
    pub down: bool,
}

#[derive(Clone, Debug)]
pub struct FakeGitHub {
    pub url: String,
    pub world: Arc<Mutex<GitHubWorld>>,
}

impl FakeGitHub {
    pub async fn start() -> Self {
        let world = Arc::new(Mutex::new(GitHubWorld::default()));
        let app = Router::new()
            .route("/login/oauth/access_token", post(exchange))
            .route("/user", get(user))
            .route(
                "/repos/Filmoo/MVP/collaborators/{login}/permission",
                get(permission),
            )
            .with_state(Arc::clone(&world));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self { url, world }
    }

    pub fn set(&self, login: &str, permission: Option<&str>) {
        let mut world = self.world.lock().unwrap();
        match permission {
            Some(p) => world.permissions.insert(login.into(), p.into()),
            None => world.permissions.remove(login),
        };
    }

    pub fn down(&self, down: bool) {
        self.world.lock().unwrap().down = down;
    }
}

type World = Arc<Mutex<GitHubWorld>>;

fn token_of(headers: &HeaderMap) -> Option<String> {
    let value = headers.get("authorization")?.to_str().ok()?;
    value.strip_prefix("Bearer tok-").map(str::to_owned)
}

async fn exchange(State(world): State<World>, body: String) -> Response {
    let mut world = world.lock().unwrap();
    if world.down {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let form: HashMap<String, String> = form_urlencoded::parse(body.as_bytes())
        .into_owned()
        .collect();
    let code = form.get("code").cloned().unwrap_or_default();
    let verifier = form.get("code_verifier").cloned().unwrap_or_default();
    let expected = world.challenges.get(&code).cloned();
    let fine = form.get("client_secret").map(String::as_str) == Some("gh-secret")
        && form.get("redirect_uri").map(String::as_str)
            == Some("https://dev.mvpgg.com/auth/callback")
        && expected.is_some_and(|c| c == crypto::pkce_challenge(&verifier))
        && !world.used.contains(&code);
    if !fine {
        return axum::Json(json!({ "error": "bad_verification_code", "error_description": "The code passed is incorrect or expired." })).into_response();
    }
    world.used.push(code.clone());
    // `code-<login>.<n>`: a login has no dots.
    let login = code
        .trim_start_matches("code-")
        .split('.')
        .next()
        .unwrap_or_default();
    axum::Json(
        json!({ "access_token": format!("tok-{login}"), "token_type": "bearer", "scope": "" }),
    )
    .into_response()
}

async fn user(State(world): State<World>, headers: HeaderMap) -> Response {
    if world.lock().unwrap().down {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let Some(login) = token_of(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    axum::Json(json!({
        "login": login,
        "id": 1000 + login.len(),
        "name": format!("{login} (name)"),
        "avatar_url": format!("https://avatars.githubusercontent.com/u/{}", login.len()),
    }))
    .into_response()
}

async fn permission(
    State(world): State<World>,
    Path(login): Path<String>,
    headers: HeaderMap,
) -> Response {
    let world = world.lock().unwrap();
    if world.down {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    // The caller asks about themselves with their own token.
    if token_of(&headers).as_deref() != Some(login.as_str()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match world.permissions.get(&login) {
        Some(p) => axum::Json(json!({ "permission": p, "role_name": p })).into_response(),
        None => (
            StatusCode::FORBIDDEN,
            axum::Json(
                json!({ "message": "Must have push access to view repository collaborators." }),
            ),
        )
            .into_response(),
    }
}

/// An answer, read whole.
#[derive(Debug)]
pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub fn header(&self, name: &str) -> String {
        self.headers
            .get(name)
            .map(|v| v.to_str().unwrap().to_owned())
            .unwrap_or_default()
    }

    /// The `Set-Cookie` line for this cookie name.
    pub fn set_cookie(&self, name: &str) -> Option<String> {
        self.headers
            .get_all("set-cookie")
            .iter()
            .map(|v| v.to_str().unwrap().to_owned())
            .find(|line| line.starts_with(&format!("{name}=")))
    }

    pub fn cookie_value(&self, name: &str) -> Option<String> {
        let line = self.set_cookie(name)?;
        let value = line.split(';').next()?.split_once('=')?.1.to_owned();
        (!value.is_empty()).then_some(value)
    }
}

/// Who sends a request.
#[derive(Debug, Clone)]
pub enum Who {
    Nobody,
    /// A browser session: its cookie and CSRF token.
    Owner {
        cookie: String,
        csrf: String,
    },
    /// A machine token.
    Claude(String),
}

pub struct TestApp {
    pub router: Router,
    pub state: AppState,
    pub clock: Arc<ManualClock>,
    pub github: FakeGitHub,
    pub cookie_name: &'static str,
}

impl TestApp {
    /// The service as on the server (HTTPS public URL), seeded with `SEED`.
    pub async fn new() -> Self {
        Self::with(false, Some(SEED)).await
    }

    pub async fn with(dev_login: bool, seed: Option<&str>) -> Self {
        let github = FakeGitHub::start().await;
        let clock = Arc::new(ManualClock::new(T0));
        let mut store = Store::open_in_memory().unwrap();
        if let Some(seed) = seed {
            store
                .import_seed(&SeedFile::parse(seed).unwrap(), T0)
                .unwrap();
        }
        let public_url = if dev_login {
            "http://127.0.0.1:8790"
        } else {
            PUBLIC_URL
        };
        let settings = Settings::new(public_url, "Filmoo/MVP", dev_login, false).unwrap();
        let cookie_name = settings.session_cookie();
        let client = GitHub::new(GitHubConfig {
            client_id: "gh-client".into(),
            client_secret: Secret::new("gh-secret"),
            web_url: github.url.clone(),
            api_url: github.url.clone(),
            repo: "Filmoo/MVP".into(),
        })
        .unwrap();
        let state = AppState::new(Parts {
            store,
            settings,
            github: (!dev_login).then_some(client),
            keys: Keys::new(&SESSION_KEY),
            clock: clock.clone(),
            web: Web::Folder(std::env::temp_dir().join("mvp-roadmap-no-ui")),
            dev_seed: seed.map(str::to_owned),
        });
        Self {
            router: router(state.clone()),
            state,
            clock,
            github,
            cookie_name,
        }
    }

    pub async fn send(
        &self,
        method: Method,
        uri: &str,
        who: &Who,
        body: Option<Value>,
        extra: &[(&str, &str)],
    ) -> Reply {
        let mut request = Request::builder().method(method.clone()).uri(uri);
        match who {
            Who::Nobody => {}
            Who::Owner { cookie, csrf } => {
                request = request.header("cookie", format!("{}={cookie}", self.cookie_name));
                if method != Method::GET {
                    request = request.header("x-csrf-token", csrf.as_str());
                }
            }
            Who::Claude(token) => {
                request = request.header("authorization", format!("Bearer {token}"));
            }
        }
        for (name, value) in extra {
            request = request.header(*name, *value);
        }
        let body = match body {
            Some(json) => {
                request = request.header("content-type", "application/json");
                Body::from(json.to_string())
            }
            None => Body::empty(),
        };
        let response = self
            .router
            .clone()
            .oneshot(request.body(body).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec();
        Reply {
            status,
            headers,
            body,
        }
    }

    pub async fn get(&self, uri: &str, who: &Who) -> Reply {
        self.send(Method::GET, uri, who, None, &[]).await
    }

    pub async fn post(&self, uri: &str, who: &Who, body: Value) -> Reply {
        self.send(Method::POST, uri, who, Some(body), &[]).await
    }

    pub async fn patch(&self, uri: &str, who: &Who, body: Value) -> Reply {
        self.send(Method::PATCH, uri, who, Some(body), &[]).await
    }

    pub async fn delete(&self, uri: &str, who: &Who) -> Reply {
        self.send(Method::DELETE, uri, who, None, &[]).await
    }

    /// `/auth/login` → GitHub (the fake) → `/auth/callback`, as a browser would.
    /// Returns the callback's answer and the state cookie used.
    pub async fn github_round_trip(&self, login: &str) -> Reply {
        let start = self.get("/auth/login", &Who::Nobody).await;
        assert_eq!(start.status, StatusCode::SEE_OTHER, "{}", start.text());
        let location = start.header("location");
        let query: HashMap<String, String> =
            form_urlencoded::parse(location.split_once('?').unwrap().1.as_bytes())
                .into_owned()
                .collect();
        let state = query["state"].clone();
        let code = {
            let mut world = self.github.world.lock().unwrap();
            let code = format!("code-{login}.{}", world.challenges.len());
            world
                .challenges
                .insert(code.clone(), query["code_challenge"].clone());
            code
        };
        let state_cookie = start.cookie_value(&self.state_cookie_name()).unwrap();
        let cookie = format!("{}={state_cookie}", self.state_cookie_name());
        self.send(
            Method::GET,
            &format!("/auth/callback?code={code}&state={state}"),
            &Who::Nobody,
            None,
            &[("cookie", cookie.as_str())],
        )
        .await
    }

    pub fn state_cookie_name(&self) -> String {
        self.state.settings().state_cookie().to_owned()
    }

    /// A signed-in admin (the fake GitHub says `admin`).
    pub async fn owner(&self) -> Who {
        self.github.set("Filmoo", Some("admin"));
        let reply = self.github_round_trip("Filmoo").await;
        assert_eq!(reply.status, StatusCode::SEE_OTHER, "{}", reply.text());
        let cookie = reply.cookie_value(self.cookie_name).unwrap();
        let me = self
            .get(
                "/api/me",
                &Who::Owner {
                    cookie: cookie.clone(),
                    csrf: String::new(),
                },
            )
            .await;
        let csrf = me.json()["csrf"].as_str().unwrap().to_owned();
        Who::Owner { cookie, csrf }
    }

    /// Claude, with a new machine token.
    pub fn claude(&self) -> Who {
        let token = crypto::new_token();
        let mut store = self.state.store();
        let _ = store.revoke_token("claude", &Actor::system("test"), T0);
        store
            .create_token(
                "claude",
                &crypto::sha256(token.as_bytes()),
                &Actor::system("test"),
                T0,
            )
            .unwrap();
        Who::Claude(token)
    }

    pub async fn roadmap(&self, who: &Who) -> Value {
        let reply = self.get("/api/roadmap", who).await;
        assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
        reply.json()
    }

    /// A feature's id by title.
    pub async fn id_of(&self, who: &Who, title: &str) -> i64 {
        let roadmap = self.roadmap(who).await;
        roadmap["features"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["title"] == title)
            .unwrap()["id"]
            .as_i64()
            .unwrap()
    }

    pub async fn version_id(&self, who: &Who, name: &str) -> i64 {
        let roadmap = self.roadmap(who).await;
        roadmap["versions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"] == name)
            .unwrap()["id"]
            .as_i64()
            .unwrap()
    }

    /// Titles of a version's live features, in order.
    pub async fn order(&self, who: &Who, version: &str) -> Vec<String> {
        let roadmap = self.roadmap(who).await;
        let id = roadmap["versions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"] == version)
            .unwrap()["id"]
            .clone();
        let mut features: Vec<&Value> = roadmap["features"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["versionId"] == id && f["removedAt"].is_null())
            .collect();
        features.sort_by_key(|f| f["position"].as_i64().unwrap());
        features
            .iter()
            .map(|f| f["title"].as_str().unwrap().to_owned())
            .collect()
    }
}
