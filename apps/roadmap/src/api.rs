//! `/api/*`: JSON, camelCase, every route behind `Auth` (the owner's session or Claude's
//! token). Rights are checked by the store (`policy`), in the same transaction as the change.
//!
//! | Route | Who | Answer |
//! | --- | --- | --- |
//! | `GET /api/me` | both | `Me` (the CSRF token for the browser) |
//! | `GET /api/roadmap` | both | versions, areas, features (removed ones flagged) |
//! | `GET /api/audit?before=&limit=` | both | the audit log, newest first |
//! | `POST /api/features` | both | 201 `Feature` (Claude's are proposals) |
//! | `GET /api/features/{id}` | both | the feature, its comments and its history |
//! | `PATCH /api/features/{id}` | owner | title, description, area, version |
//! | `POST /api/features/{id}/status` | both* | `{ status }` (*Claude: accepted work only) |
//! | `POST /api/features/{id}/move` | owner | `{ versionId, beforeId?, status? }` → `Moved` |
//! | `DELETE /api/features/{id}` | owner | soft delete; `POST …/restore` undoes it |
//! | `POST /api/features/{id}/comments` | both | 201 `Comment` |
//! | `POST /api/features/{id}/links` | both* | 201 `Link` (*Claude: accepted work only) |
//! | `DELETE /api/features/{id}/links/{linkId}` | owner | 204 |
//! | `POST /api/versions`, `PATCH`/`DELETE /api/versions/{id}`, `POST …/move` | owner | |
//! | `POST /api/areas` | owner | 201 `Area` |

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::Auth;
use crate::error::{ApiError, Payload};
use crate::model::{ActorKind, AuditEntry, Status};
use crate::store::{FeaturePatch, MoveTo, NewFeature, NewVersion, VersionPatch};

type Answer = Result<Response, ApiError>;

fn ok<T: Serialize>(value: T) -> Response {
    Json(value).into_response()
}

fn created<T: Serialize>(value: T) -> Response {
    (StatusCode::CREATED, Json(value)).into_response()
}

/// Who is signed in, and what the browser needs to make changes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub kind: ActorKind,
    pub login: String,
    pub name: String,
    pub avatar_url: String,
    /// Send it back as `X-CSRF-Token` with every change.
    pub csrf: Option<String>,
    pub repo: String,
    /// Signed in by `--dev-login`.
    pub dev: bool,
}

pub async fn me(State(state): State<AppState>, Auth(principal): Auth) -> Response {
    ok(Me {
        kind: principal.actor.kind,
        login: principal.actor.name.clone(),
        name: principal.name,
        avatar_url: principal.avatar_url,
        csrf: principal.csrf,
        repo: state.settings().repo.clone(),
        dev: principal.dev,
    })
}

pub async fn roadmap(State(state): State<AppState>, Auth(_): Auth) -> Answer {
    Ok(ok(state.store().roadmap()?))
}

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    before: Option<i64>,
    limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditPage {
    entries: Vec<AuditEntry>,
    /// Pass as `before` for the next page; `null` at the end.
    next: Option<i64>,
}

pub async fn audit(
    State(state): State<AppState>,
    Auth(_): Auth,
    Query(query): Query<AuditQuery>,
) -> Answer {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let entries = state.store().audit(query.before, limit)?;
    let full = entries.len() == usize::try_from(limit).unwrap_or(usize::MAX);
    let next = if full {
        entries.last().map(|e| e.id)
    } else {
        None
    };
    Ok(ok(AuditPage { entries, next }))
}

pub async fn create_feature(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Payload(input): Payload<NewFeature>,
) -> Answer {
    let now = state.now();
    Ok(created(state.store().create_feature(
        &input,
        &principal.actor,
        now,
    )?))
}

pub async fn feature(State(state): State<AppState>, Auth(_): Auth, Path(id): Path<i64>) -> Answer {
    Ok(ok(state.store().feature_detail(id)?))
}

pub async fn update_feature(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
    Payload(patch): Payload<FeaturePatch>,
) -> Answer {
    let now = state.now();
    Ok(ok(state.store().update_feature(
        id,
        &patch,
        &principal.actor,
        now,
    )?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusBody {
    status: Status,
}

pub async fn set_status(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
    Payload(body): Payload<StatusBody>,
) -> Answer {
    let now = state.now();
    Ok(ok(state.store().set_status(
        id,
        body.status,
        &principal.actor,
        now,
    )?))
}

pub async fn move_feature(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
    Payload(to): Payload<MoveTo>,
) -> Answer {
    let now = state.now();
    Ok(ok(state.store().move_feature(
        id,
        &to,
        &principal.actor,
        now,
    )?))
}

pub async fn remove_feature(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
) -> Answer {
    let now = state.now();
    Ok(ok(state.store().remove_feature(
        id,
        &principal.actor,
        now,
    )?))
}

pub async fn restore_feature(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
) -> Answer {
    let now = state.now();
    Ok(ok(state.store().restore_feature(
        id,
        &principal.actor,
        now,
    )?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommentBody {
    body: String,
}

pub async fn add_comment(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
    Payload(comment): Payload<CommentBody>,
) -> Answer {
    let now = state.now();
    Ok(created(state.store().add_comment(
        id,
        &comment.body,
        &principal.actor,
        now,
    )?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkBody {
    url: String,
    #[serde(default)]
    label: String,
}

pub async fn add_link(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
    Payload(link): Payload<LinkBody>,
) -> Answer {
    let now = state.now();
    Ok(created(state.store().add_link(
        id,
        &link.url,
        &link.label,
        &principal.actor,
        now,
    )?))
}

pub async fn remove_link(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path((id, link_id)): Path<(i64, i64)>,
) -> Answer {
    let now = state.now();
    state
        .store()
        .remove_link(id, link_id, &principal.actor, now)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn create_version(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Payload(input): Payload<NewVersion>,
) -> Answer {
    let now = state.now();
    Ok(created(state.store().create_version(
        &input,
        &principal.actor,
        now,
    )?))
}

pub async fn update_version(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
    Payload(patch): Payload<VersionPatch>,
) -> Answer {
    let now = state.now();
    Ok(ok(state.store().update_version(
        id,
        &patch,
        &principal.actor,
        now,
    )?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeforeBody {
    #[serde(default)]
    before_id: Option<i64>,
}

pub async fn move_version(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
    Payload(body): Payload<BeforeBody>,
) -> Answer {
    let now = state.now();
    Ok(ok(state.store().move_version(
        id,
        body.before_id,
        &principal.actor,
        now,
    )?))
}

pub async fn delete_version(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Path(id): Path<i64>,
) -> Answer {
    let now = state.now();
    state.store().delete_version(id, &principal.actor, now)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AreaBody {
    name: String,
    #[serde(default)]
    color: Option<String>,
}

pub async fn create_area(
    State(state): State<AppState>,
    Auth(principal): Auth,
    Payload(body): Payload<AreaBody>,
) -> Answer {
    let now = state.now();
    Ok(created(state.store().create_area(
        &body.name,
        body.color.as_deref(),
        &principal.actor,
        now,
    )?))
}

/// Unknown `/api/*` routes answer JSON too.
pub async fn not_found() -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "notFound",
        "There's no such API route.",
    )
}
