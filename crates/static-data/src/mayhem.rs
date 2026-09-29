//! ARAM: Mayhem's augments from the game's own files, as `CommunityDragon` mirrors them
//! (acknowledged by Riot on its developer portal, like the ranked emblems): the pool
//! (`augment-lists.json`, mode `KIWI`), each augment's id, rarity, icon and names (the client's
//! `cherry-augments.json`, English and French) and its short description (the game's string
//! tables, through the augment definitions of `kiwi.bin.json`).
//!
//! The string tables weigh ~33 MB each and the definitions ~12 MB: **our server** builds the
//! catalog once per game version ([`CatalogSource::build`]) and the app downloads the result
//! (a few hundred KB), never the sources. Nothing is committed: every file is fetched at run
//! time and kept on disk only for the version being built.
//!
//! Descriptions are the game's summaries, as plain text: values come from the augment's
//! definitions (a level range reads `20–80`; what grows with a stat shows its base), a value
//! only the game knows in play reads `…`, the champion's own ability reads `[Ability]`, and a
//! summary that can't be read leaves the description empty rather than failing the catalog.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;

use domain::{AugmentCatalog, AugmentRarity, CatalogAugment, LocalizedText};
use serde::de::{DeserializeOwned, DeserializeSeed, IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use tokio::io::AsyncWriteExt as _;

use crate::StaticDataError;

pub use crate::emblems::CDRAGON;

/// The Mayhem pool's name in `augment-lists.json`.
pub const MODE: &str = "KIWI";
/// The client's own data (JSON and art), under the mirror's root.
pub const CLIENT_DATA: &str = "plugins/rcp-be-lol-game-data/global/default";
/// Icons are client files: `{mirror}/{CLIENT_DATA}/{icon}` (see [`icon_url`]).
const METADATA: &str = "content-metadata.json";
const LISTS: &str = "plugins/rcp-be-lol-game-data/global/default/v1/augment-lists.json";
const AUGMENTS_EN: &str = "plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json";
const AUGMENTS_FR: &str = "plugins/rcp-be-lol-game-data/global/fr_fr/v1/cherry-augments.json";
const DEFINITIONS: &str = "game/maps/modespecificdata/kiwi.bin.json";
/// The game keeps its menu strings under `en_us/` inside each language's folder.
const STRINGS_EN: &str = "game/en_us/data/menu/en_us/lol.stringtable.json";
const STRINGS_FR: &str = "game/fr_fr/data/menu/en_us/lol.stringtable.json";
/// Where the client's asset paths start (`/lol-game-data/assets/ASSETS/UX/…`).
const ASSETS_PREFIX: &str = "/lol-game-data/assets/";

/// The full URL of an augment's icon (a catalog's `icon`) on the mirror at `base`.
pub fn icon_url(base: &str, icon: &str) -> String {
    format!("{}/{CLIENT_DATA}/{icon}", base.trim_end_matches('/'))
}

/// `16.19.8217343+branch.releases-16-19.content.release` → `16.19`.
pub fn patch_of(version: &str) -> Option<String> {
    let mut parts = version.split(['.', '+']);
    let (major, minor) = (parts.next()?, parts.next()?);
    let numeric = |p: &str| !p.is_empty() && p.len() <= 4 && p.bytes().all(|b| b.is_ascii_digit());
    (numeric(major) && numeric(minor)).then(|| format!("{major}.{minor}"))
}

/// The two languages of the catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    Fr,
}

impl Lang {
    /// What stands for the champion's own ability (the game fills it in during play).
    const fn ability(self) -> &'static str {
        match self {
            Self::En => "[Ability]",
            Self::Fr => "[Compétence]",
        }
    }
}

// ---- The client's JSON --------------------------------------------------------------------------

#[derive(Deserialize)]
struct ModeList {
    #[serde(rename = "modeName")]
    mode: String,
    #[serde(rename = "augmentList", default)]
    augments: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientAugment {
    id: u32,
    augment_name_id: String,
    #[serde(rename = "nameTRA", default)]
    name: String,
    #[serde(default)]
    augment_small_icon_path: String,
    #[serde(default)]
    rarity: String,
}

fn rarity(raw: &str) -> Option<AugmentRarity> {
    match raw {
        "kSilver" => Some(AugmentRarity::Silver),
        "kGold" => Some(AugmentRarity::Gold),
        "kPrismatic" => Some(AugmentRarity::Prismatic),
        _ => None,
    }
}

/// `/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/X_small.png` → the mirror's path
/// (`assets/ux/kiwi/augments/icons/x_small.png`: it serves the client's files in lower case).
fn icon_path(raw: &str) -> Option<String> {
    let path = raw.strip_prefix(ASSETS_PREFIX)?.to_ascii_lowercase();
    let safe = !path.is_empty()
        && !path
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-' | b'.'));
    safe.then_some(path)
}

fn parse<T: DeserializeOwned>(file: &str, bytes: &[u8]) -> Result<T, StaticDataError> {
    serde_json::from_slice(bytes).map_err(|source| StaticDataError::Parse {
        file: file.to_owned(),
        source,
    })
}

// ---- The game's definitions (`kiwi.bin.json`) -----------------------------------------------------

/// A value that isn't what we expect reads as missing instead of failing the whole file.
fn lenient<'de, D: Deserializer<'de>, T: DeserializeOwned>(d: D) -> Result<Option<T>, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(value).ok())
}

