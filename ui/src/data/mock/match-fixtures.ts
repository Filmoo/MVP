/**
 * Whole games behind the fixtures' match rows (match details and grades), made up and the same on
 * every run: the owner's line is the row's own numbers, the other nine players are invented.
 * Grades follow `stats::grade` (a compact port, so the mock's grades read like real ones).
 */

import { onHowlingAbyss } from "../../lib/queues";
import type { GradedMatch } from "../generated/GradedMatch";
import type { GradeFactorKind } from "../generated/GradeFactorKind";
import type { GradeLetter } from "../generated/GradeLetter";
import type { MatchDetails } from "../generated/MatchDetails";
import type { MatchGrade } from "../generated/MatchGrade";
import type { MatchPlayer } from "../generated/MatchPlayer";
import type { MatchSummary } from "../generated/MatchSummary";
import type { PlayerProfile } from "../generated/PlayerProfile";
import type { RiotId } from "../generated/RiotId";
import type { Role } from "../generated/Role";
import { CommandError } from "../transport";

const ROLES: Role[] = ["top", "jungle", "middle", "bottom", "support"];
type Lane = Role | "none";

// ── The grade (see crates/stats/src/grade.rs) ─────────────────────────────────────────────────

const KINDS: GradeFactorKind[] = [
  "killParticipation",
  "kda",
  "damageShare",
  "damageTakenShare",
  "objectiveShare",
  "visionShare",
  "csLead",
  "goldLead",
];
const WEIGHTS: Record<Lane, number[]> = {
  top: [0.15, 0.2, 0.2, 0.1, 0.1, 0.05, 0.1, 0.1],
  jungle: [0.2, 0.2, 0.15, 0.1, 0.15, 0.1, 0.05, 0.05],
  middle: [0.15, 0.2, 0.25, 0, 0.05, 0.05, 0.15, 0.15],
  bottom: [0.15, 0.2, 0.25, 0, 0.1, 0.05, 0.15, 0.1],
  support: [0.25, 0.2, 0.1, 0.1, 0, 0.3, 0, 0.05],
  none: [0.25, 0.25, 0.3, 0.15, 0.05, 0, 0, 0],
};
/** Typical shares of damage, damage taken, objectives, vision. */
const TYPICAL: Record<Lane, number[]> = {
  top: [0.22, 0.24, 0.2, 0.14],
  jungle: [0.17, 0.23, 0.32, 0.2],
  middle: [0.25, 0.17, 0.15, 0.14],
  bottom: [0.27, 0.15, 0.25, 0.16],
  support: [0.09, 0.21, 0.08, 0.36],
  none: [0.2, 0.2, 0.2, 0.2],
};
const KP_OFFSET: Record<Lane, number> = { top: -0.08, jungle: 0.05, middle: 0, bottom: -0.01, support: 0.05, none: 0 };
const SHARE_SCALE = [0.1, 0.1, 0.15, 0.1];

interface Seat {
  team: number;
  win: boolean;
  role: Role | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damage: number;
  taken: number;
  vision: number;
  objectives: number;
}

const unit = (x: number) => Math.max(-1, Math.min(1, x));
const letter = (score: number): GradeLetter => (score >= 8.5 ? "S+" : score >= 7.5 ? "S" : score >= 6 ? "A" : score >= 4 ? "B" : "C");

