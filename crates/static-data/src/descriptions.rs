//! What runes, stat shards, summoner spells and items do, for the UI's tooltips.
//!
//! Runes, spells and items: Data Dragon's own descriptions, read from the files `GameData` came
//! from (cached per version and locale), one at a time when a tooltip asks. Stat shards aren't
//! in Data Dragon: their names and effects come from the League client's data as
//! `CommunityDragon` mirrors it (`perks.json`), downloaded the first time a shard is described
//! and kept next to the patch's files (`shards.json`).
//!
//! Riot's text carries the client's markup (`<br>`, `<stats>`, `<passive>`, `<magicDamage>`…).
//! [`rich_text`] keeps the text only: lines, paragraphs, and a tone where the markup stressed or
//! coloured something. Every tag is dropped; nothing reaches the UI as markup.

use std::collections::BTreeMap;

use domain::{Description, DescriptionKind, TextSpan, TextTone};
use serde::{Deserialize, Serialize};

use crate::{DataDragon, StaticDataError, write_atomically};

/// Where the stat shards' texts are kept, next to the patch's Data Dragon files.
const SHARDS_FILE: &str = "shards.json";
/// `CommunityDragon`: the League client's files, one folder per patch (`16.19`) and `latest`.
pub const COMMUNITY_DRAGON: &str = "https://raw.communitydragon.org";

/// Finds one entry's description in a Data Dragon file.
type Describe = fn(&[u8], u32) -> Result<Option<Description>, StaticDataError>;

impl DataDragon {
    /// What rune, stat shard, summoner spell or item `id` does, in this client's language:
    /// from `version`'s files (cached, else downloaded and cached), or `None` when it has no
    /// text. Shards come from [`Self::shards`].
    pub async fn describe(
        &self,
        version: &str,
        kind: DescriptionKind,
        id: u32,
    ) -> Result<Option<Description>, StaticDataError> {
        let (file, pick): (&str, Describe) = match kind {
            DescriptionKind::Rune => ("runesReforged.json", describe_rune),
            DescriptionKind::Spell => ("summoner.json", describe_spell),
            DescriptionKind::Item => ("item.json", describe_item),
            DescriptionKind::Shard => return Ok(self.shards(version).await?.remove(&id)),
        };
        let bytes = self.file(version, file).await?;
        // A whole file to read for one entry: off the async threads.
        tokio::task::spawn_blocking(move || pick(&bytes, id))
            .await
            .map_err(|error| StaticDataError::Io(std::io::Error::other(error)))?
    }

    /// The stat shards' names and effects (ids 5001–5013) for `version` in this client's
    /// language: kept on disk with the patch, downloaded from `CommunityDragon` the first time
    /// (that patch's folder, else `latest` when it isn't mirrored yet).
    pub async fn shards(
        &self,
        version: &str,
    ) -> Result<BTreeMap<u32, Description>, StaticDataError> {
        let path = self
            .cache
            .join(version)
            .join(&self.locale)
            .join(SHARDS_FILE);
        let raw: Vec<RawShard> = if let Ok(bytes) = tokio::fs::read(&path).await {
            serde_json::from_slice(&bytes).map_err(parse_error(SHARDS_FILE))?
        } else {
            let file = format!(
                "plugins/rcp-be-lol-game-data/global/{}/v1/perks.json",
                community_locale(&self.locale)
            );
            // `16.19.1` is in the `16.19` folder.
            let folder = version.split('.').take(2).collect::<Vec<_>>().join(".");
            let perks = match self
                .get(&format!("{}/{folder}/{file}", self.community))
                .await
            {
                Err(StaticDataError::Status(404, _)) => {
                    self.get(&format!("{}/latest/{file}", self.community))
                        .await?
                }
                perks => perks?,
            };
            let raw = shards_of(&perks)?;
            let bytes = serde_json::to_vec(&raw).map_err(parse_error(SHARDS_FILE))?;
            write_atomically(&path, &bytes).await?;
            raw
        };
        Ok(raw
            .into_iter()
            .map(|shard| {
                let mut text = rich_text(&shard.text);
                stress_value(&mut text);
                (
                    shard.id,
                    Description {
                        name: Some(shard.name),
                        cooldown: None,
                        text,
                    },
                )
            })
            .collect())
    }
}

