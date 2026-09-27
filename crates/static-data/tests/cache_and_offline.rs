//! Downloads, caching and offline fallback against a local fake Data Dragon.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use static_data::{DataDragon, StaticDataError};

#[derive(Default)]
struct Hits {
    versions: AtomicUsize,
    files: AtomicUsize,
}

async fn fake_ddragon(latest: &'static str) -> (String, Arc<Hits>, tokio::task::JoinHandle<()>) {
    let hits = Arc::new(Hits::default());
    let app = Router::new()
        .route(
            "/api/versions.json",
            axum::routing::get(move |State(h): State<Arc<Hits>>| async move {
                h.versions.fetch_add(1, Ordering::SeqCst);
                format!(r#"["{latest}","16.18.1"]"#)
            }),
        )
        .route(
            "/cdn/{version}/data/{locale}/{file}",
            axum::routing::get(|State(h): State<Arc<Hits>>, Path((_v, _l, file)): Path<(String, String, String)>| async move {
                h.files.fetch_add(1, Ordering::SeqCst);
                match file.as_str() {
                    "champion.json" => Ok(r#"{"data":{"Ahri":{"id":"Ahri","key":"103","name":"Ahri","tags":["Mage"]}}}"#),
                    "item.json" => Ok(r#"{"data":{"3031":{"name":"Infinity Edge","gold":{"total":3500}}}}"#),
                    "summoner.json" => Ok(r#"{"data":{"SummonerFlash":{"id":"SummonerFlash","key":"4","name":"Flash"}}}"#),
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
    let dir = std::env::temp_dir().join(format!("scout-ddragon-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[tokio::test]
async fn downloads_once_then_serves_from_cache() {
    let (base, hits, _server) = fake_ddragon("16.19.1").await;
    let dd = DataDragon::new(&base, temp_dir("cache"), "en_US").unwrap();

    let first = dd.load().await.unwrap();
    assert_eq!(first.version, "16.19.1");
    assert_eq!(first.champions[0].name, "Ahri");
    assert_eq!(first.asset_base, format!("{base}/cdn/16.19.1"));
    assert_eq!(first.art_base, format!("{base}/cdn"));
    assert_eq!(hits.files.load(Ordering::SeqCst), 3);

    let second = dd.load().await.unwrap();
    assert_eq!(second, first);
    assert_eq!(
        hits.files.load(Ordering::SeqCst),
        3,
        "files come from the cache the second time"
    );
    assert_eq!(
        hits.versions.load(Ordering::SeqCst),
        2,
        "the version list is always checked"
    );
}

#[tokio::test]
async fn works_offline_from_cache() {
    let cache = temp_dir("offline");
    let (base, _hits, server) = fake_ddragon("16.19.1").await;
    DataDragon::new(&base, &cache, "en_US")
        .unwrap()
        .load()
        .await
        .unwrap();
    server.abort();
    let _ = server.await;

    let offline = DataDragon::new(&base, &cache, "en_US")
        .unwrap()
        .load()
        .await
        .unwrap();
    assert_eq!(offline.version, "16.19.1");
}

#[tokio::test]
async fn offline_without_cache_is_a_clear_error() {
    let dd = DataDragon::new("http://127.0.0.1:1", temp_dir("empty"), "en_US").unwrap();
    assert!(matches!(
        dd.load().await,
        Err(StaticDataError::NothingCached)
    ));
}

#[tokio::test]
async fn keeps_only_recent_versions() {
    let cache = temp_dir("prune");
    for old in ["16.16.1", "16.17.1", "16.18.1"] {
        std::fs::create_dir_all(cache.join(old)).unwrap();
    }
    let (base, _hits, _server) = fake_ddragon("16.19.1").await;
    DataDragon::new(&base, &cache, "en_US")
        .unwrap()
        .load()
        .await
        .unwrap();
    let mut left: Vec<String> = std::fs::read_dir(&cache)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    left.sort();
    assert_eq!(left, ["16.18.1", "16.19.1"]);
}
