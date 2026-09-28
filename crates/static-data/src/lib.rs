//! Riot Data Dragon: static game data (champions, items, summoner spells, runes) per patch.
//!
//! Files are cached on disk per version and locale (`{version}/{locale}/champion.json`: the
//! app's languages side by side), so the app starts offline with the last known patch and
//! downloads a new patch once per language. Only the current and previous versions are kept.

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use domain::{ChampionInfo, GameData, ItemInfo, RuneInfo, RuneStyle, SpellInfo};
use serde::Deserialize;

pub mod emblems;

pub const DDRAGON: &str = "https://ddragon.leagueoflegends.com";
const FILES: [&str; 4] = [
    "champion.json",
    "item.json",
    "summoner.json",
    "runesReforged.json",
];
const KEEP_VERSIONS: usize = 2;

#[derive(Debug, thiserror::Error)]
pub enum StaticDataError {
    #[error("Data Dragon unreachable: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Data Dragon answered HTTP {0} for {1}")]
    Status(u16, String),
    #[error("unexpected Data Dragon content in {file}: {source}")]
    Parse {
        file: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("cache: {0}")]
    Io(#[from] std::io::Error),
    #[error("no game data available offline")]
    NothingCached,
    #[error("TLS setup: {0}")]
    Tls(#[from] rustls::Error),
    #[error("image: {0}")]
    Image(String),
}

#[derive(Debug, Clone)]
pub struct DataDragon {
    http: reqwest::Client,
    base: String,
    cache: PathBuf,
    locale: String,
}

impl DataDragon {
    /// `cache` is a directory owned by this client (e.g. `<app cache>/ddragon`).
    pub fn new(
        base: impl Into<String>,
        cache: impl Into<PathBuf>,
        locale: impl Into<String>,
    ) -> Result<Self, StaticDataError> {
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(public_tls()?)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_owned(),
            cache: cache.into(),
            locale: locale.into(),
        })
    }

    /// Latest game data: downloads a new patch when online, otherwise the newest cached one.
    pub async fn load(&self) -> Result<GameData, StaticDataError> {
        let latest = match self.latest_version().await {
            Ok(version) => version,
            Err(error) => {
                tracing::warn!(%error, "Data Dragon unreachable, using cache");
                let version = self.newest_cached().ok_or(StaticDataError::NothingCached)?;
                return self.load_version(&version).await;
            }
        };
        match self.load_version(&latest).await {
            Ok(data) => {
                self.prune(&latest);
                Ok(data)
            }
            Err(error) => {
                tracing::warn!(%error, version = latest, "cannot load latest patch, using cache");
                let version = self.newest_cached().ok_or(error)?;
                self.load_version(&version).await
            }
        }
    }

    pub async fn latest_version(&self) -> Result<String, StaticDataError> {
        let url = format!("{}/api/versions.json", self.base);
        let versions: Vec<String> =
            serde_json::from_slice(&self.get(&url).await?).map_err(|source| {
                StaticDataError::Parse {
                    file: "versions.json".into(),
                    source,
                }
            })?;
        versions
            .into_iter()
            .next()
            .ok_or(StaticDataError::NothingCached)
    }

    /// Every published version, newest first.
    pub async fn versions(&self) -> Result<Vec<String>, StaticDataError> {
        let url = format!("{}/api/versions.json", self.base);
        serde_json::from_slice(&self.get(&url).await?).map_err(|source| StaticDataError::Parse {
            file: "versions.json".into(),
            source,
        })
    }

    /// Newest version of a game-version patch (`16.19` → `16.19.1`), if published.
    pub async fn version_of_patch(&self, patch: &str) -> Result<Option<String>, StaticDataError> {
        let prefix = format!("{patch}.");
        Ok(self
            .versions()
            .await?
            .into_iter()
            .find(|v| v.starts_with(&prefix)))
    }

    /// A raw Data Dragon file of a version (e.g. `item.json`, for the stats pipeline's item
    /// classes), from cache or downloaded (and then cached).
    pub async fn raw_file(&self, version: &str, name: &str) -> Result<Vec<u8>, StaticDataError> {
        self.file(version, name).await
    }

