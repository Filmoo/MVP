//! The roadmap through its API: features created, edited, ordered, removed and restored,
//! comments and links, versions and areas, and the audit log behind all of it.
#![allow(
    clippy::unwrap_used,
    clippy::too_many_lines,
    reason = "tests, each one story"
)]

mod common;

use axum::http::StatusCode;
use common::{TestApp, Who};
use serde_json::{Value, json};

async fn create(app: &TestApp, who: &Who, title: &str, version: &str) -> i64 {
    let version = app.version_id(who, version).await;
    let reply = app
        .post(
            "/api/features",
            who,
            json!({ "title": title, "versionId": version, "area": "draft" }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.text());
    reply.json()["id"].as_i64().unwrap()
}

#[tokio::test]
async fn features_are_created_read_and_edited() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let later = app.version_id(&owner, "0.4").await;
    let created = app
        .post(
            "/api/features",
            &owner,
            json!({ "title": "  Post-game graphs  ", "description": "Gold and **damage** over time.", "versionId": later, "area": "live", "status": "proposed" }),
        )
        .await;
    assert_eq!(created.status, StatusCode::CREATED);
    let feature = created.json();
    assert_eq!(feature["title"], "Post-game graphs");
    assert_eq!(feature["status"], "proposed");
    assert_eq!(feature["proposedBy"], "owner");
    assert_eq!(feature["position"], 2, "after the version's two features");
    assert_eq!(feature["createdAt"], "2026-09-29T12:00:00Z");
    let id = feature["id"].as_i64().unwrap();

    app.clock.advance(60);
    let edited = app
        .patch(&format!("/api/features/{id}"), &owner, json!({ "title": "After-game graphs", "description": "Gold, damage and XP.", "area": "draft" }))
        .await;
    assert_eq!(edited.status, StatusCode::OK, "{}", edited.text());
    let edited = edited.json();
    assert_eq!(
        (edited["title"].as_str(), edited["area"].as_str()),
        (Some("After-game graphs"), Some("draft"))
    );
    assert_eq!(edited["updatedAt"], "2026-09-29T12:01:00Z");

    // A new version puts it at the end there.
    let now = app.version_id(&owner, "0.3").await;
    let moved = app
        .patch(
            &format!("/api/features/{id}"),
            &owner,
            json!({ "versionId": now }),
        )
        .await
        .json();
    assert_eq!(
        (moved["versionId"].as_i64(), moved["position"].as_i64()),
        (Some(now), Some(2))
    );
    assert_eq!(
        app.order(&owner, "0.4").await,
        ["Tier list trends", "Uptime alerts"]
    );

    // Status: started and done dates follow.
    let started = app
        .post(
            &format!("/api/features/{id}/status"),
            &owner,
            json!({ "status": "in_progress" }),
        )
        .await
        .json();
    assert_eq!(started["startedAt"], "2026-09-29T12:01:00Z");
    assert!(started["doneAt"].is_null());
    app.clock.advance(3600);
    let done = app
        .post(
            &format!("/api/features/{id}/status"),
            &owner,
            json!({ "status": "done" }),
        )
        .await
        .json();
    assert_eq!(
        (done["startedAt"].as_str(), done["doneAt"].as_str()),
        (Some("2026-09-29T12:01:00Z"), Some("2026-09-29T13:01:00Z"))
    );
    let reopened = app
        .post(
            &format!("/api/features/{id}/status"),
            &owner,
            json!({ "status": "accepted" }),
        )
        .await
        .json();
    assert!(reopened["doneAt"].is_null());

    let detail = app.get(&format!("/api/features/{id}"), &owner).await.json();
    let history: Vec<&str> = detail["activity"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["summary"].as_str().unwrap())
        .collect();
    assert_eq!(
        history,
        [
            "Proposed “Post-game graphs” in 0.4",
            "Edited “After-game graphs”: title, description, area",
            "Edited “After-game graphs”: version",
            "“After-game graphs”: Proposed → In progress",
            "“After-game graphs”: In progress → Done",
            "“After-game graphs”: Done → Accepted",
        ]
    );

    // Mistakes are 400s with words.
    for (body, says) in [
        (
            json!({ "title": " ", "versionId": later, "area": "draft" }),
            "a title is needed",
        ),
        (
            json!({ "title": "x".repeat(201), "versionId": later, "area": "draft" }),
            "titles stay under 200 characters",
        ),
        (
            json!({ "title": "X", "versionId": 999, "area": "draft" }),
            "there is no version 999",
        ),
        (
            json!({ "title": "X", "versionId": later, "area": "nope" }),
            "there is no area \"nope\"",
        ),
        (
            json!({ "title": "X", "versionId": later, "area": "draft", "extra": 1 }),
            "unknown field `extra`",
        ),
    ] {
        let reply = app.post("/api/features", &owner, body).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST);
        assert_eq!(reply.json()["error"], "invalid");
        assert!(
            reply.json()["message"].as_str().unwrap().contains(says),
            "{}",
            reply.text()
        );
    }
    assert_eq!(
        app.get("/api/features/999", &owner).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn features_keep_their_place_when_moved() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let (a, b, c) = (
        create(&app, &owner, "A", "0.3").await,
        create(&app, &owner, "B", "0.3").await,
        create(&app, &owner, "C", "0.3").await,
    );
    let (v3, v4) = (
        app.version_id(&owner, "0.3").await,
        app.version_id(&owner, "0.4").await,
    );
    assert_eq!(
        app.order(&owner, "0.3").await,
        ["Settings search", "Live names", "A", "B", "C"]
    );

    // C before A.
    let moved = app
        .post(
            &format!("/api/features/{c}/move"),
            &owner,
            json!({ "versionId": v3, "beforeId": a }),
        )
        .await;
    assert_eq!(moved.status, StatusCode::OK, "{}", moved.text());
    assert_eq!(
        app.order(&owner, "0.3").await,
        ["Settings search", "Live names", "C", "A", "B"]
    );
    let placements: Vec<i64> = moved.json()["placements"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["position"].as_i64().unwrap())
        .collect();
    assert_eq!(placements, [0, 1, 2, 3, 4]);

    // A to the end of 0.4, started on the way (dropped in another lane).
    let moved = app
        .post(
            &format!("/api/features/{a}/move"),
            &owner,
            json!({ "versionId": v4, "status": "in_progress" }),
        )
        .await
        .json();
    assert_eq!(
        (
            moved["feature"]["versionId"].as_i64(),
            moved["feature"]["status"].as_str()
        ),
        (Some(v4), Some("in_progress"))
    );
    assert_eq!(
        app.order(&owner, "0.4").await,
        ["Tier list trends", "Uptime alerts", "A"]
    );
    assert_eq!(
        app.order(&owner, "0.3").await,
        ["Settings search", "Live names", "C", "B"]
    );
    let positions: Vec<(i64, i64)> = moved["placements"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["versionId"].as_i64().unwrap(),
                p["position"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        positions,
        [
            (v4, 0),
            (v4, 1),
            (v4, 2),
            (v3, 0),
            (v3, 1),
            (v3, 2),
            (v3, 3)
        ]
    );

    // B before the first of 0.4.
    let trends = app.id_of(&owner, "Tier list trends").await;
    app.post(
        &format!("/api/features/{b}/move"),
        &owner,
        json!({ "versionId": v4, "beforeId": trends }),
    )
    .await;
    assert_eq!(
        app.order(&owner, "0.4").await,
        ["B", "Tier list trends", "Uptime alerts", "A"]
    );

    // Where it already is: nothing changes, nothing is logged.
    let log_size = app.get("/api/audit", &owner).await.json()["entries"]
        .as_array()
        .unwrap()
        .len();
    app.post(
        &format!("/api/features/{b}/move"),
        &owner,
        json!({ "versionId": v4, "beforeId": trends }),
    )
    .await;
    assert_eq!(
        app.get("/api/audit", &owner).await.json()["entries"]
            .as_array()
            .unwrap()
            .len(),
        log_size
    );

    // Nonsense.
    let itself = app
        .post(
            &format!("/api/features/{b}/move"),
            &owner,
            json!({ "versionId": v4, "beforeId": b }),
        )
        .await;
    assert_eq!(itself.status, StatusCode::BAD_REQUEST);
    let elsewhere = app
        .post(
            &format!("/api/features/{b}/move"),
            &owner,
            json!({ "versionId": v4, "beforeId": c }),
        )
        .await;
    assert_eq!(elsewhere.status, StatusCode::BAD_REQUEST);
    assert!(
        elsewhere.json()["message"]
            .as_str()
            .unwrap()
            .contains("isn't in version 0.4")
    );
}

#[tokio::test]
async fn removing_is_undone_by_restoring() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let live = app.id_of(&owner, "Live names").await;
    let removed = app.delete(&format!("/api/features/{live}"), &owner).await;
    assert_eq!(removed.status, StatusCode::OK);
    assert_eq!(removed.json()["removedAt"], "2026-09-29T12:00:00Z");
    // Still in the roadmap, flagged, so it can come back.
    let roadmap = app.roadmap(&owner).await;
    let flagged = roadmap["features"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["id"] == live)
        .unwrap();
    assert!(!flagged["removedAt"].is_null());
    assert_eq!(app.order(&owner, "0.3").await, ["Settings search"]);

    // A removed feature doesn't change until restored.
    for reply in [
        app.post(
            &format!("/api/features/{live}/status"),
            &owner,
            json!({ "status": "done" }),
        )
        .await,
        app.patch(
            &format!("/api/features/{live}"),
            &owner,
            json!({ "title": "x" }),
        )
        .await,
        app.delete(&format!("/api/features/{live}"), &owner).await,
        app.post(
            &format!("/api/features/{live}/comments"),
            &owner,
            json!({ "body": "x" }),
        )
        .await,
    ] {
        assert_eq!(reply.status, StatusCode::CONFLICT, "{}", reply.text());
    }

    let restored = app
        .post(&format!("/api/features/{live}/restore"), &owner, json!({}))
        .await;
    assert_eq!(restored.status, StatusCode::OK);
    assert!(restored.json()["removedAt"].is_null());
    assert_eq!(
        app.order(&owner, "0.3").await,
        ["Settings search", "Live names"],
        "back where it was"
    );
    assert_eq!(
        app.post(&format!("/api/features/{live}/restore"), &owner, json!({}))
            .await
            .status,
        StatusCode::CONFLICT
    );

    let history: Vec<String> = app
        .get(&format!("/api/features/{live}"), &owner)
        .await
        .json()["activity"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["action"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(history, ["feature.remove", "feature.restore"]);
}

#[tokio::test]
async fn comments_and_links_hang_off_features() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let id = app.id_of(&owner, "Tier list trends").await;
    let comment = app
        .post(
            &format!("/api/features/{id}/comments"),
            &owner,
            json!({ "body": "  Patch over patch, **arrows**.\n" }),
        )
        .await;
    assert_eq!(comment.status, StatusCode::CREATED);
    assert_eq!(comment.json()["body"], "Patch over patch, **arrows**.");
    assert_eq!(
        app.post(
            &format!("/api/features/{id}/comments"),
            &owner,
            json!({ "body": " " })
        )
        .await
        .status,
        StatusCode::BAD_REQUEST
    );

    let link = app
        .post(
            &format!("/api/features/{id}/links"),
            &owner,
            json!({ "url": "https://github.com/Filmoo/MVP/pull/12", "label": "#12" }),
        )
        .await;
    assert_eq!(link.status, StatusCode::CREATED);
    let link_id = link.json()["id"].as_i64().unwrap();
    for bad in ["javascript:alert(1)", "data:text/html,x", "https://"] {
        let reply = app
            .post(
                &format!("/api/features/{id}/links"),
                &owner,
                json!({ "url": bad }),
            )
            .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{bad}");
    }

    let detail = app.get(&format!("/api/features/{id}"), &owner).await.json();
    assert_eq!(detail["feature"]["comments"], 1);
    assert_eq!(
        detail["comments"][0]["author"],
        json!({ "kind": "owner", "name": "Filmoo" })
    );
    assert_eq!(detail["feature"]["links"][0]["label"], "#12");

    assert_eq!(
        app.delete(&format!("/api/features/{id}/links/{link_id}"), &owner)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.delete(&format!("/api/features/{id}/links/{link_id}"), &owner)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    let roadmap = app.roadmap(&owner).await;
    let feature = roadmap["features"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["id"] == id)
        .unwrap();
    assert_eq!(
        (
            feature["links"].as_array().map(Vec::len),
            feature["comments"].as_i64()
        ),
        (Some(0), Some(1))
    );
}

#[tokio::test]
async fn versions_are_planned_ordered_and_dated() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let created = app
        .post(
            "/api/versions",
            &owner,
            json!({ "name": "0.5", "goal": "Overlay-ready", "targetDate": "2026-12-01" }),
        )
        .await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.text());
    let v5 = created.json()["id"].as_i64().unwrap();
    assert_eq!(created.json()["position"], 2);
    assert_eq!(
        app.post("/api/versions", &owner, json!({ "name": "0.5" }))
            .await
            .status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        app.post(
            "/api/versions",
            &owner,
            json!({ "name": "0.6", "targetDate": "soon" })
        )
        .await
        .status,
        StatusCode::BAD_REQUEST
    );

    let v3 = app.version_id(&owner, "0.3").await;
    let released = app
        .patch(
            &format!("/api/versions/{v3}"),
            &owner,
            json!({ "releasedOn": "2026-10-02", "goal": "Shipped" }),
        )
        .await
        .json();
    assert_eq!(
        (released["releasedOn"].as_str(), released["goal"].as_str()),
        (Some("2026-10-02"), Some("Shipped"))
    );
    let cleared = app
        .patch(
            &format!("/api/versions/{v3}"),
            &owner,
            json!({ "releasedOn": null }),
        )
        .await
        .json();
    assert!(cleared["releasedOn"].is_null());
    assert_eq!(cleared["goal"], "Shipped", "absent fields stay");

    let order = app
        .post(
            &format!("/api/versions/{v5}/move"),
            &owner,
            json!({ "beforeId": v3 }),
        )
        .await
        .json();
    let names: Vec<&str> = order
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["0.5", "0.3", "0.4"]);

    assert_eq!(
        app.delete(&format!("/api/versions/{v3}"), &owner)
            .await
            .status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        app.delete(&format!("/api/versions/{v5}"), &owner)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.delete(&format!("/api/versions/{v5}"), &owner)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn areas_take_the_next_free_colour() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let area = app
        .post(
            "/api/areas",
            &owner,
            json!({ "name": "Tier list & builds" }),
        )
        .await;
    assert_eq!(area.status, StatusCode::CREATED);
    assert_eq!(
        area.json(),
        json!({ "key": "tier-list-builds", "name": "Tier list & builds", "color": "rank-master", "position": 2 })
    );
    assert_eq!(
        app.post(
            "/api/areas",
            &owner,
            json!({ "name": "Tier list & builds" })
        )
        .await
        .status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        app.post(
            "/api/areas",
            &owner,
            json!({ "name": "X", "color": "hotpink" })
        )
        .await
        .status,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn every_change_is_in_the_audit_log() {
    let app = TestApp::new().await;
    let owner = app.owner().await;
    let claude = app.claude();
    let id = create(&app, &owner, "Heatmaps", "0.4").await;
    app.clock.advance(5);
    app.post(
        &format!("/api/features/{id}/comments"),
        &claude,
        json!({ "body": "From Match-V5 timelines." }),
    )
    .await;
    app.clock.advance(5);
    app.delete(&format!("/api/features/{id}"), &owner).await;
    app.post(&format!("/api/features/{id}/restore"), &owner, json!({}))
        .await;

    let log = app.get("/api/audit?limit=4", &owner).await.json();
    let entries = log["entries"].as_array().unwrap();
    let lines: Vec<(&str, &str, &str, &str)> = entries
        .iter()
        .map(|e| {
            (
                e["at"].as_str().unwrap(),
                e["actor"]["name"].as_str().unwrap(),
                e["action"].as_str().unwrap(),
                e["summary"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        lines,
        [
            (
                "2026-09-29T12:00:10Z",
                "Filmoo",
                "feature.restore",
                "Restored “Heatmaps”"
            ),
            (
                "2026-09-29T12:00:10Z",
                "Filmoo",
                "feature.remove",
                "Removed “Heatmaps”"
            ),
            (
                "2026-09-29T12:00:05Z",
                "claude",
                "comment.create",
                "Commented on “Heatmaps”"
            ),
            (
                "2026-09-29T12:00:00Z",
                "Filmoo",
                "feature.create",
                "Created “Heatmaps” in 0.4"
            ),
        ]
    );
    assert_eq!(entries[2]["detail"]["excerpt"], "From Match-V5 timelines.");
    assert_eq!(entries[3]["featureId"], id);

    // Older pages continue from `next`, down to Claude's token, the sign-in and the seed.
    let next = log["next"].as_i64().unwrap();
    let older = app
        .get(&format!("/api/audit?before={next}&limit=100"), &owner)
        .await
        .json();
    let actions: Vec<&str> = older["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["action"].as_str().unwrap())
        .collect();
    assert_eq!(actions, ["token.create", "auth.sign_in", "seed.import"]);
    assert_eq!(older["next"], Value::Null);
}
