//! MVP's item set for a champion, shown in the in-game shop. The item sets document is read,
//! MVP's own set for the champion (named "MVP…", for this champion only) is replaced, and the
//! document goes back with every other set and field exactly as read.

use domain::{BuildStats, FailReason, ImportOutcome, Language};
use lcu::{LcuClient, LcuError};
use reqwest::Method;
use serde_json::{Value, json};

use super::{ARAM, client_failure, is_mvp_name, now_ms};
use crate::profile::CURRENT_SUMMONER;

/// `/lol-item-sets/v1/item-sets/{summonerId}/sets`: `GET` the document, `PUT` it back whole.
pub fn sets_path(summoner_id: u64) -> String {
    format!("/lol-item-sets/v1/item-sets/{summoner_id}/sets")
}

/// Summoner's Rift and Howling Abyss map ids.
const SUMMONERS_RIFT: u32 = 11;
const HOWLING_ABYSS: u32 = 12;
/// Situational items listed at most.
const SITUATIONAL_MAX: usize = 6;

/// The blocks' titles in the UI's language (players read them in the client's shop): starting
/// items, core build, boots, situational.
const fn block_titles(language: Language) -> [&'static str; 4] {
    match language {
        Language::Fr => [
            "Objets de départ",
            "Build principal (dans l’ordre)",
            "Bottes",
            "Objets situationnels",
        ],
        Language::Auto | Language::En => [
            "Starting items",
            "Core build (in order)",
            "Boots",
            "Situational",
        ],
    }
}

/// One block of the set: a title and items with counts, in shop order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemBlock {
    pub title: &'static str,
    pub items: Vec<(u32, u32)>,
}

fn most_played(section: &domain::BuildSection) -> &[u32] {
    section
        .top
        .first()
        .map_or(&[], |option| option.ids.as_slice())
}

/// Starting items (with counts), the core in completion order, boots, then the 4th–6th items
/// players pick most, as shop blocks titled in `language`. Empty when the build has no item data.
pub fn item_blocks(build: &BuildStats, language: Language) -> Vec<ItemBlock> {
    let mut starts: Vec<(u32, u32)> = Vec::new();
    for &id in most_played(&build.starts) {
        match starts.iter_mut().find(|(item, _)| *item == id) {
            Some((_, count)) => *count += 1,
            None => starts.push((id, 1)),
        }
    }
    let core: Vec<(u32, u32)> = most_played(&build.core).iter().map(|&id| (id, 1)).collect();
    let boots: Vec<(u32, u32)> = most_played(&build.boots)
        .iter()
        .map(|&id| (id, 1))
        .collect();
    // Every option of the 4th, 5th and 6th item, most games first, without what's above.
    let mut options: Vec<(u32, u32)> = [&build.item4, &build.item5, &build.item6]
        .iter()
        .flat_map(|section| section.top.iter())
        .flat_map(|option| option.ids.iter().map(|&id| (id, option.g)))
        .collect();
    options.sort_by(|a, b| b.1.cmp(&a.1));
    let mut situational: Vec<(u32, u32)> = Vec::new();
    for (id, _) in options {
        let listed = |list: &[(u32, u32)]| list.iter().any(|(item, _)| *item == id);
        if !listed(&core) && !listed(&boots) && !listed(&situational) {
            situational.push((id, 1));
        }
        if situational.len() == SITUATIONAL_MAX {
            break;
        }
    }
    let [starting, core_build, boots_title, situational_title] = block_titles(language);
    [
        (starting, starts),
        (core_build, core),
        (boots_title, boots),
        (situational_title, situational),
    ]
    .into_iter()
    .filter(|(_, items)| items.iter().any(|&(id, _)| id != 0))
    .map(|(title, items)| ItemBlock {
        title,
        items: items.into_iter().filter(|&(id, _)| id != 0).collect(),
    })
    .collect()
}

/// The set as the client stores it (item ids are strings there).
pub fn item_set(
    uid: &str,
    title: &str,
    champion_id: u32,
    queue: u32,
    blocks: &[ItemBlock],
) -> Value {
    let map = if queue == ARAM {
        HOWLING_ABYSS
    } else {
        SUMMONERS_RIFT
    };
    let blocks: Vec<Value> = blocks
        .iter()
        .map(|block| {
            json!({
                "type": block.title,
                "items": block.items.iter().map(|(id, count)| json!({ "id": id.to_string(), "count": count })).collect::<Vec<_>>(),
                "hideIfSummonerSpell": "",
                "showIfSummonerSpell": ""
            })
        })
        .collect();
    json!({
        "uid": uid,
        "title": title,
        "type": "custom",
        "map": "any",
        "mode": "any",
        "sortrank": 0,
        "startedFrom": "blank",
        "associatedChampions": [champion_id],
        "associatedMaps": [map],
        "preferredItemSlots": [],
        "blocks": blocks
    })
}

