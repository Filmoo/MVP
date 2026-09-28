//! Ranked emblems: Riot's own art for each tier, the League client's files as mirrored by
//! `CommunityDragon` (acknowledged by Riot on its developer portal), downloaded once, cropped and
//! kept on disk. Never committed: the app fetches them at run time, like Data Dragon art.
//!
//! The client ships each emblem on a 16:9 canvas (1280×720; 2560×1440 for some tiers) with the
//! crest in the middle. One crop window, measured on the art, frames every tier and keeps the
//! client's hierarchy (higher tiers are bigger); it is scaled to [`WIDTH`] × [`HEIGHT`] (4:3).

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::time::Duration;

use domain::Tier;

use crate::StaticDataError;

/// `CommunityDragon`'s mirror of the live client's files.
pub const CDRAGON: &str = "https://raw.communitydragon.org/latest";
/// Where the client keeps the emblems (the folder moved once; both are tried, newest first).
const FOLDERS: [&str; 2] = [
    "plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem",
    "plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem",
];
/// Output size, px: 4:3, sharp for an 80 × 60 emblem on a 2× screen.
pub const WIDTH: u32 = 192;
pub const HEIGHT: u32 = 144;
/// The crop window, shares of the canvas: x 37–63 %, y 30–65 % (the crest and, for the apex
/// tiers, their ornaments).
const WINDOW: [f64; 4] = [0.37, 0.30, 0.63, 0.65];
/// Bump to fetch and crop again (new art, another window).
const CACHE_DIR: &str = "v1";

pub const TIERS: [Tier; 10] = [
    Tier::Iron,
    Tier::Bronze,
    Tier::Silver,
    Tier::Gold,
    Tier::Platinum,
    Tier::Emerald,
    Tier::Diamond,
    Tier::Master,
    Tier::Grandmaster,
    Tier::Challenger,
];

/// The file name of a tier's emblem (`emblem-gold.png`).
pub const fn file_name(tier: Tier) -> &'static str {
    match tier {
        Tier::Iron => "emblem-iron.png",
        Tier::Bronze => "emblem-bronze.png",
        Tier::Silver => "emblem-silver.png",
        Tier::Gold => "emblem-gold.png",
        Tier::Platinum => "emblem-platinum.png",
        Tier::Emerald => "emblem-emerald.png",
        Tier::Diamond => "emblem-diamond.png",
        Tier::Master => "emblem-master.png",
        Tier::Grandmaster => "emblem-grandmaster.png",
        Tier::Challenger => "emblem-challenger.png",
    }
}

/// Downloads, crops and caches the emblems.
#[derive(Debug, Clone)]
pub struct RankEmblems {
    http: reqwest::Client,
    base: String,
    cache: PathBuf,
}

impl RankEmblems {
    /// `cache` is a directory owned by this client (e.g. `<app cache>/emblems`).
    pub fn new(
        base: impl Into<String>,
        cache: impl Into<PathBuf>,
    ) -> Result<Self, StaticDataError> {
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(crate::public_tls()?)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_owned(),
            cache: cache.into().join(CACHE_DIR),
        })
    }

    /// Every tier's emblem (a PNG), from the cache or downloaded and cropped (then cached).
    /// Tiers that can't be had now (offline, not published) are left out: the UI draws its own
    /// crest for them, and the next start tries again.
    pub async fn load(&self) -> BTreeMap<Tier, Vec<u8>> {
        let mut out = BTreeMap::new();
        for tier in TIERS {
            match self.emblem(tier).await {
                Ok(png) => {
                    out.insert(tier, png);
                }
                Err(error) => tracing::info!(%error, ?tier, "ranked emblem unavailable"),
            }
        }
        out
    }

    async fn emblem(&self, tier: Tier) -> Result<Vec<u8>, StaticDataError> {
        let path = self.cache.join(file_name(tier));
        if let Ok(bytes) = tokio::fs::read(&path).await {
            return Ok(bytes);
        }
        let canvas = self.download(tier).await?;
        let png = tokio::task::spawn_blocking(move || crop(&canvas))
            .await
            .map_err(|error| StaticDataError::Image(error.to_string()))??;
        tokio::fs::create_dir_all(&self.cache).await?;
        // Write then rename: a crash mid-write never leaves a broken emblem behind.
        let partial = path.with_extension("part");
        tokio::fs::write(&partial, &png).await?;
        tokio::fs::rename(&partial, &path).await?;
        Ok(png)
    }

    async fn download(&self, tier: Tier) -> Result<Vec<u8>, StaticDataError> {
        let mut last = None;
        for folder in FOLDERS {
            let url = format!("{}/{folder}/{}", self.base, file_name(tier));
            let response = self.http.get(&url).send().await?;
            let status = response.status();
            if status.is_success() {
                return Ok(response.bytes().await?.to_vec());
            }
            last = Some(StaticDataError::Status(status.as_u16(), url));
        }
        Err(last.unwrap_or(StaticDataError::NothingCached))
    }
}