/// A stat shard's value leads its text (`+9 Adaptive Force`, `+10 - 180 PV`): stressed, as an
/// item's stats are.
fn stress_value(lines: &mut [Vec<TextSpan>]) {
    let Some(line) = lines.first_mut() else {
        return;
    };
    let Some(first) = line.first_mut() else {
        return;
    };
    let end = value_len(&first.text);
    if first.tone.is_some() || end == 0 || end == first.text.len() {
        return;
    }
    let rest = first.text.split_off(end);
    first.tone = Some(TextTone::Strong);
    line.insert(
        1,
        TextSpan {
            text: rest,
            tone: None,
        },
    );
}

/// The length of a leading `+9`, `+2.5%` or `+10 - 180` (a range), 0 when the text starts otherwise.
fn value_len(text: &str) -> usize {
    let number = |s: &str| {
        s.find(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | ',' | '%')))
            .unwrap_or(s.len())
    };
    let Some(body) = text.strip_prefix('+') else {
        return 0;
    };
    let first = number(body);
    if first == 0 {
        return 0;
    }
    let end = 1 + first;
    let after = text[end..].trim_start();
    if let Some(range) = after.strip_prefix(['-', '–']) {
        let second = range.trim_start();
        let len = number(second);
        if len > 0 {
            return text.len() - second.len() + len;
        }
    }
    end
}

/// `CommunityDragon` names the client's locales in lower case, English being `default`.
fn community_locale(locale: &str) -> String {
    if locale.eq_ignore_ascii_case("en_US") {
        "default".to_owned()
    } else {
        locale.to_ascii_lowercase()
    }
}

/// A stat shard as kept on disk: Riot's text as it came (the sanitizer runs on reading).
#[derive(Debug, Serialize, Deserialize)]
struct RawShard {
    id: u32,
    name: String,
    text: String,
}

#[derive(Deserialize)]
struct Perk {
    id: u32,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "shortDesc")]
    short_desc: String,
    #[serde(default, rename = "longDesc")]
    long_desc: String,
}

/// The stat shards of the client's `perks.json` (every rune is in it too). Fails when none is,
/// so a changed file is never cached as "no shards".
fn shards_of(perks: &[u8]) -> Result<Vec<RawShard>, StaticDataError> {
    let perks: Vec<Perk> =
        serde_json::from_slice(perks).map_err(|source| StaticDataError::Parse {
            file: "perks.json".into(),
            source,
        })?;
    let shards: Vec<RawShard> = perks
        .into_iter()
        .filter(|p| (5000..6000).contains(&p.id) && !p.name.trim().is_empty())
        .map(|p| RawShard {
            id: p.id,
            name: p.name,
            text: first_shown([&p.long_desc, &p.short_desc]).to_owned(),
        })
        .collect();
    if shards.is_empty() {
        return Err(StaticDataError::NothingCached);
    }
    Ok(shards)
}

/// The first text that can be shown as it is: some text once its markup is gone, and no value
/// the client fills in while playing (`@f1@`, `@TotalDamage@`).
fn first_shown<const N: usize>(texts: [&str; N]) -> &str {
    texts
        .into_iter()
        .find(|text| !has_placeholder(text) && !rich_text(text).is_empty())
        .unwrap_or_default()
}

/// `@name@`: a value the client computes, meaningless out of the game.
fn has_placeholder(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.iter().enumerate().any(|(at, &byte)| {
        let tail = &bytes[at + 1..];
        let name = tail
            .iter()
            .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'*'))
            .count();
        byte == b'@' && name > 0 && tail.get(name) == Some(&b'@')
    })
}

fn parse_error(file: &str) -> impl FnOnce(serde_json::Error) -> StaticDataError + '_ {
    move |source| StaticDataError::Parse {
        file: file.into(),
        source,
    }
}

/// `None` when there's nothing to say.
fn described(text: Vec<Vec<TextSpan>>, cooldown: Option<u32>) -> Option<Description> {
    (!text.is_empty() || cooldown.is_some()).then_some(Description {
        name: None,
        cooldown,
        text,
    })
}

#[derive(Deserialize)]
struct Items {
    data: BTreeMap<String, ItemText>,
}

