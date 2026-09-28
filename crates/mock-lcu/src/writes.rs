//! The client's write endpoints the app uses, with the real client's rules, so tests can check
//! what the app writes and what it must never touch:
//! - rune pages: creating one fails past the page limit (`ownedPageCount` of the inventory),
//!   preset pages can't be edited or deleted, pages are validated (9 perks, two styles);
//! - the current rune page;
//! - item sets: the whole document is replaced (only for the current summoner), validated;
//! - summoner spells (`my-selection`): only during champion select.
//!
//! Changed documents push their events, like the real client.

use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::{Shared, lcu_error};

/// Every rune page, presets included (`isDeletable: false`).
pub const PAGES: &str = "/lol-perks/v1/pages";
/// `ownedPageCount`: how many custom pages the account may have.
pub const INVENTORY: &str = "/lol-perks/v1/inventory";
pub const CURRENT_PAGE: &str = "/lol-perks/v1/currentpage";
/// `…/item-sets/{summonerId}/sets`.
pub const ITEM_SETS: &str = "/lol-item-sets/v1/item-sets/";
pub const MY_SELECTION: &str = "/lol-champ-select/v1/session/my-selection";
pub const CHAMP_SELECT: &str = "/lol-champ-select/v1/session";
pub const CURRENT_SUMMONER: &str = "/lol-summoner/v1/current-summoner";

/// Custom pages allowed when the inventory document isn't set.
const DEFAULT_OWNED_PAGES: u64 = 2;

/// Answers a write the fake client knows; `None` for everything else.
pub(crate) fn route(
    shared: &Shared,
    method: &Method,
    path: &str,
    body: Option<&Value>,
) -> Option<Response> {
    match (method.as_str(), path) {
        ("POST", PAGES) => return Some(create_page(shared, body)),
        ("GET", CURRENT_PAGE) => return Some(current_page(shared)),
        ("PUT", CURRENT_PAGE) => return Some(set_current_page(shared, body)),
        ("PATCH", MY_SELECTION) => return Some(select_spells(shared, body)),
        _ => {}
    }
    if let Some(id) = path
        .strip_prefix(PAGES)
        .and_then(|rest| rest.strip_prefix('/'))
        .and_then(|id| id.parse::<u64>().ok())
    {
        return match method.as_str() {
            "GET" => Some(page(shared, id)),
            "PUT" => Some(update_page(shared, id, body)),
            "DELETE" => Some(delete_page(shared, id)),
            _ => None,
        };
    }
    if method == Method::PUT && summoner_of_item_sets(path).is_some() {
        return Some(put_item_sets(shared, path, body));
    }
    None
}

fn ok(value: Value) -> Response {
    (StatusCode::OK, axum::Json(value)).into_response()
}

fn bad_request(message: &str) -> Response {
    lcu_error(StatusCode::BAD_REQUEST, message)
}

// ── Rune pages ────────────────────────────────────────────────────────────────────────────