/// Crops the emblem out of its canvas and scales it to [`WIDTH`] × [`HEIGHT`] (a PNG).
pub fn crop(canvas: &[u8]) -> Result<Vec<u8>, StaticDataError> {
    let (width, height, rgba) = decode(canvas)?;
    let [x0, y0, x1, y1] = WINDOW;
    let (w, h) = (f64::from(width), f64::from(height));
    let window = [x0 * w, y0 * h, x1 * w, y1 * h];
    let pixels = downscale(&rgba, width, height, window, WIDTH, HEIGHT);
    encode(&pixels, WIDTH, HEIGHT)
}

fn image_error(error: impl std::fmt::Display) -> StaticDataError {
    StaticDataError::Image(error.to_string())
}

/// Any PNG → 8-bit RGBA.
fn decode(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), StaticDataError> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(image_error)?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| image_error("image too large"))?;
    let mut buffer = vec![0; size];
    let info = reader.next_frame(&mut buffer).map_err(image_error)?;
    buffer.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buffer,
        png::ColorType::Rgb => buffer
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => buffer
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => buffer.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err(image_error("palette left after normalizing")),
    };
    Ok((info.width, info.height, rgba))
}

fn encode(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, StaticDataError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::High);
        let mut writer = encoder.write_header().map_err(image_error)?;
        writer.write_image_data(rgba).map_err(image_error)?;
    }
    Ok(out)
}

