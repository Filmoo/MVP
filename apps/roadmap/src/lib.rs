//! `mvp-roadmap`: MVP's private roadmap, served at `dev.mvpgg.com`.
//!
//! The code is public (like the whole repository); the roadmap lives in the server's `SQLite`
//! file and only reaches the admins of the repository (GitHub sign-in) and Claude (a machine
//! token). See `README.md` for running and deploying it, `auth` for who gets in, `policy` for
//! who may change what, `api` for the routes.

pub mod api;
pub mod auth;
pub mod config;
pub mod crypto;
pub mod error;
pub mod github;
pub mod limits;
pub mod model;
pub mod pages;
pub mod policy;
pub mod seed;
pub mod store;
pub mod validate;
pub mod web;

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post};
use time::OffsetDateTime;

pub use config::ServeConfig;
pub use crypto::Keys;
pub use github::{GitHub, GitHubConfig, Secret};
pub use store::Store;
pub use web::Web;

use auth::PendingLogins;
use limits::Limiter;

/// The service's port on the server (Caddy proxies `dev.mvpgg.com` to it).
pub const DEFAULT_BIND: &str = "127.0.0.1:8790";
pub const DEFAULT_REPO: &str = "Filmoo/MVP";
/// Request bodies are small: a description is at most 20 000 characters.
const BODY_LIMIT: usize = 256 * 1024;

/// What time it is, in Unix seconds (tests move it by hand).
pub trait Clock: Send + Sync + std::fmt::Debug {
    fn now(&self) -> i64;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> i64 {
        OffsetDateTime::now_utc().unix_timestamp()
    }
}

/// A clock for tests.
#[derive(Debug, Default)]
pub struct ManualClock(AtomicI64);

impl ManualClock {
    pub fn new(now: i64) -> Self {
        Self(AtomicI64::new(now))
    }

    pub fn advance(&self, seconds: i64) {
        self.0.fetch_add(seconds, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// Where the service is seen from, and how it behaves.
#[derive(Debug, Clone)]
pub struct Settings {
    /// `https://dev.mvpgg.com`, no trailing slash.
    pub public_url: String,
    /// The public URL's origin (what browsers send in `Origin`).
    pub origin: String,
    /// Served over HTTPS (Secure, `__Host-` cookies and HSTS).
    pub https: bool,
    /// `Filmoo/MVP`: whose admins may sign in.
    pub repo: String,
    /// `--dev-login`: a fake admin, no GitHub (debug builds on loopback only).
    pub dev_login: bool,
    /// Behind Caddy: the client's address is in `X-Forwarded-For`.
    pub trust_proxy: bool,
}

impl Settings {
    pub fn new(
        public_url: &str,
        repo: &str,
        dev_login: bool,
        trust_proxy: bool,
    ) -> Result<Self, String> {
        let public_url = public_url.trim().trim_end_matches('/').to_owned();
        let https = public_url.starts_with("https://");
        if !https && !public_url.starts_with("http://") {
            return Err(format!(
                "the public URL {public_url:?} must start with https://"
            ));
        }
        let host = &public_url[public_url.find("://").map_or(0, |i| i + 3)..];
        if host.is_empty() || host.contains(['/', '?', '#', '@']) {
            return Err(format!(
                "the public URL {public_url:?} must be an origin, like https://dev.mvpgg.com"
            ));
        }
        if !repo.split_once('/').is_some_and(|(owner, name)| {
            github::valid_login(owner) && !name.is_empty() && !name.contains('/')
        }) {
            return Err(format!("the repository {repo:?} must read owner/name"));
        }
        Ok(Self {
            origin: public_url.clone(),
            public_url,
            https,
            repo: repo.to_owned(),
            dev_login,
            trust_proxy,
        })
    }

    /// Where GitHub sends the browser back (the OAuth App's callback URL).
    pub fn redirect_uri(&self) -> String {
        format!("{}/auth/callback", self.public_url)
    }

    /// `__Host-` cookies need HTTPS; a plain-HTTP dev server uses bare names.
    pub fn session_cookie(&self) -> &'static str {
        if self.https {
            "__Host-mvp_roadmap"
        } else {
            "mvp_roadmap"
        }
    }

    pub fn state_cookie(&self) -> &'static str {
        if self.https {
            "__Host-mvp_roadmap_state"
        } else {
            "mvp_roadmap_state"
        }
    }
}

/// Everything the service is made of (the binary builds it from `ServeConfig`, tests by hand).
#[derive(Debug)]
pub struct Parts {
    pub store: Store,
    pub settings: Settings,
    pub github: Option<GitHub>,
    pub keys: Keys,
    pub clock: Arc<dyn Clock>,
    pub web: Web,
    /// The seed `--dev-login`'s reset imports again (development only).
    pub dev_seed: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AppState(Arc<Inner>);

#[derive(Debug)]
struct Inner {
    store: Mutex<Store>,
    settings: Settings,
    github: Option<GitHub>,
    keys: Keys,
    clock: Arc<dyn Clock>,
    web: Web,
    limiter: Limiter,
    pending: Mutex<PendingLogins>,
    dev_seed: Option<String>,
}

impl AppState {
    pub fn new(parts: Parts) -> Self {
        Self(Arc::new(Inner {
            store: Mutex::new(parts.store),
            settings: parts.settings,
            github: parts.github,
            keys: parts.keys,
            clock: parts.clock,
            web: parts.web,
            limiter: Limiter::default(),
            pending: Mutex::new(HashMap::new()),
            dev_seed: parts.dev_seed,
        }))
    }

