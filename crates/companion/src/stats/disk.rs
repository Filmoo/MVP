//! The on-disk copy of the published stats files: `{root}/v1/{key}` (the server's layout under
//! `/v1/stats/`), each with its `ETag` next to it in `{key}.etag`. Writes are atomic (temp file +
//! rename) and never fail the caller: a copy that can't be saved is only logged.

use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

use super::valid_patch;

#[derive(Debug, Clone)]
pub(crate) struct Disk {
    /// `{app cache}/stats`.
    root: PathBuf,
}

/// `name.ext` → `name.ext{suffix}` next to it.
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

async fn remove_file(path: &Path) -> io::Result<()> {
    match tokio::fs::remove_file(path).await {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

async fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let part = sibling(path, ".part");
    tokio::fs::write(&part, bytes).await?;
    tokio::fs::rename(&part, path).await
}

fn etag_of(bytes: Option<Vec<u8>>) -> Option<String> {
    let text = String::from_utf8(bytes?).ok()?;
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

impl Disk {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    /// `key` (`index.json`, `16.19/420/emeraldPlus/champions.json`) → its file. Keys are built
    /// from validated parts only (see `DataSet`).
    fn path(&self, key: &str) -> PathBuf {
        let mut path = self.root.join("v1");
        path.extend(key.split('/'));
        path
    }

    /// Body and `ETag` of a saved file, at startup (no runtime needed).
    pub(crate) fn read_blocking(&self, key: &str) -> Option<(Vec<u8>, Option<String>)> {
        let path = self.path(key);
        let body = std::fs::read(&path).ok()?;
        Some((body, etag_of(std::fs::read(sibling(&path, ".etag")).ok())))
    }

    /// Body and `ETag` of a saved file.
    pub(crate) async fn read(&self, key: &str) -> Option<(Vec<u8>, Option<String>)> {
        let path = self.path(key);
        let body = tokio::fs::read(&path).await.ok()?;
        let etag = etag_of(tokio::fs::read(sibling(&path, ".etag")).await.ok());
        Some((body, etag))
    }

    /// Saves `bytes` (and its `etag`) as `key`.
    pub(crate) async fn write(&self, key: &str, bytes: &[u8], etag: Option<&str>) {
        let path = self.path(key);
        let tag = sibling(&path, ".etag");
        let saved = async {
            if let Some(dir) = path.parent() {
                tokio::fs::create_dir_all(dir).await?;
            }
            // The old tag goes first: a crash between the writes must never pair it with the
            // new body (a 304 would then vouch for the wrong file).
            remove_file(&tag).await?;
            write_atomically(&path, bytes).await?;
            if let Some(etag) = etag {
                write_atomically(&tag, etag.as_bytes()).await?;
            }
            Ok::<(), io::Error>(())
        };
        if let Err(error) = saved.await {
            tracing::warn!(%error, path = %path.display(), "cannot cache a stats file");
        }
    }

    /// Forgets `key` (the server no longer publishes it, or the copy is unreadable).
    pub(crate) async fn remove(&self, key: &str) {
        let path = self.path(key);
        for file in [sibling(&path, ".etag"), path] {
            if let Err(error) = remove_file(&file).await {
                tracing::warn!(%error, path = %file.display(), "cannot remove a cached stats file");
            }
        }
    }

    /// Deletes every patch directory except `keep`.
    pub(crate) async fn prune(&self, keep: &[String]) {
        let Ok(mut dir) = tokio::fs::read_dir(self.root.join("v1")).await else {
            return;
        };
        while let Ok(Some(entry)) = dir.next_entry().await {
            let name = entry.file_name();
            let Some(patch) = name.to_str() else { continue };
            let is_dir = entry.file_type().await.is_ok_and(|t| t.is_dir());
            if !is_dir || !valid_patch(patch) || keep.iter().any(|k| k == patch) {
                continue;
            }
            match tokio::fs::remove_dir_all(entry.path()).await {
                Ok(()) => tracing::info!(patch, "stats: removed an old patch from the cache"),
                Err(error) => tracing::warn!(%error, patch, "cannot remove an old stats patch"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]
    use super::*;

    #[tokio::test]
    async fn keeps_bodies_with_their_tags() {
        let dir = tempfile::tempdir().unwrap();
        let disk = Disk::new(dir.path().to_path_buf());
        let key = "16.19/420/emeraldPlus/champions.json";
        assert!(disk.read(key).await.is_none());
        disk.write(key, b"{}", Some("\"a\"")).await;
        assert_eq!(
            disk.read(key).await,
            Some((b"{}".to_vec(), Some("\"a\"".to_owned())))
        );
        assert!(
            dir.path()
                .join("v1/16.19/420/emeraldPlus/champions.json.etag")
                .exists()
        );
        // A body without a validator loses the old one.
        disk.write(key, b"[]", None).await;
        assert_eq!(disk.read(key).await, Some((b"[]".to_vec(), None)));
        assert_eq!(disk.read_blocking(key), Some((b"[]".to_vec(), None)));
        disk.remove(key).await;
        assert!(disk.read(key).await.is_none());
    }

    #[tokio::test]
    async fn prunes_old_patches_only() {
        let dir = tempfile::tempdir().unwrap();
        let disk = Disk::new(dir.path().to_path_buf());
        for patch in ["16.17", "16.18", "16.19"] {
            disk.write(
                &format!("{patch}/420/emeraldPlus/tierlist.json"),
                b"{}",
                None,
            )
            .await;
        }
        disk.write("index.json", b"{}", Some("\"i\"")).await;
        std::fs::create_dir_all(dir.path().join("v1/not-a-patch")).unwrap();
        disk.prune(&["16.19".to_owned(), "16.18".to_owned()]).await;
        let v1 = dir.path().join("v1");
        assert!(!v1.join("16.17").exists());
        assert!(v1.join("16.18").exists() && v1.join("16.19").exists());
        assert!(v1.join("index.json").exists() && v1.join("not-a-patch").exists());
    }
}