/// MVP's set for `champion_id`: named "MVP…" and tied to this champion only.
fn is_ours(set: &Value, champion_id: u32) -> bool {
    set.get("title")
        .and_then(Value::as_str)
        .is_some_and(is_mvp_name)
        && set
            .get("associatedChampions")
            .and_then(Value::as_array)
            .is_some_and(|champions| {
                champions.len() == 1
                    && champions.first().and_then(Value::as_u64) == Some(u64::from(champion_id))
            })
}

/// A uid no other set uses, recognizable as MVP's (`6d7670` is "mvp" in hex).
fn unique_uid(sets: &[Value], champion_id: u32) -> String {
    let taken = |uid: &str| {
        sets.iter()
            .any(|s| s.get("uid").and_then(Value::as_str) == Some(uid))
    };
    (0..=u16::MAX)
        .map(|n| format!("6d7670a0-{n:04x}-4000-8000-{champion_id:012x}"))
        .find(|uid| !taken(uid))
        .unwrap_or_else(|| format!("6d7670a0-ffff-4000-8000-{:012x}", now_ms()))
}

/// Replaces MVP's set for `champion_id` in `document` (the `GET` answer) with a set made of
/// `blocks`, keeping every other set and field as read.
pub fn merge_item_set(
    document: &mut Value,
    champion_id: u32,
    queue: u32,
    title: &str,
    blocks: &[ItemBlock],
) {
    if !document.is_object() {
        *document = json!({});
    }
    let Some(fields) = document.as_object_mut() else {
        return;
    };
    let sets = fields.entry("itemSets").or_insert_with(|| json!([]));
    if !sets.is_array() {
        *sets = json!([]);
    }
    let Some(sets) = sets.as_array_mut() else {
        return;
    };
    sets.retain(|set| !is_ours(set, champion_id));
    let uid = unique_uid(sets, champion_id);
    sets.push(item_set(&uid, title, champion_id, queue, blocks));
    fields.insert("timestamp".into(), json!(now_ms()));
}

#[derive(Debug)]
enum Error {
    NoSummoner,
    Client(LcuError),
}

impl From<LcuError> for Error {
    fn from(error: LcuError) -> Self {
        Self::Client(error)
    }
}

async fn write(
    client: &LcuClient,
    champion_id: u32,
    queue: u32,
    title: &str,
    blocks: &[ItemBlock],
) -> Result<(), Error> {
    let summoner: Value = client.get(CURRENT_SUMMONER).await?;
    let summoner_id = summoner
        .get("summonerId")
        .and_then(Value::as_u64)
        .ok_or(Error::NoSummoner)?;
    let path = sets_path(summoner_id);
    let mut document = match client.get::<Value>(&path).await {
        Ok(document) => document,
        // No sets yet.
        Err(error) if error.is_not_found() => json!({
            "accountId": summoner.get("accountId").cloned().unwrap_or(Value::Null),
            "itemSets": [],
            "timestamp": 0
        }),
        Err(error) => return Err(error.into()),
    };
    merge_item_set(&mut document, champion_id, queue, title, blocks);
    client.request(Method::PUT, &path, Some(&document)).await?;
    Ok(())
}

