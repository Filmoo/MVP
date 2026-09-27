//! League Client (LCU) API.
//!
//! The League client exposes a local HTTPS + WebSocket API. Its port and a per-session
//! password are published in a `lockfile` in the install directory and on the
//! `LeagueClientUx` process command line. Only loopback traffic; nothing here touches the
//! game process itself (Vanguard-safe).

mod client;
mod connector;
pub mod discovery;
mod events;
mod lockfile;
pub mod tls;

pub use client::{LcuClient, LcuError};
pub use connector::{
    ConnectionState, Connector, ConnectorConfig, ConnectorUpdate, GAMEFLOW_PHASE, spawn,
};
pub use events::{EventKind, EventStream, EventStreamError, LcuEvent, parse_frame, topic_for};
pub use lockfile::{Credentials, Lockfile, LockfileError};
