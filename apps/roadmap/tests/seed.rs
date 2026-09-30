//! The seed goes into an empty database only, so importing it again (a restart,
//! `mvp-roadmap seed`) never duplicates or overwrites anything; and the command line works on a
//! real database file.
#![allow(clippy::unwrap_used, reason = "tests")]

use std::process::Command;

use mvp_roadmap::model::{Actor, Proposer, Status};
use mvp_roadmap::seed::{self, SeedFile};
use mvp_roadmap::store::{NewVersion, SeedOutcome, Store};

const NOW: i64 = 1_790_683_200;

#[test]
fn the_seed_goes_into_an_empty_database_only() {
    let seed = SeedFile::parse(seed::DEFAULT).unwrap();
    let mut store = Store::open_in_memory().unwrap();
    let first = store.import_seed(&seed, NOW).unwrap();
    assert_eq!(
        first,
        SeedOutcome::Imported {
            areas: seed.areas.len(),
            versions: 4,
            features: seed.features.len()
        }
    );
    let before = store.roadmap().unwrap();
    assert_eq!(
        store.import_seed(&seed, NOW + 60).unwrap(),
        SeedOutcome::NotEmpty
    );
    assert_eq!(
        store.roadmap().unwrap(),
        before,
        "a second import changes nothing"
    );

    // Versions in order, the released one dated; every feature placed, in order, once.
    let names: Vec<&str> = before.versions.iter().map(|v| v.name.as_str()).collect();
    assert_eq!(names, ["0.2", "0.3", "0.4", "Later"]);
    assert!(before.versions[0].released_on.is_some());
    for version in &before.versions {
        let positions: Vec<i64> = before
            .features
            .iter()
            .filter(|f| f.version_id == version.id)
            .map(|f| f.position)
            .collect();
        assert_eq!(
            positions,
            (0..i64::try_from(positions.len()).unwrap()).collect::<Vec<_>>(),
            "{}",
            version.name
        );
    }
    // 0.2 is released: all done. What waits for the owner is Claude's.
    let v02 = before.versions[0].id;
    assert!(
        before
            .features
            .iter()
            .filter(|f| f.version_id == v02)
            .all(|f| f.status == Status::Done)
    );
    assert!(
        before
            .features
            .iter()
            .filter(|f| f.status == Status::Proposed)
            .all(|f| f.proposed_by == Proposer::Claude)
    );
    assert!(
        before
            .features
            .iter()
            .any(|f| f.status == Status::InProgress)
    );
    assert!(
        before.features.iter().all(|f| !f.links.is_empty()),
        "every feature names its source"
    );

    // Any roadmap at all counts: a database with a single version isn't seeded.
    let mut other = Store::open_in_memory().unwrap();
    other
        .create_version(
            &NewVersion {
                name: "1.0".into(),
                ..NewVersion::default()
            },
            &Actor::system("test"),
            NOW,
        )
        .unwrap();
    assert_eq!(
        other.import_seed(&seed, NOW).unwrap(),
        SeedOutcome::NotEmpty
    );
    assert_eq!(other.roadmap().unwrap().features.len(), 0);
}

#[test]
fn a_database_file_keeps_everything_across_opens() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("roadmap.db");
    let seed = SeedFile::parse(seed::DEFAULT).unwrap();
    {
        let mut store = Store::open(&path).unwrap();
        store.import_seed(&seed, NOW).unwrap();
    }
    let mut store = Store::open(&path).unwrap();
    assert_eq!(
        store.import_seed(&seed, NOW).unwrap(),
        SeedOutcome::NotEmpty
    );
    assert_eq!(store.roadmap().unwrap().features.len(), seed.features.len());
    // A backup is a whole database of its own.
    let copy = dir.path().join("copy.db");
    store.backup(&copy).unwrap();
    assert!(store.backup(&copy).is_err(), "never over an existing file");
    let restored = Store::open(&copy).unwrap();
    assert_eq!(restored.roadmap().unwrap(), store.roadmap().unwrap());
}

fn run(args: &[&str], db: &std::path::Path) -> (bool, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_mvp-roadmap"))
        .args(args)
        .arg("--db")
        .arg(db)
        .env("RUST_LOG", "error")
        .output()
        .unwrap();
    (
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

#[test]
fn the_command_line_seeds_once_and_makes_tokens() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("cli.db");
    let (ok, out, _) = run(&["seed"], &db);
    assert!(ok && out.starts_with("imported 4 versions"), "{out}");
    let (ok, out, _) = run(&["seed"], &db);
    assert!(ok && out.contains("nothing imported"), "{out}");

    let (ok, out, err) = run(&["token", "create", "--name", "claude"], &db);
    assert!(ok, "{err}");
    let token = out.lines().nth(1).unwrap().trim().to_owned();
    assert!(token.starts_with("mvpr_") && token.len() == 48, "{out}");
    let (ok, _, err) = run(&["token", "create", "--name", "claude"], &db);
    assert!(!ok && err.contains("revoke it first"), "{err}");

    // Stored as a hash: the token itself is nowhere in the file.
    let bytes = std::fs::read(&db).unwrap();
    assert!(!bytes.windows(token.len()).any(|w| w == token.as_bytes()));
    let store = Store::open(&db).unwrap();
    assert!(
        store
            .token(&mvp_roadmap::crypto::sha256(token.as_bytes()))
            .unwrap()
            .is_some()
    );
    drop(store);

    let (_, out, _) = run(&["token", "list"], &db);
    assert!(
        out.contains("claude") && out.contains("never used"),
        "{out}"
    );
    let (ok, out, _) = run(&["token", "revoke", "--name", "claude"], &db);
    assert!(ok && out.contains("revoked"), "{out}");
    let (ok, _, _) = run(&["token", "revoke", "--name", "claude"], &db);
    assert!(!ok);

    let backup = dir.path().join("backup.db");
    let (ok, out, err) = run(&["backup", "--out", backup.to_str().unwrap()], &db);
    assert!(ok && backup.exists(), "{out}{err}");

    // Into a folder, the newest two kept (what the nightly timer runs).
    let folder = dir.path().join("backups");
    let folder_arg = format!("{}/", folder.display());
    for _ in 0..3 {
        let (ok, out, err) = run(&["backup", "--out", &folder_arg, "--keep", "2"], &db);
        assert!(ok, "{out}{err}");
    }
    let mut kept: Vec<String> = std::fs::read_dir(&folder)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    kept.sort();
    assert_eq!(kept.len(), 2, "{kept:?}");
    assert!(kept.iter().all(|n| {
        n.starts_with("roadmap-")
            && std::path::Path::new(n)
                .extension()
                .is_some_and(|e| e == "db")
    }));
}

#[test]
fn serve_refuses_dev_login_off_the_loopback() {
    let dir = tempfile::tempdir().unwrap();
    let (ok, _, err) = run(
        &["serve", "--dev-login", "--bind", "0.0.0.0:0"],
        &dir.path().join("x.db"),
    );
    assert!(!ok && err.contains("loopback"), "{err}");
    let (ok, _, err) = run(&["serve"], &dir.path().join("y.db"));
    assert!(!ok && err.contains("ROADMAP_PUBLIC_URL"), "{err}");
}
