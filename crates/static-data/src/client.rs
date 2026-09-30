//! Files of the League client as `CommunityDragon` mirrors them (acknowledged by Riot on its
//! developer portal): downloaded once, shaped for the UI (an emblem cropped, an icon cleaned) and
//! kept on disk. Never committed: the app fetches them at run time, like Data Dragon art.

use std::path::PathBuf;
use std::time::Duration;

use crate::StaticDataError;

/// `CommunityDragon`'s mirror of the live client's files.
pub const CDRAGON: &str = "https://raw.communitydragon.org/latest";

/// How a downloaded file is made ready for the UI before it is cached.
pub(crate) type Shape = fn(&[u8]) -> Result<Vec<u8>, StaticDataError>;

/// Client files in one cache directory, each downloaded once.
#[derive(Debug, Clone)]
pub(crate) struct ClientFiles {
    http: reqwest::Client,
    base: String,
    cache: PathBuf,
}

impl ClientFiles {
    pub(crate) fn new(base: impl Into<String>, cache: PathBuf) -> Result<Self, StaticDataError> {
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(crate::public_tls()?)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_owned(),
            cache,
        })
    }

    /// `name` as cached, else downloaded from the first of `folders` that has it (the client
    /// moves files now and then), shaped off the async threads, then cached.
    pub(crate) async fn get(
        &self,
        folders: &[&str],
        name: &str,
        shape: Shape,
    ) -> Result<Vec<u8>, StaticDataError> {
        let path = self.cache.join(name);
        if let Ok(bytes) = tokio::fs::read(&path).await {
            return Ok(bytes);
        }
        let raw = self.download(folders, name).await?;
        let shaped = tokio::task::spawn_blocking(move || shape(&raw))
            .await
            .map_err(|error| StaticDataError::Image(error.to_string()))??;
        tokio::fs::create_dir_all(&self.cache).await?;
        // Write then rename: a crash mid-write never leaves a broken file behind.
        let partial = path.with_extension("part");
        tokio::fs::write(&partial, &shaped).await?;
        tokio::fs::rename(&partial, &path).await?;
        Ok(shaped)
    }

    async fn download(&self, folders: &[&str], name: &str) -> Result<Vec<u8>, StaticDataError> {
        let mut last = None;
        for folder in folders {
            let url = format!("{}/{folder}/{name}", self.base);
            let response = self.http.get(&url).send().await?;
            let status = response.status();
            if status.is_success() {
                return Ok(response.bytes().await?.to_vec());
            }
            last = Some(StaticDataError::Status(status.as_u16(), url));
        }
        Err(last.unwrap_or(StaticDataError::NothingCached))
    }
}