#[derive(Deserialize)]
struct ItemText {
    #[serde(default)]
    description: String,
    #[serde(default)]
    plaintext: String,
}

/// An item's stats, passives and actives (`item.json`), else its one-line summary.
pub fn describe_item(items: &[u8], id: u32) -> Result<Option<Description>, StaticDataError> {
    let items: Items = serde_json::from_slice(items).map_err(parse_error("item.json"))?;
    Ok(items.data.get(&id.to_string()).and_then(|item| {
        described(
            rich_text(first_shown([&item.description, &item.plaintext])),
            None,
        )
    }))
}

#[derive(Deserialize)]
struct Spells {
    data: BTreeMap<String, SpellText>,
}

#[derive(Deserialize)]
struct SpellText {
    key: String,
    #[serde(default)]
    description: String,
    #[serde(default, rename = "cooldownBurn")]
    cooldown: String,
}

/// A summoner spell's description and cooldown (`summoner.json`; its numeric `key` is the id).
pub fn describe_spell(spells: &[u8], id: u32) -> Result<Option<Description>, StaticDataError> {
    let spells: Spells = serde_json::from_slice(spells).map_err(parse_error("summoner.json"))?;
    Ok(spells
        .data
        .into_values()
        .find(|spell| spell.key.parse() == Ok(id))
        .and_then(|spell| {
            // `300`, or one value per rank (`210/180`): the first. Under a second is a mode's
            // own rule (Arena's rounds), not a cooldown to show.
            let cooldown = spell
                .cooldown
                .split('/')
                .next()
                .and_then(|s| s.trim().parse::<f64>().ok())
                .filter(|s| s.is_finite() && *s >= 1.0 && *s <= f64::from(u32::MAX))
                .map(|s| {
                    #[allow(
                        clippy::cast_possible_truncation,
                        clippy::cast_sign_loss,
                        reason = "a positive number of seconds, bounded above"
                    )]
                    let seconds = s.round() as u32;
                    seconds
                });
            described(rich_text(first_shown([&spell.description])), cooldown)
        }))
}

#[derive(Deserialize)]
struct RuneTree {
    #[serde(default)]
    slots: Vec<RuneRow>,
}

#[derive(Deserialize)]
struct RuneRow {
    #[serde(default)]
    runes: Vec<RuneText>,
}

#[derive(Deserialize)]
struct RuneText {
    id: u32,
    #[serde(default, rename = "shortDesc")]
    short_desc: String,
    #[serde(default, rename = "longDesc")]
    long_desc: String,
}

/// A rune's full text, as the client shows it on the rune page (`runesReforged.json`), else
/// its short one (the full one sometimes has values only the game fills in).
pub fn describe_rune(runes: &[u8], id: u32) -> Result<Option<Description>, StaticDataError> {
    let trees: Vec<RuneTree> =
        serde_json::from_slice(runes).map_err(parse_error("runesReforged.json"))?;
    Ok(trees
        .into_iter()
        .flat_map(|tree| tree.slots)
        .flat_map(|row| row.runes)
        .find(|rune| rune.id == id)
        .and_then(|rune| {
            described(
                rich_text(first_shown([&rune.long_desc, &rune.short_desc])),
                None,
            )
        }))
}

/// Riot's markup to lines of text: `<br>` ends a line, two of them (or `<hr>`) a paragraph
/// (an empty line between), `<li>` starts a line with a bullet. The client's stressed and
/// coloured tags give their text a tone ([`TextTone`]); any other tag is dropped and its text
/// kept. Whitespace collapses, the common entities are decoded, a `<` that opens no tag is
/// text. The result is text only: nothing in it is ever read as markup.
pub fn rich_text(markup: &str) -> Vec<Vec<TextSpan>> {
    let mut out = Lines::default();
    // Open tags that set a tone, innermost last.
    let mut open: Vec<(String, TextTone)> = Vec::new();
    let mut rest = markup;
    while let Some(at) = rest.find('<') {
        out.text(&rest[..at], open.last().map(|(_, tone)| *tone));
        let inside = &rest[at + 1..];
        let (Some((closing, name)), Some(end)) = (tag_name(inside), inside.find('>')) else {
            // Not a tag: the `<` is text.
            out.text("<", open.last().map(|(_, tone)| *tone));
            rest = inside;
            continue;
        };
        match name.as_str() {
            "br" => out.breaks += 1,
            "hr" => out.breaks = out.breaks.max(2),
            "li" if !closing => {
                out.breaks = out.breaks.max(1);
                out.bullet = true;
            }
            _ if closing => {
                // The innermost tag of that name (Riot's markup isn't always well nested).
                if let Some(index) = open.iter().rposition(|(tag, _)| *tag == name) {
                    open.remove(index);
                }
            }
            _ => {
                if let Some(tone) = tone_of(&name)
                    && !inside[..end].ends_with('/')
                {
                    open.push((name, tone));
                }
            }
        }
        rest = &inside[end + 1..];
    }
    out.text(rest, open.last().map(|(_, tone)| *tone));
    out.finish()
}

