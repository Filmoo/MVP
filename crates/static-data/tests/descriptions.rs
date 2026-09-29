//! Descriptions for tooltips: Data Dragon's files (cached with the patch) and the stat shards'
//! texts from a fake `CommunityDragon`, downloaded once per patch and language.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use domain::{DescriptionKind, TextTone};
use static_data::DataDragon;

#[derive(Default)]
struct Hits {
    files: AtomicUsize,
    perks: AtomicUsize,
}

/// Data Dragon under `/cdn`, `CommunityDragon` under `/cdragon`, both in English and French.
async fn fake_servers() -> (String, Arc<Hits>, tokio::task::JoinHandle<()>) {
    let hits = Arc::new(Hits::default());
    let app = Router::new()
        .route(
            "/cdn/{version}/data/{locale}/{file}",
            axum::routing::get(|State(h): State<Arc<Hits>>, Path((_v, locale, file)): Path<(String, String, String)>| async move {
                h.files.fetch_add(1, Ordering::SeqCst);
                let french = locale == "fr_FR";
                match file.as_str() {
                    "item.json" if french => Ok(r#"{"data":{"3157":{"plaintext":"x","description":"<mainText><stats><attention>10</attention> puissance</stats><br><br><active>Pause</active><br>Restez <keyword>immobile</keyword>.</mainText>"}}}"#),
                    "item.json" => Ok(r#"{"data":{"3157":{"plaintext":"x","description":"<mainText><stats><attention>10</attention> Ability Power</stats><br><br><active>Pause</active><br>Stand <keyword>still</keyword>.</mainText>"}}}"#),
                    "summoner.json" => Ok(r#"{"data":{"SummonerFlash":{"key":"4","description":"Teleports you.","cooldownBurn":"300"}}}"#),
                    "runesReforged.json" => Ok(r#"[{"id":8000,"slots":[{"runes":[{"id":8010,"shortDesc":"Stacks.","longDesc":"Deal <magicDamage>damage</magicDamage>.<br><br>Cooldown: 20s"}]}]}]"#),
                    _ => Err(StatusCode::NOT_FOUND),
                }
            }),
        )
        .route(
            // Patch 16.19 is mirrored, later ones only as `latest`.
            "/cdragon/{patch}/plugins/rcp-be-lol-game-data/global/{locale}/v1/perks.json",
            axum::routing::get(|State(h): State<Arc<Hits>>, Path((patch, locale)): Path<(String, String)>| async move {
                h.perks.fetch_add(1, Ordering::SeqCst);
                match (patch.as_str(), locale.as_str()) {
                    ("16.19", "default") => Ok(r#"[{"id":8010,"name":"Conqueror","longDesc":"x"},{"id":5008,"name":"Adaptive Force","longDesc":"+9 <font color='#48C4B7'>Adaptive Force</font>"},{"id":5013,"name":"Tenacity","longDesc":"+15% Tenacity"}]"#),
                    ("16.19", "fr_fr") => Ok(r#"[{"id":5008,"name":"Force adaptative","longDesc":"+9 force adaptative"}]"#),
                    ("latest", "default") => Ok(r#"[{"id":5008,"name":"Adaptive Force","longDesc":"+10 Adaptive Force"}]"#),
                    _ => Err(StatusCode::NOT_FOUND),
                }
            }),
        )
        .with_state(Arc::clone(&hits));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (base, hits, server)
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("scout-descriptions-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn client(base: &str, cache: &std::path::Path, locale: &str) -> DataDragon {
    DataDragon::new(base, cache, locale)
        .unwrap()
        .with_community_dragon(format!("{base}/cdragon"))
}

/// The text of a description, spans joined, lines by `|`.
fn words(lines: &[Vec<domain::TextSpan>]) -> String {
    lines
        .iter()
        .map(|line| line.iter().map(|s| s.text.as_str()).collect::<String>())
        .collect::<Vec<_>>()
        .join("|")
}

#[tokio::test]
async fn describes_runes_spells_and_items_from_the_patch_files() {
    let cache = temp_dir("kinds");
    let (base, hits, _server) = fake_servers().await;
    let dd = client(&base, &cache, "en_US");

    let item = dd
        .describe("16.19.1", DescriptionKind::Item, 3157)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(words(&item.text), "10 Ability Power||Pause|Stand still.");
    assert_eq!(item.text[0][0].tone, Some(TextTone::Strong));
    let flash = dd
        .describe("16.19.1", DescriptionKind::Spell, 4)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (flash.cooldown, words(&flash.text)),
        (Some(300), "Teleports you.".to_owned())
    );
    let conqueror = dd
        .describe("16.19.1", DescriptionKind::Rune, 8010)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(words(&conqueror.text), "Deal damage.||Cooldown: 20s");
    assert_eq!(conqueror.text[0][1].tone, Some(TextTone::Magic));
    assert_eq!(
        dd.describe("16.19.1", DescriptionKind::Item, 1)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        hits.files.load(Ordering::SeqCst),
        3,
        "each file once, then from the cache"
    );

    // French text from the French files.
    let french = client(&base, &cache, "fr_FR");
    let item = french
        .describe("16.19.1", DescriptionKind::Item, 3157)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(words(&item.text), "10 puissance||Pause|Restez immobile.");
}

#[tokio::test]
async fn shards_download_once_per_language_then_read_offline() {
    let cache = temp_dir("shards");
    let (base, hits, server) = fake_servers().await;
    let english = client(&base, &cache, "en_US");
    let shards = english.shards("16.19.1").await.unwrap();
    assert_eq!(
        shards.keys().copied().collect::<Vec<_>>(),
        [5008, 5013],
        "runes left out"
    );
    let force = &shards[&5008];
    assert_eq!(force.name.as_deref(), Some("Adaptive Force"));
    assert_eq!(words(&force.text), "+9 Adaptive Force");
    let described = english
        .describe("16.19.1", DescriptionKind::Shard, 5013)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(words(&described.text), "+15% Tenacity");
    assert_eq!(
        hits.perks.load(Ordering::SeqCst),
        1,
        "kept with the patch after the first time"
    );

    let french = client(&base, &cache, "fr_FR")
        .shards("16.19.1")
        .await
        .unwrap();
    assert_eq!(french[&5008].name.as_deref(), Some("Force adaptative"));
    assert_eq!(
        hits.perks.load(Ordering::SeqCst),
        2,
        "each language its own"
    );

    server.abort();
    let _ = server.await;
    let offline = client(&base, &cache, "en_US")
        .shards("16.19.1")
        .await
        .unwrap();
    assert_eq!(offline, shards, "offline, from the disk");
    assert!(
        client(&base, &cache, "de_DE")
            .shards("16.19.1")
            .await
            .is_err(),
        "offline and never downloaded: an error the caller can live with"
    );
}

#[tokio::test]
async fn a_patch_not_mirrored_yet_reads_the_live_clients_shards() {
    let cache = temp_dir("shards-latest");
    let (base, hits, _server) = fake_servers().await;
    let shards = client(&base, &cache, "en_US")
        .shards("16.20.1")
        .await
        .unwrap();
    assert_eq!(words(&shards[&5008].text), "+10 Adaptive Force");
    assert_eq!(hits.perks.load(Ordering::SeqCst), 2, "16.20, then latest");
}

#[tokio::test]
async fn shards_the_server_does_not_have_are_not_cached() {
    let cache = temp_dir("shards-missing");
    let (base, hits, _server) = fake_servers().await;
    let german = client(&base, &cache, "de_DE");
    assert!(german.shards("16.19.1").await.is_err());
    assert!(german.shards("16.19.1").await.is_err());
    assert_eq!(
        hits.perks.load(Ordering::SeqCst),
        4,
        "asked again (the patch, then latest): nothing was kept"
    );
}
