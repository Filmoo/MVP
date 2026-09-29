//! Who may do what. The owner (a GitHub admin of the repository, or the server's command line)
//! may do everything. Claude, with a machine token, may:
//! - read everything;
//! - propose features (always `proposed`, "proposed by Claude");
//! - comment on any feature;
//! - move the features the owner agreed to (accepted, in progress, done) between those three
//!   statuses, and link commits, pull requests or docs to them.
//!
//! Accepting and rejecting proposals, editing, ordering, removing and restoring features, and
//! everything about versions and areas are the owner's.

use crate::model::{Actor, Status};

/// Why something was refused, in words for the caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Denied(pub &'static str);

/// The status a new feature starts in.
pub fn create(by: &Actor, requested: Option<Status>) -> Result<Status, Denied> {
    if by.is_owner() {
        return Ok(requested.unwrap_or(Status::Accepted));
    }
    match requested {
        None | Some(Status::Proposed) => Ok(Status::Proposed),
        Some(_) => Err(Denied(
            "Claude proposes: a new feature starts as a proposal, and the owner decides",
        )),
    }
}

/// Moving a feature from one status to another.
pub fn status(by: &Actor, from: Status, to: Status) -> Result<(), Denied> {
    if by.is_owner() || from == to {
        return Ok(());
    }
    match (from, to) {
        (Status::Proposed, _) => Err(Denied(
            "accepting or rejecting a proposal is the owner's call",
        )),
        (Status::Rejected, _) => Err(Denied("only the owner reopens a rejected feature")),
        (_, Status::Proposed | Status::Rejected) => Err(Denied(
            "only the owner sends a feature back to proposals or rejects it",
        )),
        _ => Ok(()),
    }
}

/// Linking a commit, pull request or doc to a feature.
pub fn link(by: &Actor, current: Status) -> Result<(), Denied> {
    if by.is_owner() || current.is_planned() {
        Ok(())
    } else {
        Err(Denied(
            "Claude links work to features the owner accepted; comment on proposals instead",
        ))
    }
}

/// Everything else that changes the roadmap (edit, order, remove, restore, versions, areas).
pub fn owner_only(by: &Actor, what: &'static str) -> Result<(), Denied> {
    if by.is_owner() {
        Ok(())
    } else {
        Err(Denied(what))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude() -> Actor {
        Actor::claude("claude")
    }

    #[test]
    fn the_owner_may_do_anything() {
        let owner = Actor::owner("Filmoo");
        assert_eq!(create(&owner, None), Ok(Status::Accepted));
        assert_eq!(create(&owner, Some(Status::Proposed)), Ok(Status::Proposed));
        for from in Status::ALL {
            for to in Status::ALL {
                assert_eq!(status(&owner, from, to), Ok(()));
            }
        }
        assert!(owner_only(&owner, "x").is_ok());
        assert!(link(&owner, Status::Rejected).is_ok());
    }

    #[test]
    fn claude_only_proposes() {
        assert_eq!(create(&claude(), None), Ok(Status::Proposed));
        assert_eq!(
            create(&claude(), Some(Status::Proposed)),
            Ok(Status::Proposed)
        );
        assert!(create(&claude(), Some(Status::Accepted)).is_err());
        assert!(create(&claude(), Some(Status::Done)).is_err());
    }

    #[test]
    fn claude_moves_accepted_work_only() {
        use Status::{Accepted, Done, InProgress, Proposed, Rejected};
        for (from, to) in [
            (Accepted, InProgress),
            (InProgress, Done),
            (Done, InProgress),
            (InProgress, Accepted),
        ] {
            assert_eq!(status(&claude(), from, to), Ok(()), "{from:?} → {to:?}");
        }
        for (from, to) in [
            (Proposed, Accepted),
            (Proposed, Rejected),
            (Rejected, Accepted),
            (Accepted, Rejected),
            (Done, Proposed),
        ] {
            assert!(status(&claude(), from, to).is_err(), "{from:?} → {to:?}");
        }
        assert!(link(&claude(), InProgress).is_ok());
        assert!(link(&claude(), Proposed).is_err());
        assert!(owner_only(&claude(), "x").is_err());
    }
}