/// `b>`, `/b>`, `font color='…'>` → whether it closes, and the tag's name in lower case; `None`
/// when no name starts right after the `<` (then it isn't a tag).
fn tag_name(inside: &str) -> Option<(bool, String)> {
    let (closing, name) = match inside.strip_prefix('/') {
        Some(name) => (true, name),
        None => (false, inside),
    };
    if !name.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }
    let len = name
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .unwrap_or(name.len());
    Some((closing, name[..len].to_ascii_lowercase()))
}

/// The tone of the client's tags that stress or colour their text.
fn tone_of(tag: &str) -> Option<TextTone> {
    Some(match tag {
        "attention" | "b" | "strong" | "passive" | "active" | "unique" | "keywordmajor"
        | "spellname" | "spellactive" | "spellpassive" | "raritygeneric" | "raritylegendary"
        | "raritymythic" | "ornnbonus" | "jadeunique" | "buffedstat" | "titleleft" => {
            TextTone::Strong
        }
        "rules" | "i" | "em" | "flavortext" | "jaderules" | "titleright" => TextTone::Subtle,
        "physicaldamage" => TextTone::Physical,
        "magicdamage" => TextTone::Magic,
        "truedamage" => TextTone::True,
        "healing" => TextTone::Heal,
        _ => return None,
    })
}

/// Lines being built: text arrives in runs between tags.
#[derive(Default)]
struct Lines {
    done: Vec<Vec<TextSpan>>,
    line: Vec<TextSpan>,
    /// Line breaks since the last text: they take effect only if text follows.
    breaks: usize,
    /// The next line starts with a bullet.
    bullet: bool,
}

impl Lines {
    fn text(&mut self, raw: &str, tone: Option<TextTone>) {
        let text = collapse(&decode(raw));
        if text.trim().is_empty() && (self.breaks > 0 || self.line.is_empty()) {
            // Space between breaks, or at the start of a line: nothing to show.
            return;
        }
        if self.breaks > 0 {
            if !self.line.is_empty() || !self.done.is_empty() {
                self.end_line();
                if self.breaks > 1 {
                    self.done.push(Vec::new());
                }
            }
            self.breaks = 0;
        }
        if self.bullet {
            self.bullet = false;
            self.push("• ".to_owned(), None);
        }
        // One space between words, none to start a line with.
        let text = if self.line.last().is_none_or(|span| span.text.ends_with(' ')) {
            text.trim_start()
        } else {
            &text
        };
        if !text.is_empty() {
            self.push(text.to_owned(), tone);
        }
    }

    fn push(&mut self, text: String, tone: Option<TextTone>) {
        match self.line.last_mut() {
            Some(last) if last.tone == tone => last.text.push_str(&text),
            _ => self.line.push(TextSpan { text, tone }),
        }
    }

    /// Closes the current line, without the spaces it ends with.
    fn end_line(&mut self) {
        let mut line = std::mem::take(&mut self.line);
        while let Some(last) = line.last_mut() {
            let kept = last.text.trim_end().len();
            last.text.truncate(kept);
            if !last.text.is_empty() {
                break;
            }
            line.pop();
        }
        if !line.is_empty() {
            self.done.push(line);
        }
    }

    fn finish(mut self) -> Vec<Vec<TextSpan>> {
        self.end_line();
        // A paragraph break with nothing after it.
        while self.done.last().is_some_and(Vec::is_empty) {
            self.done.pop();
        }
        self.done
    }
}