/// Imports the build's items as MVP's set for the champion, named `title`, its blocks titled in
/// `language`.
pub(super) async fn import(
    client: &LcuClient,
    build: &BuildStats,
    champion_id: u32,
    title: &str,
    queue: u32,
    language: Language,
) -> ImportOutcome {
    let blocks = item_blocks(build, language);
    if blocks.is_empty() {
        return ImportOutcome::Failed {
            reason: FailReason::NoData,
        };
    }
    match write(client, champion_id, queue, title, &blocks).await {
        Ok(()) => {
            tracing::info!(title, "item set imported");
            ImportOutcome::Saved {
                name: title.to_owned(),
            }
        }
        Err(Error::NoSummoner) => ImportOutcome::Failed {
            reason: FailReason::Client {
                message: "the client didn't say who is logged in".to_owned(),
            },
        },
        Err(Error::Client(error)) => client_failure(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{BuildOption, BuildSection};

    fn section(options: &[(&[u32], u32)]) -> BuildSection {
        BuildSection {
            n: 100,
            top: options
                .iter()
                .map(|(ids, g)| BuildOption {
                    ids: ids.to_vec(),
                    g: *g,
                    w: g / 2,
                })
                .collect(),
        }
    }

    fn ahri() -> BuildStats {
        BuildStats {
            role: Some(domain::Role::Middle),
            g: 100,
            w: 52,
            runes: BuildSection::default(),
            keystones: BuildSection::default(),
            spells: BuildSection::default(),
            skills: BuildSection::default(),
            skill_start: BuildSection::default(),
            starts: section(&[(&[1056, 2003, 2003], 70), (&[1082, 2003], 20)]),
            core: section(&[(&[6655, 3020, 4645], 40)]),
            boots: section(&[(&[3020], 80)]),
            item4: section(&[(&[3089], 30), (&[4645], 12)]),
            item5: section(&[(&[3157], 25), (&[3089], 10)]),
            item6: section(&[(&[3135], 15), (&[3102], 9)]),
        }
    }

    #[test]
    fn blocks_follow_the_build() {
        let blocks = item_blocks(&ahri(), Language::En);
        let titles: Vec<&str> = blocks.iter().map(|b| b.title).collect();
        assert_eq!(
            titles,
            [
                "Starting items",
                "Core build (in order)",
                "Boots",
                "Situational"
            ]
        );
        assert_eq!(blocks[0].items, vec![(1056, 1), (2003, 2)]);
        assert_eq!(blocks[1].items, vec![(6655, 1), (3020, 1), (4645, 1)]);
        assert_eq!(blocks[2].items, vec![(3020, 1)]);
        // Most games first, nothing from the core or boots again.
        assert_eq!(
            blocks[3].items,
            vec![(3089, 1), (3157, 1), (3135, 1), (3102, 1)]
        );
    }

    #[test]
    fn blocks_are_titled_in_the_ui_language() {
        let french = item_blocks(&ahri(), Language::Fr);
        let titles: Vec<&str> = french.iter().map(|b| b.title).collect();
        assert_eq!(
            titles,
            [
                "Objets de départ",
                "Build principal (dans l’ordre)",
                "Bottes",
                "Objets situationnels"
            ]
        );
        // Same items, whatever the language.
        let english = item_blocks(&ahri(), Language::En);
        assert!(french.iter().zip(&english).all(|(f, e)| f.items == e.items));
        // Unresolved (the UI hasn't said yet): English.
        assert_eq!(item_blocks(&ahri(), Language::Auto), english);
    }

    #[test]
    fn no_items_no_blocks() {
        let mut build = ahri();
        for section in [
            &mut build.starts,
            &mut build.core,
            &mut build.boots,
            &mut build.item4,
            &mut build.item5,
            &mut build.item6,
        ] {
            *section = BuildSection::default();
        }
        assert!(item_blocks(&build, Language::En).is_empty());
    }

    #[test]
    fn replaces_only_our_set_and_keeps_the_rest_as_read() {
        let theirs = json!({ "uid": "p-1", "title": "My Ahri", "associatedChampions": [103], "associatedMaps": [11], "blocks": [], "customField": { "kept": true } });
        let other_mvp = json!({ "uid": "m-2", "title": "MVP · Lux Mid", "associatedChampions": [99], "blocks": [] });
        let multi = json!({ "uid": "p-3", "title": "MVP picks", "associatedChampions": [103, 99], "blocks": [] });
        let ours = json!({ "uid": "m-1", "title": "MVP · Ahri Mid", "associatedChampions": [103], "blocks": [] });
        let mut document = json!({ "accountId": 42, "itemSets": [theirs.clone(), ours, other_mvp.clone(), multi.clone()], "timestamp": 1, "unknown": [1, 2] });

        merge_item_set(
            &mut document,
            103,
            420,
            "MVP · Ahri Support",
            &item_blocks(&ahri(), Language::En),
        );
        let sets = document["itemSets"].as_array().expect("sets");
        assert_eq!(sets.len(), 4);
        assert_eq!(sets[0], theirs);
        assert_eq!(sets[1], other_mvp);
        assert_eq!(
            sets[2], multi,
            "a set for several champions is the player's"
        );
        assert_eq!(sets[3]["title"], "MVP · Ahri Support");
        assert_eq!(sets[3]["associatedChampions"], json!([103]));
        assert_eq!(sets[3]["associatedMaps"], json!([11]));
        assert_eq!(
            sets[3]["blocks"][0]["items"][1],
            json!({ "id": "2003", "count": 2 })
        );
        assert_eq!(document["accountId"], 42);
        assert_eq!(document["unknown"], json!([1, 2]));
    }

    #[test]
    fn uids_never_collide() {
        let first = format!("6d7670a0-0000-4000-8000-{:012x}", 103);
        let sets = vec![json!({ "uid": first, "title": "Renamed by the player" })];
        let uid = unique_uid(&sets, 103);
        assert_ne!(uid, first);
        assert!(uid.starts_with("6d7670a0-0001-"));
    }

    #[test]
    fn aram_sets_go_to_howling_abyss() {
        let set = item_set(
            "u",
            "MVP · Ahri ARAM",
            103,
            ARAM,
            &item_blocks(&ahri(), Language::En),
        );
        assert_eq!(set["associatedMaps"], json!([12]));
    }
}
