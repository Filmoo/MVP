//! Build imports against the fake client: what MVP writes, and what it must never touch.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use companion::automation::CoreEvent;
use companion::imports::{
    self, BuildFuture, BuildSource, CURRENT_PAGE, INVENTORY, Importer, MY_SELECTION, PAGES,
};
use domain::{
    Bracket, BuildOption, BuildSection, BuildStats, ClientConnection, ClientStatus, FailReason,
    FlashKey, FlashNote, GameflowPhase, ImportOutcome, ImportPart, ImportRequest, ImportResult,
    ImportWarning, Language, Lock, RemoteConfig, Role, Settings, SkipReason, SpellKey,
};
use lcu::tls::pinned_client_config;
use lcu::{ConnectorConfig, LcuClient};
use mock_lcu::MockLcu;
use serde_json::{Value, json};
use tokio::sync::watch;

const AHRI: u32 = 103;
/// A second champion with a build (a trade's).
const SYNDRA: u32 = 134;
/// A champion without a build.
const LUX: u32 = 99;
const FLASH: u32 = 4;
const IGNITE: u32 = 14;
const SUMMONER_ID: u64 = 2_345_678;
const SESSION: &str = "/lol-champ-select/v1/session";
const HISTORY: &str = "/lol-match-history/v1/products/lol/current-summoner/matches";

fn sets_path() -> String {
    imports::sets_path(SUMMONER_ID)
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────

fn option(ids: &[u32], g: u32) -> BuildSection {
    BuildSection {
        n: 1_000,
        top: vec![BuildOption {
            ids: ids.to_vec(),
            g,
            w: g / 2,
        }],
    }
}

/// Ahri's published build: Electrocute page, Flash + Ignite (lower id first), items.
fn ahri_build(role: Option<Role>) -> BuildStats {
    BuildStats {
        role,
        g: 1_000,
        w: 520,
        runes: option(
            &[
                8100, 8300, 8112, 8139, 8138, 8135, 8345, 8347, 5008, 5008, 5001,
            ],
            400,
        ),
        keystones: option(&[8112], 700),
        spells: option(&[FLASH, IGNITE], 800),
        skills: option(&[1, 3, 2], 600),
        skill_start: option(&[1, 3, 2, 1], 300),
        starts: option(&[1056, 2003, 2003], 700),
        core: option(&[6655, 4645, 3089], 300),
        boots: option(&[3020], 800),
        item4: option(&[3157], 200),
        item5: option(&[3135], 150),
        item6: option(&[3102], 90),
    }
}

/// A build asked for: champion, role, queue, bracket.
type Asked = (u32, Option<Role>, u32, Bracket);

/// Builds for Ahri and Syndra only (at every bracket but `unpublished`), answered after `slow`;
/// remembers what was asked.
#[derive(Debug, Default)]
struct FakeBuilds {
    asked: Mutex<Vec<Asked>>,
    unpublished: Option<Bracket>,
    slow: Option<Duration>,
}

impl BuildSource for FakeBuilds {
    fn build(
        &self,
        champion_id: u32,
        role: Option<Role>,
        queue: u32,
        bracket: Bracket,
    ) -> BuildFuture<'_> {
        self.asked
            .lock()
            .unwrap()
            .push((champion_id, role, queue, bracket));
        let published = self.unpublished != Some(bracket);
        let build = ([AHRI, SYNDRA].contains(&champion_id) && published).then(|| ahri_build(role));
        let slow = self.slow;
        Box::pin(async move {
            if let Some(slow) = slow {
                tokio::time::sleep(slow).await;
            }
            build
        })
    }
}

fn preset(id: u64, name: &str) -> Value {
    json!({ "id": id, "name": name, "isDeletable": false, "isEditable": false, "isActive": false, "current": false,
            "primaryStyleId": 8000, "subStyleId": 8200, "selectedPerkIds": [8005, 9111, 9104, 8014, 8233, 8236, 5005, 5008, 5002], "order": 9 })
}

/// Two presets and two pages of the player's (one current), with fields MVP doesn't know.
fn player_pages() -> Vec<Value> {
    vec![
        preset(1, "Domination"),
        preset(2, "Precision"),
        json!({ "id": 101, "name": "Ahri mid (mine)", "isDeletable": true, "isEditable": true, "isActive": true, "current": true,
                "primaryStyleId": 8200, "subStyleId": 8100, "selectedPerkIds": [8229, 8226, 8210, 8237, 8139, 8135, 5008, 5008, 5001],
                "order": 0, "lastModified": 1_780_000_000_000_i64, "uiPerks": [{ "id": 8229 }], "futureField": { "kept": true } }),
        json!({ "id": 102, "name": "Jungle", "isDeletable": true, "isEditable": true, "isActive": false, "current": false,
                "primaryStyleId": 8000, "subStyleId": 8100, "selectedPerkIds": [8010, 9111, 9104, 8299, 8143, 8135, 5005, 5008, 5001],
                "order": 1, "lastModified": 1_770_000_000_000_i64 }),
    ]
}

fn player_item_sets() -> Value {
    json!({
        "accountId": SUMMONER_ID,
        "itemSets": [
            { "uid": "p-ahri", "title": "My Ahri", "type": "custom", "map": "any", "mode": "any", "sortrank": 1, "startedFrom": "blank",
              "associatedChampions": [AHRI], "associatedMaps": [11], "preferredItemSlots": [{ "id": "3089", "preferredItemSlot": 2 }],
              "blocks": [{ "type": "Mine", "items": [{ "id": "3089", "count": 1 }], "hideIfSummonerSpell": "", "showIfSummonerSpell": "" }],
              "customFlag": true },
            { "uid": "p-all", "title": "All champions", "type": "custom", "map": "any", "mode": "any", "sortrank": 0, "startedFrom": "blank",
              "associatedChampions": [], "associatedMaps": [], "preferredItemSlots": [], "blocks": [] }
        ],
        "timestamp": 1_780_000_000_000_i64,
        "futureField": "kept"
    })
}

/// Recent games: Flash on F three times out of four.
fn flash_on_f_history() -> Value {
    let game = |d: u32, f: u32| json!({ "mapId": 11, "queueId": 420, "participants": [{ "spell1Id": d, "spell2Id": f }] });
    json!({ "games": { "games": [game(IGNITE, FLASH), game(12, FLASH), game(FLASH, IGNITE), game(IGNITE, FLASH)] } })
}

