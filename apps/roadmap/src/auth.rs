//! Who may come in, and how.
//!
//! - **The owner** signs in with GitHub (OAuth web flow with PKCE and a state bound to the
//!   browser by a cookie). Only admins of the repository get a session; anyone else gets the
//!   403 page. Admin rights are asked again after `RECHECK_AFTER` on the next request, with the
//!   user's own token (kept sealed, `crypto`).
//! - **Sessions** are 32 random bytes in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie
//!   (`__Host-` prefixed), kept server-side as a keyed hash, ending after `SESSION_LIFETIME`
//!   or `SESSION_IDLE` without use. Changes (`POST`, `PATCH`, `DELETE`) also need the session's
//!   CSRF token in `X-CSRF-Token`, and a foreign `Origin` is refused.
//! - **Claude** sends `Authorization: Bearer mvpr_…`, a machine token made by
//!   `mvp-roadmap token create` (stored as SHA-256). No cookie, so no CSRF.
//! - **`--dev-login`** (debug builds on a loopback address only, checked at start) signs anyone
//!   in as a fake admin, without GitHub.

use std::collections::HashMap;
use std::net::IpAddr;

use axum::extract::{FromRequestParts, Query, State};
use axum::http::header::{AUTHORIZATION, COOKIE, ORIGIN, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use serde::Deserialize;
use serde_json::json;

use crate::crypto;
use crate::error::ApiError;
use crate::github::{Access, GitHubError, Secret};
use crate::limits::{Bucket, ClientIp};
use crate::model::{Actor, ActorKind};
use crate::pages;
use crate::store::Session;
use crate::{AppState, Settings};

/// A session ends a week after sign-in…
pub const SESSION_LIFETIME: i64 = 7 * 24 * 60 * 60;
/// …or after two days without use.
pub const SESSION_IDLE: i64 = 2 * 24 * 60 * 60;
/// GitHub is asked again whether the user is still an admin after ten minutes.
pub const RECHECK_AFTER: i64 = 10 * 60;
/// When GitHub doesn't answer, its last yes holds for an hour.
pub const RECHECK_GRACE: i64 = 60 * 60;
/// A sign-in must come back from GitHub within ten minutes.
const STATE_LIFETIME: i64 = 10 * 60;
pub const CSRF_HEADER: &str = "x-csrf-token";
/// The fake admin of `--dev-login`.
pub const DEV_LOGIN: &str = "dev-admin";

/// A sign-in on its way to GitHub and back.
pub struct Pending {
    verifier: String,
    created: i64,
}

impl std::fmt::Debug for Pending {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pending")
            .field("verifier", &"[redacted]")
            .field("created", &self.created)
            .finish()
    }
}

pub type PendingLogins = HashMap<String, Pending>;

/// Who is asking, once let in.
#[derive(Clone)]
pub struct Principal {
    pub actor: Actor,
    /// The name to show (GitHub's display name, or "Claude").
    pub name: String,
    pub avatar_url: String,
    /// Browser sessions only.
    pub csrf: Option<String>,
    pub dev: bool,
    session: Option<Vec<u8>>,
}

impl std::fmt::Debug for Principal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Principal")
            .field("actor", &self.actor)
            .field("dev", &self.dev)
            .finish_non_exhaustive()
    }
}

/// Extractor: a signed-in owner (cookie, and CSRF for changes) or Claude (token).
#[derive(Debug, Clone)]
pub struct Auth(pub Principal);

impl FromRequestParts<AppState> for Auth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let now = state.now();
        if let Some(token) = bearer(&parts.headers) {
            let Ok(ClientIp(ip)) = ClientIp::from_request_parts(parts, state).await;
            return token_principal(state, &token, ip, now).map(Self);
        }
        let Some(id) = cookie(&parts.headers, state.settings().session_cookie()) else {
            return Err(ApiError::signed_out("Sign in to see the roadmap."));
        };
        let principal = session_principal(state, &id, now).await?;
        if !parts.method.is_safe() {
            check_csrf(&parts.headers, &principal, state.settings())?;
        }
        Ok(Self(principal))
    }
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    scheme
        .eq_ignore_ascii_case("bearer")
        .then(|| token.trim().to_owned())
        .filter(|t| !t.is_empty())
}

/// A cookie's value from the request's `Cookie` headers.
pub fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned())
        .filter(|value| !value.is_empty())
}