    /// One version's data, from cache or downloaded (and then cached).
    pub async fn load_version(&self, version: &str) -> Result<GameData, StaticDataError> {
        let mut files = BTreeMap::new();
        for name in FILES {
            files.insert(name, self.file(version, name).await?);
        }
        let get = |name: &str| files.get(name).map_or(&[][..], Vec::as_slice);
        parse(
            version,
            &format!("{}/cdn/{version}", self.base),
            get("champion.json"),
            get("item.json"),
            get("summoner.json"),
            get("runesReforged.json"),
        )
    }

    async fn file(&self, version: &str, name: &str) -> Result<Vec<u8>, StaticDataError> {
        let path = self.cache.join(version).join(&self.locale).join(name);
        if let Ok(bytes) = tokio::fs::read(&path).await {
            return Ok(bytes);
        }
        let url = format!("{}/cdn/{version}/data/{}/{name}", self.base, self.locale);
        let bytes = self.get(&url).await?;
        // Validate before caching so a broken download is never reused.
        serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|source| {
            StaticDataError::Parse {
                file: name.into(),
                source,
            }
        })?;
        write_atomically(&path, &bytes).await?;
        Ok(bytes)
    }

    async fn get(&self, url: &str) -> Result<Vec<u8>, StaticDataError> {
        let res = self.http.get(url).send().await?;
        if !res.status().is_success() {
            return Err(StaticDataError::Status(
                res.status().as_u16(),
                url.to_owned(),
            ));
        }
        Ok(res.bytes().await?.to_vec())
    }

    /// Highest cached version that has every file.
    pub fn newest_cached(&self) -> Option<String> {
        self.cached_versions().into_iter().find(|v| {
            FILES
                .iter()
                .all(|f| self.cache.join(v).join(&self.locale).join(f).is_file())
        })
    }

    /// Cached versions, newest first.
    fn cached_versions(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(&self.cache) else {
            return Vec::new();
        };
        let mut versions: Vec<String> = entries
            .filter_map(Result::ok)
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        versions.sort_by(|a, b| compare_versions(b, a));
        versions
    }

    fn prune(&self, current: &str) {
        for old in self
            .cached_versions()
            .into_iter()
            .filter(|v| v != current)
            .skip(KEEP_VERSIONS - 1)
        {
            if let Err(error) = std::fs::remove_dir_all(self.cache.join(&old)) {
                tracing::debug!(%error, version = old, "cannot prune cached version");
            }
        }
    }
}

/// TLS for public HTTPS: the operating system's certificate store (so corporate or antivirus
/// roots keep working) with the ring crypto backend.
pub(crate) fn public_tls() -> Result<rustls::ClientConfig, StaticDataError> {
    use rustls_platform_verifier::BuilderVerifierExt as _;
    let provider = std::sync::Arc::new(rustls::crypto::ring::default_provider());
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_platform_verifier()?
        .with_no_client_auth())
}

/// Numeric comparison of dotted versions (`16.10.1` > `16.9.1`).
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let parts = |v: &str| {
        v.split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    parts(a).cmp(&parts(b))
}

async fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let tmp = path.with_extension("part");
    tokio::fs::write(&tmp, bytes).await?;
    tokio::fs::rename(&tmp, path).await
}

#[derive(Deserialize)]
struct DdFile<T> {
    data: BTreeMap<String, T>,
}