/// Scales `window` (x0, y0, x1, y1 in source pixels) of an RGBA image to `out_w` × `out_h`,
/// each output pixel the area-weighted mean of what it covers, with premultiplied alpha (no dark
/// fringes along the edges of the art).
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "pixel coordinates and 8-bit channels, clamped"
)]
pub fn downscale(
    src: &[u8],
    width: u32,
    height: u32,
    window: [f64; 4],
    out_w: u32,
    out_h: u32,
) -> Vec<u8> {
    let [x0, y0, x1, y1] = window;
    let sx = (x1 - x0) / f64::from(out_w);
    let sy = (y1 - y0) / f64::from(out_h);
    let mut out = vec![0; (out_w * out_h * 4) as usize];
    for oy in 0..out_h {
        let top = y0 + f64::from(oy) * sy;
        let bottom = top + sy;
        for ox in 0..out_w {
            let left = x0 + f64::from(ox) * sx;
            let right = left + sx;
            let mut acc = [0.0_f64; 4];
            let mut area = 0.0;
            let (ys, ye) = (
                top.floor().max(0.0) as u32,
                (bottom.ceil() as u32).min(height),
            );
            let (xs, xe) = (
                left.floor().max(0.0) as u32,
                (right.ceil() as u32).min(width),
            );
            for y in ys..ye {
                let wy = (bottom.min(f64::from(y + 1)) - top.max(f64::from(y))).max(0.0);
                for x in xs..xe {
                    let wx = (right.min(f64::from(x + 1)) - left.max(f64::from(x))).max(0.0);
                    let weight = wx * wy;
                    let i = ((y * width + x) * 4) as usize;
                    let alpha = f64::from(src[i + 3]) / 255.0;
                    for (c, value) in acc.iter_mut().take(3).enumerate() {
                        *value += f64::from(src[i + c]) * alpha * weight;
                    }
                    acc[3] += alpha * weight;
                    area += weight;
                }
            }
            let o = ((oy * out_w + ox) * 4) as usize;
            if area > 0.0 && acc[3] > 0.0 {
                for c in 0..3 {
                    out[o + c] = (acc[c] / acc[3]).round().clamp(0.0, 255.0) as u8;
                }
                out[o + 3] = (acc[3] / area * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    /// A transparent canvas with an opaque `color` block over `rect` (x0, y0, x1, y1).
    fn canvas(width: u32, height: u32, rect: [u32; 4], color: [u8; 3]) -> Vec<u8> {
        let mut rgba = vec![0; (width * height * 4) as usize];
        for y in rect[1]..rect[3] {
            for x in rect[0]..rect[2] {
                let i = ((y * width + x) * 4) as usize;
                rgba[i..i + 4].copy_from_slice(&[color[0], color[1], color[2], 255]);
            }
        }
        encode(&rgba, width, height).unwrap()
    }

    #[test]
    fn crops_the_middle_of_the_canvas_to_four_by_three() {
        // The crest fills the crop window exactly on a 1280 × 720 canvas.
        let png = canvas(1280, 720, [474, 216, 806, 468], [200, 170, 90]);
        let (w, h, rgba) = decode(&crop(&png).unwrap()).unwrap();
        assert_eq!((w, h), (WIDTH, HEIGHT));
        // Opaque gold in the middle, colour kept exactly (no dark fringe from the transparent
        // surroundings: premultiplied averaging).
        let middle = (((HEIGHT / 2) * WIDTH + WIDTH / 2) * 4) as usize;
        assert_eq!(&rgba[middle..middle + 4], &[200, 170, 90, 255]);
        let edge = (((HEIGHT / 2) * WIDTH) * 4) as usize;
        assert_eq!(&rgba[edge..edge + 3], &[200, 170, 90]);
    }

    #[test]
    fn the_same_window_frames_bigger_canvases() {
        let small = crop(&canvas(1280, 720, [600, 300, 680, 400], [90, 200, 160])).unwrap();
        let big = crop(&canvas(2560, 1440, [1200, 600, 1360, 800], [90, 200, 160])).unwrap();
        let coverage = |png: &[u8]| {
            let (_, _, rgba) = decode(png).unwrap();
            rgba.chunks_exact(4).filter(|p| p[3] > 128).count()
        };
        assert_eq!(coverage(&small), coverage(&big));
    }

    #[test]
    fn averages_by_area() {
        // Half of each output pixel covered: half alpha, full colour.
        let src: Vec<u8> = [[255, 0, 0, 255], [0, 0, 0, 0]].concat();
        let out = downscale(&src, 2, 1, [0.0, 0.0, 2.0, 1.0], 1, 1);
        assert_eq!(out, vec![255, 0, 0, 128]);
    }

    #[test]
    fn reads_any_png_colour_type() {
        let mut rgb = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut rgb, 2, 1);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[10, 20, 30, 40, 50, 60])
                .unwrap();
        }
        let (w, h, rgba) = decode(&rgb).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(rgba, vec![10, 20, 30, 255, 40, 50, 60, 255]);
    }

    #[test]
    fn names_the_files_like_the_client() {
        assert_eq!(file_name(Tier::Grandmaster), "emblem-grandmaster.png");
        assert_eq!(TIERS.len(), 10);
    }
}