fn set_cookie(
    settings: &Settings,
    name: &str,
    value: &str,
    same_site: &str,
    max_age: i64,
) -> HeaderValue {
    let secure = if settings.https { "; Secure" } else { "" };
    let text = format!(
        "{name}={value}; Path=/; HttpOnly; SameSite={same_site}; Max-Age={max_age}{secure}"
    );
    HeaderValue::from_str(&text).unwrap_or_else(|_| HeaderValue::from_static(""))
}

fn token_principal(
    state: &AppState,
    token: &str,
    ip: IpAddr,
    now: i64,
) -> Result<Principal, ApiError> {
    if let Some(wait) = state.limiter().blocked(Bucket::BadToken, ip, now) {
        return Err(ApiError::rate_limited(wait));
    }
    let hash = crypto::sha256(token.as_bytes());
    let found = state.store().token(&hash)?;
    let Some((id, name, last_used)) = found else {
        let _ = state.limiter().hit(Bucket::BadToken, ip, now);
        return Err(ApiError::signed_out(
            "This token is unknown or was revoked.",
        ));
    };
    if last_used.is_none_or(|at| now - at >= 60) {
        state.store().touch_token(id, now)?;
    }
    Ok(Principal {
        actor: Actor::claude(&name),
        name: "Claude".into(),
        avatar_url: String::new(),
        csrf: None,
        dev: false,
        session: None,
    })
}

async fn session_principal(state: &AppState, id: &str, now: i64) -> Result<Principal, ApiError> {
    let hash = state.keys().session_hash(id);
    let found = state.store().session(&hash)?;
    let ended = || ApiError::signed_out("Your session ended: sign in again.");
    let Some(session) = found else {
        return Err(ended());
    };
    let expired = session.expires_at <= now || session.last_seen_at + SESSION_IDLE <= now;
    if expired || session.dev != state.settings().dev_login {
        state.store().delete_session(&hash)?;
        return Err(ended());
    }
    if !session.dev && now - session.verified_at >= RECHECK_AFTER {
        match still_admin(state, &session).await {
            Ok(true) => state.store().session_verified(&hash, now)?,
            Ok(false) => {
                let repo = &state.settings().repo;
                let store = state.store();
                store.delete_session(&hash)?;
                store.record(
                    &Actor::owner(&session.login),
                    "auth.revoked",
                    format!(
                        "@{} isn't an admin of {repo} any more: signed out",
                        session.login
                    ),
                    json!({}),
                    now,
                )?;
                tracing::info!(login = %session.login, "no longer an admin: session closed");
                return Err(ApiError::forbidden(
                    "notAdmin",
                    format!("@{} isn't an admin of {repo} any more.", session.login),
                ));
            }
            Err(error) if now - session.verified_at < RECHECK_GRACE => {
                tracing::warn!(%error, login = %session.login, "GitHub didn't answer: the last check holds");
            }
            Err(error) => {
                tracing::warn!(%error, login = %session.login, "GitHub didn't answer for too long");
                return Err(ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "githubUnavailable",
                    "GitHub doesn't answer, so your access can't be checked. Try again in a minute.",
                ));
            }
        }
    }
    if now - session.last_seen_at >= 60 {
        state.store().touch_session(&hash, now)?;
    }
    Ok(Principal {
        actor: Actor::owner(&session.login),
        name: session.name,
        avatar_url: session.avatar_url,
        csrf: Some(session.csrf),
        dev: session.dev,
        session: Some(hash),
    })
}

/// Asks GitHub again, with the user's own token.
async fn still_admin(state: &AppState, session: &Session) -> Result<bool, GitHubError> {
    let Some(github) = state.github() else {
        return Ok(false);
    };
    let token = session
        .github_token
        .as_deref()
        .and_then(|sealed| state.keys().open(sealed))
        .and_then(|plain| String::from_utf8(plain).ok());
    let Some(token) = token else {
        return Ok(false);
    };
    Ok(github.access(&Secret::new(token), &session.login).await? == Access::Admin)
}

fn check_csrf(
    headers: &HeaderMap,
    principal: &Principal,
    settings: &Settings,
) -> Result<(), ApiError> {
    if let Some(origin) = headers.get(ORIGIN)
        && origin.as_bytes() != settings.origin.as_bytes()
    {
        return Err(ApiError::forbidden(
            "badOrigin",
            "This request came from another site.",
        ));
    }
    let sent = headers
        .get(CSRF_HEADER)
        .map(HeaderValue::as_bytes)
        .unwrap_or_default();
    let expected = principal.csrf.as_deref().unwrap_or_default().as_bytes();
    if expected.is_empty() || !crypto::same(sent, expected) {
        return Err(ApiError::forbidden(
            "csrf",
            "This change came without its CSRF token: reload the page.",
        ));
    }
    Ok(())
}

