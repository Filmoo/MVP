//! MVP's rune page. MVP reuses the page named "MVP…" (the player can hand one of theirs over by
//! renaming it), or creates one when the account has room, then makes it current. The player's
//! pages are never modified, and nothing is ever deleted.

use domain::{BuildStats, FailReason, ImportOutcome};
use lcu::{LcuClient, LcuError};
use reqwest::{Method, StatusCode};
use serde_json::{Map, Value, json};

use super::{client_failure, is_mvp_name};

/// Every rune page (`GET`), and where new ones are created (`POST`); `PUT {PAGES}/{id}` replaces
/// one (only ever MVP's).
pub const PAGES: &str = "/lol-perks/v1/pages";
/// Page limit: `ownedPageCount`, `canAddCustomPage`.
pub const INVENTORY: &str = "/lol-perks/v1/inventory";
/// `PUT` a page id to make it the current page.
pub const CURRENT_PAGE: &str = "/lol-perks/v1/currentpage";

/// A rune page from a build's most played runes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunePage {
    pub primary_style: u32,
    pub sub_style: u32,
    /// 4 primary perks, 2 secondary perks, 3 shards (offense, flex, defense).
    pub perks: [u32; 9],
}

impl RunePage {
    /// From `runes.top[0].ids` = `[primaryStyle, subStyle, 4 + 2 perks, 3 shards]`; `None` when
    /// incomplete.
    pub fn from_build(build: &BuildStats) -> Option<Self> {
        let ids = &build.runes.top.first()?.ids;
        let [primary_style, sub_style, perks @ ..] = ids.as_slice() else {
            return None;
        };
        let perks: [u32; 9] = perks.try_into().ok()?;
        let complete = *primary_style != 0
            && *sub_style != 0
            && primary_style != sub_style
            && perks.iter().all(|&p| p != 0);
        complete.then_some(Self {
            primary_style: *primary_style,
            sub_style: *sub_style,
            perks,
        })
    }

    /// Writes this page's runes and `name` into `page` (an object), keeping its other fields.
    fn fill(&self, page: &mut Map<String, Value>, name: &str) {
        page.insert("name".into(), json!(name));
        page.insert("primaryStyleId".into(), json!(self.primary_style));
        page.insert("subStyleId".into(), json!(self.sub_style));
        page.insert("selectedPerkIds".into(), json!(self.perks));
        page.insert("current".into(), json!(true));
    }
}

fn flag(page: &Value, key: &str) -> Option<bool> {
    page.get(key).and_then(Value::as_bool)
}

/// A page the player can edit (not one of the client's presets).
fn editable(page: &Value) -> bool {
    flag(page, "isEditable") != Some(false) && flag(page, "isDeletable") != Some(false)
}

/// MVP's page: named "MVP…", and editable.
fn is_ours(page: &Value) -> bool {
    page.get("name")
        .and_then(Value::as_str)
        .is_some_and(is_mvp_name)
        && editable(page)
}

fn id_of(page: &Value) -> Option<u64> {
    page.get("id").and_then(Value::as_u64)
}

#[derive(Debug)]
enum Error {
    NoFreePage,
    Client(LcuError),
}

impl From<LcuError> for Error {
    fn from(error: LcuError) -> Self {
        Self::Client(error)
    }
}

/// Whether one more custom page fits. Unknown (no inventory): let the client decide.
async fn has_room(client: &LcuClient, pages: &[Value]) -> bool {
    let Ok(inventory) = client.get::<Value>(INVENTORY).await else {
        return true;
    };
    if let Some(can) = flag(&inventory, "canAddCustomPage") {
        return can;
    }
    let custom = pages
        .iter()
        .filter(|p| flag(p, "isDeletable") == Some(true))
        .count();
    inventory
        .get("ownedPageCount")
        .and_then(Value::as_u64)
        .is_none_or(|owned| (custom as u64) < owned)
}

/// The client refused a new page because the account is full.
fn is_page_limit(error: &LcuError) -> bool {
    matches!(error, LcuError::Http { status, message, .. }
        if *status == StatusCode::BAD_REQUEST && message.to_ascii_lowercase().contains("max"))
}