function grade(seats: Seat[], seconds: number): MatchGrade[] | null {
  if (seconds <= 300 || seats.length !== 10) return null;
  const minutes = seconds / 60;
  const scored = seats.map((me, i) => {
    const team = seats.filter((p) => p.team === me.team);
    const lane: Lane = me.role ?? "none";
    const teamKills = team.reduce((s, p) => s + p.kills, 0);
    const kpOf = (p: Seat) => Math.min(1, (p.kills + p.assists) / teamKills);
    const others = seats.filter((_, j) => j !== i);
    const lobby =
      others.reduce((s, p) => s + p.kills + p.assists, 0) /
      Math.max(
        1,
        others.reduce((s, p) => s + p.deaths, 0),
      );
    const kda = (me.kills + me.assists) / Math.max(1, me.deaths);
    const share = (key: "damage" | "taken" | "objectives" | "vision", column: number): [number, number] | null => {
      const total = team.reduce((s, p) => s + p[key], 0);
      if (!total) return null;
      const fact = me[key] / total;
      return [fact, unit((fact - (TYPICAL[lane][column] ?? 0.2)) / (SHARE_SCALE[column] ?? 0.1))];
    };
    const opponent =
      me.role && seats.filter((p) => p.role === me.role).length === 2
        ? seats.find((p) => p.team !== me.team && p.role === me.role)
        : undefined;
    const lead = (key: "cs" | "gold", scale: number): [number, number] | null =>
      opponent ? [me[key] - opponent[key], unit((me[key] - opponent[key]) / minutes / scale)] : null;
    const parts: Array<[number, number] | null> = [
      teamKills ? [kpOf(me), unit((kpOf(me) - team.reduce((s, p) => s + kpOf(p), 0) / 5 - KP_OFFSET[lane]) / 0.25)] : null,
      [kda, unit(Math.log2(Math.max(kda, 0.25) / Math.max(lobby, 0.25)) / 2)],
      share("damage", 0),
      share("taken", 1),
      share("objectives", 2),
      share("vision", 3),
      lead("cs", 1.5),
      lead("gold", 100),
    ];
    const weights = WEIGHTS[lane];
    const used = parts.flatMap((part, k) => (part && (weights[k] ?? 0) > 0 ? [{ k, part }] : []));
    const total = used.reduce((s, u) => s + (weights[u.k] ?? 0), 0);
    const points = used.map((u) => ({ ...u, points: (5 * (weights[u.k] ?? 0) * u.part[1]) / total }));
    const score = Math.max(0, Math.min(10, 5 + points.reduce((s, p) => s + p.points, 0)));
    points.sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || a.k - b.k);
    const shown = points.length > 2 && Math.abs(points[2]?.points ?? 0) >= 0.15 ? 3 : 2;
    const factors = points.slice(0, shown).map((p) => ({
      kind: KINDS[p.k] as GradeFactorKind,
      value: p.k === 1 ? Math.round(p.part[0] * 100) / 100 : p.k >= 6 ? p.part[0] : Math.round(p.part[0] * 1000) / 1000,
      points: Math.round(p.points * 100) / 100,
    }));
    return { score, factors };
  });
  const order = seats.map((_, i) => i).sort((a, b) => (scored[b]?.score ?? 0) - (scored[a]?.score ?? 0) || a - b);
  const best = (win: boolean) => order.find((i) => seats[i]?.win === win);
  const [mvp, ace] = [best(true), best(false)];
  return scored.map((s, i) => {
    const shown = Math.round(s.score * 10) / 10;
    return {
      score: shown,
      letter: letter(shown),
      place: order.indexOf(i) + 1,
      badge: i === mvp ? "mvp" : i === ace ? "ace" : null,
      factors: s.factors,
    };
  });
}

// ── The other nine ──────────────────────────────────────────────────────────────────────────