// ---- Sign in and out -----------------------------------------------------------------------

/// `GET /auth/login`: off to GitHub (or, with `--dev-login`, signed in at once).
pub async fn login(State(state): State<AppState>, ClientIp(ip): ClientIp) -> Response {
    let now = state.now();
    let settings = state.settings();
    // `--dev-login` only listens on the loopback, where the UI tests sign in once per test.
    if settings.dev_login {
        return dev_sign_in(&state, now);
    }
    if let Err(wait) = state.limiter().hit(Bucket::SignIn, ip, now) {
        return pages::too_many_attempts(wait);
    }
    let Some(github) = state.github() else {
        return pages::sign_in_failed(
            StatusCode::SERVICE_UNAVAILABLE,
            "GitHub sign-in isn't set up on this server.",
        );
    };
    let (key, verifier) = (crypto::random_id(), crypto::random_id());
    {
        let mut pending = state.pending();
        pending.retain(|_, p| now - p.created < STATE_LIFETIME);
        if pending.len() >= 1_000 {
            return pages::too_many_attempts(60);
        }
        pending.insert(
            key.clone(),
            Pending {
                verifier: verifier.clone(),
                created: now,
            },
        );
    }
    let url = github.authorize_url(
        &settings.redirect_uri(),
        &key,
        &crypto::pkce_challenge(&verifier),
    );
    let mut response = Redirect::to(&url).into_response();
    response.headers_mut().append(
        SET_COOKIE,
        set_cookie(
            settings,
            settings.state_cookie(),
            &key,
            "Lax",
            STATE_LIFETIME,
        ),
    );
    response
}

#[derive(Debug, Deserialize)]
pub struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// `GET /auth/callback`: back from GitHub. Admins get a session, others the 403 page.
pub async fn callback(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Query(query): Query<Callback>,
    headers: HeaderMap,
) -> Response {
    let now = state.now();
    if let Err(wait) = state.limiter().hit(Bucket::SignIn, ip, now) {
        return pages::too_many_attempts(wait);
    }
    let settings = state.settings();
    let mut response = match finish(&state, &query, &headers, now).await {
        Ok(id) => signed_in(settings, &id),
        Err(page) => page,
    };
    response.headers_mut().append(
        SET_COOKIE,
        set_cookie(settings, settings.state_cookie(), "", "Lax", 0),
    );
    response
}

async fn finish(
    state: &AppState,
    query: &Callback,
    headers: &HeaderMap,
    now: i64,
) -> Result<String, Response> {
    let settings = state.settings();
    if let Some(error) = &query.error {
        let why = if error == "access_denied" {
            "You cancelled the sign-in on GitHub."
        } else {
            "GitHub stopped the sign-in."
        };
        return Err(pages::sign_in_failed(StatusCode::BAD_REQUEST, why));
    }
    let (Some(code), Some(key)) = (&query.code, &query.state) else {
        return Err(pages::sign_in_failed(
            StatusCode::BAD_REQUEST,
            "This sign-in link is incomplete.",
        ));
    };
    let bound = cookie(headers, settings.state_cookie()).unwrap_or_default();
    if !crypto::same(bound.as_bytes(), key.as_bytes()) {
        return Err(pages::sign_in_failed(
            StatusCode::BAD_REQUEST,
            "This sign-in didn't start in this browser, or it expired. Start again.",
        ));
    }
    let pending = state.pending().remove(key);
    let Some(pending) = pending.filter(|p| now - p.created < STATE_LIFETIME) else {
        return Err(pages::sign_in_failed(
            StatusCode::BAD_REQUEST,
            "This sign-in expired. Start again.",
        ));
    };
    let Some(github) = state.github() else {
        return Err(pages::sign_in_failed(
            StatusCode::SERVICE_UNAVAILABLE,
            "GitHub sign-in isn't set up on this server.",
        ));
    };
    let token = github
        .exchange(code, &settings.redirect_uri(), &pending.verifier)
        .await
        .map_err(github_failed)?;
    let user = github.user(&token).await.map_err(github_failed)?;
    if let Access::Not(permission) = github
        .access(&token, &user.login)
        .await
        .map_err(github_failed)?
    {
        let visitor = Actor {
            kind: ActorKind::Visitor,
            name: user.login.clone(),
        };
        let summary = format!("Refused @{} ({permission})", user.login);
        if let Err(error) = state.store().record(
            &visitor,
            "auth.denied",
            summary,
            json!({ "permission": permission }),
            now,
        ) {
            tracing::error!(%error, "audit");
        }
        tracing::info!(login = %user.login, %permission, "sign-in refused: not an admin");
        return Err(pages::not_an_admin(&user.login, &permission, github.repo()));
    }
    let id = crypto::random_id();
    let session = Session {
        login: user.login.clone(),
        github_id: user.id,
        name: user.name,
        avatar_url: user.avatar_url,
        csrf: crypto::random_id(),
        github_token: Some(state.keys().seal(token.expose().as_bytes())),
        dev: false,
        created_at: now,
        last_seen_at: now,
        verified_at: now,
        expires_at: now + SESSION_LIFETIME,
    };
    start_session(state, &id, &session, now).map_err(|e| session_not_saved(&e))?;
    tracing::info!(login = %session.login, "signed in");
    Ok(id)
}