/// Champion select: you (cell 2, mid) on `champion`, locked or hovering, `left_ms` on the clock
/// (`phase` timer), Flash currently on D.
fn champ_select(champion: u32, locked: bool, phase: &str, left_ms: i64) -> Value {
    json!({
        "localPlayerCellId": 2,
        "myTeam": [
            { "cellId": 0, "assignedPosition": "top", "championId": 54, "spell1Id": 12, "spell2Id": 4 },
            { "cellId": 2, "assignedPosition": "middle", "championId": champion, "championPickIntent": AHRI, "spell1Id": FLASH, "spell2Id": 7 }
        ],
        "theirTeam": [{ "cellId": 5, "championId": 39 }],
        "actions": [[{ "id": 1, "actorCellId": 2, "type": "pick", "championId": champion, "completed": locked, "isInProgress": !locked }]],
        "timer": { "phase": phase, "adjustedTimeLeftInPhase": left_ms, "isInfinite": false }
    })
}

/// A client with the player's pages (`owned` custom pages allowed), sets and history.
async fn client_with_player_data(owned: u64) -> MockLcu {
    let mock = MockLcu::start().await.unwrap();
    mock.set(
        companion::profile::CURRENT_SUMMONER,
        json!({ "summonerId": SUMMONER_ID, "accountId": SUMMONER_ID, "gameName": "Fillmo", "tagLine": "7272" }),
    );
    mock.set(PAGES, Value::Array(player_pages()));
    mock.set(
        INVENTORY,
        json!({ "ownedPageCount": owned, "customPageCount": 2, "isCustomPageCreationUnlocked": true }),
    );
    mock.set(&sets_path(), player_item_sets());
    mock.set(HISTORY, flash_on_f_history());
    mock.set(
        imports::GAMEFLOW_SESSION,
        json!({ "phase": "ChampSelect", "gameData": { "queue": { "id": 420, "mapId": 11 } } }),
    );
    mock
}

fn lcu_client(mock: &MockLcu) -> LcuClient {
    let creds = lcu::Lockfile::parse(&mock.lockfile())
        .unwrap()
        .credentials();
    LcuClient::new(
        &creds,
        pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap()
}

struct Setup {
    importer: Importer,
    builds: Arc<FakeBuilds>,
    settings: watch::Sender<Settings>,
    status: watch::Sender<ClientStatus>,
    remote: watch::Sender<RemoteConfig>,
}

fn names() -> imports::ChampionNames {
    Arc::new(|id| match id {
        AHRI => Some("Ahri".to_owned()),
        SYNDRA => Some("Syndra".to_owned()),
        _ => None,
    })
}

/// An importer on `mock`, in `phase`, with `settings`.
fn importer(mock: &MockLcu, phase: GameflowPhase, settings: Settings) -> Setup {
    importer_with(mock, phase, settings, FakeBuilds::default())
}

/// [`importer`], with these `builds`.
fn importer_with(
    mock: &MockLcu,
    phase: GameflowPhase,
    settings: Settings,
    builds: FakeBuilds,
) -> Setup {
    importer_on(lcu_client(mock), phase, settings, builds)
}

/// An importer talking to `client`.
fn importer_on(
    client: LcuClient,
    phase: GameflowPhase,
    settings: Settings,
    builds: FakeBuilds,
) -> Setup {
    let builds = Arc::new(builds);
    let (settings_tx, settings_rx) = watch::channel(settings);
    let (status_tx, status_rx) = watch::channel(ClientStatus {
        connection: ClientConnection::Connected,
        phase,
    });
    let (_client_tx, client_rx) = watch::channel(Some(client));
    let (remote_tx, remote_rx) = watch::channel(RemoteConfig::default());
    Setup {
        importer: Importer::new(
            client_rx,
            status_rx,
            settings_rx,
            remote_rx,
            builds.clone(),
            names(),
            watch::channel(Language::En).1,
        ),
        builds,
        settings: settings_tx,
        status: status_tx,
        remote: remote_tx,
    }
}

/// A click on a champion page's bar (not tied to a champion select).
fn request(parts: &[ImportPart]) -> ImportRequest {
    ImportRequest {
        champion_id: AHRI,
        role: Some(Role::Middle),
        queue: None,
        bracket: None,
        parts: parts.to_vec(),
        champ_select: false,
    }
}

/// A click in Draft: for the champion select.
fn in_draft(parts: &[ImportPart]) -> ImportRequest {
    ImportRequest {
        champ_select: true,
        ..request(parts)
    }
}

fn outcome(result: &ImportResult, part: ImportPart) -> ImportOutcome {
    result
        .parts
        .iter()
        .find(|p| p.part == part)
        .map(|p| p.outcome.clone())
        .unwrap()
}

fn pages_now(mock: &MockLcu) -> Vec<Value> {
    mock.get(PAGES).unwrap().as_array().unwrap().clone()
}

/// The player's pages as they are now, without the client's own current-page flags.
fn player_pages_now(mock: &MockLcu) -> Vec<Value> {
    let strip = |mut page: Value| {
        let fields = page.as_object_mut().unwrap();
        fields.remove("current");
        fields.remove("isActive");
        page
    };
    let ids: Vec<u64> = player_pages()
        .iter()
        .map(|p| p["id"].as_u64().unwrap())
        .collect();
    let mut now: Vec<Value> = pages_now(mock)
        .into_iter()
        .filter(|p| ids.contains(&p["id"].as_u64().unwrap()))
        .map(strip)
        .collect();
    now.sort_by_key(|p| p["id"].as_u64());
    now
}

fn player_pages_before() -> Vec<Value> {
    let mut pages: Vec<Value> = player_pages()
        .into_iter()
        .map(|mut page| {
            let fields = page.as_object_mut().unwrap();
            fields.remove("current");
            fields.remove("isActive");
            page
        })
        .collect();
    pages.sort_by_key(|p| p["id"].as_u64());
    pages
}

fn mvp_pages(mock: &MockLcu) -> Vec<Value> {
    pages_now(mock)
        .into_iter()
        .filter(|p| p["name"].as_str().is_some_and(imports::is_mvp_name))
        .collect()
}

/// Nothing of the player's was modified or deleted.
fn assert_player_pages_untouched(mock: &MockLcu) {
    assert_eq!(player_pages_now(mock), player_pages_before());
    assert_eq!(mock.count_method("DELETE"), 0, "never deletes anything");
    for id in [1, 2, 101, 102] {
        assert_eq!(
            mock.count("PUT", &format!("{PAGES}/{id}")),
            0,
            "page {id} written"
        );
    }
}

// ── Rune pages ────────────────────────────────────────────────────────────────────────────

/// A client that doesn't answer (seen on a real PC: another app held every connection the
/// League client accepts): the import says so, instead of quoting a transport error as the
/// client's refusal.
#[tokio::test]
async fn a_client_that_does_not_answer_is_not_a_refusal() {
    let mock = client_with_player_data(3).await;
    // A port nothing listens on: every request fails before any answer.
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let creds = lcu::Lockfile::parse(&format!("LeagueClient:1:{port}:secret:https"))
        .unwrap()
        .credentials();
    let silent = LcuClient::new(
        &creds,
        pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
    )
    .unwrap();
    let setup = importer_on(
        silent,
        GameflowPhase::ChampSelect,
        Settings::default(),
        FakeBuilds::default(),
    );
    let result = setup
        .importer
        .import(&request(&[ImportPart::Runes]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Failed {
            reason: FailReason::NotAnswering
        }
    );
    assert_eq!(mock.count("POST", PAGES), 0);
}

#[tokio::test]
async fn creates_mvp_page_when_there_is_room() {
    let mock = client_with_player_data(3).await;
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::Runes]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Saved {
            name: "MVP · Ahri Mid".into()
        }
    );
    assert!(!result.automatic);
    let ours = mvp_pages(&mock);
    assert_eq!(ours.len(), 1);
    let page = &ours[0];
    assert_eq!(page["current"], true);
    assert_eq!(page["primaryStyleId"], 8100);
    assert_eq!(page["subStyleId"], 8300);
    assert_eq!(
        page["selectedPerkIds"],
        json!([8112, 8139, 8138, 8135, 8345, 8347, 5008, 5008, 5001])
    );
    assert_eq!(mock.count("POST", PAGES), 1);
    assert_eq!(mock.bodies("PUT", CURRENT_PAGE), vec![page["id"].clone()]);
    assert_player_pages_untouched(&mock);
    assert_eq!(
        setup.builds.asked.lock().unwrap().as_slice(),
        [(AHRI, Some(Role::Middle), 420, Bracket::EmeraldPlus)]
    );
}