/// One object of the definitions file; only what the catalog reads.
#[derive(Deserialize, Default)]
struct BinEntry {
    #[serde(rename = "__type", default, deserialize_with = "lenient")]
    kind: Option<String>,
    #[serde(rename = "DescriptionTra", default, deserialize_with = "lenient")]
    description: Option<String>,
    #[serde(rename = "RootSpell", default, deserialize_with = "lenient")]
    root_spell: Option<String>,
    #[serde(rename = "mSpell", default, deserialize_with = "lenient")]
    spell: Option<BinSpell>,
}

#[derive(Deserialize, Default)]
struct BinSpell {
    #[serde(rename = "DataValues", alias = "mDataValues", default)]
    values: Vec<BinValue>,
    /// Values the game computes (`Calc_…`): formulas of numbers, named values, level ranges
    /// and stat scalings.
    #[serde(rename = "mSpellCalculations", default, deserialize_with = "lenient")]
    calculations: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Deserialize)]
struct BinValue {
    #[serde(alias = "mName")]
    name: String,
    #[serde(alias = "mValues", default)]
    values: Vec<f64>,
}

/// A value a description shows: one number, or a range over the champion's level (`low–high`).
/// What also grows with a stat (ability power…) shows its base: the description can't know the
/// stat.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Shown {
    low: f64,
    high: f64,
    /// Shown as a percentage (the game's `mDisplayAsPercent`).
    percent: bool,
}

impl Shown {
    const fn plain(x: f64) -> Self {
        Self {
            low: x,
            high: x,
            percent: false,
        }
    }
}

/// What a description needs from the definitions: its string key and its spells' values.
#[derive(Debug, Default, Clone, PartialEq)]
struct Definition {
    /// Key of the summary in the string tables.
    description: Option<String>,
    /// The spells' named values and calculations, the root spell's first (lower-case names).
    values: Vec<(String, Shown)>,
}

/// The value a tooltip shows for level 1 (index 0 is level 0; most augments hold one value).
fn level_one(values: &[f64]) -> Option<f64> {
    values.get(1).or_else(|| values.first()).copied()
}

/// A calculation's value, when its parts are ones a description can show: numbers, named
/// values, level ranges (stat scalings are left out: the base shows). `None` for anything else.
fn calculation(calc: &serde_json::Value, values: &[(String, Shown)]) -> Option<Shown> {
    let text = |part: &serde_json::Value, key: &str| {
        part.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    };
    let number =
        |part: &serde_json::Value, key: &str| part.get(key).and_then(serde_json::Value::as_f64);
    if text(calc, "__type").as_deref() != Some("GameCalculation") {
        return None;
    }
    let mut total = Shown::plain(0.0);
    let mut counted = false;
    for part in calc.get("mFormulaParts")?.as_array()? {
        match text(part, "__type")?.as_str() {
            "NumberCalculationPart" => {
                let n = number(part, "mNumber")?;
                (total.low, total.high) = (total.low + n, total.high + n);
                counted = true;
            }
            "NamedDataValueCalculationPart" => {
                let name = text(part, "mDataValue")?.to_ascii_lowercase();
                let value = values.iter().find(|(n, _)| *n == name)?.1;
                (total.low, total.high) = (total.low + value.low, total.high + value.high);
                counted = true;
            }
            "ByCharLevelInterpolationCalculationPart" => {
                total.low += number(part, "mStartValue").unwrap_or(0.0);
                total.high += number(part, "mEndValue").unwrap_or(0.0);
                counted = true;
            }
            "StatByNamedDataValueCalculationPart" | "StatByCoefficientCalculationPart" => {}
            _ => return None,
        }
    }
    total.percent = calc
        .get("mDisplayAsPercent")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    counted.then_some(total)
}

/// The definitions of `paths` (augments of the pool) from `kiwi.bin.json`.
fn definitions(
    reader: impl Read,
    paths: &[String],
) -> Result<HashMap<String, Definition>, serde_json::Error> {
    let entries: HashMap<String, BinEntry> = serde_json::from_reader(BufReader::new(reader))?;
    let mut out = HashMap::new();
    for path in paths {
        let Some(entry) = entries.get(path) else {
            continue;
        };
        let prefix = format!("{path}/");
        let mut spells: Vec<(&String, &BinSpell)> = entries
            .iter()
            .filter(|(key, e)| key.starts_with(&prefix) && e.kind.as_deref() == Some("SpellObject"))
            .filter_map(|(key, e)| Some((key, e.spell.as_ref()?)))
            .collect();
        // The root spell first, then the others in a stable order.
        spells.sort_by_key(|(key, _)| (Some(*key) != entry.root_spell.as_ref(), *key));
        let mut values: Vec<(String, Shown)> = spells
            .iter()
            .flat_map(|(_, spell)| &spell.values)
            .filter_map(|v| {
                Some((
                    v.name.to_ascii_lowercase(),
                    Shown::plain(level_one(&v.values)?),
                ))
            })
            .collect();
        // Calculations read the named values: after them, in the same order.
        let computed: Vec<(String, Shown)> = spells
            .iter()
            .filter_map(|(_, spell)| spell.calculations.as_ref())
            .flat_map(|calcs| {
                let mut calcs: Vec<_> = calcs.iter().collect();
                calcs.sort_by_key(|(name, _)| *name);
                calcs
            })
            .filter_map(|(name, calc)| {
                Some((name.to_ascii_lowercase(), calculation(calc, &values)?))
            })
            .collect();
        values.extend(computed);
        out.insert(
            path.clone(),
            Definition {
                description: entry.description.clone(),
                values,
            },
        );
    }
    Ok(out)
}

