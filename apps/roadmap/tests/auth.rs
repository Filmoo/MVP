//! Who gets in: GitHub admins (sessions, CSRF, expiry, admin rights asked again), Claude's
//! machine token and its rights, `--dev-login`, and the headers every answer carries.
#![allow(
    clippy::unwrap_used,
    clippy::too_many_lines,
    reason = "tests, each one story"
)]

mod common;

use axum::http::{Method, StatusCode};
use common::{PUBLIC_URL, SESSION_KEY, T0, TestApp, Who};
use mvp_roadmap::Keys;
use mvp_roadmap::auth::{RECHECK_AFTER, RECHECK_GRACE, SESSION_IDLE, SESSION_LIFETIME};
use mvp_roadmap::store::Session;
use serde_json::json;

#[tokio::test]
async fn an_admin_signs_in_with_github() {
    let app = TestApp::new().await;
    app.github.set("Filmoo", Some("admin"));

    let start = app.get("/auth/login", &Who::Nobody).await;
    assert_eq!(start.status, StatusCode::SEE_OTHER);
    let location = start.header("location");
    assert!(
        location.starts_with(&format!(
            "{}/login/oauth/authorize?client_id=gh-client&",
            app.github.url
        )),
        "{location}"
    );
    assert!(location.contains("redirect_uri=https%3A%2F%2Fdev.mvpgg.com%2Fauth%2Fcallback"));
    assert!(location.contains("code_challenge_method=S256"));
    assert!(
        !location.contains("scope="),
        "no scope is asked for: {location}"
    );
    let state_cookie = start.set_cookie("__Host-mvp_roadmap_state").unwrap();
    for part in [
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Path=/",
        "Max-Age=600",
    ] {
        assert!(state_cookie.contains(part), "{state_cookie}");
    }

    let back = app.github_round_trip("Filmoo").await;
    assert_eq!(back.status, StatusCode::SEE_OTHER, "{}", back.text());
    assert_eq!(back.header("location"), "/");
    let session = back.set_cookie("__Host-mvp_roadmap").unwrap();
    for part in [
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Path=/",
        &format!("Max-Age={SESSION_LIFETIME}"),
    ] {
        assert!(session.contains(part), "{session}");
    }
    // The state cookie is spent.
    assert!(
        back.set_cookie("__Host-mvp_roadmap_state")
            .unwrap()
            .contains("Max-Age=0")
    );

    let cookie = back.cookie_value("__Host-mvp_roadmap").unwrap();
    let me = app
        .get(
            "/api/me",
            &Who::Owner {
                cookie,
                csrf: String::new(),
            },
        )
        .await;
    assert_eq!(me.status, StatusCode::OK);
    let me = me.json();
    assert_eq!(me["kind"], "owner");
    assert_eq!(me["login"], "Filmoo");
    assert_eq!(me["name"], "Filmoo (name)");
    assert_eq!(me["repo"], "Filmoo/MVP");
    assert_eq!(me["csrf"].as_str().unwrap().len(), 43);

    let owner = app.owner().await;
    let log = app.get("/api/audit", &owner).await.json();
    let signed_in = log["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["action"] == "auth.sign_in")
        .count();
    assert_eq!(signed_in, 2);
    // The database keeps neither the cookie nor the token in clear.
    let stored = app
        .state
        .store()
        .session(
            &Keys::new(&SESSION_KEY)
                .session_hash(&back.cookie_value("__Host-mvp_roadmap").unwrap()),
        )
        .unwrap()
        .unwrap();
    assert!(
        stored
            .github_token
            .as_ref()
            .is_some_and(|t| !t.windows(12).any(|w| w == b"tok-Filmoo"))
    );
    assert!(!format!("{stored:?}").contains(&stored.csrf));
}

#[tokio::test]
async fn anyone_else_gets_the_403_page() {
    let app = TestApp::new().await;
    for (login, permission, says) in [
        (
            "pusher",
            Some("write"),
            "can push to <strong>Filmoo/MVP</strong>",
        ),
        (
            "reader",
            Some("read"),
            "can read <strong>Filmoo/MVP</strong>",
        ),
        (
            "stranger",
            None,
            "isn't an admin of <strong>Filmoo/MVP</strong>",
        ),
    ] {
        app.github.set(login, permission);
        let reply = app.github_round_trip(login).await;
        assert_eq!(reply.status, StatusCode::FORBIDDEN, "{login}");
        assert!(reply.header("content-type").starts_with("text/html"));
        let page = reply.text();
        assert!(page.contains("This roadmap is private"), "{page}");
        assert!(
            page.contains(&format!("@{login}")) && page.contains(says),
            "{page}"
        );
        assert!(
            reply.set_cookie("__Host-mvp_roadmap").is_none(),
            "no session for {login}"
        );
    }
    let owner = app.owner().await;
    let log = app.get("/api/audit", &owner).await.json();
    let refused: Vec<&str> = log["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["action"] == "auth.denied")
        .map(|e| e["actor"]["name"].as_str().unwrap())
        .collect();
    assert_eq!(refused, ["stranger", "reader", "pusher"]);
}

#[tokio::test]
async fn a_callback_needs_the_state_this_browser_started() {
    let app = TestApp::new().await;
    app.github.set("Filmoo", Some("admin"));
    let start = app.get("/auth/login", &Who::Nobody).await;
    let location = start.header("location");
    let state = location
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap()
        .to_owned();
    let cookie = format!(
        "__Host-mvp_roadmap_state={}",
        start.cookie_value("__Host-mvp_roadmap_state").unwrap()
    );

    // No cookie (the link was opened elsewhere), or another state.
    for (uri, header) in [
        (
            format!("/auth/callback?code=code-Filmoo&state={state}"),
            None,
        ),
        (
            "/auth/callback?code=code-Filmoo&state=forged".to_owned(),
            Some(cookie.as_str()),
        ),
        ("/auth/callback?state=x".to_owned(), Some(cookie.as_str())),
        (
            "/auth/callback?error=access_denied".to_owned(),
            Some(cookie.as_str()),
        ),
    ] {
        let extra: Vec<(&str, &str)> = header.map(|h| ("cookie", h)).into_iter().collect();
        let reply = app
            .send(Method::GET, &uri, &Who::Nobody, None, &extra)
            .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{uri}");
        assert!(reply.set_cookie("__Host-mvp_roadmap").is_none());
    }

    // A state works once, and not after ten minutes.
    let first = app.github_round_trip("Filmoo").await;
    assert_eq!(first.status, StatusCode::SEE_OTHER);
    let start = app.get("/auth/login", &Who::Nobody).await;
    let state = start
        .header("location")
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap()
        .to_owned();
    let cookie = format!(
        "__Host-mvp_roadmap_state={}",
        start.cookie_value("__Host-mvp_roadmap_state").unwrap()
    );
    app.clock.advance(11 * 60);
    let late = app
        .send(
            Method::GET,
            &format!("/auth/callback?code=code-x&state={state}"),
            &Who::Nobody,
            None,
            &[("cookie", &cookie)],
        )
        .await;
    assert_eq!(late.status, StatusCode::BAD_REQUEST);
    assert!(late.text().contains("expired"));
}

#[tokio::test]
async fn github_down_during_sign_in_is_not_a_refusal() {
    let app = TestApp::new().await;
    app.github.set("Filmoo", Some("admin"));
    app.github.down(true);
    let reply = app.github_round_trip("Filmoo").await;
    assert_eq!(reply.status, StatusCode::BAD_GATEWAY);
    assert!(
        reply.text().contains("GitHub didn&#39;t answer"),
        "{}",
        reply.text()
    );
    assert!(reply.set_cookie("__Host-mvp_roadmap").is_none());
}

#[tokio::test]
async fn sign_in_attempts_are_rate_limited() {
    let app = TestApp::new().await;
    for _ in 0..10 {
        assert_eq!(
            app.get("/auth/login", &Who::Nobody).await.status,
            StatusCode::SEE_OTHER
        );
    }
    let blocked = app.get("/auth/login", &Who::Nobody).await;
    assert_eq!(blocked.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(blocked.header("retry-after"), "600");
    app.clock.advance(600);
    assert_eq!(
        app.get("/auth/login", &Who::Nobody).await.status,
        StatusCode::SEE_OTHER
    );
}

#[tokio::test]
async fn sessions_end_when_idle_and_after_a_week() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    assert_eq!(app.get("/api/roadmap", &owner).await.status, StatusCode::OK);

    // Idle for two days: gone.
    app.clock.advance(SESSION_IDLE);
    let reply = app.get("/api/roadmap", &owner).await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply.json()["error"], "signedOut");

    // Used every day: still gone a week after sign-in.
    let owner = app.owner().await;
    for _ in 0..6 {
        app.clock.advance(24 * 60 * 60);
        assert_eq!(app.get("/api/roadmap", &owner).await.status, StatusCode::OK);
    }
    app.clock.advance(24 * 60 * 60);
    assert_eq!(
        app.get("/api/roadmap", &owner).await.status,
        StatusCode::UNAUTHORIZED
    );

    // A cookie nobody issued.
    let forged = Who::Owner {
        cookie: "x".repeat(43),
        csrf: String::new(),
    };
    assert_eq!(
        app.get("/api/roadmap", &forged).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.get("/api/roadmap", &Who::Nobody).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn admin_rights_are_asked_again() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    app.clock.advance(RECHECK_AFTER - 1);
    app.github.set("Filmoo", Some("write"));
    // Checked less than ten minutes ago: GitHub isn't asked.
    assert_eq!(app.get("/api/roadmap", &owner).await.status, StatusCode::OK);
    app.clock.advance(2);
    let reply = app.get("/api/roadmap", &owner).await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    assert_eq!(reply.json()["error"], "notAdmin");
    // The session is gone for good.
    app.github.set("Filmoo", Some("admin"));
    assert_eq!(
        app.get("/api/roadmap", &owner).await.status,
        StatusCode::UNAUTHORIZED
    );

    // Still an admin: the check moves on.
    let owner = app.owner().await;
    app.clock.advance(RECHECK_AFTER + 1);
    assert_eq!(app.get("/api/roadmap", &owner).await.status, StatusCode::OK);
}

#[tokio::test]
async fn a_github_outage_keeps_a_recent_session_for_an_hour() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    app.github.down(true);
    app.clock.advance(RECHECK_AFTER + 1);
    assert_eq!(app.get("/api/roadmap", &owner).await.status, StatusCode::OK);
    app.clock.advance(RECHECK_GRACE);
    let reply = app.get("/api/roadmap", &owner).await;
    assert_eq!(reply.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(reply.json()["error"], "githubUnavailable");
    app.github.down(false);
    assert_eq!(app.get("/api/roadmap", &owner).await.status, StatusCode::OK);
}

#[tokio::test]
async fn changes_need_the_csrf_token_and_our_origin() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let Who::Owner { cookie, csrf } = owner.clone() else {
        unreachable!()
    };
    let version = app.version_id(&owner, "0.4").await;
    let body = json!({ "title": "A new idea", "versionId": version, "area": "draft" });
    let session = format!("__Host-mvp_roadmap={cookie}");

    let bare = app
        .send(
            Method::POST,
            "/api/features",
            &Who::Nobody,
            Some(body.clone()),
            &[("cookie", &session)],
        )
        .await;
    assert_eq!(bare.status, StatusCode::FORBIDDEN);
    assert_eq!(bare.json()["error"], "csrf");
    let wrong = app
        .send(
            Method::POST,
            "/api/features",
            &Who::Nobody,
            Some(body.clone()),
            &[("cookie", &session), ("x-csrf-token", "nope")],
        )
        .await;
    assert_eq!(wrong.json()["error"], "csrf");
    let foreign = app
        .send(
            Method::POST,
            "/api/features",
            &Who::Nobody,
            Some(body.clone()),
            &[
                ("cookie", &session),
                ("x-csrf-token", &csrf),
                ("origin", "https://evil.example"),
            ],
        )
        .await;
    assert_eq!(foreign.status, StatusCode::FORBIDDEN);
    assert_eq!(foreign.json()["error"], "badOrigin");
    let ours = app
        .send(
            Method::POST,
            "/api/features",
            &Who::Nobody,
            Some(body),
            &[
                ("cookie", &session),
                ("x-csrf-token", &csrf),
                ("origin", PUBLIC_URL),
            ],
        )
        .await;
    assert_eq!(ours.status, StatusCode::CREATED, "{}", ours.text());
    assert_eq!(ours.json()["status"], "accepted");
    assert_eq!(ours.json()["proposedBy"], "owner");
    // Reads need no CSRF token.
    assert_eq!(app.get("/api/roadmap", &owner).await.status, StatusCode::OK);
}

#[tokio::test]
async fn claude_proposes_comments_and_moves_accepted_work_only() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let claude = app.claude();
    let later = app.version_id(&claude, "0.4").await;

    let me = app.get("/api/me", &claude).await.json();
    assert_eq!(
        (
            me["kind"].as_str(),
            me["login"].as_str(),
            me["csrf"].is_null()
        ),
        (Some("claude"), Some("claude"), true)
    );

    // Proposes (no CSRF needed: no cookie), never more.
    let proposal = app
        .post(
            "/api/features",
            &claude,
            json!({ "title": "Heatmaps", "versionId": later, "area": "live" }),
        )
        .await;
    assert_eq!(proposal.status, StatusCode::CREATED);
    assert_eq!(
        (
            proposal.json()["status"].as_str(),
            proposal.json()["proposedBy"].as_str()
        ),
        (Some("proposed"), Some("claude"))
    );
    let proposal = proposal.json()["id"].as_i64().unwrap();
    let accepted = app
        .post(
            "/api/features",
            &claude,
            json!({ "title": "X", "versionId": later, "area": "live", "status": "accepted" }),
        )
        .await;
    assert_eq!(accepted.status, StatusCode::FORBIDDEN);

    // Can't accept or reject a proposal, its own or another.
    for status in ["accepted", "rejected"] {
        let reply = app
            .post(
                &format!("/api/features/{proposal}/status"),
                &claude,
                json!({ "status": status }),
            )
            .await;
        assert_eq!(reply.status, StatusCode::FORBIDDEN, "{status}");
        assert_eq!(reply.json()["error"], "notAllowed");
    }

    // Works on what the owner accepted.
    let trends = app.id_of(&owner, "Tier list trends").await;
    for status in ["in_progress", "done", "in_progress"] {
        let reply = app
            .post(
                &format!("/api/features/{trends}/status"),
                &claude,
                json!({ "status": status }),
            )
            .await;
        assert_eq!(reply.status, StatusCode::OK, "{status}: {}", reply.text());
    }
    let reply = app
        .post(
            &format!("/api/features/{trends}/status"),
            &claude,
            json!({ "status": "rejected" }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    let link = app
        .post(
            &format!("/api/features/{trends}/links"),
            &claude,
            json!({ "url": "https://github.com/Filmoo/MVP/commit/abc1234", "label": "abc1234" }),
        )
        .await;
    assert_eq!(link.status, StatusCode::CREATED);
    let link_on_proposal = app
        .post(
            &format!("/api/features/{proposal}/links"),
            &claude,
            json!({ "url": "https://x.dev" }),
        )
        .await;
    assert_eq!(link_on_proposal.status, StatusCode::FORBIDDEN);

    // Comments anywhere.
    let comment = app
        .post(
            &format!("/api/features/{proposal}/comments"),
            &claude,
            json!({ "body": "Deaths by minute, from timelines." }),
        )
        .await;
    assert_eq!(comment.status, StatusCode::CREATED);
    assert_eq!(
        comment.json()["author"],
        json!({ "kind": "claude", "name": "claude" })
    );

    // Everything else is the owner's.
    let version = app.version_id(&owner, "0.3").await;
    let denied = [
        app.patch(
            &format!("/api/features/{trends}"),
            &claude,
            json!({ "title": "Renamed" }),
        )
        .await,
        app.delete(&format!("/api/features/{trends}"), &claude)
            .await,
        app.post(
            &format!("/api/features/{trends}/move"),
            &claude,
            json!({ "versionId": version }),
        )
        .await,
        app.post("/api/versions", &claude, json!({ "name": "0.5" }))
            .await,
        app.patch(
            &format!("/api/versions/{version}"),
            &claude,
            json!({ "goal": "x" }),
        )
        .await,
        app.post("/api/areas", &claude, json!({ "name": "Tools" }))
            .await,
    ];
    for reply in denied {
        assert_eq!(reply.status, StatusCode::FORBIDDEN, "{}", reply.text());
    }

    // The owner decides.
    let accept = app
        .post(
            &format!("/api/features/{proposal}/status"),
            &owner,
            json!({ "status": "accepted" }),
        )
        .await;
    assert_eq!(accept.status, StatusCode::OK);
    let log = app.get("/api/audit", &owner).await.json();
    let actions: Vec<(String, String)> = log["entries"]
        .as_array()
        .unwrap()
        .iter()
        .take(3)
        .map(|e| {
            (
                e["actor"]["kind"].as_str().unwrap().to_owned(),
                e["action"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        actions,
        [
            ("owner".to_owned(), "feature.status".to_owned()),
            ("claude".to_owned(), "comment.create".to_owned()),
            ("claude".to_owned(), "link.add".to_owned()),
        ]
    );
}

#[tokio::test]
async fn unknown_and_revoked_tokens_are_refused() {
    let app = TestApp::new().await;
    let claude = app.claude();
    assert_eq!(
        app.get("/api/roadmap", &claude).await.status,
        StatusCode::OK
    );
    let Who::Claude(token) = &claude else {
        unreachable!()
    };
    app.state
        .store()
        .revoke_token("claude", &mvp_roadmap::model::Actor::system("test"), T0)
        .unwrap();
    let revoked = app.get("/api/roadmap", &Who::Claude(token.clone())).await;
    assert_eq!(revoked.status, StatusCode::UNAUTHORIZED);
    for _ in 0..19 {
        let reply = app
            .get("/api/roadmap", &Who::Claude("mvpr_guess".into()))
            .await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    }
    let blocked = app
        .get("/api/roadmap", &Who::Claude("mvpr_guess".into()))
        .await;
    assert_eq!(blocked.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(blocked.json()["error"], "rateLimited");
}

#[tokio::test]
async fn signing_out_ends_the_session() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let Who::Owner { cookie, .. } = &owner else {
        unreachable!()
    };
    let without_csrf = app
        .send(
            Method::POST,
            "/auth/logout",
            &Who::Nobody,
            None,
            &[("cookie", &format!("__Host-mvp_roadmap={cookie}"))],
        )
        .await;
    assert_eq!(without_csrf.status, StatusCode::FORBIDDEN);
    let out = app
        .send(Method::POST, "/auth/logout", &owner, None, &[])
        .await;
    assert_eq!(out.status, StatusCode::NO_CONTENT);
    assert!(
        out.set_cookie("__Host-mvp_roadmap")
            .unwrap()
            .contains("Max-Age=0")
    );
    assert_eq!(
        app.get("/api/roadmap", &owner).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn dev_login_signs_in_a_fake_admin_without_github() {
    let app = TestApp::with(true, Some(common::SEED)).await;
    let reply = app.get("/auth/login", &Who::Nobody).await;
    assert_eq!(reply.status, StatusCode::SEE_OTHER);
    assert_eq!(reply.header("location"), "/");
    let line = reply.set_cookie("mvp_roadmap").unwrap();
    assert!(
        line.contains("HttpOnly") && line.contains("SameSite=Strict") && !line.contains("Secure"),
        "{line}"
    );
    let cookie = reply.cookie_value("mvp_roadmap").unwrap();
    let me = app
        .get(
            "/api/me",
            &Who::Owner {
                cookie: cookie.clone(),
                csrf: String::new(),
            },
        )
        .await
        .json();
    assert_eq!(
        (me["login"].as_str(), me["dev"].as_bool()),
        (Some("dev-admin"), Some(true))
    );
    // The reset the UI tests use.
    let owner = Who::Owner {
        cookie,
        csrf: me["csrf"].as_str().unwrap().to_owned(),
    };
    let removed = app.id_of(&owner, "Live names").await;
    assert_eq!(
        app.delete(&format!("/api/features/{removed}"), &owner)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        app.post("/api/dev/reset", &Who::Nobody, json!({}))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    let roadmap = app.roadmap(&owner).await;
    assert!(
        roadmap["features"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f["removedAt"].is_null())
    );
}

#[tokio::test]
async fn production_has_no_dev_routes_and_refuses_dev_sessions() {
    let app = TestApp::new().await;
    assert_eq!(
        app.post("/api/dev/reset", &Who::Nobody, json!({}))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    // A dev session found in a production database (copied over, say) opens nothing.
    let hash = Keys::new(&SESSION_KEY).session_hash("dev-cookie");
    let session = Session {
        login: "dev-admin".into(),
        github_id: 0,
        name: "Dev admin".into(),
        avatar_url: String::new(),
        csrf: "c".into(),
        github_token: None,
        dev: true,
        created_at: T0,
        last_seen_at: T0,
        verified_at: T0,
        expires_at: T0 + SESSION_LIFETIME,
    };
    app.state.store().insert_session(&hash, &session).unwrap();
    let reply = app
        .get(
            "/api/roadmap",
            &Who::Owner {
                cookie: "dev-cookie".into(),
                csrf: "c".into(),
            },
        )
        .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn every_answer_carries_the_security_headers() {
    let app = TestApp::new().await;
    for uri in ["/", "/api/roadmap", "/auth/login", "/nope", "/health"] {
        let reply = app.get(uri, &Who::Nobody).await;
        assert_eq!(
            reply.header("x-robots-tag"),
            "noindex, nofollow, noarchive",
            "{uri}"
        );
        let csp = reply.header("content-security-policy");
        assert!(
            csp.contains("default-src 'none'") && csp.contains("frame-ancestors 'none'"),
            "{uri}: {csp}"
        );
        assert!(!csp.contains("unsafe-inline"), "{uri}");
        assert_eq!(reply.header("x-frame-options"), "DENY");
        assert_eq!(reply.header("x-content-type-options"), "nosniff");
        assert_eq!(
            reply.header("strict-transport-security"),
            "max-age=31536000"
        );
    }
    assert_eq!(
        app.get("/api/roadmap", &Who::Nobody)
            .await
            .header("cache-control"),
        "no-store"
    );
    let robots = app.get("/robots.txt", &Who::Nobody).await;
    assert_eq!(robots.text(), "User-agent: *\nDisallow: /\n");
    let health = app.get("/health", &Who::Nobody).await.json();
    assert_eq!(health["ok"], true);
    let css = app.get("/_/page.css", &Who::Nobody).await;
    assert!(css.header("content-type").starts_with("text/css") && css.text().contains("--accent"));
    let unknown = app.get("/api/nope", &app.owner().await).await;
    assert_eq!(
        (unknown.status, unknown.json()["error"].as_str()),
        (StatusCode::NOT_FOUND, Some("notFound"))
    );
}
