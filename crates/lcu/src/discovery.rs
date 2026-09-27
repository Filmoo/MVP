//! Finding a running League client.
//!
//! The client writes `lockfile` into its install directory while it runs. The install
//! directory comes from the Riot Client's product settings (custom installs included), with
//! the default path as fallback. `SCOUT_LCU_LOCKFILE` points at another lockfile (the mock
//! client uses it in development).

use std::path::PathBuf;

use crate::{Credentials, Lockfile};

pub const LOCKFILE_ENV: &str = "SCOUT_LCU_LOCKFILE";

#[cfg(windows)]
const PRODUCT_SETTINGS: &str = r"C:\ProgramData\Riot Games\Metadata\league_of_legends.live\league_of_legends.live.product_settings.yaml";

/// Lockfile locations to try, most specific first.
pub fn candidate_lockfiles() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(path) = std::env::var_os(LOCKFILE_ENV) {
        paths.push(PathBuf::from(path));
    }
    #[cfg(windows)]
    {
        if let Some(dir) = std::fs::read_to_string(PRODUCT_SETTINGS)
            .ok()
            .as_deref()
            .and_then(parse_install_dir)
        {
            paths.push(dir.join("lockfile"));
        }
        paths.push(PathBuf::from(r"C:\Riot Games\League of Legends\lockfile"));
    }
    #[cfg(target_os = "macos")]
    paths.push(PathBuf::from(
        "/Applications/League of Legends.app/Contents/LoL/lockfile",
    ));
    paths
}

/// Reads the first lockfile that exists and parses.
pub fn find_credentials() -> Option<Credentials> {
    candidate_lockfiles()
        .iter()
        .filter_map(|path| std::fs::read_to_string(path).ok())
        .find_map(|content| Lockfile::parse(&content).ok())
        .map(|lockfile| lockfile.credentials())
}

/// Extracts `product_install_full_path` from the Riot Client's product settings YAML.
pub fn parse_install_dir(yaml: &str) -> Option<PathBuf> {
    yaml.lines()
        .find_map(|line| line.trim().strip_prefix("product_install_full_path:"))
        .map(|value| value.trim().trim_matches(|c| c == '"' || c == '\''))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_install_dir_from_product_settings() {
        let yaml = "product_install_full_path: \"D:/Games/Riot Games/League of Legends\"\nproduct_install_root: \"D:/Games\"\n";
        assert_eq!(
            parse_install_dir(yaml),
            Some(PathBuf::from("D:/Games/Riot Games/League of Legends"))
        );
        assert_eq!(
            parse_install_dir("other: 1\nproduct_install_full_path: ''"),
            None
        );
        assert_eq!(parse_install_dir(""), None);
    }
}
