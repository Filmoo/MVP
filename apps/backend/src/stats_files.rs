//! Serves the published stats files (`mvp-crawler publish` output) from `STATS_DIR`, with a
//! content `ETag` (`304` on `If-None-Match`) and cache headers so the app and a CDN in front can
//! cache them. The layout is described in `aggregate::publish`.

use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::extract::{Path as UrlPath, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::error::Failure;

/// The index changes on every publication: revalidate often.
const INDEX_CACHE: &str = "public, max-age=300";
/// Patch files change at most once per publication (a few times a day).
const FILE_CACHE: &str = "public, max-age=3600";

/// FNV-1a 64: a stable content hash for `ETag`s (not for security).
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn safe_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('.')
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// `{patch}/{queue}/{file…}` → a path under `v1/`, or `None` for anything unexpected
/// (traversal, hidden staging directories, non-JSON).
fn data_path(patch: &str, queue: &str, file: &str) -> Option<PathBuf> {
    let patch_ok = patch.split('.').count() == 2
        && patch
            .split('.')
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    let queue_ok =
        !queue.is_empty() && queue.len() <= 5 && queue.bytes().all(|b| b.is_ascii_digit());
    let segments: Vec<&str> = file.split('/').collect();
    let file_ok = (1..=3).contains(&segments.len())
        && segments.iter().all(|s| safe_segment(s))
        && Path::new(file)
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !(patch_ok && queue_ok && file_ok) {
        return None;
    }
    let mut rel = PathBuf::from("v1").join(patch).join(queue);
    for s in segments {
        rel.push(s);
    }
    Some(rel)
}

async fn serve(dir: &Path, rel: &Path, cache: &'static str, headers: &HeaderMap) -> Response {
    let Ok(bytes) = tokio::fs::read(dir.join(rel)).await else {
        return Failure::not_found().into_response();
    };
    let etag = format!("\"{:016x}\"", fnv1a(&bytes));
    let cached = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|t| t.trim() == etag || t.trim() == "*"));
    let mut res = if cached {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        let mut res = Response::new(Body::from(bytes));
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        res
    };
    let h = res.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&etag) {
        h.insert(header::ETAG, v);
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res
}

/// `GET /v1/stats/index`
pub async fn index(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(dir) = state.stats_dir() else {
        return Failure::not_found().into_response();
    };
    serve(dir, Path::new("v1/index.json"), INDEX_CACHE, &headers).await
}

/// `GET /v1/stats/{patch}/{queue}/{*file}`, e.g. `16.19/420/emeraldPlus/builds/103.json`.
pub async fn file(
    State(state): State<AppState>,
    UrlPath((patch, queue, file)): UrlPath<(String, String, String)>,
    headers: HeaderMap,
) -> Response {
    let (Some(dir), Some(rel)) = (state.stats_dir(), data_path(&patch, &queue, &file)) else {
        return Failure::not_found().into_response();
    };
    serve(dir, &rel, FILE_CACHE, &headers).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_published_paths() {
        assert_eq!(
            data_path("16.19", "420", "emeraldPlus/builds/103.json"),
            Some(PathBuf::from("v1/16.19/420/emeraldPlus/builds/103.json"))
        );
        assert!(data_path("16.19", "450", "masterPlus/champions.json").is_some());
        for (patch, queue, file) in [
            ("16.19", "420", "../../secret.json"),
            ("16.19", "420", "emeraldPlus/../../x.json"),
            ("..", "420", "emeraldPlus/champions.json"),
            ("16.19", "420", ".staging-16.19/a.json"),
            ("16.19", "420", "emeraldPlus/champions.txt"),
            ("16.19", "abc", "emeraldPlus/champions.json"),
            ("16", "420", "emeraldPlus/champions.json"),
            ("16.19", "420", "a/b/c/d.json"),
            ("16.19", "420", "emeraldPlus//x.json"),
        ] {
            assert_eq!(data_path(patch, queue, file), None, "{file}");
        }
    }

    #[test]
    fn etags_follow_content() {
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_ne!(fnv1a(b"{\"a\":1}"), fnv1a(b"{\"a\":2}"));
    }
}
