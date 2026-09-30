//! League's position icons: the client's own lane art (`position-top.svg` …) as `CommunityDragon`
//! mirrors it ([`crate::client`]), downloaded once, cleaned and kept on disk like the ranked
//! emblems. The UI tints them; it draws its own icons while they aren't here.

use std::path::PathBuf;

use domain::Role;

use crate::StaticDataError;
use crate::client::ClientFiles;

/// Where the client keeps them.
const FOLDER: &str = "plugins/rcp-fe-lol-static-assets/global/default/svg";
/// Bump to fetch and clean again.
const CACHE_DIR: &str = "v1";
/// The client's icons weigh a few hundred bytes: anything much bigger isn't one of them.
const MAX_BYTES: usize = 16 * 1024;

pub const ROLES: [Role; 5] = [
    Role::Top,
    Role::Jungle,
    Role::Middle,
    Role::Bottom,
    Role::Support,
];

/// The client's file for a role (support is "utility" there).
pub const fn file_name(role: Role) -> &'static str {
    match role {
        Role::Top => "position-top.svg",
        Role::Jungle => "position-jungle.svg",
        Role::Middle => "position-middle.svg",
        Role::Bottom => "position-bottom.svg",
        Role::Support => "position-utility.svg",
    }
}

/// Downloads, cleans and caches the position icons.
#[derive(Debug, Clone)]
pub struct PositionIcons(ClientFiles);

impl PositionIcons {
    /// `cache` is a directory owned by this client (e.g. `<app cache>/positions`).
    pub fn new(
        base: impl Into<String>,
        cache: impl Into<PathBuf>,
    ) -> Result<Self, StaticDataError> {
        Ok(Self(ClientFiles::new(base, cache.into().join(CACHE_DIR))?))
    }

    /// Every role's icon (an SVG), from the cache or downloaded (then cached). Roles that can't be
    /// had now are left out: the UI draws its own icon for them, and the next start tries again.
    pub async fn load(&self) -> Vec<(Role, Vec<u8>)> {
        let mut out = Vec::new();
        for role in ROLES {
            match self.0.get(&[FOLDER], file_name(role), clean).await {
                Ok(svg) => out.push((role, svg)),
                Err(error) => tracing::info!(%error, ?role, "position icon unavailable"),
            }
        }
        out
    }
}

/// The drawing alone: the client's file also links a stylesheet (`glow.css`) the app never loads.
pub fn clean(file: &[u8]) -> Result<Vec<u8>, StaticDataError> {
    let text = std::str::from_utf8(file).unwrap_or_default();
    match (text.find("<svg"), text.rfind("</svg>")) {
        (Some(start), Some(end)) if file.len() <= MAX_BYTES && start < end => {
            Ok(file[start..end + "</svg>".len()].to_vec())
        }
        _ => Err(StaticDataError::Image("not a position icon".to_owned())),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    #[test]
    fn keeps_the_drawing_without_the_stylesheet() {
        let file = br#"<?xml-stylesheet type="text/css" href="./glow.css"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34"><path d="M4 4h26v26z"/></svg>
"#;
        let svg = String::from_utf8(clean(file).unwrap()).unwrap();
        assert!(svg.starts_with("<svg") && svg.ends_with("</svg>"));
        assert!(!svg.contains("glow.css"));
    }

    #[test]
    fn refuses_what_is_not_an_icon() {
        assert!(clean(b"<html>Not found</html>").is_err());
        assert!(clean(&[0xff, 0xfe, 0x00]).is_err());
        let big = format!("<svg>{}</svg>", " ".repeat(MAX_BYTES));
        assert!(clean(big.as_bytes()).is_err());
    }

    #[test]
    fn names_the_files_like_the_client() {
        assert_eq!(file_name(Role::Support), "position-utility.svg");
        let names: std::collections::HashSet<_> = ROLES.map(file_name).into();
        assert_eq!(names.len(), ROLES.len());
    }
}