#[tokio::test]
async fn the_champion_pages_queue_and_bracket_are_imported() {
    let mock = client_with_player_data(3).await;
    let setup = importer(&mock, GameflowPhase::Idle, Settings::default());
    let diamond = ImportRequest {
        queue: Some(420),
        bracket: Some(Bracket::DiamondPlus),
        ..request(&[ImportPart::ItemSet])
    };
    let result = setup.importer.import(&diamond, false).await;
    assert!(matches!(
        outcome(&result, ImportPart::ItemSet),
        ImportOutcome::Saved { .. }
    ));
    assert_eq!(
        setup.builds.asked.lock().unwrap().as_slice(),
        [(AHRI, Some(Role::Middle), 420, Bracket::DiamondPlus)]
    );
}

#[tokio::test]
async fn the_players_bracket_is_imported_else_emerald() {
    let mock = client_with_player_data(3).await;
    let builds = FakeBuilds {
        unpublished: Some(Bracket::MasterPlus),
        ..FakeBuilds::default()
    };
    let settings = Settings {
        stats_bracket: Bracket::DiamondPlus,
        ..Settings::default()
    };
    let setup = importer_with(&mock, GameflowPhase::Idle, settings, builds);
    let ranked = ImportRequest {
        queue: Some(420),
        ..request(&[ImportPart::ItemSet])
    };
    setup.importer.import(&ranked, false).await;
    // Master+ isn't published yet: Emerald+'s build rather than none.
    setup
        .settings
        .send_modify(|s| s.stats_bracket = Bracket::MasterPlus);
    let result = setup.importer.import(&ranked, false).await;
    assert!(matches!(
        outcome(&result, ImportPart::ItemSet),
        ImportOutcome::Saved { .. }
    ));
    // A page's own bracket is taken as it is.
    let master = ImportRequest {
        bracket: Some(Bracket::MasterPlus),
        ..ranked.clone()
    };
    let result = setup.importer.import(&master, false).await;
    assert!(matches!(
        outcome(&result, ImportPart::ItemSet),
        ImportOutcome::Failed { .. }
    ));
    let middle = Some(Role::Middle);
    assert_eq!(
        setup.builds.asked.lock().unwrap().as_slice(),
        [
            (AHRI, middle, 420, Bracket::DiamondPlus),
            (AHRI, middle, 420, Bracket::MasterPlus),
            (AHRI, middle, 420, Bracket::EmeraldPlus),
            (AHRI, middle, 420, Bracket::MasterPlus),
        ]
    );
}

#[tokio::test]
async fn reuses_mvp_page_instead_of_creating_another() {
    let mock = client_with_player_data(3).await;
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    setup
        .importer
        .import(&request(&[ImportPart::Runes]), false)
        .await;
    let first = mvp_pages(&mock)[0]["id"].clone();
    let support = ImportRequest {
        role: Some(Role::Support),
        ..request(&[ImportPart::Runes])
    };
    let result = setup.importer.import(&support, false).await;
    assert_eq!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Saved {
            name: "MVP · Ahri Support".into()
        }
    );
    let ours = mvp_pages(&mock);
    assert_eq!(ours.len(), 1, "one MVP page, reused");
    assert_eq!(ours[0]["id"], first);
    assert_eq!(ours[0]["name"], "MVP · Ahri Support");
    assert_eq!(mock.count("POST", PAGES), 1, "created once");
    assert_eq!(mock.count("PUT", &format!("{PAGES}/{first}")), 1);
    assert_player_pages_untouched(&mock);
}