#[derive(Deserialize)]
struct DdChampion {
    id: String,
    key: String,
    name: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct DdItem {
    name: String,
    #[serde(default)]
    gold: DdGold,
}

#[derive(Deserialize, Default)]
struct DdGold {
    #[serde(default)]
    total: u32,
}

#[derive(Deserialize)]
struct DdSpell {
    id: String,
    key: String,
    name: String,
}

/// `runesReforged.json` is a bare array of trees (no `data` map).
#[derive(Deserialize)]
struct DdRuneStyle {
    id: u32,
    key: String,
    name: String,
    icon: String,
    #[serde(default)]
    slots: Vec<DdRuneSlot>,
}

#[derive(Deserialize)]
struct DdRuneSlot {
    #[serde(default)]
    runes: Vec<DdRune>,
}

#[derive(Deserialize)]
struct DdRune {
    id: u32,
    key: String,
    name: String,
    icon: String,
    #[serde(default, rename = "shortDesc")]
    short_desc: String,
}

/// Data Dragon descriptions carry the client's markup (`<b>`, `<br>`, tooltip tags): plain
/// text for the UI, a line break read as a space.
fn plain_text(markup: &str) -> String {
    let mut text = String::with_capacity(markup.len());
    let mut rest = markup;
    while let Some(open) = rest.find('<') {
        text.push_str(&rest[..open]);
        let Some(len) = rest[open..].find('>') else {
            // An unclosed `<` is text.
            text.push_str(&rest[open..]);
            rest = "";
            break;
        };
        let tag = rest[open + 1..open + len].trim_start_matches('/');
        let name = tag
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or_default();
        if name.eq_ignore_ascii_case("br") {
            text.push(' ');
        }
        rest = &rest[open + len + 1..];
    }
    text.push_str(rest);
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn rune_style(style: DdRuneStyle) -> RuneStyle {
    RuneStyle {
        id: style.id,
        key: style.key,
        name: style.name,
        icon: style.icon,
        slots: style
            .slots
            .into_iter()
            .map(|slot| {
                slot.runes
                    .into_iter()
                    .map(|r| RuneInfo {
                        id: r.id,
                        key: r.key,
                        name: r.name,
                        icon: r.icon,
                        short_desc: plain_text(&r.short_desc),
                    })
                    .collect()
            })
            .collect(),
    }
}

/// Maps Data Dragon files onto the compact domain model.
pub fn parse(
    version: &str,
    asset_base: &str,
    champions: &[u8],
    items: &[u8],
    spells: &[u8],
    runes: &[u8],
) -> Result<GameData, StaticDataError> {
    fn file<T: for<'de> Deserialize<'de>>(
        name: &str,
        bytes: &[u8],
    ) -> Result<DdFile<T>, StaticDataError> {
        serde_json::from_slice(bytes).map_err(|source| StaticDataError::Parse {
            file: name.into(),
            source,
        })
    }
    let mut champions: Vec<ChampionInfo> = file::<DdChampion>("champion.json", champions)?
        .data
        .into_values()
        .filter_map(|c| {
            Some(ChampionInfo {
                id: c.key.parse().ok()?,
                key: c.id,
                name: c.name,
                tags: c.tags,
            })
        })
        .collect();
    champions.sort_by(|a, b| a.name.cmp(&b.name));
    let items = file::<DdItem>("item.json", items)?
        .data
        .into_iter()
        .filter_map(|(id, item)| {
            Some(ItemInfo {
                id: id.parse().ok()?,
                name: item.name,
                gold: item.gold.total,
            })
        })
        .collect();
    let summoner_spells = file::<DdSpell>("summoner.json", spells)?
        .data
        .into_values()
        .filter_map(|s| {
            Some(SpellInfo {
                id: s.key.parse().ok()?,
                key: s.id,
                name: s.name,
            })
        })
        .collect();
    let runes = serde_json::from_slice::<Vec<DdRuneStyle>>(runes)
        .map_err(|source| StaticDataError::Parse {
            file: "runesReforged.json".into(),
            source,
        })?
        .into_iter()
        .map(rune_style)
        .collect();
    Ok(GameData {
        version: version.to_owned(),
        asset_base: asset_base.to_owned(),
        art_base: asset_base
            .strip_suffix(&format!("/{version}"))
            .unwrap_or(asset_base)
            .to_owned(),
        champions,
        items,
        summoner_spells,
        runes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(compare_versions("16.10.1", "16.9.1"), Ordering::Greater);
        assert_eq!(compare_versions("16.9.1", "16.9.1"), Ordering::Equal);
        assert_eq!(compare_versions("15.24.1", "16.1.1"), Ordering::Less);
    }

    #[test]
    fn parses_data_dragon_files() {
        let champions = br#"{"data":{"Kaisa":{"id":"Kaisa","key":"145","name":"Kai'Sa","tags":["Marksman"]},"Bad":{"id":"Bad","key":"x","name":"?"}}}"#;
        let items = br#"{"data":{"3031":{"name":"Infinity Edge","gold":{"total":3500}},"oops":{"name":"?"}}}"#;
        let spells =
            br#"{"data":{"SummonerFlash":{"id":"SummonerFlash","key":"4","name":"Flash"}}}"#;
        let data = parse(
            "16.19.1",
            "https://x/cdn/16.19.1",
            champions,
            items,
            spells,
            RUNES,
        )
        .expect("valid");
        assert_eq!(data.champions.len(), 1, "unparseable keys are skipped");
        assert_eq!(data.champions[0].id, 145);
        assert_eq!(data.champions[0].key, "Kaisa");
        assert_eq!(data.items[0].gold, 3500);
        assert_eq!(data.summoner_spells[0].id, 4);
        assert_eq!(data.runes.len(), 1);
    }

    const EMPTY: &[u8] = br#"{"data":{}}"#;
    const RUNES: &[u8] = br#"[{"id":8000,"key":"Precision","icon":"perk-images/Styles/7201_Precision.png","name":"Precision","slots":[
        {"runes":[
            {"id":8005,"key":"PressTheAttack","icon":"perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png","name":"Press the Attack",
             "shortDesc":"Hitting an enemy <b>3 consecutive</b> times deals <lol-uikit-tooltipped-keyword key='x'>bonus damage</lol-uikit-tooltipped-keyword>."},
            {"id":8010,"key":"Conqueror","icon":"perk-images/Styles/Precision/Conqueror/Conqueror.png","name":"Conqueror",
             "shortDesc":"Gain stacks.<br>Heal at 12 stacks."}]},
        {"runes":[{"id":9111,"key":"Triumph","icon":"perk-images/Styles/Precision/Triumph.png","name":"Triumph","longDesc":"ignored"}]}]}]"#;

