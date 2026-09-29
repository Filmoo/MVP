//! GitHub: the OAuth web flow (an OAuth App; the client secret stays on the server) and the one
//! question this service asks, with the user's own token: is this login an admin of the
//! repository? (`GET /repos/{owner}/{repo}/collaborators/{login}/permission` → `admin`.)
//!
//! The app asks for no scope: the token reads public data only, which is all this needs.

use std::sync::Arc;
use std::time::Duration;

use reqwest::StatusCode;
use serde::Deserialize;

/// A secret string that never shows in logs or `Debug`.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[redacted]")
    }
}

/// The OAuth App and where GitHub is (overridable for tests).
#[derive(Debug, Clone)]
pub struct GitHubConfig {
    pub client_id: String,
    pub client_secret: Secret,
    /// `https://github.com` (the OAuth pages).
    pub web_url: String,
    /// `https://api.github.com`.
    pub api_url: String,
    /// `Filmoo/MVP`.
    pub repo: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubUser {
    pub login: String,
    pub id: i64,
    pub name: String,
    pub avatar_url: String,
}

/// What GitHub says about a login and the repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Access {
    Admin,
    /// Not an admin: the permission GitHub gave (`write`, `read`, `none`, or why none).
    Not(String),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GitHubError {
    /// GitHub answered no (a used or expired code, a revoked token).
    #[error("GitHub refused: {0}")]
    Refused(String),
    /// No usable answer (network, 5xx, rate limit): nothing can be concluded.
    #[error("GitHub didn't answer: {0}")]
    Unavailable(String),
}

#[derive(Debug, Clone)]
pub struct GitHub {
    http: reqwest::Client,
    config: Arc<GitHubConfig>,
}

#[derive(Deserialize)]
struct TokenAnswer {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct UserAnswer {
    login: String,
    id: i64,
    name: Option<String>,
    #[serde(default)]
    avatar_url: String,
}

#[derive(Deserialize)]
struct PermissionAnswer {
    permission: String,
}

fn unavailable(error: reqwest::Error) -> GitHubError {
    GitHubError::Unavailable(error.without_url().to_string())
}

/// GitHub logins: letters, digits and single dashes, 39 at most.
pub fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 39
        && login
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !login.starts_with('-')
}

impl GitHub {
    pub fn new(config: GitHubConfig) -> Result<Self, String> {
        use rustls_platform_verifier::BuilderVerifierExt as _;
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .with_platform_verifier()
            .map_err(|e| e.to_string())?
            .with_no_client_auth();
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(tls)
            .user_agent(concat!("mvp-roadmap/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            http,
            config: Arc::new(config),
        })
    }

    pub fn repo(&self) -> &str {
        &self.config.repo
    }

    /// Where the browser goes to sign in: no scope, the state, and PKCE's challenge.
    pub fn authorize_url(&self, redirect_uri: &str, state: &str, challenge: &str) -> String {
        let query = form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &self.config.client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("allow_signup", "false")
            .finish();
        format!("{}/login/oauth/authorize?{query}", self.config.web_url)
    }

    /// Trades the callback's code for the user's token.
    pub async fn exchange(
        &self,
        code: &str,
        redirect_uri: &str,
        verifier: &str,
    ) -> Result<Secret, GitHubError> {
        let body = form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &self.config.client_id)
            .append_pair("client_secret", self.config.client_secret.expose())
            .append_pair("code", code)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("code_verifier", verifier)
            .finish();
        let response = self
            .http
            .post(format!("{}/login/oauth/access_token", self.config.web_url))
            .header(reqwest::header::ACCEPT, "application/json")
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body)
            .send()
            .await
            .map_err(unavailable)?;
        if response.status().is_server_error() {
            return Err(GitHubError::Unavailable(response.status().to_string()));
        }
        let answer: TokenAnswer = response.json().await.map_err(unavailable)?;
        match (answer.access_token, answer.error) {
            (Some(token), None) if !token.is_empty() => Ok(Secret::new(token)),
            (_, error) => Err(GitHubError::Refused(
                answer
                    .error_description
                    .or(error)
                    .unwrap_or_else(|| "no token".into()),
            )),
        }
    }

    fn get(&self, token: &Secret, path: &str) -> reqwest::RequestBuilder {
        self.http
            .get(format!("{}{path}", self.config.api_url))
            .bearer_auth(token.expose())
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    /// Who the token belongs to.
    pub async fn user(&self, token: &Secret) -> Result<GitHubUser, GitHubError> {
        let response = self.get(token, "/user").send().await.map_err(unavailable)?;
        match response.status() {
            StatusCode::OK => {}
            StatusCode::UNAUTHORIZED => {
                return Err(GitHubError::Refused("the token was rejected".into()));
            }
            other => return Err(GitHubError::Unavailable(other.to_string())),
        }
        let user: UserAnswer = response.json().await.map_err(unavailable)?;
        if !valid_login(&user.login) {
            return Err(GitHubError::Refused(format!("odd login {:?}", user.login)));
        }
        Ok(GitHubUser {
            name: user
                .name
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| user.login.clone()),
            login: user.login,
            id: user.id,
            avatar_url: user.avatar_url,
        })
    }

    /// Whether `login` is an admin of the repository, asked with the user's own token.
    pub async fn access(&self, token: &Secret, login: &str) -> Result<Access, GitHubError> {
        if !valid_login(login) {
            return Ok(Access::Not("none".into()));
        }
        let path = format!(
            "/repos/{}/collaborators/{login}/permission",
            self.config.repo
        );
        let response = self.get(token, &path).send().await.map_err(unavailable)?;
        match response.status() {
            StatusCode::OK => {
                let answer: PermissionAnswer = response.json().await.map_err(unavailable)?;
                Ok(if answer.permission == "admin" {
                    Access::Admin
                } else {
                    Access::Not(answer.permission)
                })
            }
            // Not a collaborator: GitHub hides the list from people without push access.
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => Ok(Access::Not("none".into())),
            StatusCode::UNAUTHORIZED => Ok(Access::Not("token revoked".into())),
            other => Err(GitHubError::Unavailable(other.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logins_are_checked_before_they_reach_a_url() {
        assert!(valid_login("Filmoo"));
        assert!(valid_login("some-user-42"));
        for bad in ["", "-x", "a/b", "a b", "../x", "é"] {
            assert!(!valid_login(bad), "{bad}");
        }
        assert!(!valid_login(&"a".repeat(40)));
    }

    #[test]
    fn the_authorize_url_asks_for_no_scope() {
        let github = GitHub::new(GitHubConfig {
            client_id: "Iv1.abc".into(),
            client_secret: Secret::new("s3cret"),
            web_url: "https://github.com".into(),
            api_url: "https://api.github.com".into(),
            repo: "Filmoo/MVP".into(),
        });
        let Ok(github) = github else {
            panic!("client");
        };
        let url = github.authorize_url("https://dev.mvpgg.com/auth/callback", "st", "ch");
        assert!(url.starts_with("https://github.com/login/oauth/authorize?client_id=Iv1.abc&"));
        assert!(url.contains("redirect_uri=https%3A%2F%2Fdev.mvpgg.com%2Fauth%2Fcallback"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(!url.contains("scope"));
        assert!(!url.contains("s3cret"));
        assert_eq!(format!("{:?}", Secret::new("s3cret")), "[redacted]");
    }
}