fn pages(shared: &Shared) -> Vec<Value> {
    shared
        .get(PAGES)
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

fn id_of(page: &Value) -> Option<u64> {
    page.get("id").and_then(Value::as_u64)
}

fn flag(page: &Value, key: &str) -> bool {
    page.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// Two different styles and nine perks, like the client checks.
fn valid_page(page: &Value) -> bool {
    let style = |key: &str| page.get(key).and_then(Value::as_u64).filter(|&s| s > 0);
    let perks = page
        .get("selectedPerkIds")
        .and_then(Value::as_array)
        .is_some_and(|perks| perks.len() == 9 && perks.iter().all(|p| p.as_u64().is_some()));
    let named = page
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(|n| !n.trim().is_empty());
    matches!((style("primaryStyleId"), style("subStyleId")), (Some(a), Some(b)) if a != b)
        && perks
        && named
}

fn owned_pages(shared: &Shared) -> u64 {
    shared
        .get(INVENTORY)
        .and_then(|i| i.get("ownedPageCount").and_then(Value::as_u64))
        .unwrap_or(DEFAULT_OWNED_PAGES)
}

fn custom_pages(pages: &[Value]) -> u64 {
    pages.iter().filter(|p| flag(p, "isDeletable")).count() as u64
}

/// Saves the pages and keeps the inventory's counters in step.
fn save_pages(shared: &Shared, pages: Vec<Value>) {
    let custom = custom_pages(&pages);
    shared.set(PAGES, Value::Array(pages));
    if let Some(mut inventory) = shared.get(INVENTORY) {
        inventory["customPageCount"] = json!(custom);
        inventory["canAddCustomPage"] = json!(custom < owned_pages(shared));
        shared.set(INVENTORY, inventory);
    }
}

fn make_current(pages: &mut [Value], id: u64) {
    for page in pages {
        let current = id_of(page) == Some(id);
        page["current"] = json!(current);
        page["isActive"] = json!(current);
    }
}

fn create_page(shared: &Shared, body: Option<&Value>) -> Response {
    let Some(body) = body.filter(|b| valid_page(b)) else {
        return bad_request("Invalid rune page");
    };
    let mut all = pages(shared);
    if custom_pages(&all) >= owned_pages(shared) {
        return bad_request("Max pages reached");
    }
    let id = all.iter().filter_map(id_of).max().unwrap_or(1_000) + 1;
    let page = json!({
        "id": id,
        "name": body["name"],
        "primaryStyleId": body["primaryStyleId"],
        "subStyleId": body["subStyleId"],
        "selectedPerkIds": body["selectedPerkIds"],
        "current": false,
        "isActive": false,
        "isDeletable": true,
        "isEditable": true,
        "isValid": true,
        "order": 0,
        "lastModified": 1_790_000_000_000_i64
    });
    // New pages come first in the client's list.
    all.insert(0, page);
    if flag(body, "current") {
        make_current(&mut all, id);
    }
    let created = all.first().cloned().unwrap_or(Value::Null);
    save_pages(shared, all);
    ok(created)
}

fn page(shared: &Shared, id: u64) -> Response {
    match pages(shared).into_iter().find(|p| id_of(p) == Some(id)) {
        Some(page) => ok(page),
        None => lcu_error(StatusCode::NOT_FOUND, "Page not found"),
    }
}

fn update_page(shared: &Shared, id: u64, body: Option<&Value>) -> Response {
    let mut all = pages(shared);
    let Some(index) = all.iter().position(|p| id_of(p) == Some(id)) else {
        return lcu_error(StatusCode::NOT_FOUND, "Page not found");
    };
    let Some(body) = body else {
        return bad_request("Invalid rune page");
    };
    let Some(existing) = all.get(index) else {
        return lcu_error(StatusCode::NOT_FOUND, "Page not found");
    };
    if !flag(existing, "isEditable") {
        return bad_request("Page is not editable");
    }
    let mut next = existing.clone();
    for key in ["name", "primaryStyleId", "subStyleId", "selectedPerkIds"] {
        if let Some(value) = body.get(key) {
            next[key] = value.clone();
        }
    }
    if !valid_page(&next) {
        return bad_request("Invalid rune page");
    }
    next["lastModified"] = json!(1_790_000_000_001_i64);
    if let Some(slot) = all.get_mut(index) {
        *slot = next;
    }
    if flag(body, "current") {
        make_current(&mut all, id);
    }
    let updated = all.get(index).cloned().unwrap_or(Value::Null);
    save_pages(shared, all);
    ok(updated)
}

fn delete_page(shared: &Shared, id: u64) -> Response {
    let mut all = pages(shared);
    let Some(index) = all.iter().position(|p| id_of(p) == Some(id)) else {
        return lcu_error(StatusCode::NOT_FOUND, "Page not found");
    };
    if !all.get(index).is_some_and(|p| flag(p, "isDeletable")) {
        return bad_request("Page is not deletable");
    }
    all.remove(index);
    save_pages(shared, all);
    StatusCode::NO_CONTENT.into_response()
}

fn current_page(shared: &Shared) -> Response {
    match pages(shared).into_iter().find(|p| flag(p, "current")) {
        Some(page) => ok(page),
        None => lcu_error(StatusCode::NOT_FOUND, "No current page"),
    }
}

fn set_current_page(shared: &Shared, body: Option<&Value>) -> Response {
    let Some(id) = body.and_then(Value::as_u64) else {
        return bad_request("Expected a page id");
    };
    let mut all = pages(shared);
    if !all.iter().any(|p| id_of(p) == Some(id)) {
        return lcu_error(StatusCode::NOT_FOUND, "Page not found");
    }
    make_current(&mut all, id);
    save_pages(shared, all);
    StatusCode::NO_CONTENT.into_response()
}

// ── Item sets ─────────────────────────────────────────────────────────────────────────────

/// `/lol-item-sets/v1/item-sets/{summonerId}/sets` → the summoner id.
fn summoner_of_item_sets(path: &str) -> Option<u64> {
    path.strip_prefix(ITEM_SETS)?
        .strip_suffix("/sets")?
        .parse()
        .ok()
}

/// Every set has a uid, a title and blocks of `{ id: "<item id>", count }`.
fn valid_item_sets(document: &Value) -> bool {
    let Some(sets) = document.get("itemSets").and_then(Value::as_array) else {
        return false;
    };
    sets.iter().all(|set| {
        let text = |key: &str| set.get(key).and_then(Value::as_str).is_some();
        let blocks = set
            .get("blocks")
            .and_then(Value::as_array)
            .is_some_and(|blocks| {
                blocks.iter().all(|block| {
                    block
                        .get("items")
                        .and_then(Value::as_array)
                        .is_some_and(|items| {
                            items.iter().all(|item| {
                                item.get("id")
                                    .and_then(Value::as_str)
                                    .is_some_and(|id| id.parse::<u32>().is_ok())
                                    && item.get("count").and_then(Value::as_u64).is_some()
                            })
                        })
                })
            });
        text("uid") && text("title") && blocks
    })
}

fn put_item_sets(shared: &Shared, path: &str, body: Option<&Value>) -> Response {
    let me = shared
        .get(CURRENT_SUMMONER)
        .and_then(|s| s.get("summonerId").and_then(Value::as_u64));
    if me.is_some() && me != summoner_of_item_sets(path) {
        return lcu_error(StatusCode::FORBIDDEN, "Not the current summoner");
    }
    let Some(document) = body.filter(|b| valid_item_sets(b)) else {
        return bad_request("Invalid item sets");
    };
    shared.set(path, document.clone());
    StatusCode::CREATED.into_response()
}

// ── Champion select ───────────────────────────────────────────────────────────────────────

fn select_spells(shared: &Shared, body: Option<&Value>) -> Response {
    let Some(mut session) = shared.get(CHAMP_SELECT) else {
        return lcu_error(StatusCode::NOT_FOUND, "No active delegate");
    };
    let spell = |key: &str| {
        body.and_then(|b| b.get(key))
            .and_then(Value::as_u64)
            .filter(|&s| s > 0)
    };
    let (Some(spell1), Some(spell2)) = (spell("spell1Id"), spell("spell2Id")) else {
        return bad_request("Expected spell1Id and spell2Id");
    };
    if spell1 == spell2 {
        return bad_request("Invalid summoner spells");
    }
    let cell = session.get("localPlayerCellId").and_then(Value::as_i64);
    let Some(me) = session
        .get_mut("myTeam")
        .and_then(Value::as_array_mut)
        .and_then(|team| {
            team.iter_mut()
                .find(|m| m.get("cellId").and_then(Value::as_i64) == cell)
        })
    else {
        return lcu_error(StatusCode::NOT_FOUND, "No local player");
    };
    me["spell1Id"] = json!(spell1);
    me["spell2Id"] = json!(spell2);
    shared.set(CHAMP_SELECT, session);
    StatusCode::NO_CONTENT.into_response()
}
