//! League Client (LCU) API.
//!
//! The League client exposes a local HTTPS + WebSocket API. Its port and a
//! per-session password are published in a `lockfile` in the install
//! directory (and on the `LeagueClientUx` process command line).

mod lockfile;

pub use lockfile::{Credentials, Lockfile, LockfileError};