// ---- The string tables --------------------------------------------------------------------------

/// Strings by lower-case key.
type Strings = HashMap<String, String>;

/// The strings of `wanted` (lower-case keys) from a string table
/// (`{ "entries": { key: text, … }, … }`), read as a stream: the table is ~33 MB, only a few
/// hundred entries are kept.
fn pick_strings(reader: impl Read, wanted: &HashSet<String>) -> Result<Strings, serde_json::Error> {
    let mut de = serde_json::Deserializer::from_reader(BufReader::new(reader));
    let out = Table(wanted).deserialize(&mut de)?;
    de.end()?;
    Ok(out)
}

struct Table<'a>(&'a HashSet<String>);

impl<'de> DeserializeSeed<'de> for Table<'_> {
    type Value = Strings;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for Table<'_> {
    type Value = Strings;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a string table")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut out = HashMap::new();
        while let Some(key) = map.next_key::<String>()? {
            if key == "entries" {
                out = map.next_value_seed(Entries(self.0))?;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(out)
    }
}

struct Entries<'a>(&'a HashSet<String>);

impl<'de> DeserializeSeed<'de> for Entries<'_> {
    type Value = Strings;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for Entries<'_> {
    type Value = Strings;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("string table entries")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut out = HashMap::new();
        while let Some(key) = map.next_key::<String>()? {
            let key = key.to_ascii_lowercase();
            if self.0.contains(&key) {
                if let Ok(text) = map.next_value::<String>() {
                    out.insert(key, text);
                }
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(out)
    }
}

/// Keys of the `{{ key }}` references in `texts` (lower case), the ability placeholder aside.
fn nested_keys<'a>(texts: impl Iterator<Item = &'a String>) -> HashSet<String> {
    let mut keys = HashSet::new();
    for text in texts {
        let mut rest = text.as_str();
        while let Some(open) = rest.find("{{") {
            let Some(len) = rest[open..].find("}}") else {
                break;
            };
            let key = rest[open + 2..open + len].trim().to_ascii_lowercase();
            if !key.is_empty() && key != "spellname" {
                keys.insert(key);
            }
            rest = &rest[open + len + 2..];
        }
    }
    keys
}

/// One language's strings for the catalog: the summaries, and the strings they refer to.
#[derive(Debug, Default)]
struct Texts {
    summaries: Strings,
    nested: Strings,
}

/// The summaries of `definitions` in one language, and the strings they refer to.
fn summaries<R: Read>(
    open: &dyn Fn() -> std::io::Result<R>,
    definitions: &HashMap<String, Definition>,
) -> Result<Texts, StaticDataError> {
    let keys: HashSet<String> = definitions
        .values()
        .filter_map(|d| d.description.as_ref().map(|k| k.to_ascii_lowercase()))
        .collect();
    let table = |wanted: &HashSet<String>| {
        pick_strings(open()?, wanted).map_err(|source| StaticDataError::Parse {
            file: "lol.stringtable.json".to_owned(),
            source,
        })
    };
    let summaries = table(&keys)?;
    let wanted = nested_keys(summaries.values());
    let nested = if wanted.is_empty() {
        HashMap::new()
    } else {
        table(&wanted)?
    };
    Ok(Texts { summaries, nested })
}

// ---- Descriptions -------------------------------------------------------------------------------

/// A number as the tooltip shows it: whole when it is, else up to two decimals.
fn number(x: f64, lang: Lang) -> String {
    if (x - x.round()).abs() < 1e-6 {
        // Tooltip values are small: the cast can't truncate anything real.
        #[allow(clippy::cast_possible_truncation, reason = "a small whole number")]
        return format!("{}", x.round() as i64);
    }
    let text = format!("{x:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    match lang {
        Lang::En => text.to_owned(),
        Lang::Fr => text.replace('.', ","),
    }
}

/// `Name`, `Name*100` or `Name/2` → its value, when the definitions have it: a number or a level
/// range (`20–80`), and whether the game shows it as a percentage (its sign not written yet).
fn placeholder(inner: &str, values: &[(String, Shown)], lang: Lang) -> Option<(String, bool)> {
    let at = inner.find(['*', '/']);
    let (name, op) = match at {
        Some(i) => (&inner[..i], Some((&inner[i..=i], inner[i + 1..].trim()))),
        None => (inner, None),
    };
    let name = name.trim().to_ascii_lowercase();
    let value = values.iter().find(|(n, _)| *n == name)?.1;
    let factor = match op {
        None => 1.0,
        Some(("*", factor)) => factor.parse::<f64>().ok()?,
        Some((_, divisor)) => {
            let divisor = divisor
                .parse::<f64>()
                .ok()
                .filter(|d| d.abs() > f64::EPSILON)?;
            1.0 / divisor
        }
    };
    let scale = if value.percent {
        factor * 100.0
    } else {
        factor
    };
    let (low, high) = (value.low * scale, value.high * scale);
    if !low.is_finite() || !high.is_finite() {
        return None;
    }
    let mut shown = number(low, lang);
    if (high - low).abs() > 1e-6 {
        shown = format!("{shown}–{}", number(high, lang));
    }
    Some((shown, value.percent))
}

