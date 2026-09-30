//! Pages the server renders itself, around sign-in: not an admin (403), a sign-in that went
//! wrong, too many attempts, not found. Same look as the app (its tokens), no script.

use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};

/// The app's design tokens, then the pages' own rules (`GET /_/page.css`).
pub const PAGE_CSS: &str = concat!(
    include_str!("../../../ui/src/design/tokens.css"),
    "\n",
    include_str!("page.css")
);

/// MVP's mark (`ui/src/design/Logo.tsx`, `Mark`).
const MARK: &str = r#"<svg class="mark" width="44" height="44" viewBox="-60 -50 120 170" role="img" aria-label="MVP"><ellipse cx="0" cy="98" rx="37" ry="10" fill="none" stroke="var(--accent)" stroke-width="7"/><path d="M-40 0 L0 18 L40 0 L0 95 Z" fill="var(--text-1)" stroke="currentColor" stroke-width="9" stroke-linejoin="round"/><path d="M-17 12 V-9 L-9 -1 L0 -14 L9 -1 L17 -9 V12 Z" transform="translate(0 -28) scale(1.3)" fill="var(--warn)" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/></svg>"#;

/// Text for HTML.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// A whole page; `body` is HTML (escape what comes from outside).
pub fn page(status: StatusCode, title: &str, body: &str) -> Response {
    let html = format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <meta name=\"robots\" content=\"noindex, nofollow\">\n\
         <title>{title} · MVP Roadmap</title>\n\
         <link rel=\"icon\" href=\"/favicon.svg\">\n\
         <link rel=\"stylesheet\" href=\"/_/page.css\">\n</head>\n<body>\n<main class=\"card\">\n\
         {MARK}\n<p class=\"eyebrow\">MVP Roadmap</p>\n<h1>{title}</h1>\n{body}\n</main>\n</body>\n</html>\n",
        title = escape(title),
    );
    let mut response = (status, Html(html)).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// Someone signed in to GitHub who isn't an admin of the repository.
pub fn not_an_admin(login: &str, permission: &str, repo: &str) -> Response {
    let (login, repo) = (escape(login), escape(repo));
    let who = match permission {
        "write" | "maintain" => {
            format!("can push to <strong>{repo}</strong> but isn't one of its admins")
        }
        "read" | "triage" => {
            format!("can read <strong>{repo}</strong> but isn't one of its admins")
        }
        _ => format!("isn't an admin of <strong>{repo}</strong>"),
    };
    let body = format!(
        "<p>You're signed in to GitHub as <strong>@{login}</strong>, who {who}.</p>\n\
         <p>MVP's roadmap is private to the repository's admins.</p>\n\
         <div class=\"actions\">\
         <a class=\"button secondary\" href=\"https://mvpgg.com\">Go to mvpgg.com</a>\
         <a class=\"button primary\" href=\"/auth/login\">Sign in again</a></div>\n\
         <p class=\"small\">To use another GitHub account, sign out of GitHub first. \
         Refused sign-ins are kept in the roadmap's audit log.</p>"
    );
    page(StatusCode::FORBIDDEN, "This roadmap is private", &body)
}

/// A sign-in that couldn't finish; `message` is plain text.
pub fn sign_in_failed(status: StatusCode, message: &str) -> Response {
    let body = format!(
        "<p>{}</p>\n<div class=\"actions\"><a class=\"button primary\" href=\"/auth/login\">Try again</a></div>",
        escape(message)
    );
    page(status, "Sign-in didn't finish", &body)
}

pub fn too_many_attempts(retry_after: i64) -> Response {
    let minutes = (retry_after + 59) / 60;
    let body = format!(
        "<p>Too many sign-in attempts from this address. Try again in {minutes} minute{}.</p>",
        if minutes == 1 { "" } else { "s" }
    );
    let mut response = page(StatusCode::TOO_MANY_REQUESTS, "Slow down", &body);
    if let Ok(value) = HeaderValue::from_str(&retry_after.max(1).to_string()) {
        response.headers_mut().insert(header::RETRY_AFTER, value);
    }
    response
}

pub fn not_found() -> Response {
    page(
        StatusCode::NOT_FOUND,
        "Nothing here",
        "<p>This page doesn't exist.</p>\n<div class=\"actions\"><a class=\"button primary\" href=\"/\">Open the roadmap</a></div>",
    )
}

/// Debug builds serve `web/dist` from disk: say how to build it rather than a blank page.
pub fn ui_not_built() -> Response {
    page(
        StatusCode::SERVICE_UNAVAILABLE,
        "The web UI isn't built",
        "<p>Build it once with <strong>pnpm --filter @scout/roadmap build</strong> \
         (<strong>pnpm roadmap</strong> does), then reload.</p>",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outside_text_is_escaped() {
        assert_eq!(
            escape("<b>\"x\" & 'y'</b>"),
            "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;"
        );
    }

    #[test]
    fn the_page_css_starts_with_the_apps_tokens() {
        assert!(PAGE_CSS.contains("--accent: #b9a9ff"));
        assert!(PAGE_CSS.contains(".card"));
    }
}