    #[test]
    fn parses_rune_trees_row_by_row() {
        let data = parse(
            "16.19.1",
            "https://x/cdn/16.19.1",
            EMPTY,
            EMPTY,
            EMPTY,
            RUNES,
        )
        .expect("valid");
        let [precision] = data.runes.as_slice() else {
            panic!("one tree expected, got {:?}", data.runes);
        };
        assert_eq!((precision.id, precision.name.as_str()), (8000, "Precision"));
        assert_eq!(precision.icon, "perk-images/Styles/7201_Precision.png");
        let rows: Vec<Vec<u32>> = precision
            .slots
            .iter()
            .map(|row| row.iter().map(|r| r.id).collect())
            .collect();
        assert_eq!(rows, [vec![8005, 8010], vec![9111]], "keystones first");
        assert_eq!(
            precision.slots[0][0].short_desc,
            "Hitting an enemy 3 consecutive times deals bonus damage."
        );
        assert_eq!(
            precision.slots[0][1].short_desc, "Gain stacks. Heal at 12 stacks.",
            "a line break reads as a space"
        );
        assert_eq!(precision.slots[1][0].short_desc, "", "no description");
    }

    #[test]
    fn plain_text_drops_markup_only() {
        assert_eq!(plain_text("a <b>b</b>  c<br/>d<br />e<BR>f"), "a b c d e f");
        assert_eq!(plain_text("x<i>y</i>z"), "xyz");
        assert_eq!(plain_text("2 < 3"), "2 < 3", "an unclosed `<` is text");
        assert_eq!(plain_text(""), "");
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(
            parse("1", "x", b"<html>", b"{}", b"{}", b"[]"),
            Err(StaticDataError::Parse { .. })
        ));
        assert!(matches!(
            parse("1", "x", EMPTY, EMPTY, EMPTY, EMPTY),
            Err(StaticDataError::Parse { file, .. }) if file == "runesReforged.json"
        ));
    }
}