/// `{{ key }}`: another string of the table, or the champion's ability.
fn expand_references(text: &str, nested: &Strings, lang: Lang) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("{{") {
        out.push_str(&rest[..open]);
        let Some(len) = rest[open..].find("}}") else {
            return out;
        };
        let key = rest[open + 2..open + len].trim().to_ascii_lowercase();
        if key == "spellname" {
            out.push_str(lang.ability());
        } else if let Some(inner) = nested.get(&key) {
            out.push_str(inner);
        }
        rest = &rest[open + len + 2..];
    }
    out.push_str(rest);
    out
}

/// The text after a value writes its own `%` (`@X*100@%`, French `@X@ %`).
fn percent_follows(rest: &str) -> bool {
    rest.trim_start_matches([' ', '\u{a0}', '\u{202f}'])
        .starts_with('%')
}

/// `@Value@`, `@Value*100@` from the definitions. A value only the game knows in play (it
/// depends on the champion's stats) reads `…`, so the sentence still holds.
fn fill_values(text: &str, values: &[(String, Shown)], lang: Lang) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('@') {
        let Some(len) = rest[open + 1..].find('@') else {
            break;
        };
        let inner = &rest[open + 1..open + 1 + len];
        // `@` isn't always a placeholder: only a short name without spaces is.
        if inner.is_empty() || inner.len() > 64 || inner.contains(char::is_whitespace) {
            out.push_str(&rest[..=open]);
            rest = &rest[open + 1..];
            continue;
        }
        out.push_str(&rest[..open]);
        rest = &rest[open + len + 2..];
        match placeholder(inner, values, lang) {
            Some((value, percent)) => {
                out.push_str(&value);
                if percent && !percent_follows(rest) {
                    out.push_str(match lang {
                        Lang::En => "%",
                        Lang::Fr => "\u{a0}%",
                    });
                }
            }
            None => out.push('…'),
        }
    }
    out.push_str(rest);
    out
}

/// Markup and inline icons (`%i:scaleAP%`) dropped; `<br>` is a line break.
fn strip_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let tag = rest.find('<');
        let icon = rest.find("%i:");
        match (tag, icon) {
            (Some(t), i) if i.is_none_or(|i| t < i) => {
                out.push_str(&rest[..t]);
                let Some(len) = rest[t..].find('>') else {
                    out.push_str(&rest[t..]);
                    return out;
                };
                let name = rest[t + 1..t + len].trim_start_matches('/');
                let name = name
                    .split(|c: char| c.is_whitespace() || c == '/')
                    .next()
                    .unwrap_or_default();
                if name.eq_ignore_ascii_case("br") {
                    out.push('\n');
                }
                rest = &rest[t + len + 1..];
            }
            (_, Some(i)) => {
                out.push_str(&rest[..i]);
                rest = rest[i + 3..]
                    .find('%')
                    .map_or("", |len| &rest[i + 3 + len + 1..]);
            }
            _ => {
                out.push_str(rest);
                return out;
            }
        }
    }
}

/// One space between words (no-break spaces kept: French puts one before `%`), none before a
/// full stop or comma, one line break between paragraphs.
fn tidy(text: &str) -> String {
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            let words = line.split_ascii_whitespace().collect::<Vec<_>>().join(" ");
            words.replace(" .", ".").replace(" ,", ",")
        })
        .filter(|line| !line.is_empty())
        .collect();
    lines.join("\n")
}

/// Plain text of a game string: references resolved (`{{ key }}` from `nested`, `@Value@` from
/// `values`), what can't be resolved left out, markup dropped, `<br>` kept as a line break.
fn describe(text: &str, values: &[(String, Shown)], nested: &Strings, lang: Lang) -> String {
    let expanded = expand_references(text, nested, lang);
    tidy(&strip_markup(&fill_values(&expanded, values, lang)))
}

// ---- The catalog --------------------------------------------------------------------------------

/// The game's files a catalog is built from (see the module docs); the large ones are optional:
/// without them the descriptions are empty.
#[derive(Debug)]
pub struct Inputs<R> {
    /// The mirror's version (`content-metadata.json`).
    pub version: String,
    pub lists: Vec<u8>,
    pub augments_en: Vec<u8>,
    pub augments_fr: Vec<u8>,
    /// `kiwi.bin.json`.
    pub definitions: Option<R>,
    /// The string tables, English and French, each opened twice (summaries, then the strings
    /// they refer to).
    pub strings: Option<StringTables<R>>,
}

/// Opens a string table again for each pass.
pub type Opener<R> = Box<dyn Fn() -> std::io::Result<R> + Send>;

/// The English and French string tables.
pub struct StringTables<R> {
    pub en: Opener<R>,
    pub fr: Opener<R>,
}

impl<R> fmt::Debug for StringTables<R> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("StringTables")
    }
}