    /// The database. Held briefly, never across an `.await`.
    pub fn store(&self) -> MutexGuard<'_, Store> {
        self.0.store.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn now(&self) -> i64 {
        self.0.clock.now()
    }

    pub fn settings(&self) -> &Settings {
        &self.0.settings
    }

    pub fn web(&self) -> &Web {
        &self.0.web
    }

    pub(crate) fn keys(&self) -> &Keys {
        &self.0.keys
    }

    pub(crate) fn github(&self) -> Option<&GitHub> {
        self.0.github.as_ref()
    }

    pub(crate) fn limiter(&self) -> &Limiter {
        &self.0.limiter
    }

    pub(crate) fn pending(&self) -> MutexGuard<'_, PendingLogins> {
        self.0
            .pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// `GET /health`: for Docker and monitoring; says nothing about the roadmap.
async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }))
}

/// The whole service.
pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/me", get(api::me))
        .route("/roadmap", get(api::roadmap))
        .route("/audit", get(api::audit))
        .route("/features", post(api::create_feature))
        .route(
            "/features/{id}",
            get(api::feature)
                .patch(api::update_feature)
                .delete(api::remove_feature),
        )
        .route("/features/{id}/restore", post(api::restore_feature))
        .route("/features/{id}/status", post(api::set_status))
        .route("/features/{id}/move", post(api::move_feature))
        .route("/features/{id}/comments", post(api::add_comment))
        .route("/features/{id}/links", post(api::add_link))
        .route("/features/{id}/links/{link_id}", delete(api::remove_link))
        .route("/versions", post(api::create_version))
        .route(
            "/versions/{id}",
            axum::routing::patch(api::update_version).delete(api::delete_version),
        )
        .route("/versions/{id}/move", post(api::move_version))
        .route("/areas", post(api::create_area));
    #[cfg(debug_assertions)]
    let api = if state.settings().dev_login {
        api.route("/dev/reset", post(dev::reset))
            .route("/dev/token", post(dev::token))
    } else {
        api
    };
    let api = api.fallback(api::not_found);

    Router::new()
        .route("/", get(web::index))
        .route("/health", get(health))
        .route("/robots.txt", get(web::robots))
        .route("/auth/login", get(auth::login))
        .route("/auth/callback", get(auth::callback))
        .route("/auth/logout", post(auth::logout))
        .route("/_/page.css", get(web::page_css))
        .route("/assets/{*path}", get(web::asset))
        .route("/{file}", get(web::root_file))
        .nest("/api", api)
        .fallback(|| async { pages::not_found() })
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            web::headers,
        ))
        .with_state(state)
}

/// Development helpers, compiled into debug builds and routed only with `--dev-login`.
#[cfg(debug_assertions)]
mod dev {
    use axum::Json;
    use axum::extract::{Query, State};
    use axum::http::StatusCode;
    use axum::response::{IntoResponse, Response};
    use serde::Deserialize;

    use crate::AppState;
    use crate::crypto;
    use crate::error::ApiError;
    use crate::model::Actor;
    use crate::seed::{self, SeedFile};

    #[derive(Debug, Deserialize)]
    pub struct ResetQuery {
        /// `builtin`: the committed roadmap (screenshots), else the server's `--seed`.
        seed: Option<String>,
    }

    /// `POST /api/dev/reset`: the roadmap back to the seed (the UI tests start each test here).
    pub async fn reset(
        State(state): State<AppState>,
        Query(query): Query<ResetQuery>,
    ) -> Result<Response, ApiError> {
        let now = state.now();
        let text = match query.seed.as_deref() {
            Some("builtin") => Some(seed::DEFAULT),
            _ => state.0.dev_seed.as_deref(),
        };
        let mut store = state.store();
        store.reset()?;
        if let Some(text) = text {
            let seed = SeedFile::parse(text)
                .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, "invalid", e))?;
            store.import_seed(&seed, now)?;
        }
        Ok(StatusCode::NO_CONTENT.into_response())
    }

    /// `POST /api/dev/token`: a fresh machine token named "claude" (the old one is revoked).
    pub async fn token(State(state): State<AppState>) -> Result<Response, ApiError> {
        let now = state.now();
        let token = crypto::new_token();
        let mut store = state.store();
        let by = Actor::system("dev");
        store.revoke_token("claude", &by, now)?;
        store.create_token("claude", &crypto::sha256(token.as_bytes()), &by, now)?;
        Ok(Json(serde_json::json!({ "token": token })).into_response())
    }
}