/// Replaces MVP's page, or creates it; then makes it current.
async fn write(client: &LcuClient, page: &RunePage, name: &str) -> Result<(), Error> {
    let pages: Vec<Value> = client.get(PAGES).await?;
    let ours = pages
        .iter()
        .find(|p| is_ours(p))
        .and_then(|p| Some((id_of(p)?, p)));
    let id = if let Some((id, existing)) = ours {
        let mut body = existing.as_object().cloned().unwrap_or_default();
        page.fill(&mut body, name);
        client
            .request(
                Method::PUT,
                &format!("{PAGES}/{id}"),
                Some(&Value::Object(body)),
            )
            .await?;
        id
    } else {
        if !has_room(client, &pages).await {
            return Err(Error::NoFreePage);
        }
        let mut body = Map::new();
        page.fill(&mut body, name);
        let created = match client.post(PAGES, Some(&Value::Object(body))).await {
            Ok(created) => created,
            Err(error) if is_page_limit(&error) => return Err(Error::NoFreePage),
            Err(error) => return Err(error.into()),
        };
        match id_of(&created) {
            Some(id) => id,
            // Some client versions answer without the page: find it by its name.
            None => client
                .get::<Vec<Value>>(PAGES)
                .await?
                .iter()
                .find(|p| is_ours(p))
                .and_then(id_of)
                .ok_or(Error::NoFreePage)?,
        }
    };
    client
        .request(Method::PUT, CURRENT_PAGE, Some(&json!(id)))
        .await?;
    Ok(())
}

/// Imports the build's runes as MVP's page named `name`.
pub(super) async fn import(client: &LcuClient, build: &BuildStats, name: &str) -> ImportOutcome {
    let Some(page) = RunePage::from_build(build) else {
        return ImportOutcome::Failed {
            reason: FailReason::NoData,
        };
    };
    match write(client, &page, name).await {
        Ok(()) => {
            tracing::info!(name, "rune page imported");
            ImportOutcome::Saved {
                name: name.to_owned(),
            }
        }
        Err(Error::NoFreePage) => ImportOutcome::Failed {
            reason: FailReason::NoFreePage,
        },
        Err(Error::Client(error)) => client_failure(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{BuildOption, BuildSection};

    fn build_with_runes(ids: Vec<u32>) -> BuildStats {
        let section = |ids: Vec<u32>| BuildSection {
            n: 10,
            top: vec![BuildOption { ids, g: 10, w: 6 }],
        };
        BuildStats {
            role: None,
            g: 10,
            w: 6,
            runes: section(ids),
            keystones: BuildSection::default(),
            spells: BuildSection::default(),
            skills: BuildSection::default(),
            skill_start: BuildSection::default(),
            starts: BuildSection::default(),
            core: BuildSection::default(),
            boots: BuildSection::default(),
            item4: BuildSection::default(),
            item5: BuildSection::default(),
            item6: BuildSection::default(),
        }
    }

    #[test]
    fn reads_a_page_from_the_build() {
        let ids = vec![
            8100, 8300, 8112, 8139, 8138, 8135, 8345, 8347, 5008, 5008, 5001,
        ];
        let page = RunePage::from_build(&build_with_runes(ids)).expect("complete");
        assert_eq!((page.primary_style, page.sub_style), (8100, 8300));
        assert_eq!(
            page.perks,
            [8112, 8139, 8138, 8135, 8345, 8347, 5008, 5008, 5001]
        );
    }

    #[test]
    fn incomplete_pages_are_refused() {
        assert!(RunePage::from_build(&build_with_runes(vec![8100, 8300, 8112])).is_none());
        let same_styles = vec![
            8100, 8100, 8112, 8139, 8138, 8135, 8345, 8347, 5008, 5008, 5001,
        ];
        assert!(RunePage::from_build(&build_with_runes(same_styles)).is_none());
        assert!(RunePage::from_build(&build_with_runes(Vec::new())).is_none());
    }

    #[test]
    fn only_mvp_pages_are_ours() {
        let page = |name: &str, deletable: bool| json!({ "id": 1, "name": name, "isDeletable": deletable, "isEditable": deletable });
        assert!(is_ours(&page("MVP · Ahri Mid", true)));
        assert!(is_ours(&page("mvp", true)));
        assert!(!is_ours(&page("My Ahri page", true)));
        // A preset can't be MVP's, whatever its name.
        assert!(!is_ours(&page("MVP", false)));
    }
}