/// What the descriptions are made from, when the large files could be read.
struct Described {
    definitions: HashMap<String, Definition>,
    en: Texts,
    fr: Texts,
}

impl Described {
    /// Reads the definitions and both string tables; `None` (logged) when any can't be read.
    fn read<R: Read>(
        definitions: Option<R>,
        strings: Option<&StringTables<R>>,
        pool: &[String],
    ) -> Option<Self> {
        let definitions = match definitions.map(|reader| self::definitions(reader, pool)) {
            Some(Ok(definitions)) if !definitions.is_empty() => definitions,
            Some(Err(error)) => {
                tracing::warn!(%error, "Mayhem augments: definitions unreadable, no descriptions");
                return None;
            }
            _ => return None,
        };
        let tables = strings?;
        let read = |open: &Opener<R>| summaries(open.as_ref(), &definitions);
        match (read(&tables.en), read(&tables.fr)) {
            (Ok(en), Ok(fr)) => Some(Self {
                definitions,
                en,
                fr,
            }),
            (Err(error), _) | (_, Err(error)) => {
                tracing::warn!(%error, "Mayhem augments: string tables unreadable, no descriptions");
                None
            }
        }
    }

    /// The description of the augment defined at `path`, in `lang` (empty when unknown).
    fn text(&self, path: &str, lang: Lang) -> String {
        let Some(definition) = self.definitions.get(path) else {
            return String::new();
        };
        let texts = match lang {
            Lang::En => &self.en,
            Lang::Fr => &self.fr,
        };
        definition
            .description
            .as_ref()
            .and_then(|key| texts.summaries.get(&key.to_ascii_lowercase()))
            .map(|raw| describe(raw, &definition.values, &texts.nested, lang))
            .unwrap_or_default()
    }
}

/// The Mayhem pool: the augments' definition paths (`Maps/ModeSpecificData/Augments/X`).
fn pool_of(lists: &[u8]) -> Result<Vec<String>, StaticDataError> {
    let lists: Vec<ModeList> = parse("augment-lists.json", lists)?;
    let pool: Vec<String> = lists
        .into_iter()
        .find(|l| l.mode == MODE)
        .map(|l| l.augments)
        .unwrap_or_default();
    if pool.is_empty() {
        return Err(StaticDataError::Status(
            0,
            format!("augment-lists.json has no {MODE} pool"),
        ));
    }
    Ok(pool)
}

