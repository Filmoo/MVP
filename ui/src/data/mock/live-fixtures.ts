import { platformLabel } from "../../lib/riot-id";
import type { BackendError } from "../generated/BackendError";
import type { ChampionRecord } from "../generated/ChampionRecord";
import type { LiveGame } from "../generated/LiveGame";
import type { LivePlayer } from "../generated/LivePlayer";
import type { PlayerProfile } from "../generated/PlayerProfile";
import type { RankedEntry } from "../generated/RankedEntry";
import type { RiotId } from "../generated/RiotId";
import type { Role } from "../generated/Role";
import type { ScoutCard } from "../generated/ScoutCard";
import type { ScoutTag } from "../generated/ScoutTag";
import { CommandError } from "../transport";
import { matchesFromSeeds, profile } from "./fixtures";

// ── Player lookups (search bar, player pages) ──────────────────────────────────────────────

const top = (championId: number, hoursAgo: number, win: boolean, k: number, d: number, a: number) => ({
  hoursAgo,
  championId,
  role: "top" as Role,
  win,
  kills: k,
  deaths: d,
  assists: a,
  creepScore: 190 + k * 6,
  durationSeconds: 1_600 + d * 60,
  items: [3078, 3047, 3074, 6333, 3053],
});

/** Another player: a Camille main, top lane. */
export const otherProfile: PlayerProfile = {
  riotId: { gameName: "Blade Dancer", tagLine: "IRE" },
  region: "EUW",
  level: 512,
  profileIconId: 588,
  soloQueue: { tier: "master", division: null, leaguePoints: 214, wins: 301, losses: 262 },
  recentMatches: matchesFromSeeds(
    [
      top(164, 0.8, true, 8, 3, 4),
      top(164, 1.6, true, 11, 2, 6),
      top(164, 2.5, false, 3, 5, 2),
      top(24, 4.2, true, 7, 4, 5),
      top(164, 22.0, true, 6, 1, 9),
      top(164, 23.1, false, 2, 6, 3),
      top(897, 26.4, true, 5, 3, 10),
      top(164, 47.9, true, 9, 4, 3),
      top(24, 49.2, false, 4, 7, 2),
      top(164, 50.5, true, 12, 2, 5),
    ],
    "EUW1_75208",
  ),
};

function fail(message: string, detail: BackendError): never {
  throw new CommandError("search_player", message, detail);
}

/**
 * The backend, played by names: `Nobody` isn't found, `Busy` is rate limited, `Offline` can't
 * be reached, `Down` is unavailable; `Fillmo#7272` is the rich fixture, anyone else a Camille main.
 */
export function searchPlayer(args: { riotId: RiotId; platform: string }): PlayerProfile {
  const name = args.riotId.gameName.toLowerCase();
  if (name === "nobody") fail("not found", { kind: "notFound" });
  if (name === "busy") fail("rate limited, retry after 12 s", { kind: "rateLimited", retryAfter: 12 });
  if (name === "offline") fail("backend unreachable: couldn't connect", { kind: "network", message: "couldn't connect" });
  if (name === "down") fail("service unavailable", { kind: "unavailable", message: "the server has no Riot API key" });
  const region = platformLabel(args.platform);
  if (name === "fillmo" && args.riotId.tagLine === "7272") return { ...profile, region };
  return { ...otherProfile, riotId: args.riotId, region };
}

// ── Loading-screen scouting ─────────────────────────────────────────────────────────────────

const rank = (tier: RankedEntry["tier"], division: RankedEntry["division"], lp: number, wins: number, losses: number): RankedEntry => ({
  tier,
  division,
  leaguePoints: lp,
  wins,
  losses,
});

const record = (championId: number, games: number, wins: number, kda = 2.8): ChampionRecord => ({
  championId,
  games,
  wins,
  kills: Math.round(games * 5),
  deaths: Math.round(games * 4),
  assists: Math.round(games * 6),
  kda,
});

/** `W`/`L` string, newest first. */
const form = (results: string) => [...results].map((r) => r === "W");

function card(
  puuid: string,
  riotId: RiotId,
  soloQueue: RankedEntry | null,
  topChampions: ChampionRecord[],
  results: string,
  mainRoles: Role[],
  tags: ScoutTag[] = [],
): ScoutCard {
  return { puuid, riotId, soloQueue, gamesSampled: 20, topChampions, recentResults: form(results), mainRoles, tags };
}

function seat(
  championId: number,
  spells: [number, number],
  role: Role,
  riotId: RiotId | null,
  scout: ScoutCard | null,
  isMe = false,
): LivePlayer {
  return { championId, spells, role, isMe, hidden: false, riotId, card: scout };
}

const id = (gameName: string, tagLine: string): RiotId => ({ gameName, tagLine });

const FLASH = 4;
const TELEPORT = 12;
const SMITE = 11;
const IGNITE = 14;
const HEAL = 7;
const BARRIER = 21;

const me = id("Fillmo", "7272");

