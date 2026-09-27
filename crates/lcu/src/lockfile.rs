use std::fmt;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

/// Parsed content of the League client `lockfile`.
///
/// Format: `LeagueClient:<pid>:<port>:<password>:<protocol>`.
#[derive(Clone, PartialEq, Eq)]
pub struct Lockfile {
    pub process_name: String,
    pub pid: u32,
    pub port: u16,
    pub password: String,
    pub protocol: String,
}

// Manual impl so the session password never ends up in logs.
impl fmt::Debug for Lockfile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Lockfile")
            .field("process_name", &self.process_name)
            .field("pid", &self.pid)
            .field("port", &self.port)
            .field("password", &"<redacted>")
            .field("protocol", &self.protocol)
            .finish()
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LockfileError {
    #[error("lockfile has {0} fields, expected 5")]
    FieldCount(usize),
    #[error("invalid {field} in lockfile: {value:?}")]
    InvalidField { field: &'static str, value: String },
}

impl Lockfile {
    pub fn parse(content: &str) -> Result<Self, LockfileError> {
        let fields: Vec<&str> = content.trim().split(':').collect();
        let [process_name, pid, port, password, protocol] = fields[..] else {
            return Err(LockfileError::FieldCount(fields.len()));
        };
        let invalid = |field: &'static str, value: &str| LockfileError::InvalidField {
            field,
            value: value.to_owned(),
        };
        if password.is_empty() {
            return Err(invalid("password", password));
        }
        if protocol != "https" && protocol != "http" {
            return Err(invalid("protocol", protocol));
        }
        Ok(Self {
            process_name: process_name.to_owned(),
            pid: pid.parse().map_err(|_| invalid("pid", pid))?,
            port: port
                .parse()
                .ok()
                .filter(|&p| p != 0)
                .ok_or_else(|| invalid("port", port))?,
            password: password.to_owned(),
            protocol: protocol.to_owned(),
        })
    }

    pub fn credentials(&self) -> Credentials {
        Credentials {
            port: self.port,
            password: self.password.clone(),
        }
    }
}

/// What is needed to talk to a running client.
#[derive(Clone, PartialEq, Eq)]
pub struct Credentials {
    pub port: u16,
    pub password: String,
}

impl fmt::Debug for Credentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Credentials")
            .field("port", &self.port)
            .field("password", &"<redacted>")
            .finish()
    }
}

impl Credentials {
    /// Base URL of the REST API (`https://127.0.0.1:<port>`).
    pub fn base_url(&self) -> String {
        format!("https://127.0.0.1:{}", self.port)
    }

    /// Value of the `Authorization` header (HTTP basic auth, user `riot`).
    pub fn authorization(&self) -> String {
        format!(
            "Basic {}",
            STANDARD.encode(format!("riot:{}", self.password))
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn parses_a_real_lockfile() {
        let lf = Lockfile::parse("LeagueClient:17220:52437:x9Kp_2mNq-Zr8s:https\n").expect("valid");
        assert_eq!(lf.pid, 17220);
        assert_eq!(lf.port, 52437);
        assert_eq!(lf.password, "x9Kp_2mNq-Zr8s");
        assert_eq!(lf.credentials().base_url(), "https://127.0.0.1:52437");
    }

    #[test]
    fn builds_basic_auth_header() {
        let creds = Credentials {
            port: 1,
            password: "secret".into(),
        };
        // base64("riot:secret")
        assert_eq!(creds.authorization(), "Basic cmlvdDpzZWNyZXQ=");
    }

    #[test]
    fn rejects_malformed_content() {
        assert_eq!(Lockfile::parse(""), Err(LockfileError::FieldCount(1)));
        assert_eq!(Lockfile::parse("a:b:c"), Err(LockfileError::FieldCount(3)));
        assert!(matches!(
            Lockfile::parse("LeagueClient:1:0:pw:https"),
            Err(LockfileError::InvalidField { field: "port", .. })
        ));
        assert!(matches!(
            Lockfile::parse("LeagueClient:1:2:pw:ftp"),
            Err(LockfileError::InvalidField {
                field: "protocol",
                ..
            })
        ));
        assert!(matches!(
            Lockfile::parse("LeagueClient:x:2:pw:https"),
            Err(LockfileError::InvalidField { field: "pid", .. })
        ));
    }

    #[test]
    fn debug_output_redacts_password() {
        let lf = Lockfile::parse("LeagueClient:1:2:hunter2:https").expect("valid");
        assert!(!format!("{lf:?}").contains("hunter2"));
        assert!(!format!("{:?}", lf.credentials()).contains("hunter2"));
    }

    proptest! {
        #[test]
        fn never_panics_on_arbitrary_input(s in ".*") {
            let _ = Lockfile::parse(&s);
        }

        #[test]
        fn roundtrips_valid_fields(pid in 1u32.., port in 1u16.., pw in "[A-Za-z0-9_-]{1,32}") {
            let lf = Lockfile::parse(&format!("LeagueClient:{pid}:{port}:{pw}:https")).expect("valid");
            prop_assert_eq!(lf.pid, pid);
            prop_assert_eq!(lf.port, port);
            prop_assert_eq!(lf.password, pw);
        }
    }
}