/// Builds the catalog: the pool's augments by id. Descriptions stay empty when the definitions
/// or string tables are missing or unreadable (logged).
pub fn assemble<R: Read>(inputs: Inputs<R>) -> Result<AugmentCatalog, StaticDataError> {
    let patch = patch_of(&inputs.version).ok_or_else(|| {
        StaticDataError::Status(0, format!("unexpected version {:?}", inputs.version))
    })?;
    let pool = pool_of(&inputs.lists)?;
    let en: Vec<ClientAugment> = parse("cherry-augments.json", &inputs.augments_en)?;
    let fr: Vec<ClientAugment> = parse("cherry-augments.json (fr_fr)", &inputs.augments_fr)?;
    let by_name: HashMap<&str, &ClientAugment> =
        en.iter().map(|a| (a.augment_name_id.as_str(), a)).collect();
    let french: HashMap<u32, &str> = fr.iter().map(|a| (a.id, a.name.as_str())).collect();
    let described = Described::read(inputs.definitions, inputs.strings.as_ref(), &pool);
    let plain = |name: &str, lang| describe(name, &[], &HashMap::new(), lang);

    let mut augments = BTreeMap::new();
    for path in &pool {
        let name_id = path.rsplit('/').next().unwrap_or(path);
        let Some(client) = by_name.get(name_id) else {
            tracing::debug!(name_id, "Mayhem augment missing from the client's list");
            continue;
        };
        let (Some(rarity), Some(icon)) = (
            rarity(&client.rarity),
            icon_path(&client.augment_small_icon_path),
        ) else {
            continue;
        };
        let name_en = plain(&client.name, Lang::En);
        if name_en.is_empty() {
            continue;
        }
        let name_fr = french
            .get(&client.id)
            .map(|name| plain(name, Lang::Fr))
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| name_en.clone());
        let text = |lang| {
            described
                .as_ref()
                .map_or_else(String::new, |d| d.text(path, lang))
        };
        augments.insert(
            client.id,
            CatalogAugment {
                id: client.id,
                rarity,
                icon,
                name: LocalizedText {
                    en: name_en,
                    fr: name_fr,
                },
                description: LocalizedText {
                    en: text(Lang::En),
                    fr: text(Lang::Fr),
                },
            },
        );
    }
    Ok(AugmentCatalog {
        version: inputs.version,
        patch,
        built_at: now_ms(),
        augments: augments.into_values().collect(),
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

// ---- Downloads ----------------------------------------------------------------------------------

/// Downloads the game's files from a `CommunityDragon` mirror and builds the catalog.
#[derive(Debug, Clone)]
pub struct CatalogSource {
    http: reqwest::Client,
    base: String,
    /// Owned by this source: `{cache}/{version}/…` holds the large files of the version being
    /// built (a retry doesn't download them again); other versions are removed.
    cache: PathBuf,
}

#[derive(Deserialize)]
struct Metadata {
    version: String,
}

impl CatalogSource {
    pub fn new(
        base: impl Into<String>,
        cache: impl Into<PathBuf>,
    ) -> Result<Self, StaticDataError> {
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(crate::public_tls()?)
            .connect_timeout(Duration::from_secs(10))
            // The string tables are large and the mirror can be slow: bound each read, not
            // the whole download.
            .read_timeout(Duration::from_secs(90))
            .build()?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_owned(),
            cache: cache.into(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.base)
    }

    async fn get(&self, path: &str) -> Result<Vec<u8>, StaticDataError> {
        let url = self.url(path);
        let response = self.http.get(&url).send().await?;
        if !response.status().is_success() {
            return Err(StaticDataError::Status(response.status().as_u16(), url));
        }
        Ok(response.bytes().await?.to_vec())
    }

    /// The game version the mirror holds now.
    pub async fn version(&self) -> Result<String, StaticDataError> {
        let metadata: Metadata = parse(METADATA, &self.get(METADATA).await?)?;
        Ok(metadata.version)
    }

    /// Streams `path` to `file` (unless it's there already).
    async fn fetch_to(&self, path: &str, file: &Path) -> Result<(), StaticDataError> {
        if tokio::fs::metadata(file).await.is_ok_and(|m| m.len() > 0) {
            return Ok(());
        }
        let url = self.url(path);
        let mut response = self.http.get(&url).send().await?;
        if !response.status().is_success() {
            return Err(StaticDataError::Status(response.status().as_u16(), url));
        }
        let partial = file.with_extension("part");
        let mut out = tokio::fs::File::create(&partial).await?;
        while let Some(chunk) = response.chunk().await? {
            out.write_all(&chunk).await?;
        }
        out.flush().await?;
        drop(out);
        tokio::fs::rename(&partial, file).await?;
        Ok(())
    }

    /// Builds the catalog of what the mirror holds now (see the module docs).
    pub async fn build(&self) -> Result<AugmentCatalog, StaticDataError> {
        let version = self.version().await?;
        let folder: String = version
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let dir = self.cache.join(&folder);
        tokio::fs::create_dir_all(&dir).await?;
        self.prune(&folder).await;
        let (lists, augments_en, augments_fr) = tokio::try_join!(
            self.get(LISTS),
            self.get(AUGMENTS_EN),
            self.get(AUGMENTS_FR)
        )?;
        let definitions = dir.join("kiwi.bin.json");
        let strings_en = dir.join("lol.stringtable.en_us.json");
        let strings_fr = dir.join("lol.stringtable.fr_fr.json");
        let large = async {
            self.fetch_to(DEFINITIONS, &definitions).await?;
            self.fetch_to(STRINGS_EN, &strings_en).await?;
            self.fetch_to(STRINGS_FR, &strings_fr).await
        };
        let described = match large.await {
            Ok(()) => true,
            Err(error) => {
                tracing::warn!(%error, "Mayhem augments: game files unavailable, building without descriptions");
                false
            }
        };
        let open = |path: PathBuf| -> Box<dyn Fn() -> std::io::Result<std::fs::File> + Send> {
            Box::new(move || std::fs::File::open(&path))
        };
        let inputs = Inputs {
            version,
            lists,
            augments_en,
            augments_fr,
            definitions: if described {
                std::fs::File::open(&definitions).ok()
            } else {
                None
            },
            strings: described.then(|| StringTables {
                en: open(strings_en),
                fr: open(strings_fr),
            }),
        };
        tokio::task::spawn_blocking(move || assemble(inputs))
            .await
            .map_err(|error| StaticDataError::Io(std::io::Error::other(error)))?
    }

    /// Removes the files of other versions.
    async fn prune(&self, keep: &str) {
        let Ok(mut entries) = tokio::fs::read_dir(&self.cache).await else {
            return;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            if entry.file_name().to_str() != Some(keep)
                && entry.file_type().await.is_ok_and(|t| t.is_dir())
                && let Err(error) = tokio::fs::remove_dir_all(entry.path()).await
            {
                tracing::debug!(%error, "cannot remove old Mayhem game files");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use std::io::Cursor;

    use super::*;

    fn values(pairs: &[(&str, f64)]) -> Vec<(String, Shown)> {
        pairs
            .iter()
            .map(|(n, v)| (n.to_ascii_lowercase(), Shown::plain(*v)))
            .collect()
    }

    #[test]
    fn calculations_show_numbers_ranges_and_percentages() {
        let named = values(&[("BaseCrit", 0.25)]);
        let calc = |json: &str| calculation(&serde_json::from_str(json).unwrap(), &named);
        let crit = calc(
            r#"{"__type":"GameCalculation","mDisplayAsPercent":true,"mFormulaParts":[
                {"__type":"NamedDataValueCalculationPart","mDataValue":"BaseCrit"},
                {"__type":"StatByNamedDataValueCalculationPart","mDataValue":"Ratio"}]}"#,
        )
        .unwrap();
        let ap = calc(
            r#"{"__type":"GameCalculation","mFormulaParts":[
                {"__type":"ByCharLevelInterpolationCalculationPart","mStartValue":20.0,"mEndValue":80.0}]}"#,
        )
        .unwrap();
        let flat = calc(r#"{"__type":"GameCalculation","mFormulaParts":[{"__type":"NumberCalculationPart","mNumber":0.45}]}"#).unwrap();
        let v = vec![
            ("crit".to_owned(), crit),
            ("ap".to_owned(), ap),
            ("flat".to_owned(), flat),
        ];
        let none = HashMap::new();
        assert_eq!(
            describe(
                "Gain @Crit@ Crit Chance and @AP@ Ability Power, @Flat*100@% more.",
                &v,
                &none,
                Lang::En
            ),
            "Gain 25% Crit Chance and 20–80 Ability Power, 45% more.",
            "a stat scaling leaves its base"
        );
        assert_eq!(
            describe("Gagne @Crit@ de chances.", &v, &none, Lang::Fr),
            "Gagne 25\u{a0}% de chances."
        );
        assert_eq!(
            describe("Vous gagnez @Crit@\u{a0}% de chances.", &v, &none, Lang::Fr),
            "Vous gagnez 25\u{a0}% de chances.",
            "a text that writes its own % keeps one"
        );
        assert_eq!(
            calc(
                r#"{"__type":"{e9a3c91d}","mFormulaParts":[{"__type":"NumberCalculationPart","mNumber":75.0}]}"#
            ),
            None,
            "a calculation of another kind (melee and ranged values) isn't guessed"
        );
        assert_eq!(
            describe(
                "Throw a boomerang every @Cooldown@s. Hits @Unknown@% harder.",
                &v,
                &none,
                Lang::En
            ),
            "Throw a boomerang every …s. Hits …% harder.",
            "a value only the game knows in play reads …"
        );
    }

    #[test]
    fn patches_and_icons() {
        assert_eq!(
            patch_of("16.19.8217343+branch.releases-16-19.content.release").as_deref(),
            Some("16.19")
        );
        assert_eq!(patch_of("latest"), None);
        assert_eq!(
            icon_path("/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/TestGlyph_small.png")
                .as_deref(),
            Some("assets/ux/kiwi/augments/icons/testglyph_small.png")
        );
        assert_eq!(
            icon_path("/lol-game-data/assets/../../secret.png"),
            None,
            "no way out of the client's files"
        );
        assert_eq!(icon_path("https://elsewhere/x.png"), None);
        assert_eq!(
            icon_url("https://mirror/latest/", "assets/x.png"),
            "https://mirror/latest/plugins/rcp-be-lol-game-data/global/default/assets/x.png"
        );
    }

    #[test]
    fn descriptions_read_like_the_game_without_its_markup() {
        let nested = HashMap::from([(
            "item_keyword_onhit".to_owned(),
            "<OnHit>On-Hit</OnHit>".to_owned(),
        )]);
        let v = values(&[("Duration", 4.0), ("Shred", 0.3), ("Haste", 12.5)]);
        assert_eq!(
            describe(
                "Gain <speed>@Duration@ s</speed> of @Shred*100@% <scaleArmor>shred</scaleArmor>.<br><br><rules>Once per @Cooldown@ seconds.</rules>",
                &v,
                &nested,
                Lang::En
            ),
            "Gain 4 s of 30% shred.\nOnce per … seconds.",
        );
        assert_eq!(
            describe(
                "Your {{SpellName}} gains @Haste@ Ability Haste %i:scaleAH%.",
                &v,
                &nested,
                Lang::En
            ),
            "Your [Ability] gains 12.5 Ability Haste."
        );
        assert_eq!(
            describe(
                "Votre {{ SpellName }} gagne @Haste@ d'accélération.",
                &v,
                &nested,
                Lang::Fr
            ),
            "Votre [Compétence] gagne 12,5 d'accélération."
        );
        assert_eq!(
            describe(
                "Attacks apply {{ Item_Keyword_OnHit }} effects.",
                &v,
                &nested,
                Lang::En
            ),
            "Attacks apply On-Hit effects."
        );
        assert_eq!(
            describe(
                "Unknown @Calc_Shield@% shield and @TotalShield@ more.",
                &v,
                &nested,
                Lang::En
            ),
            "Unknown …% shield and … more.",
            "values the game computes in play read …"
        );
        assert_eq!(
            describe("Email me@host or 2 @ 3", &v, &nested, Lang::En),
            "Email me@host or 2 @ 3",
            "an @ that isn't a placeholder stays"
        );
        assert_eq!(
            describe(
                "<font color='#F0C200'>QUEST:</font> Win",
                &v,
                &nested,
                Lang::En
            ),
            "QUEST: Win"
        );
        assert_eq!(describe("", &v, &nested, Lang::En), "");
    }

    #[test]
    fn values_divide_and_multiply() {
        let v = values(&[("Ratio", 0.125)]);
        let shown = |inner: &str| placeholder(inner, &v, Lang::En).map(|(text, _)| text);
        assert_eq!(shown("Ratio*100").as_deref(), Some("12.5"));
        assert_eq!(shown("ratio/0.5").as_deref(), Some("0.25"));
        assert_eq!(placeholder("Ratio/0", &v, Lang::En), None);
        assert_eq!(placeholder("Missing", &v, Lang::En), None);
        assert_eq!(number(3.0, Lang::Fr), "3");
        assert_eq!(number(0.333_33, Lang::Fr), "0,33");
    }

    #[test]
    fn string_tables_are_read_as_a_stream_keeping_only_what_is_asked() {
        let table = br#"{"entries":{"keep_me":"Kept","Skip":"no","keep_me_too":"<b>Too</b>","nested":{"odd":1}},"version":"1.0"}"#;
        let wanted: HashSet<String> = ["keep_me".to_owned(), "keep_me_too".to_owned()].into();
        let picked = pick_strings(Cursor::new(&table[..]), &wanted).unwrap();
        assert_eq!(picked.len(), 2);
        assert_eq!(picked["keep_me_too"], "<b>Too</b>");
        assert!(pick_strings(Cursor::new(&b"{\"entries\": [1"[..]), &wanted).is_err());
    }

    /// A made-up miniature of the game's files (no game text).
    fn inputs(described: bool) -> Inputs<Cursor<Vec<u8>>> {
        let lists = br#"[{"augmentList":["Maps/A/Glass"],"modeName":"CHERRY"},
            {"augmentList":["Maps/A/Glass","Maps/A/Spark","Maps/A/Missing"],"modeName":"KIWI"}]"#;
        let en = br#"[{"id":7,"augmentNameId":"Glass","nameTRA":"Glass Test","augmentSmallIconPath":"/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/Glass_small.png","rarity":"kGold"},
            {"id":3,"augmentNameId":"Spark","nameTRA":"Spark Test","augmentSmallIconPath":"/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/Spark_small.png","rarity":"kPrismatic"},
            {"id":9,"augmentNameId":"ArenaOnly","nameTRA":"Arena","augmentSmallIconPath":"/lol-game-data/assets/x.png","rarity":"kSilver"}]"#;
        let fr = br#"[{"id":7,"augmentNameId":"Glass","nameTRA":"Verre test","augmentSmallIconPath":"","rarity":"kGold"}]"#;
        let bin = br#"{
            "Maps/A/Glass": {"__type":"AugmentData","DescriptionTra":"Glass_Summary","RootSpell":"Maps/A/Glass/Root"},
            "Maps/A/Glass/Root": {"__type":"SpellObject","mSpell":{"DataValues":[{"name":"Duration","values":[0,3,3]}]}},
            "Maps/A/Glass/Other": {"__type":"SpellObject","mSpell":{"DataValues":[{"name":"Duration","values":[9,9]},{"mName":"Bonus","mValues":[0.2]}]}},
            "Maps/A/Glass/Particles/X": {"__type":"VfxSystemDefinitionData","mSpell":"not an object"},
            "Maps/A/Spark": {"__type":"AugmentData","DescriptionTra":"Spark_Summary"}
        }"#;
        let strings_en = br#"{"entries":{"glass_summary":"Last @Duration@ s, +@Bonus*100@% with {{ Keyword_Test }}.","keyword_test":"<b>focus</b>","spark_summary":"Sparks."}}"#;
        let strings_fr =
            br#"{"entries":{"glass_summary":"Dure @Duration@ s.","spark_summary":"Etincelles."}}"#;
        let table =
            |bytes: &'static [u8]| -> Box<dyn Fn() -> std::io::Result<Cursor<Vec<u8>>> + Send> {
                Box::new(move || Ok(Cursor::new(bytes.to_vec())))
            };
        Inputs {
            version: "16.19.1+branch".into(),
            lists: lists.to_vec(),
            augments_en: en.to_vec(),
            augments_fr: fr.to_vec(),
            definitions: described.then(|| Cursor::new(bin.to_vec())),
            strings: described.then(|| StringTables {
                en: table(strings_en),
                fr: table(strings_fr),
            }),
        }
    }

    #[test]
    fn assembles_the_pool_by_id_in_both_languages() {
        let catalog = assemble(inputs(true)).unwrap();
        assert_eq!(catalog.patch, "16.19");
        let ids: Vec<u32> = catalog.augments.iter().map(|a| a.id).collect();
        assert_eq!(
            ids,
            [3, 7],
            "the KIWI pool only, by id; unknown names skipped"
        );
        let glass = &catalog.augments[1];
        assert_eq!(glass.rarity, AugmentRarity::Gold);
        assert_eq!(glass.icon, "assets/ux/kiwi/augments/icons/glass_small.png");
        assert_eq!(
            (glass.name.en.as_str(), glass.name.fr.as_str()),
            ("Glass Test", "Verre test")
        );
        assert_eq!(
            glass.description.en, "Last 3 s, +20% with focus.",
            "the root spell's value wins, others fill in"
        );
        assert_eq!(glass.description.fr, "Dure 3 s.");
        let spark = &catalog.augments[0];
        assert_eq!(
            spark.name.fr, "Spark Test",
            "no French name: the English one"
        );
        assert_eq!(spark.description.en, "Sparks.");
    }

    #[test]
    fn without_the_large_files_the_names_still_come() {
        let catalog = assemble(inputs(false)).unwrap();
        assert_eq!(catalog.augments.len(), 2);
        assert!(catalog.augments.iter().all(|a| a.description.en.is_empty()));
        let mut broken = inputs(false);
        broken.lists = br#"[{"augmentList":[],"modeName":"CHERRY"}]"#.to_vec();
        assert!(assemble(broken).is_err(), "no Mayhem pool: no catalog");
    }
}