/// Runs of ASCII whitespace as one space (a no-break space stays: it holds a number to its unit).
fn collapse(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = false;
    for c in text.chars() {
        if c.is_ascii_whitespace() {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    out
}

/// The entities Riot's text may carry (`&amp;`, `&nbsp;`, `&#39;`…); others stay as written.
fn decode(text: &str) -> String {
    if !text.contains('&') {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let entity = &rest[at..];
        let decoded = entity.find(';').filter(|end| *end <= 10).and_then(|end| {
            let char = match &entity[1..end] {
                "amp" => '&',
                "lt" => '<',
                "gt" => '>',
                "quot" => '"',
                "apos" => '\'',
                "nbsp" => '\u{a0}',
                code => {
                    let number = code.strip_prefix('#')?;
                    let value = match number.strip_prefix(['x', 'X']) {
                        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                        None => number.parse().ok()?,
                    };
                    char::from_u32(value)?
                }
            };
            Some((char, end))
        });
        if let Some((char, end)) = decoded {
            out.push(char);
            rest = &entity[end + 1..];
        } else {
            out.push('&');
            rest = &entity[1..];
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cases shared with the browser mock's port (`ui/src/data/mock/descriptions.ts`), so both
    /// read Riot's markup the same way.
    #[derive(Deserialize)]
    struct Case {
        name: String,
        markup: String,
        lines: Vec<Vec<TextSpan>>,
    }

    #[test]
    fn reads_riot_markup_as_the_shared_cases_say() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../../fixtures/rich-text-cases.json"))
                .expect("valid cases");
        assert!(cases.len() >= 10);
        for case in cases {
            assert_eq!(rich_text(&case.markup), case.lines, "{}", case.name);
        }
    }

    #[test]
    fn never_lets_markup_through() {
        let lines = rich_text(
            "<script>alert(1)</script><img src=x onerror='y'><a href='javascript:z'>link</a>&lt;b&gt;",
        );
        assert_eq!(
            lines,
            [vec![TextSpan {
                text: "alert(1)link<b>".into(),
                tone: None
            }]],
            "tags dropped, their text kept as text"
        );
    }

    fn plain(text: &str) -> Vec<Vec<TextSpan>> {
        vec![vec![TextSpan {
            text: text.into(),
            tone: None,
        }]]
    }

    const ITEMS: &[u8] = br#"{"data":{
        "3031":{"name":"Infinity Edge","plaintext":"Crits","description":"<mainText><stats><attention>75</attention> Attack Damage</stats><br><br></mainText>"},
        "3349":{"plaintext":"Slows by @Slow@","description":"<mainText>Deals @TotalDamage@</mainText>"},
        "2003":{"plaintext":"Heals","description":"<mainText><stats></stats><br><br></mainText>"}}}"#;

    #[test]
    fn describes_items() {
        let edge = describe_item(ITEMS, 3031)
            .expect("valid")
            .expect("described");
        assert_eq!(edge.text[0][0].text, "75");
        assert_eq!(edge.text[0][0].tone, Some(TextTone::Strong));
        assert_eq!(edge.cooldown, None);
        assert_eq!(
            describe_item(ITEMS, 3349).expect("valid"),
            None,
            "values only the game knows: nothing rather than @Slow@"
        );
        assert_eq!(
            describe_item(ITEMS, 2003).expect("valid").map(|d| d.text),
            Some(plain("Heals")),
            "an empty description: the summary"
        );
        assert_eq!(describe_item(ITEMS, 1).expect("valid"), None);
        assert!(describe_item(b"<html>", 1).is_err());
    }

    #[test]
    fn describes_spells_with_their_cooldown() {
        let spells = br#"{"data":{
            "SummonerFlash":{"key":"4","description":"Teleports you.","cooldownBurn":"300"},
            "SummonerCherryFlash":{"key":"2202","description":"Once a round.","cooldownBurn":"0.25"},
            "SummonerSmite":{"key":"11","description":"","cooldownBurn":"15/12"}}}"#;
        let flash = describe_spell(spells, 4)
            .expect("valid")
            .expect("described");
        assert_eq!(
            (flash.cooldown, flash.text),
            (Some(300), plain("Teleports you."))
        );
        assert_eq!(
            describe_spell(spells, 2202)
                .expect("valid")
                .and_then(|d| d.cooldown),
            None,
            "under a second isn't a cooldown to show"
        );
        let smite = describe_spell(spells, 11)
            .expect("valid")
            .expect("described");
        assert_eq!((smite.cooldown, smite.text.len()), (Some(15), 0));
        assert_eq!(describe_spell(spells, 99).expect("valid"), None);
    }

    #[test]
    fn describes_runes_in_full_unless_the_game_fills_values_in() {
        let runes = br#"[{"id":8000,"slots":[{"runes":[
            {"id":8010,"shortDesc":"Short.","longDesc":"Long.<br>Cooldown: 20s"},
            {"id":8360,"shortDesc":"Swap spells.","longDesc":"Cooldown @f3@ seconds."}]}]}]"#;
        let conqueror = describe_rune(runes, 8010)
            .expect("valid")
            .expect("described");
        assert_eq!(conqueror.text.len(), 2);
        assert_eq!(
            describe_rune(runes, 8360).expect("valid").map(|d| d.text),
            Some(plain("Swap spells."))
        );
        assert_eq!(describe_rune(runes, 1).expect("valid"), None);
    }

    #[test]
    fn keeps_the_stat_shards_of_the_clients_perks() {
        let perks = br#"[
            {"id":8010,"name":"Conqueror","shortDesc":"x","longDesc":"y"},
            {"id":5008,"name":"Adaptive Force","shortDesc":"+9 <lol-uikit-tooltipped-keyword key='a'><font color='#48C4B7'>Adaptive Force</font></lol-uikit-tooltipped-keyword>","longDesc":"+9 <lol-uikit-tooltipped-keyword key='a'><font color='#48C4B7'>Adaptive Force</font></lol-uikit-tooltipped-keyword>"},
            {"id":5001,"name":"Health Scaling","shortDesc":"+10-180 Health (based on level)","longDesc":"+@f1@ Health"}]"#;
        let shards = shards_of(perks).expect("valid");
        assert_eq!(
            shards.iter().map(|s| s.id).collect::<Vec<_>>(),
            [5008, 5001],
            "runes left out"
        );
        assert_eq!(rich_text(&shards[0].text), plain("+9 Adaptive Force"));
        assert_eq!(shards[1].text, "+10-180 Health (based on level)");
        assert!(
            shards_of(b"[]").is_err(),
            "a file without shards is never kept"
        );
        assert!(shards_of(b"{}").is_err());
    }

    #[test]
    fn stresses_a_shards_leading_value() {
        let stressed = |text: &str| {
            let mut lines = plain(text);
            stress_value(&mut lines);
            lines[0]
                .iter()
                .map(|s| (s.text.clone(), s.tone.is_some()))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            stressed("+9 Adaptive Force"),
            [("+9".into(), true), (" Adaptive Force".into(), false)]
        );
        assert_eq!(stressed("+2.5% Move Speed")[0], ("+2.5%".into(), true));
        assert_eq!(
            stressed("+10 - 180 PV (selon le niveau)")[0],
            ("+10 - 180".into(), true),
            "a range, spaced as in French"
        );
        assert_eq!(stressed("+10-180 Health")[0], ("+10-180".into(), true));
        assert_eq!(
            stressed("Gain stacks."),
            [("Gain stacks.".into(), false)],
            "no value: as it was"
        );
        assert_eq!(
            stressed("+8")[0],
            ("+8".into(), false),
            "a value alone stays plain"
        );
        let mut none: Vec<Vec<TextSpan>> = Vec::new();
        stress_value(&mut none);
        assert!(none.is_empty());
    }

    #[test]
    fn spots_values_the_game_fills_in() {
        assert!(has_placeholder("Deals @TotalDamage@ damage"));
        assert!(has_placeholder("+@f1@ Health"));
        assert!(has_placeholder(
            "@spell.summonerrevive_jade:bonusmovespeed*100@"
        ));
        assert!(!has_placeholder("mail@example.com"));
        assert!(!has_placeholder("@ @"));
        assert!(!has_placeholder("@@"));
    }

    #[test]
    fn names_community_dragon_locales() {
        assert_eq!(community_locale("en_US"), "default");
        assert_eq!(community_locale("fr_FR"), "fr_fr");
    }
}