#[tokio::test]
async fn a_page_the_player_renamed_mvp_is_used_even_when_full() {
    let mock = client_with_player_data(2).await;
    let mut pages = player_pages();
    pages[3]["name"] = json!("MVP");
    mock.set(PAGES, Value::Array(pages));
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::Runes]), false)
        .await;
    assert!(matches!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Saved { .. }
    ));
    assert_eq!(mock.count("POST", PAGES), 0);
    assert_eq!(mock.count("PUT", &format!("{PAGES}/102")), 1);
    let page = pages_now(&mock)
        .into_iter()
        .find(|p| p["id"] == 102)
        .unwrap();
    assert_eq!(page["name"], "MVP · Ahri Mid");
    assert_eq!(page["current"], true);
    // The other page of the player's is untouched.
    let mine = pages_now(&mock)
        .into_iter()
        .find(|p| p["id"] == 101)
        .unwrap();
    assert_eq!(
        mine["selectedPerkIds"],
        player_pages()[2]["selectedPerkIds"]
    );
    assert_eq!(mine["futureField"], json!({ "kept": true }));
    assert_eq!(mock.count_method("DELETE"), 0);
}

#[tokio::test]
async fn no_free_page_is_a_clear_failure() {
    let mock = client_with_player_data(2).await;
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::Runes]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Failed {
            reason: FailReason::NoFreePage
        }
    );
    assert_eq!(mock.count("POST", PAGES), 0, "checked before trying");
    assert_eq!(pages_now(&mock), player_pages());
    assert_eq!(mock.count_method("DELETE"), 0);
}

#[tokio::test]
async fn the_page_limit_answer_of_the_client_is_understood() {
    // The inventory says there's room, the client says otherwise.
    let mock = client_with_player_data(2).await;
    mock.set(
        INVENTORY,
        json!({ "ownedPageCount": 2, "canAddCustomPage": true }),
    );
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::Runes]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Failed {
            reason: FailReason::NoFreePage
        }
    );
    assert_eq!(pages_now(&mock), player_pages());
}

// ── Item sets ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn item_sets_round_trip_untouched() {
    let mock = client_with_player_data(3).await;
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::ItemSet]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::ItemSet),
        ImportOutcome::Saved {
            name: "MVP · Ahri Mid".into()
        }
    );
    let check = |mock: &MockLcu| {
        let document = mock.get(&sets_path()).unwrap();
        let before = player_item_sets();
        assert_eq!(document["accountId"], before["accountId"]);
        assert_eq!(document["futureField"], "kept");
        let sets = document["itemSets"].as_array().unwrap().clone();
        assert_eq!(sets[0], before["itemSets"][0], "the player's Ahri set");
        assert_eq!(sets[1], before["itemSets"][1], "the player's global set");
        sets
    };
    let sets = check(&mock);
    assert_eq!(sets.len(), 3);
    let ours = &sets[2];
    assert_eq!(ours["title"], "MVP · Ahri Mid");
    assert_eq!(ours["associatedChampions"], json!([AHRI]));
    assert_eq!(ours["associatedMaps"], json!([11]));
    let block = |i: usize| {
        (
            ours["blocks"][i]["type"].as_str().unwrap().to_owned(),
            ours["blocks"][i]["items"].clone(),
        )
    };
    assert_eq!(
        block(0),
        (
            "Starting items".into(),
            json!([{ "id": "1056", "count": 1 }, { "id": "2003", "count": 2 }])
        )
    );
    assert_eq!(
        block(1),
        (
            "Core build (in order)".into(),
            json!([{ "id": "6655", "count": 1 }, { "id": "4645", "count": 1 }, { "id": "3089", "count": 1 }])
        )
    );
    assert_eq!(block(2).1, json!([{ "id": "3020", "count": 1 }]));

    // Again, from support: MVP's set is replaced, still one of ours.
    let support = ImportRequest {
        role: Some(Role::Support),
        ..request(&[ImportPart::ItemSet])
    };
    setup.importer.import(&support, false).await;
    let sets = check(&mock);
    assert_eq!(sets.len(), 3);
    assert_eq!(sets[2]["title"], "MVP · Ahri Support");
    assert_eq!(mock.count("PUT", &sets_path()), 2);
}

// ── Summoner spells ───────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn flash_stays_on_the_players_key() {
    let mock = client_with_player_data(3).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 25_000));
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::Spells]), false)
        .await;
    // Recent games say F; the build lists Flash first (D): Flash stays on F, with a note.
    assert_eq!(
        outcome(&result, ImportPart::Spells),
        ImportOutcome::SpellsSet {
            spell_ids: [IGNITE, FLASH],
            changed: true,
            flash: Some(FlashNote::KeptOnYourKey { key: SpellKey::F }),
        }
    );
    assert_eq!(
        mock.bodies("PATCH", MY_SELECTION),
        vec![json!({ "spell1Id": IGNITE, "spell2Id": FLASH })]
    );
    let me = &mock.get(SESSION).unwrap()["myTeam"][1];
    assert_eq!(
        (me["spell1Id"].clone(), me["spell2Id"].clone()),
        (json!(IGNITE), json!(FLASH))
    );

    // Already like this: nothing is written again.
    let again = setup
        .importer
        .import(&request(&[ImportPart::Spells]), false)
        .await;
    assert!(matches!(
        outcome(&again, ImportPart::Spells),
        ImportOutcome::SpellsSet { changed: false, .. }
    ));
    assert_eq!(mock.count("PATCH", MY_SELECTION), 1);
}

#[tokio::test]
async fn the_flash_key_setting_wins() {
    let mock = client_with_player_data(3).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 25_000));
    let settings = Settings {
        flash_key: FlashKey::D,
        ..Settings::default()
    };
    let setup = importer(&mock, GameflowPhase::ChampSelect, settings);
    let result = setup
        .importer
        .import(&request(&[ImportPart::Spells]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Spells),
        ImportOutcome::SpellsSet {
            spell_ids: [FLASH, IGNITE],
            changed: true,
            flash: None,
        }
    );
    assert_eq!(mock.count("GET", HISTORY), 0, "no need for the history");
}

#[tokio::test]
async fn no_habit_keeps_flash_where_it_is() {
    let mock = client_with_player_data(3).await;
    mock.remove(HISTORY);
    // Flash is on D in the current selection.
    mock.set(SESSION, champ_select(AHRI, true, "FINALIZATION", 25_000));
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::Spells]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Spells),
        ImportOutcome::SpellsSet {
            spell_ids: [FLASH, IGNITE],
            changed: true,
            flash: None,
        }
    );
}