/** A ranked game on the loading screen, every card in: rich, unranked, hidden and card-less players. */
export const liveGame: LiveGame = {
  gameId: 7_100_000_001,
  queueId: 420,
  platform: "euw1",
  scouting: { state: "done" },
  allies: [
    seat(
      54,
      [FLASH, TELEPORT],
      "top",
      me,
      card("p1", me, rank("emerald", "II", 67, 142, 128), [record(54, 6, 4), record(103, 5, 3)], "WWLWLWWLWW", ["top", "middle"]),
      true,
    ),
    seat(
      64,
      [SMITE, FLASH],
      "jungle",
      id("Treeline Tom", "EUW"),
      card(
        "p2",
        id("Treeline Tom", "EUW"),
        rank("diamond", "IV", 12, 88, 71),
        [record(64, 14, 9, 3.4)],
        "WWWWWLWLLW",
        ["jungle"],
        [
          { kind: "mainRole", role: "jungle" },
          { kind: "hotStreak", wins: 5 },
        ],
      ),
    ),
    seat(
      103,
      [FLASH, IGNITE],
      "middle",
      id("Quiet Storm", "0412"),
      card(
        "p3",
        id("Quiet Storm", "0412"),
        rank("emerald", "I", 88, 170, 142),
        [record(103, 17, 10, 3.9), record(517, 2, 1)],
        "WLWWLWLWWL",
        ["middle"],
        [
          { kind: "otp", championId: 103, share: 0.85 },
          { kind: "veteran", games: 312 },
        ],
      ),
    ),
    seat(
      222,
      [FLASH, HEAL],
      "bottom",
      id("Lane Kingdom", "EUW"),
      card("p4", id("Lane Kingdom", "EUW"), rank("platinum", "II", 45, 61, 66), [record(51, 8, 3), record(81, 6, 3)], "LLWLWWLLWL", [
        "bottom",
      ]),
    ),
    seat(412, [FLASH, IGNITE], "support", id("Wardwalker", "FR1"), {
      ...card("p5", id("Wardwalker", "FR1"), null, [record(412, 3, 2)], "WLW", ["support"]),
      gamesSampled: 3,
    }),
  ],
  enemies: [
    seat(
      39,
      [TELEPORT, FLASH],
      "top",
      id("Blade Dancer", "IRE"),
      card(
        "e1",
        id("Blade Dancer", "IRE"),
        rank("master", null, 214, 301, 262),
        [record(39, 18, 12, 3.1)],
        "WWLWWWLWLW",
        ["top"],
        [
          { kind: "otp", championId: 39, share: 0.9 },
          { kind: "veteran", games: 540 },
        ],
      ),
    ),
    { championId: 234, spells: [SMITE, FLASH], role: "jungle", isMe: false, hidden: true, riotId: null, card: null },
    seat(
      910,
      [FLASH, IGNITE],
      "middle",
      id("Zed Is Life", "1v9"),
      card("e3", id("Zed Is Life", "1v9"), rank("emerald", "III", 30, 97, 99), [record(910, 5, 2), record(238, 9, 5)], "LWLLWLWWLL", [
        "middle",
      ]),
    ),
    seat(51, [FLASH, BARRIER], "bottom", id("Crit Happens", "ADC"), null),
    seat(
      53,
      [FLASH, IGNITE],
      "support",
      id("Hook City", "BLTZ"),
      card(
        "e5",
        id("Hook City", "BLTZ"),
        rank("diamond", "II", 55, 120, 98),
        [record(53, 9, 7, 4.2)],
        "WWWWLWLWWW",
        ["support"],
        [
          { kind: "mainRole", role: "support" },
          { kind: "hotStreak", wins: 4 },
        ],
      ),
    ),
  ],
};

/** Just loaded: the client says who is where, the cards are on their way. */
export const liveScouting: LiveGame = {
  ...liveGame,
  scouting: { state: "loading" },
  allies: liveGame.allies.map((p) => ({ ...p, card: null })),
  enemies: liveGame.enemies.map((p) => ({ ...p, card: null })),
};

/** The backend couldn't be reached: names and champions only. */
export const liveFailed: LiveGame = {
  ...liveScouting,
  scouting: { state: "failed", error: { kind: "network", message: "couldn't connect" } },
};

/** Longest names, apex ranks, every tag at once: cards must hold. */
export const liveExtreme: LiveGame = {
  ...liveGame,
  queueId: 440,
  platform: "eun1",
  allies: liveGame.allies.map((p, i) => ({
    ...p,
    riotId: id("WWWWWWWWWWWWWWWW", "WWWWW"),
    card: p.card && {
      ...p.card,
      riotId: id("WWWWWWWWWWWWWWWW", "WWWWW"),
      soloQueue: rank("grandmaster", null, 1_487 + i, 1_988, 1_502),
      topChampions: [record(p.championId ?? 1, 188, 120)],
      tags: [
        { kind: "otp", championId: p.championId ?? 1, share: 0.95 },
        { kind: "hotStreak", wins: 12 },
        { kind: "veteran", games: 1_240 },
      ],
      recentResults: form("WWWWWWWWWW"),
    },
  })),
};