fn start_session(
    state: &AppState,
    id: &str,
    session: &Session,
    now: i64,
) -> crate::store::Result<()> {
    let store = state.store();
    store.prune_sessions(now, SESSION_IDLE)?;
    store.insert_session(&state.keys().session_hash(id), session)?;
    let how = if session.dev { " (--dev-login)" } else { "" };
    store.record(
        &Actor::owner(&session.login),
        "auth.sign_in",
        format!("@{} signed in{how}", session.login),
        json!({}),
        now,
    )
}

fn session_not_saved(error: &crate::store::StoreError) -> Response {
    tracing::error!(%error, "saving a session");
    pages::sign_in_failed(
        StatusCode::INTERNAL_SERVER_ERROR,
        "The server couldn't save your session.",
    )
}

fn github_failed(error: GitHubError) -> Response {
    match error {
        GitHubError::Refused(why) => pages::sign_in_failed(
            StatusCode::BAD_REQUEST,
            &format!("GitHub refused the sign-in ({why}). Start again."),
        ),
        GitHubError::Unavailable(why) => {
            tracing::warn!(%why, "GitHub didn't answer during a sign-in");
            pages::sign_in_failed(
                StatusCode::BAD_GATEWAY,
                "GitHub didn't answer. Try again in a minute.",
            )
        }
    }
}

fn signed_in(settings: &Settings, id: &str) -> Response {
    let mut response = Redirect::to("/").into_response();
    response.headers_mut().append(
        SET_COOKIE,
        set_cookie(
            settings,
            settings.session_cookie(),
            id,
            "Strict",
            SESSION_LIFETIME,
        ),
    );
    response
}

fn dev_sign_in(state: &AppState, now: i64) -> Response {
    let id = crypto::random_id();
    let session = Session {
        login: DEV_LOGIN.into(),
        github_id: 0,
        name: "Dev admin".into(),
        avatar_url: String::new(),
        csrf: crypto::random_id(),
        github_token: None,
        dev: true,
        created_at: now,
        last_seen_at: now,
        verified_at: now,
        expires_at: now + SESSION_LIFETIME,
    };
    match start_session(state, &id, &session, now) {
        Ok(()) => signed_in(state.settings(), &id),
        Err(error) => session_not_saved(&error),
    }
}

/// `POST /auth/logout` (with the CSRF header): ends this browser's session.
pub async fn logout(State(state): State<AppState>, Auth(principal): Auth) -> Response {
    if let Some(hash) = &principal.session {
        let store = state.store();
        let ended = store.delete_session(hash).and_then(|()| {
            store.record(
                &principal.actor,
                "auth.sign_out",
                format!("@{} signed out", principal.actor.name),
                json!({}),
                state.now(),
            )
        });
        if let Err(error) = ended {
            tracing::error!(%error, "signing out");
        }
    }
    let settings = state.settings();
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().append(
        SET_COOKIE,
        set_cookie(settings, settings.session_cookie(), "", "Strict", 0),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookies_and_bearers_are_read_from_headers() {
        let mut headers = HeaderMap::new();
        headers.append(
            COOKIE,
            HeaderValue::from_static("a=1; __Host-mvp_roadmap=abc"),
        );
        headers.append(COOKIE, HeaderValue::from_static("b=2"));
        assert_eq!(
            cookie(&headers, "__Host-mvp_roadmap").as_deref(),
            Some("abc")
        );
        assert_eq!(cookie(&headers, "b").as_deref(), Some("2"));
        assert_eq!(cookie(&headers, "c"), None);
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer mvpr_x"));
        assert_eq!(bearer(&headers).as_deref(), Some("mvpr_x"));
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Basic eDp5"));
        assert_eq!(bearer(&headers), None);
    }
}
