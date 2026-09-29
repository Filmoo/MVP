//! Release builds carry the web UI (`web/dist`, made by `pnpm --filter @scout/roadmap build`)
//! inside the binary, so the server is one file. Debug builds read `web/dist` from disk on each
//! request instead (`web.rs`): a rebuilt UI shows without recompiling, and a checkout that never
//! built the UI still compiles.
#![allow(
    clippy::print_stdout,
    reason = "cargo reads a build script's directives from its stdout"
)]

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::{env, fs};

fn main() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap_or_default());
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap_or_default());
    let dist = manifest.join("web").join("dist");
    let release = env::var("PROFILE").is_ok_and(|p| p == "release");
    println!("cargo::rerun-if-changed=build.rs");

    let mut code =
        String::from("/// The web UI's files (path, bytes), embedded in release builds.\n");
    code.push_str("pub static ASSETS: &[(&str, &[u8])] = &[\n");
    if release {
        assert!(
            dist.join("index.html").is_file(),
            "{} has no index.html: build the web UI first (pnpm --filter @scout/roadmap build)",
            dist.display()
        );
        println!("cargo::rerun-if-changed={}", dist.display());
        let mut files = Vec::new();
        collect(&dist, &dist, &mut files);
        files.sort();
        for (name, path) in files {
            let _ = writeln!(
                code,
                "    ({name:?}, include_bytes!({:?})),",
                path.display().to_string()
            );
        }
    }
    code.push_str("];\n");
    let target = out.join("assets.rs");
    if fs::read_to_string(&target).ok().as_deref() != Some(code.as_str()) {
        fs::write(&target, code)
            .unwrap_or_else(|e| panic!("cannot write {}: {e}", target.display()));
    }
}

/// Every file under `dir`, as (path relative to `root` with `/`, absolute path).
fn collect(root: &Path, dir: &Path, files: &mut Vec<(String, PathBuf)>) {
    let entries =
        fs::read_dir(dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()));
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, files);
        } else if let Ok(relative) = path.strip_prefix(root) {
            let name = relative
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            files.push((name, path));
        }
    }
}
