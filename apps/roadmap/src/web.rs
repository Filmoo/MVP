//! The web UI (`web/`, built by Vite into `web/dist`) and the headers every answer carries.
//!
//! The page is public code (the repository is), so it is served to anyone; the roadmap only
//! comes from `/api/*` once signed in. Release builds embed `web/dist` (`build.rs`); debug builds
//! read it from disk on each request, so a rebuilt UI shows without recompiling the server.

use std::borrow::Cow;
use std::path::PathBuf;

use axum::extract::{Path, Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::pages;

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/assets.rs"));
}

/// Where the UI's files come from.
#[derive(Debug, Clone)]
pub enum Web {
    /// Built into the binary (release builds).
    Embedded,
    /// Read from this folder on each request (debug builds, or `ROADMAP_WEB_DIR`).
    Folder(PathBuf),
}

impl Web {
    /// Release builds: the embedded files; debug builds: `web/dist` next to the sources.
    pub fn default_for_build() -> Self {
        if cfg!(debug_assertions) {
            Self::Folder(PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/web/dist"
            )))
        } else {
            Self::Embedded
        }
    }

    fn file(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        let odd = |part: &str| {
            part.is_empty() || part == ".." || part == "." || part.contains(['\\', ':'])
        };
        if path.split('/').any(odd) {
            return None;
        }
        match self {
            Self::Embedded => embedded::ASSETS
                .iter()
                .find(|(name, _)| *name == path)
                .map(|(_, bytes)| Cow::Borrowed(*bytes)),
            Self::Folder(root) => {
                let file = root.join(path);
                if !file.starts_with(root) {
                    return None;
                }
                std::fs::read(file).ok().map(Cow::Owned)
            }
        }
    }
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "json" | "map" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        "ico" => "image/x-icon",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

fn serve(web: &Web, path: &str, cache: &'static str) -> Option<Response> {
    let bytes = web.file(path)?;
    let mut response = (StatusCode::OK, bytes.into_owned()).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type(path)),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    Some(response)
}

/// `GET /`: the app. Revalidated every time, so a deploy shows at once.
pub async fn index(State(state): State<AppState>) -> Response {
    serve(state.web(), "index.html", "no-cache").unwrap_or_else(pages::ui_not_built)
}

/// `GET /assets/…`: Vite's files, named by their hash, so they never change.
pub async fn asset(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    serve(
        state.web(),
        &format!("assets/{path}"),
        "public, max-age=31536000, immutable",
    )
    .unwrap_or_else(pages::not_found)
}

/// `GET /{file}`: files at the root of `web/dist` (the icon); anything else is not found.
pub async fn root_file(State(state): State<AppState>, Path(file): Path<String>) -> Response {
    if file == "index.html" {
        return index(State(state)).await;
    }
    serve(state.web(), &file, "public, max-age=3600").unwrap_or_else(pages::not_found)
}

pub async fn page_css() -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/css; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=3600"),
        ],
        pages::PAGE_CSS,
    )
        .into_response()
}

pub async fn robots() -> Response {
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "User-agent: *\nDisallow: /\n",
    )
        .into_response()
}

/// The app only talks to itself; GitHub's avatars are the one outside image.
pub const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'self'; \
     style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; \
     font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; \
     form-action 'self'; frame-ancestors 'none'";

/// Security headers on every answer; `no-store` on the API and sign-in routes.
pub async fn headers(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let private = {
        let path = request.uri().path();
        path.starts_with("/api/") || path.starts_with("/auth/")
    };
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    let set = [
        ("x-robots-tag", "noindex, nofollow, noarchive"),
        ("content-security-policy", CONTENT_SECURITY_POLICY),
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "same-origin"),
        (
            "permissions-policy",
            "camera=(), microphone=(), geolocation=(), browsing-topics=()",
        ),
        ("cross-origin-opener-policy", "same-origin"),
        ("cross-origin-resource-policy", "same-origin"),
    ];
    for (name, value) in set {
        headers.insert(
            HeaderName::from_static(name),
            HeaderValue::from_static(value),
        );
    }
    if state.settings().https {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000"),
        );
    }
    if private {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_ui() {
        let web = Web::Folder(PathBuf::from("/nonexistent"));
        for bad in [
            "",
            "../Cargo.toml",
            "assets/../../x",
            "/etc/passwd",
            "a//b",
            "./x",
            "a\\..\\..\\x",
            "C:x",
        ] {
            assert!(web.file(bad).is_none(), "{bad}");
        }
        assert_eq!(
            content_type("assets/index-3f2a.js"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(content_type("favicon.svg"), "image/svg+xml");
    }
}
