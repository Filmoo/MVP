//! The seed: the roadmap as the docs described it when this service was written
//! (`apps/roadmap/seed/roadmap.json`, committed). It is imported only into an empty database,
//! so importing again (a restart, `mvp-roadmap seed`) never duplicates or overwrites anything.

use std::collections::HashSet;

use serde::Deserialize;

use crate::model::{AREA_COLORS, Proposer, Status};
use crate::validate;

/// The committed seed, built into the binary.
pub const DEFAULT: &str = include_str!("../seed/roadmap.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedFile {
    /// Free text for people reading the file (where it came from).
    #[serde(default, rename = "$comment")]
    pub comment: String,
    pub areas: Vec<SeedArea>,
    pub versions: Vec<SeedVersion>,
    pub features: Vec<SeedFeature>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedArea {
    pub key: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedVersion {
    pub name: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub released_on: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedFeature {
    /// Stable id within the seed (kept in the database as `seed_key`).
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// A version's name.
    pub version: String,
    pub status: Status,
    /// An area's key.
    pub area: String,
    pub proposed_by: Proposer,
    #[serde(default)]
    pub links: Vec<SeedLink>,
    /// `YYYY-MM-DD`: when it was written down (default: the import).
    #[serde(default)]
    pub created_on: Option<String>,
    /// `YYYY-MM-DD`: when it was done (done features only; default: the import).
    #[serde(default)]
    pub done_on: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeedLink {
    pub url: String,
    #[serde(default)]
    pub label: String,
}

impl SeedFile {
    /// Parses and checks a seed: unknown keys, duplicate keys or names, features pointing at
    /// versions or areas that don't exist, bad links and dates are all errors.
    pub fn parse(text: &str) -> Result<Self, String> {
        let seed: Self = serde_json::from_str(text).map_err(|e| format!("seed: {e}"))?;
        seed.check()?;
        Ok(seed)
    }

    fn check(&self) -> Result<(), String> {
        let mut areas = HashSet::new();
        for area in &self.areas {
            validate::area_key(&area.key).map_err(|e| format!("area {:?}: {e}", area.key))?;
            validate::name(&area.name, 40).map_err(|e| format!("area {:?}: {e}", area.key))?;
            if !AREA_COLORS.contains(&area.color.as_str()) {
                return Err(format!(
                    "area {:?}: unknown colour {:?}",
                    area.key, area.color
                ));
            }
            if !areas.insert(area.key.as_str()) {
                return Err(format!("area {:?} twice", area.key));
            }
        }
        let mut versions = HashSet::new();
        for version in &self.versions {
            validate::name(&version.name, 40)
                .map_err(|e| format!("version {:?}: {e}", version.name))?;
            validate::text(&version.goal, 500)
                .map_err(|e| format!("version {:?}: {e}", version.name))?;
            for date in [&version.target_date, &version.released_on]
                .into_iter()
                .flatten()
            {
                validate::date(date).map_err(|e| format!("version {:?}: {e}", version.name))?;
            }
            if !versions.insert(version.name.as_str()) {
                return Err(format!("version {:?} twice", version.name));
            }
        }
        let mut keys = HashSet::new();
        for feature in &self.features {
            let at = |e: String| format!("feature {:?}: {e}", feature.key);
            if feature.key.trim().is_empty() || !keys.insert(feature.key.as_str()) {
                return Err(at("empty or repeated key".into()));
            }
            validate::title(&feature.title).map_err(at)?;
            validate::text(&feature.description, validate::DESCRIPTION_MAX).map_err(at)?;
            if !versions.contains(feature.version.as_str()) {
                return Err(at(format!("no version {:?}", feature.version)));
            }
            if !areas.contains(feature.area.as_str()) {
                return Err(at(format!("no area {:?}", feature.area)));
            }
            for link in &feature.links {
                validate::url(&link.url).map_err(at)?;
                validate::text(&link.label, 200).map_err(at)?;
            }
            for date in [&feature.created_on, &feature.done_on]
                .into_iter()
                .flatten()
            {
                validate::date(date).map_err(at)?;
            }
            if feature.done_on.is_some() && feature.status != Status::Done {
                return Err(at("doneOn on a feature that isn't done".into()));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_committed_seed_is_valid() {
        let seed = SeedFile::parse(DEFAULT);
        assert!(seed.is_ok(), "{:?}", seed.err());
        let seed = seed.unwrap_or_else(|_| unreachable!());
        let names: Vec<&str> = seed.versions.iter().map(|v| v.name.as_str()).collect();
        assert_eq!(names, ["0.2", "0.3", "0.4", "Later"]);
        assert!(
            seed.features.len() >= 40,
            "{} features",
            seed.features.len()
        );
        // Every feature says where it comes from (a doc, a commit or a pull request).
        for feature in &seed.features {
            assert!(!feature.links.is_empty(), "{} has no source", feature.key);
            assert!(
                !feature.description.trim().is_empty(),
                "{} has no description",
                feature.key
            );
        }
        // Claude's new suggestions wait for the owner in the inbox; the owner's own items are
        // decided (Claude's older ideas the owner took are accepted or done).
        let waiting = seed
            .features
            .iter()
            .filter(|f| f.status == Status::Proposed)
            .inspect(|f| assert_eq!(f.proposed_by, Proposer::Claude, "{}", f.key))
            .count();
        assert!(waiting >= 5, "{waiting} proposals");
    }

    #[test]
    fn mistakes_are_named() {
        let bad = r#"{"areas":[],"versions":[{"name":"0.1"}],"features":[{"key":"a","title":"A","version":"0.9","status":"done","area":"x","proposedBy":"owner"}]}"#;
        let error = SeedFile::parse(bad).err().unwrap_or_default();
        assert!(error.contains("no version \"0.9\""), "{error}");

        let unknown = r#"{"areas":[],"versions":[],"features":[],"extra":1}"#;
        assert!(SeedFile::parse(unknown).is_err());

        let link = r#"{"areas":[{"key":"x","name":"X","color":"accent"}],"versions":[{"name":"0.1"}],"features":[{"key":"a","title":"A","version":"0.1","status":"done","area":"x","proposedBy":"owner","links":[{"url":"javascript:alert(1)"}]}]}"#;
        assert!(SeedFile::parse(link).is_err());
    }
}
