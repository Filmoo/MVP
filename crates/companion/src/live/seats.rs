//! Naming the seats of the client's session from another list of the game's players: Riot's
//! live game (through our backend) or the game's own. Matched by side, then champion.

use domain::{ActiveGame, LivePlayer, RiotId, Role, ScoutCard};

use super::{Scouted, same_riot_id};

/// A side of the map: blue (team 100, the game's `ORDER`) or red (team 200, `CHAOS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Side {
    Blue,
    Red,
}

impl Side {
    const fn other(self) -> Self {
        match self {
            Self::Blue => Self::Red,
            Self::Red => Self::Blue,
        }
    }
}

/// Who a listed player is, as the list shows them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Who {
    Named(RiotId),
    /// Kept anonymous by Riot (streamer mode): never named, never looked up.
    Hidden,
    Bot,
}

/// A player as another list shows them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Listed {
    pub side: Side,
    pub champion_id: Option<u32>,
    pub who: Who,
    pub spells: Vec<u32>,
    pub role: Option<Role>,
    pub card: Option<ScoutCard>,
}

/// Riot's live game as our backend answered it.
pub(crate) fn from_riot(game: &ActiveGame) -> Vec<Listed> {
    game.participants
        .iter()
        .map(|p| Listed {
            side: if p.team_id == 200 {
                Side::Red
            } else {
                Side::Blue
            },
            champion_id: Some(p.champion_id).filter(|&id| id != 0),
            who: if p.bot {
                Who::Bot
            } else {
                p.riot_id.clone().map_or(Who::Hidden, Who::Named)
            },
            spells: p.spells.clone(),
            role: None,
            card: p.card.clone(),
        })
        .collect()
}

impl Scouted {
    /// Names the seats from `listed`: by side, then champion (a champion twice on one side: in
    /// order). Players the session didn't list (bots in custom games) get seats of their own.
    /// `me`: the local player's own Riot ID, which tells their side when the list names them.
    pub(crate) fn name_from(&mut self, listed: &[Listed], me: Option<&RiotId>) {
        let ours = self.allies_side(listed, me);
        let on = |side: Side| listed.iter().filter(|l| l.side == side).collect::<Vec<_>>();
        fill(&mut self.game.allies, &on(ours));
        fill(&mut self.game.enemies, &on(ours.other()));
    }

    /// Which side the local player's team plays on: where the list names them, else the way
    /// round more champions match, else as the session put the teams (its first team is blue).
    fn allies_side(&self, listed: &[Listed], me: Option<&RiotId>) -> Side {
        if self.game.allies.iter().any(|p| p.is_me)
            && let Some(me) = me
            && let Some(mine) = listed
                .iter()
                .find(|l| matches!(&l.who, Who::Named(id) if same_riot_id(id, me)))
        {
            return mine.side;
        }
        let first = if self.allies_first_team {
            Side::Blue
        } else {
            Side::Red
        };
        let matching = |allies: Side| {
            let count = |seats: &[LivePlayer], side: Side| {
                seats
                    .iter()
                    .filter(|s| {
                        s.champion_id.is_some()
                            && listed
                                .iter()
                                .any(|l| l.side == side && l.champion_id == s.champion_id)
                    })
                    .count()
            };
            count(&self.game.allies, allies) + count(&self.game.enemies, allies.other())
        };
        if matching(first.other()) > matching(first) {
            first.other()
        } else {
            first
        }
    }
}

/// Names one side's seats from that side's list; adds the players the session didn't list.
fn fill(seats: &mut Vec<LivePlayer>, listed: &[&Listed]) {
    let mut used = vec![false; listed.len()];
    for seat in seats.iter_mut() {
        let Some(champion) = seat.champion_id else {
            continue;
        };
        let found = listed
            .iter()
            .zip(&used)
            .position(|(l, &taken)| !taken && l.champion_id == Some(champion));
        if let Some(i) = found {
            used[i] = true;
            name(seat, listed[i]);
        }
    }
    // As many as the list has more: a seat whose champion the list got wrong isn't doubled.
    let room = listed.len().saturating_sub(seats.len());
    let extra: Vec<LivePlayer> = listed
        .iter()
        .zip(&used)
        .filter(|(l, taken)| !**taken && l.champion_id.is_some())
        .take(room)
        .map(|(l, _)| seat_of(l))
        .collect();
    seats.extend(extra);
}

/// Names a seat. A seat already hidden stays hidden, whatever the list says; the local player
/// keeps their own name (they know who they are).
fn name(seat: &mut LivePlayer, listed: &Listed) {
    if seat.spells.is_empty() {
        seat.spells.clone_from(&listed.spells);
    }
    if seat.role.is_none() {
        seat.role = listed.role;
    }
    if seat.is_me {
        if seat.card.is_none() && matches!(listed.who, Who::Named(_)) {
            seat.card.clone_from(&listed.card);
        }
        return;
    }
    if seat.hidden {
        return;
    }
    match &listed.who {
        Who::Hidden => {
            seat.hidden = true;
            seat.riot_id = None;
            seat.card = None;
        }
        Who::Bot => {
            seat.bot = true;
            seat.riot_id = None;
            seat.card = None;
        }
        Who::Named(id) => {
            if seat.riot_id.is_none() {
                seat.riot_id = Some(id.clone());
            }
            if listed.card.is_some() {
                seat.card.clone_from(&listed.card);
            }
        }
    }
}

fn seat_of(listed: &Listed) -> LivePlayer {
    let named = match &listed.who {
        Who::Named(id) => Some(id.clone()),
        Who::Hidden | Who::Bot => None,
    };
    LivePlayer {
        champion_id: listed.champion_id,
        spells: listed.spells.clone(),
        role: listed.role,
        is_me: false,
        hidden: listed.who == Who::Hidden,
        bot: listed.who == Who::Bot,
        card: named.as_ref().and(listed.card.clone()),
        riot_id: named,
    }
}
