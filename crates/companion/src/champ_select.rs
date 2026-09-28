//! Champion select session (League client) → the UI's `DraftView`.
//!
//! Privacy by construction: the session carries names, PUUIDs and obfuscated ids of players,
//! some of them hidden by Riot in ranked (and by streamer mode). We never deserialize those
//! fields, so they cannot reach the UI, the logs or the stats model.

use domain::{DraftPhase, DraftSlot, DraftView, Role};
use serde::Deserialize;

pub const SESSION: &str = "/lol-champ-select/v1/session";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    #[serde(default)]
    my_team: Vec<Member>,
    #[serde(default)]
    their_team: Vec<Member>,
    #[serde(default)]
    actions: Vec<Vec<Action>>,
    #[serde(default)]
    bans: Bans,
    #[serde(default)]
    timer: Timer,
    #[serde(default)]
    local_player_cell_id: i64,
}

/// Only what the draft needs. Identity fields are intentionally absent.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Member {
    cell_id: i64,
    #[serde(default)]
    assigned_position: String,
    #[serde(default)]
    champion_id: u32,
    #[serde(default)]
    champion_pick_intent: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Action {
    actor_cell_id: i64,
    #[serde(default)]
    is_in_progress: bool,
    #[serde(default, rename = "type")]
    kind: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bans {
    #[serde(default)]
    my_team_bans: Vec<u32>,
    #[serde(default)]
    their_team_bans: Vec<u32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Timer {
    #[serde(default)]
    phase: String,
    #[serde(default)]
    adjusted_time_left_in_phase: i64,
}

pub(crate) fn role(position: &str) -> Option<Role> {
    match position {
        "top" => Some(Role::Top),
        "jungle" => Some(Role::Jungle),
        "middle" => Some(Role::Middle),
        "bottom" => Some(Role::Bottom),
        "utility" => Some(Role::Support),
        _ => None,
    }
}

/// Maps a session payload; `None` if it isn't a champ-select session.
pub fn map_session(value: &serde_json::Value) -> Option<DraftView> {
    let session: Session = serde_json::from_value(value.clone()).ok()?;
    let in_progress: Vec<&Action> = session
        .actions
        .iter()
        .flatten()
        .filter(|a| a.is_in_progress)
        .collect();
    let picking = |cell: i64| {
        in_progress
            .iter()
            .any(|a| a.actor_cell_id == cell && a.kind == "pick")
    };
    let phase = match session.timer.phase.as_str() {
        "PLANNING" => DraftPhase::Planning,
        "FINALIZATION" | "GAME_STARTING" => DraftPhase::Finalizing,
        _ if in_progress.iter().any(|a| a.kind == "ban") => DraftPhase::Banning,
        _ => DraftPhase::Picking,
    };
    let ally = |m: &Member| {
        let (champion_id, hovering) = match (m.champion_id, m.champion_pick_intent) {
            (0, 0) => (None, false),
            (0, intent) => (Some(intent), true),
            (locked, _) => (Some(locked), false),
        };
        DraftSlot {
            champion_id,
            hovering,
            role: role(&m.assigned_position),
            role_odds: Vec::new(),
            is_me: m.cell_id == session.local_player_cell_id,
            picking: picking(m.cell_id),
        }
    };
    let enemy = |m: &Member| DraftSlot {
        champion_id: (m.champion_id != 0).then_some(m.champion_id),
        hovering: false,
        role: None,
        role_odds: Vec::new(),
        is_me: false,
        picking: picking(m.cell_id),
    };
    let my_role = session
        .my_team
        .iter()
        .find(|m| m.cell_id == session.local_player_cell_id)
        .and_then(|m| role(&m.assigned_position));
    let seconds = |ms: i64| u32::try_from(ms.max(0) / 1000).ok();
    Some(DraftView {
        phase,
        seconds_left: (session.timer.adjusted_time_left_in_phase > 0)
            .then(|| seconds(session.timer.adjusted_time_left_in_phase))
            .flatten(),
        my_role,
        allies: session.my_team.iter().map(ally).collect(),
        enemies: session.their_team.iter().map(enemy).collect(),
        ally_bans: session
            .bans
            .my_team_bans
            .into_iter()
            .filter(|&c| c != 0)
            .collect(),
        enemy_bans: session
            .bans
            .their_team_bans
            .into_iter()
            .filter(|&c| c != 0)
            .collect(),
        team: None,
        suggestions: Vec::new(),
        data: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Shaped like a real ranked solo/duo session: hidden allies still carry names in the raw
    /// payload (observed in the wild), which must never come out.
    fn ranked_session() -> serde_json::Value {
        json!({
            "localPlayerCellId": 0,
            "myTeam": [
                { "cellId": 0, "assignedPosition": "top", "championId": 0, "championPickIntent": 54, "nameVisibilityType": "UNHIDDEN", "gameName": "Nightfall", "tagLine": "EUW", "puuid": "me-puuid" },
                { "cellId": 1, "assignedPosition": "jungle", "championId": 64, "nameVisibilityType": "HIDDEN", "gameName": "SecretJungler", "tagLine": "000", "puuid": "", "obfuscatedPuuid": "xyz" },
                { "cellId": 2, "assignedPosition": "middle", "championId": 103, "nameVisibilityType": "HIDDEN", "gameName": "SecretMid" },
                { "cellId": 3, "assignedPosition": "bottom", "championId": 0 },
                { "cellId": 4, "assignedPosition": "utility", "championId": 0, "championPickIntent": 412 }
            ],
            "theirTeam": [
                { "cellId": 5, "championId": 39 }, { "cellId": 6, "championId": 234 }, { "cellId": 7, "championId": 910 },
                { "cellId": 8, "championId": 0 }, { "cellId": 9, "championId": 0 }
            ],
            "actions": [[
                { "id": 1, "actorCellId": 0, "championId": 54, "completed": false, "isInProgress": true, "type": "pick" },
                { "id": 2, "actorCellId": 8, "championId": 0, "completed": false, "isInProgress": true, "type": "pick" }
            ]],
            "bans": { "myTeamBans": [777, 238, 0], "theirTeamBans": [517, 266], "numBans": 10 },
            "timer": { "phase": "BAN_PICK", "adjustedTimeLeftInPhase": 24_500 }
        })
    }

    #[test]
    fn maps_a_ranked_session() {
        let view = map_session(&ranked_session()).expect("session");
        assert_eq!(view.phase, DraftPhase::Picking);
        assert_eq!(view.seconds_left, Some(24));
        assert_eq!(view.my_role, Some(Role::Top));
        let me = &view.allies[0];
        assert!(me.is_me && me.hovering && me.picking);
        assert_eq!(me.champion_id, Some(54));
        assert_eq!(view.allies[1].champion_id, Some(64));
        assert!(!view.allies[1].hovering);
        assert_eq!(view.allies[4].role, Some(Role::Support));
        assert_eq!(view.enemies[0].champion_id, Some(39));
        assert!(view.enemies[3].picking);
        assert_eq!(view.ally_bans, vec![777, 238]);
        assert_eq!(view.enemy_bans, vec![517, 266]);
    }

    #[test]
    fn never_carries_player_identities() {
        let view = map_session(&ranked_session()).expect("session");
        let json = serde_json::to_string(&view).expect("serializable");
        for secret in [
            "Nightfall",
            "SecretJungler",
            "SecretMid",
            "me-puuid",
            "xyz",
            "EUW",
        ] {
            assert!(
                !json.contains(secret),
                "{secret} leaked into the draft view"
            );
        }
    }

    #[test]
    fn recognises_phases() {
        let mut s = ranked_session();
        s["timer"]["phase"] = json!("PLANNING");
        assert_eq!(map_session(&s).map(|v| v.phase), Some(DraftPhase::Planning));
        s["timer"]["phase"] = json!("BAN_PICK");
        s["actions"] = json!([[{ "actorCellId": 0, "isInProgress": true, "type": "ban" }]]);
        assert_eq!(map_session(&s).map(|v| v.phase), Some(DraftPhase::Banning));
        s["timer"]["phase"] = json!("FINALIZATION");
        assert_eq!(
            map_session(&s).map(|v| v.phase),
            Some(DraftPhase::Finalizing)
        );
    }

    #[test]
    fn rejects_other_payloads() {
        assert!(map_session(&json!("ChampSelect")).is_none());
        assert!(map_session(&json!(null)).is_none());
    }
}
