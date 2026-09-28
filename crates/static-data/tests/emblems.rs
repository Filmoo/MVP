//! Ranked emblems against a local fake `CommunityDragon`: downloaded once, cropped, cached, and
//! still there offline.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use domain::Tier;
use static_data::emblems::{HEIGHT, RankEmblems, WIDTH};

/// A 1280 × 720 canvas with a coloured crest in the middle.
fn canvas() -> Vec<u8> {
    let (w, h) = (1280_u32, 720_u32);
    let mut rgba = vec![0_u8; (w * h * 4) as usize];
    for y in 280..440 {
        for x in 560..720 {
            let i = ((y * w + x) * 4) as usize;
            rgba[i..i + 4].copy_from_slice(&[220, 180, 90, 255]);
        }
    }
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&rgba)
            .unwrap();
    }
    png
}

/// Serves only the gold emblem, only from the client's older folder.
async fn fake_cdragon() -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let body = Arc::new(canvas());
    let app = Router::new()
        .route(
            "/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/{file}",
            axum::routing::get(
                move |State(hits): State<Arc<AtomicUsize>>, Path(file): Path<String>| {
                    let body = Arc::clone(&body);
                    async move {
                        if file != "emblem-gold.png" {
                            return Err(StatusCode::NOT_FOUND);
                        }
                        hits.fetch_add(1, Ordering::SeqCst);
                        Ok(body.as_ref().clone())
                    }
                },
            ),
        )
        .with_state(Arc::clone(&hits));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (base, hits)
}

fn size_of(png: &[u8]) -> (u32, u32) {
    let decoder = png::Decoder::new(std::io::Cursor::new(png));
    let reader = decoder.read_info().unwrap();
    let info = reader.info();
    (info.width, info.height)
}

#[tokio::test]
async fn downloads_once_crops_and_keeps_working_offline() {
    let (base, hits) = fake_cdragon().await;
    let dir = std::env::temp_dir().join(format!("mvp-emblems-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);

    let emblems = RankEmblems::new(&base, &dir).unwrap().load().await;
    // Only gold is published here: the other tiers are left out (the UI draws its own crest).
    assert_eq!(
        emblems.keys().copied().collect::<Vec<_>>(),
        vec![Tier::Gold]
    );
    assert_eq!(size_of(&emblems[&Tier::Gold]), (WIDTH, HEIGHT));
    assert_eq!(hits.load(Ordering::SeqCst), 1);

    // Again: from the cache, no download.
    let again = RankEmblems::new(&base, &dir).unwrap().load().await;
    assert_eq!(again[&Tier::Gold], emblems[&Tier::Gold]);
    assert_eq!(hits.load(Ordering::SeqCst), 1);

    // Offline (nothing answers): still there.
    let offline = RankEmblems::new("http://127.0.0.1:9", &dir)
        .unwrap()
        .load()
        .await;
    assert_eq!(offline[&Tier::Gold], emblems[&Tier::Gold]);
    let _ = std::fs::remove_dir_all(&dir);
}