#[tokio::test]
async fn never_in_the_last_seconds() {
    let mock = client_with_player_data(3).await;
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    for (phase, left) in [
        ("FINALIZATION", 4_900),
        ("FINALIZATION", 5_000),
        ("BAN_PICK", 1_000),
        ("GAME_STARTING", 30_000),
    ] {
        mock.set(SESSION, champ_select(AHRI, true, phase, left));
        let result = setup
            .importer
            .import(&request(&[ImportPart::Spells]), false)
            .await;
        assert!(
            matches!(
                outcome(&result, ImportPart::Spells),
                ImportOutcome::Skipped {
                    reason: SkipReason::TooLate { .. }
                }
            ),
            "{phase} {left}"
        );
    }
    assert_eq!(mock.count("PATCH", MY_SELECTION), 0);
}

#[tokio::test]
async fn spells_only_in_champion_select() {
    let mock = client_with_player_data(3).await;
    // The core isn't in champion select: nothing is even read.
    let lobby = importer(&mock, GameflowPhase::Lobby, Settings::default());
    let result = lobby
        .importer
        .import(&request(&[ImportPart::Spells]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Spells),
        ImportOutcome::Skipped {
            reason: SkipReason::NotInChampSelect
        }
    );
    assert!(lobby.builds.asked.lock().unwrap().is_empty());
    // The phase says champion select but the client has no session (it just ended).
    let late = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = late
        .importer
        .import(&request(&[ImportPart::Spells]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Spells),
        ImportOutcome::Skipped {
            reason: SkipReason::NotInChampSelect
        }
    );
    assert_eq!(mock.count("PATCH", MY_SELECTION), 0);
}

// ── Whole imports ─────────────────────────────────────────────────────────────────────────

/// The switches only say what is imported by itself: every part's button works either way.
#[tokio::test]
async fn the_buttons_work_whatever_the_switches() {
    let mock = client_with_player_data(3).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 25_000));
    let off = Settings {
        auto_import_runes: false,
        auto_import_item_set: false,
        auto_import_spells: false,
        ..Settings::default()
    };
    let setup = importer(&mock, GameflowPhase::ChampSelect, off);
    let result = setup
        .importer
        .import(&in_draft(&ImportPart::ALL), false)
        .await;
    assert!(matches!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Saved { .. }
    ));
    assert!(matches!(
        outcome(&result, ImportPart::ItemSet),
        ImportOutcome::Saved { .. }
    ));
    assert!(matches!(
        outcome(&result, ImportPart::Spells),
        ImportOutcome::SpellsSet { changed: true, .. }
    ));
    assert_eq!(mock.count("POST", PAGES), 1);
    assert_eq!(mock.count("PUT", &sets_path()), 1);
    assert_eq!(mock.count("PATCH", MY_SELECTION), 1);
}

const ENDED: ImportOutcome = ImportOutcome::Skipped {
    reason: SkipReason::ChampSelectEnded,
};

/// A click in Draft as champion select ends (the game is starting): nothing is tried, and the
/// player is told so rather than a failure that isn't one.
#[tokio::test]
async fn a_click_as_champion_select_ends_tries_nothing() {
    let mock = client_with_player_data(3).await;
    let setup = importer(&mock, GameflowPhase::Loading, Settings::default());
    let result = setup
        .importer
        .import(&in_draft(&ImportPart::ALL), false)
        .await;
    for part in ImportPart::ALL {
        assert_eq!(outcome(&result, part), ENDED, "{part:?}");
    }
    assert!(
        setup.builds.asked.lock().unwrap().is_empty(),
        "nothing read"
    );
    assert_eq!(writes(&mock), 0);

    // The session's last seconds: the game is starting, nothing can change any more.
    mock.set(SESSION, champ_select(AHRI, true, "GAME_STARTING", 3_000));
    setup
        .status
        .send_modify(|s| s.phase = GameflowPhase::ChampSelect);
    let result = setup
        .importer
        .import(&in_draft(&ImportPart::ALL), false)
        .await;
    for part in ImportPart::ALL {
        assert_eq!(outcome(&result, part), ENDED, "{part:?}");
    }
    assert_eq!(writes(&mock), 0);

    // A champion page's import is for any game: it goes ahead.
    let page = setup
        .importer
        .import(&request(&[ImportPart::Runes]), false)
        .await;
    assert!(matches!(
        outcome(&page, ImportPart::Runes),
        ImportOutcome::Saved { .. }
    ));
}

/// Seen on a real client: a click as champion select ended said "No build for this champion and
/// role" (the session was gone by the time the build was looked up). What happened is said.
#[tokio::test]
async fn champion_select_ending_during_the_import_is_what_it_says() {
    let mock = client_with_player_data(3).await;
    mock.set(SESSION, champ_select(LUX, true, "FINALIZATION", 6_000));
    let builds = FakeBuilds {
        slow: Some(Duration::from_millis(300)),
        ..FakeBuilds::default()
    };
    let setup = importer_with(
        &mock,
        GameflowPhase::ChampSelect,
        Settings::default(),
        builds,
    );
    let lux = ImportRequest {
        champion_id: LUX,
        ..in_draft(&ImportPart::ALL)
    };
    let importer = setup.importer.clone();
    let running = tokio::spawn(async move { importer.import(&lux, false).await });
    tokio::time::sleep(Duration::from_millis(100)).await;
    // The game starts while the build is looked up.
    mock.remove(SESSION);
    setup
        .status
        .send_modify(|s| s.phase = GameflowPhase::Loading);
    let result = running.await.unwrap();
    for part in ImportPart::ALL {
        assert_eq!(outcome(&result, part), ENDED, "{part:?}");
    }
    assert_eq!(writes(&mock), 0);
}