/** A small random generator seeded by the match id: the same game on every run. */
function random(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const CHAMPIONS: Record<Role, number[]> = {
  top: [54, 39, 516, 24, 122, 266],
  jungle: [64, 104, 234, 11, 121, 254],
  middle: [238, 134, 61, 7, 517, 103],
  bottom: [222, 51, 67, 81, 145, 236],
  support: [412, 89, 53, 117, 267, 99],
};
const NAMES = [
  "Treeline Tom#EUW",
  "Quiet Storm#0412",
  "Lane Kingdom#EUW",
  "Wardwalker#FR1",
  "Zed Is Life#1v9",
  "Crit Happens#ADC",
  "Hook City#BLTZ",
  "Mid Or Feed#GG",
  "Baron Pit Bull#NA1",
  "Tower Hugger#EUW",
  "Flash Forward#F4",
  "Minion Whisperer#CS",
];
const ITEMS: Record<Role, number[]> = {
  top: [3078, 3047, 3053, 3071, 6333, 3075],
  jungle: [6610, 3111, 3071, 3053, 3161, 3065],
  middle: [6655, 3020, 4645, 3157, 3089, 3135],
  bottom: [6672, 3006, 3031, 3094, 3036, 3046],
  support: [3870, 3158, 3190, 3107, 3222, 3116],
};
const SPELLS: Record<Role, [number, number]> = { top: [12, 4], jungle: [11, 4], middle: [14, 4], bottom: [7, 4], support: [3, 4] };
const RUNES: Record<Role, [number, number]> = {
  top: [8010, 8400],
  jungle: [8112, 8000],
  middle: [8112, 8300],
  bottom: [8008, 8200],
  support: [8439, 8300],
};
/** Per minute: CS, gold, damage to champions, damage taken, vision, objectives. */
const PACE: Record<Role, number[]> = {
  top: [7, 390, 720, 1150, 0.8, 280],
  jungle: [5.8, 380, 560, 1050, 1.1, 520],
  middle: [7.8, 420, 880, 760, 0.8, 200],
  bottom: [8.2, 430, 920, 640, 0.9, 360],
  support: [1.2, 260, 300, 880, 2.6, 60],
};

function riotId(text: string): RiotId {
  const [gameName = text, tagLine = ""] = text.split("#");
  return { gameName, tagLine };
}

/** The whole game behind `match`, `owner`'s row; `extreme` fills every slot with the longest names and biggest numbers. */
export function gameFor(match: MatchSummary, owner: RiotId, extreme = false): MatchDetails {
  const next = random(match.matchId);
  // Howling Abyss (ARAM, ARAM: Mayhem): no roles, no wards (everyone's vision score is 0).
  const aram = onHowlingAbyss(match.queueId);
  const minutes = match.durationSeconds / 60;
  const ownerRole: Role = match.role ?? "middle";
  const names = [...NAMES].sort(() => next() - 0.5);
  const lines: Array<{ seat: Seat; player: MatchPlayer }> = [];
  for (const team of [100, 200]) {
    const won = team === 100 ? match.win : !match.win;
    for (const role of ROLES) {
      const mine = team === 100 && role === ownerRole;
      const pace = PACE[role];
      const at = (k: number) => (pace[k] ?? 0) * minutes * (0.8 + next() * 0.45) * (won ? 1.1 : 0.92);
      const champion = mine
        ? match.championId
        : (CHAMPIONS[role].filter((id) => id !== match.championId)[Math.floor(next() * 5)] ?? CHAMPIONS[role][0] ?? 1);
      const kills = mine ? match.kills : Math.round((role === "support" ? 1 : won ? 6 : 3) * (0.4 + next()));
      const deaths = mine ? match.deaths : Math.round((won ? 3 : 6) * (0.4 + next()));
      const assists = mine ? match.assists : Math.round((role === "support" ? 14 : won ? 8 : 5) * (0.5 + next()));
      const hidden = !mine && !extreme && team === 200 && role === "jungle" && next() < 0.5;
      const seat: Seat = {
        team,
        win: won,
        role: aram ? null : role,
        kills: extreme ? kills * 3 + 20 : kills,
        deaths: extreme ? deaths * 2 + 10 : deaths,
        assists: extreme ? assists * 3 + 30 : assists,
        cs: mine ? match.creepScore : Math.round(at(0) * (extreme ? 2 : 1)),
        gold: Math.round(at(1) * (extreme ? 2.2 : 1)),
        damage: Math.round(at(2) * (extreme ? 4 : 1)) + (mine ? match.kills * 900 : 0),
        taken: Math.round(at(3)),
        vision: aram ? 0 : Math.round(at(4) * (extreme ? 3 : 1)),
        objectives: Math.round(at(5)),
      };
      const items = mine ? match.items : ITEMS[role].slice(0, extreme ? 6 : 3 + Math.floor(minutes / 12));
      lines.push({
        seat,
        player: {
          riotId: extreme
            ? { gameName: "WWWWWWWWWWWWWWWW", tagLine: "WWWWW" }
            : mine
              ? owner
              : hidden
                ? null
                : riotId(names.pop() ?? "Player#EUW"),
          hidden,
          isMe: mine,
          championId: champion,
          championLevel: extreme ? 18 : Math.min(18, Math.round(minutes / 2 + next() * 3)),
          role: seat.role,
          kills: seat.kills,
          deaths: seat.deaths,
          assists: seat.assists,
          creepScore: seat.cs,
          gold: seat.gold,
          damageToChampions: seat.damage,
          visionScore: seat.vision,
          items,
          trinket: role === "support" ? 3364 : 3340,
          spells: aram ? [4, 32] : SPELLS[role],
          keystone: RUNES[role][0],
          secondaryTree: RUNES[role][1],
          grade: null,
        },
      });
    }
  }
  const grades = grade(
    lines.map((l) => l.seat),
    match.durationSeconds,
  );
  lines.forEach((line, i) => {
    // A row that came with its grade (a captured profile's, from the backend) keeps it.
    line.player.grade = (line.player.isMe ? match.grade : null) ?? grades?.[i] ?? null;
  });
  return {
    matchId: match.matchId,
    queueId: match.queueId,
    durationSeconds: match.durationSeconds,
    endedAt: match.endedAt,
    teams: [100, 200].map((teamId, t) => ({
      teamId,
      win: teamId === 100 ? match.win : !match.win,
      players: lines.slice(t * 5, t * 5 + 5).map((l) => l.player),
    })),
  };
}

const ownerLine = (game: MatchDetails) => game.teams.flatMap((t) => t.players).find((p) => p.isMe);
const ownerGrade = (game: MatchDetails) => ownerLine(game)?.grade ?? null;

function lookup(profiles: readonly PlayerProfile[], matchId: string): { match: MatchSummary; owner: RiotId } | undefined {
  for (const p of profiles) {
    const match = p.recentMatches.find((m) => m.matchId === matchId);
    if (match) return { match, owner: p.riotId };
  }
  return undefined;
}

/** `match_details` answering for the games of `profiles`. */
export function detailsFrom(profiles: readonly PlayerProfile[], extreme = false): (args: { matchId: string }) => MatchDetails {
  return ({ matchId }) => {
    const found = lookup(profiles, matchId);
    if (!found) throw new CommandError("match_details", "not found", { kind: "notFound" });
    return gameFor(found.match, found.owner, extreme);
  };
}

/** `match_grades` answering for the games of `profiles`: your grade and the role you played. */
export function gradesFrom(profiles: readonly PlayerProfile[], extreme = false): (args: { matchIds: string[] }) => GradedMatch[] {
  return ({ matchIds }) =>
    matchIds.map((matchId) => {
      const found = lookup(profiles, matchId);
      const mine = found && ownerLine(gameFor(found.match, found.owner, extreme));
      return { matchId, grade: mine?.grade ?? null, role: mine?.role ?? null };
    });
}

/** A profile as the backend answers it: every game with its grade. */
export function withGrades(profile: PlayerProfile): PlayerProfile {
  return {
    ...profile,
    recentMatches: profile.recentMatches.map((m) => ({ ...m, grade: ownerGrade(gameFor(m, profile.riotId)) })),
  };
}
