//! Statistics primitives.
//!
//! Everything here is pure and deterministic so it can be property-tested and
//! reused identically by the desktop app and the stats backend.

mod record;

pub use record::{BetaPrior, Record, logit, sigmoid, wilson_interval};