#[tokio::test]
async fn parts_paused_by_the_server_are_never_written() {
    let mock = client_with_player_data(3).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 25_000));
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    // A kill switch for rune pages, the spells feature turned off.
    setup.remote.send_modify(|config| {
        config.kill_switches.rune_import = true;
        config.features.summoner_spells = false;
    });
    let result = setup
        .importer
        .import(&request(&ImportPart::ALL), false)
        .await;
    let paused = ImportOutcome::Skipped {
        reason: SkipReason::Paused,
    };
    assert_eq!(outcome(&result, ImportPart::Runes), paused);
    assert_eq!(outcome(&result, ImportPart::Spells), paused);
    assert!(matches!(
        outcome(&result, ImportPart::ItemSet),
        ImportOutcome::Saved { .. }
    ));
    assert_eq!(mock.count("POST", PAGES), 0);
    assert_eq!(mock.count("PUT", CURRENT_PAGE), 0);
    assert_eq!(mock.count("PATCH", MY_SELECTION), 0);
}

#[tokio::test]
async fn without_a_build_nothing_is_written() {
    let mock = client_with_player_data(3).await;
    mock.set(SESSION, champ_select(99, true, "BAN_PICK", 25_000));
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let lux = ImportRequest {
        champion_id: 99,
        ..request(&ImportPart::ALL)
    };
    let result = setup.importer.import(&lux, false).await;
    for part in ImportPart::ALL {
        assert_eq!(
            outcome(&result, part),
            ImportOutcome::Failed {
                reason: FailReason::NoBuild
            }
        );
    }
    for method in ["POST", "PUT", "PATCH", "DELETE"] {
        assert_eq!(mock.count_method(method), 0, "{method}");
    }
}

#[tokio::test]
async fn aram_uses_aram_builds_without_roles() {
    let mock = client_with_player_data(3).await;
    mock.set(
        imports::GAMEFLOW_SESSION,
        json!({ "gameData": { "queue": { "id": 450, "mapId": 12 } } }),
    );
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::ItemSet]), false)
        .await;
    assert_eq!((result.queue, result.role), (450, None));
    assert_eq!(
        setup.builds.asked.lock().unwrap().as_slice(),
        [(AHRI, None, 450, Bracket::EmeraldPlus)]
    );
    let sets = mock.get(&sets_path()).unwrap();
    assert_eq!(sets["itemSets"][2]["title"], "MVP · Ahri ARAM");
    assert_eq!(sets["itemSets"][2]["associatedMaps"], json!([12]));
}

#[tokio::test]
async fn arena_has_no_builds() {
    let mock = client_with_player_data(3).await;
    mock.set(
        imports::GAMEFLOW_SESSION,
        json!({ "gameData": { "queue": { "id": 1700, "mapId": 30 } } }),
    );
    let setup = importer(&mock, GameflowPhase::ChampSelect, Settings::default());
    let result = setup
        .importer
        .import(&request(&[ImportPart::Runes]), false)
        .await;
    assert_eq!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Failed {
            reason: FailReason::UnsupportedMode
        }
    );
    assert!(setup.builds.asked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn without_a_client_every_part_says_so() {
    let (_settings_tx, settings) = watch::channel(Settings::default());
    let (_status_tx, status) = watch::channel(ClientStatus::not_running());
    let (_client_tx, client) = watch::channel(None);
    let (_remote_tx, remote) = watch::channel(RemoteConfig::default());
    let importer = Importer::new(
        client,
        status,
        settings,
        remote,
        Arc::new(FakeBuilds::default()),
        names(),
        watch::channel(Language::En).1,
    );
    let result = importer.import(&request(&ImportPart::ALL), false).await;
    for part in ImportPart::ALL {
        assert_eq!(
            outcome(&result, part),
            ImportOutcome::Failed {
                reason: FailReason::NoClient
            }
        );
    }
}

// ── Automatic import (first lock-in) ──────────────────────────────────────────────────────

fn config_for(mock: &MockLcu) -> ConnectorConfig {
    let lockfile = mock.lockfile();
    ConnectorConfig {
        discover: Box::new(move || {
            lcu::Lockfile::parse(&lockfile)
                .ok()
                .map(|l| l.credentials())
        }),
        tls: pinned_client_config(mock.ca_pem().as_bytes()).unwrap(),
        paths: vec![],
        poll_interval: Duration::from_millis(50),
        startup_grace: Duration::from_secs(1),
    }
}

/// Every part's "Auto import" switch on.
fn auto_import_all() -> Settings {
    Settings {
        auto_import_runes: true,
        auto_import_item_set: true,
        auto_import_spells: true,
        // Only the imports matter here.
        auto_switch_view: false,
        bring_to_front_on_champ_select: false,
        ..Settings::default()
    }
}

/// Only the rune page's switch on.
fn auto_import_runes() -> Settings {
    Settings {
        auto_import_item_set: false,
        auto_import_spells: false,
        ..auto_import_all()
    }
}

/// A core connected to `mock`, in champion select, hovering Ahri.
async fn in_champ_select(
    mock: &MockLcu,
    settings: Settings,
) -> (
    companion::Companion,
    watch::Sender<Settings>,
    Arc<FakeBuilds>,
) {
    in_champ_select_with(mock, settings, watch::channel(RemoteConfig::default()).1).await
}

/// [`in_champ_select`] following the server's `remote` config.
async fn in_champ_select_with(
    mock: &MockLcu,
    settings: Settings,
    remote: watch::Receiver<RemoteConfig>,
) -> (
    companion::Companion,
    watch::Sender<Settings>,
    Arc<FakeBuilds>,
) {
    let builds = Arc::new(FakeBuilds::default());
    let (settings_tx, settings_rx) = watch::channel(settings);
    let companion = companion::start_with_services(
        config_for(mock),
        settings_rx,
        companion::Services {
            remote,
            builds: builds.clone(),
            names: names(),
            ..companion::Services::default()
        },
    );
    let mut status = companion.status.clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        status.wait_for(|s| s.connection == ClientConnection::Connected),
    )
    .await
    .unwrap()
    .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    mock.set(SESSION, champ_select(AHRI, false, "BAN_PICK", 25_000));
    mock.set(lcu::GAMEFLOW_PHASE, json!("ChampSelect"));
    tokio::time::timeout(
        Duration::from_secs(5),
        status.wait_for(|s| s.phase == GameflowPhase::ChampSelect),
    )
    .await
    .unwrap()
    .unwrap();
    (companion, settings_tx, builds)
}

async fn next_import(companion: &mut companion::Companion) -> ImportResult {
    loop {
        let event = tokio::time::timeout(Duration::from_secs(5), companion.events.recv())
            .await
            .unwrap()
            .unwrap();
        if let CoreEvent::Import(result) = event {
            return result;
        }
    }
}

/// Waits until Draft's warning is `wanted`.
async fn warning_is(companion: &companion::Companion, wanted: Option<&ImportWarning>) {
    let mut warning = companion.import_warning.clone();
    let reached = tokio::time::timeout(
        Duration::from_secs(5),
        warning.wait_for(|now| now.as_ref() == wanted),
    )
    .await;
    assert!(
        reached.is_ok(),
        "warning {:?}, waited for {wanted:?}",
        *companion.import_warning.borrow()
    );
}

fn writes(mock: &MockLcu) -> usize {
    ["POST", "PUT", "PATCH", "DELETE"]
        .iter()
        .map(|m| mock.count_method(m))
        .sum()
}

/// Locked in mid (the fixture's position).
const fn mid(champion_id: u32) -> Lock {
    Lock {
        champion_id,
        role: Some(Role::Middle),
    }
}

#[tokio::test]
async fn imports_once_at_the_first_lock_in() {
    let mock = client_with_player_data(3).await;
    let (mut companion, _settings, _builds) = in_champ_select(&mock, auto_import_all()).await;
    // Hovering: nothing.
    mock.set(SESSION, champ_select(AHRI, false, "BAN_PICK", 20_000));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(writes(&mock), 0, "a hover never imports");

    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 20_000));
    let result = next_import(&mut companion).await;
    assert!(result.automatic);
    assert_eq!(
        (result.champion_id, result.role),
        (AHRI, Some(Role::Middle))
    );
    assert!(matches!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Saved { .. }
    ));
    assert!(matches!(
        outcome(&result, ImportPart::ItemSet),
        ImportOutcome::Saved { .. }
    ));
    assert!(matches!(
        outcome(&result, ImportPart::Spells),
        ImportOutcome::SpellsSet { changed: true, .. }
    ));

    // The same lock, event after event (other players pick, the timer moves on).
    for left in [18_000, 15_000, 30_000] {
        let mut session = champ_select(AHRI, true, "BAN_PICK", left);
        session["theirTeam"][0]["championId"] = json!(left);
        mock.set(SESSION, session);
    }
    mock.set(SESSION, champ_select(AHRI, true, "FINALIZATION", 30_000));
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(mock.count("POST", PAGES), 1);
    assert_eq!(mock.count("PUT", &sets_path()), 1);
    assert_eq!(mock.count("PATCH", MY_SELECTION), 1);
    assert_player_pages_untouched(&mock);
    assert_eq!(*companion.import_warning.borrow(), None);
}

#[tokio::test]
async fn a_kill_switch_stops_the_automatic_import_at_once() {
    let mock = client_with_player_data(3).await;
    let (remote_tx, remote_rx) = watch::channel(RemoteConfig::default());
    let (mut companion, _settings, _builds) =
        in_champ_select_with(&mock, auto_import_all(), remote_rx).await;
    // Switched on in the middle of the champion select: the lock-in leaves rune pages alone.
    remote_tx.send_modify(|config| config.kill_switches.rune_import = true);
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 20_000));
    let result = next_import(&mut companion).await;
    let parts: Vec<ImportPart> = result.parts.iter().map(|p| p.part).collect();
    assert_eq!(parts, vec![ImportPart::ItemSet, ImportPart::Spells]);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(mock.count("POST", PAGES), 0);
    assert_eq!(mock.count("PUT", CURRENT_PAGE), 0);
    assert_player_pages_untouched(&mock);
}

#[tokio::test]
async fn no_automatic_import_when_every_switch_is_off() {
    // Off until the player turns them on.
    let defaults = Settings::default();
    assert!(
        ImportPart::ALL
            .into_iter()
            .all(|p| !defaults.auto_import(p))
    );
    let mock = client_with_player_data(3).await;
    let off = Settings {
        auto_switch_view: false,
        bring_to_front_on_champ_select: false,
        ..defaults
    };
    let (companion, _settings, builds) = in_champ_select(&mock, off).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 20_000));
    tokio::time::sleep(Duration::from_millis(300)).await;
    // A trade: nothing was imported by itself, so nothing to warn about either.
    mock.set(SESSION, champ_select(SYNDRA, true, "BAN_PICK", 18_000));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(writes(&mock), 0);
    assert!(builds.asked.lock().unwrap().is_empty());
    assert_eq!(*companion.import_warning.borrow(), None);
}

#[tokio::test]
async fn a_last_second_lock_sets_spells_on_the_next_turn() {
    let mock = client_with_player_data(3).await;
    let (mut companion, _settings, _builds) = in_champ_select(&mock, auto_import_all()).await;
    // Locked with 2 s left on the pick timer: runes and items now, spells wait.
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 2_000));
    let first = next_import(&mut companion).await;
    let parts: Vec<ImportPart> = first.parts.iter().map(|p| p.part).collect();
    assert_eq!(parts, [ImportPart::Runes, ImportPart::ItemSet]);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(mock.count("PATCH", MY_SELECTION), 0);

    // Still the last seconds: still waiting.
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 1_000));
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(mock.count("PATCH", MY_SELECTION), 0);

    // The next turn starts with time on the clock.
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 27_000));
    let second = next_import(&mut companion).await;
    assert_eq!(second.parts.len(), 1);
    assert!(matches!(
        outcome(&second, ImportPart::Spells),
        ImportOutcome::SpellsSet { changed: true, .. }
    ));
    assert_eq!(mock.count("PATCH", MY_SELECTION), 1);
}

#[tokio::test]
async fn a_trade_after_the_automatic_import_warns_and_does_not_import() {
    let mock = client_with_player_data(3).await;
    let (mut companion, _settings, builds) = in_champ_select(&mock, auto_import_runes()).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 20_000));
    let first = next_import(&mut companion).await;
    assert_eq!(first.parts.len(), 1);
    assert_eq!(*companion.import_warning.borrow(), None);
    let before = writes(&mock);

    // Traded for Syndra: nothing is imported, Draft warns.
    mock.set(SESSION, champ_select(SYNDRA, true, "BAN_PICK", 15_000));
    let warning = ImportWarning {
        built_for: mid(AHRI),
        now: mid(SYNDRA),
        parts: vec![ImportPart::Runes],
    };
    warning_is(&companion, Some(&warning)).await;
    // The new lock's later events and finalization: still nothing by itself.
    mock.set(SESSION, champ_select(SYNDRA, true, "BAN_PICK", 9_000));
    mock.set(SESSION, champ_select(SYNDRA, true, "FINALIZATION", 30_000));
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(writes(&mock), before, "never imported again by itself");
    assert_eq!(
        builds.asked.lock().unwrap().len(),
        1,
        "Syndra's never looked up"
    );
    assert_eq!(mvp_pages(&mock)[0]["name"], "MVP · Ahri Mid");
    assert_eq!(companion.import_warning.borrow().as_ref(), Some(&warning));
}

#[tokio::test]
async fn the_warnings_import_imports_for_the_new_champion() {
    let mock = client_with_player_data(3).await;
    let (mut companion, _settings, builds) = in_champ_select(&mock, auto_import_all()).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 20_000));
    next_import(&mut companion).await;
    mock.set(SESSION, champ_select(SYNDRA, true, "BAN_PICK", 20_000));
    let warning = ImportWarning {
        built_for: mid(AHRI),
        now: mid(SYNDRA),
        parts: ImportPart::ALL.to_vec(),
    };
    warning_is(&companion, Some(&warning)).await;

    // "Import for Syndra": the parts it lists, for the lock it names, from Draft.
    let request = ImportRequest {
        champion_id: warning.now.champion_id,
        role: warning.now.role,
        queue: None,
        bracket: None,
        parts: warning.parts.clone(),
        champ_select: true,
    };
    let result = companion.imports.import(&request, false).await;
    assert_eq!(
        outcome(&result, ImportPart::Runes),
        ImportOutcome::Saved {
            name: "MVP · Syndra Mid".into()
        }
    );
    assert!(matches!(
        outcome(&result, ImportPart::ItemSet),
        ImportOutcome::Saved { .. }
    ));
    assert!(matches!(
        outcome(&result, ImportPart::Spells),
        ImportOutcome::SpellsSet { .. }
    ));
    warning_is(&companion, None).await;
    let ours = mvp_pages(&mock);
    assert_eq!(ours.len(), 1, "MVP's page, replaced");
    assert_eq!(ours[0]["name"], "MVP · Syndra Mid");
    // MVP keeps one set per champion: Syndra's comes next to Ahri's.
    let sets = mock.get(&sets_path()).unwrap();
    let syndra = sets["itemSets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|set| set["title"] == "MVP · Syndra Mid")
        .cloned()
        .unwrap();
    assert_eq!(syndra["associatedChampions"], json!([SYNDRA]));
    assert_eq!(
        builds.asked.lock().unwrap().last().map(|asked| asked.0),
        Some(SYNDRA)
    );
    assert_player_pages_untouched(&mock);
}

/// MVP never watches the player's things: what they change themselves (another page, their
/// spells, their item sets) neither warns nor imports.
#[tokio::test]
async fn the_players_own_changes_never_warn_nor_import() {
    let mock = client_with_player_data(3).await;
    let (mut companion, _settings, _builds) = in_champ_select(&mock, auto_import_all()).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 20_000));
    next_import(&mut companion).await;
    let before = writes(&mock);

    // Their own page made current again, MVP's page edited, MVP's item set deleted…
    let pages: Vec<Value> = pages_now(&mock)
        .into_iter()
        .map(|mut page| {
            let mine = page["id"] == 101;
            page["current"] = json!(mine);
            if page["name"].as_str().is_some_and(imports::is_mvp_name) {
                page["selectedPerkIds"][0] = json!(8128);
            }
            page
        })
        .collect();
    mock.set(PAGES, Value::Array(pages));
    mock.set(&sets_path(), player_item_sets());
    // …and Ghost instead of Ignite, all in the client.
    let mut session = champ_select(AHRI, true, "BAN_PICK", 15_000);
    session["myTeam"][1]["spell1Id"] = json!(6);
    session["myTeam"][1]["spell2Id"] = json!(FLASH);
    mock.set(SESSION, session);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(writes(&mock), before, "nothing imported again");
    assert_eq!(
        *companion.import_warning.borrow(),
        None,
        "nothing to warn about"
    );
}

#[tokio::test]
async fn the_warning_follows_the_switches_and_ends_with_champion_select() {
    let mock = client_with_player_data(3).await;
    let (mut companion, settings, _builds) = in_champ_select(&mock, auto_import_runes()).await;
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 20_000));
    next_import(&mut companion).await;
    mock.set(SESSION, champ_select(SYNDRA, true, "BAN_PICK", 20_000));
    let warning = ImportWarning {
        built_for: mid(AHRI),
        now: mid(SYNDRA),
        parts: vec![ImportPart::Runes],
    };
    warning_is(&companion, Some(&warning)).await;
    // The rune page's switch turned off: nothing left for that one click to import.
    settings.send_modify(|s| s.auto_import_runes = false);
    warning_is(&companion, None).await;
    settings.send_modify(|s| s.auto_import_runes = true);
    warning_is(&companion, Some(&warning)).await;
    // Traded back: MVP's build is for what you play again.
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 18_000));
    warning_is(&companion, None).await;
    mock.set(SESSION, champ_select(SYNDRA, true, "BAN_PICK", 16_000));
    warning_is(&companion, Some(&warning)).await;
    // The game starts.
    mock.set(lcu::GAMEFLOW_PHASE, json!("InProgress"));
    warning_is(&companion, None).await;
}

#[tokio::test]
async fn a_trade_before_deferred_spells_leaves_them_to_the_warning() {
    let mock = client_with_player_data(3).await;
    let (mut companion, _settings, _builds) = in_champ_select(&mock, auto_import_all()).await;
    // Locked with 2 s left: runes and items now, spells wait for time on the clock…
    mock.set(SESSION, champ_select(AHRI, true, "BAN_PICK", 2_000));
    next_import(&mut companion).await;
    // …but a trade comes first: Ahri's spells never go on Syndra.
    mock.set(SESSION, champ_select(SYNDRA, true, "BAN_PICK", 27_000));
    let warning = ImportWarning {
        built_for: mid(AHRI),
        now: mid(SYNDRA),
        parts: ImportPart::ALL.to_vec(),
    };
    warning_is(&companion, Some(&warning)).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(mock.count("PATCH", MY_SELECTION), 0);
}
