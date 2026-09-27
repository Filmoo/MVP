import type { MatchSummary } from "../generated/MatchSummary";
import type { PlayerProfile } from "../generated/PlayerProfile";

/** Reference "now" of every fixture: 2026-09-27 12:00 UTC. Tests freeze the clock here. */
export const FIXTURE_NOW = 1_790_510_400_000;

const MIN = 60_000;
const HOUR = 60 * MIN;

type MatchSeed = Omit<MatchSummary, "matchId" | "endedAt" | "queueId"> & {
  hoursAgo: number;
  queueId?: number;
};

// A mid-lane main's last games, hand-written to cover edge cases:
// perfect KDA, a stomp, a feed game, a remake-length game, off-role games.
const seeds: MatchSeed[] = [
  {
    hoursAgo: 1.2,
    championId: 103,
    role: "middle",
    win: true,
    kills: 9,
    deaths: 2,
    assists: 11,
    creepScore: 231,
    durationSeconds: 1_742,
    items: [6655, 3020, 4645, 3157, 3089],
  },
  {
    hoursAgo: 1.9,
    championId: 134,
    role: "middle",
    win: false,
    kills: 3,
    deaths: 6,
    assists: 5,
    creepScore: 198,
    durationSeconds: 1_935,
    items: [6655, 3020, 3157, 4645, 1056],
  },
  {
    hoursAgo: 2.7,
    championId: 893,
    role: "middle",
    win: true,
    kills: 14,
    deaths: 0,
    assists: 7,
    creepScore: 212,
    durationSeconds: 1_588,
    items: [4646, 3020, 4645, 3089],
  },
  {
    hoursAgo: 5.4,
    championId: 61,
    role: "middle",
    win: true,
    kills: 4,
    deaths: 3,
    assists: 18,
    creepScore: 267,
    durationSeconds: 2_112,
    items: [3118, 3020, 6653, 3157, 3089, 3135],
  },
  {
    hoursAgo: 6.1,
    championId: 517,
    role: "middle",
    win: false,
    kills: 0,
    deaths: 9,
    assists: 2,
    creepScore: 141,
    durationSeconds: 1_456,
    items: [2503, 3020, 1056],
  },
  {
    hoursAgo: 23.5,
    championId: 910,
    role: "middle",
    win: true,
    kills: 6,
    deaths: 4,
    assists: 21,
    creepScore: 244,
    durationSeconds: 2_388,
    items: [6655, 3020, 4628, 3089, 3135, 3157],
  },
  {
    hoursAgo: 24.2,
    championId: 103,
    role: "middle",
    win: false,
    kills: 5,
    deaths: 5,
    assists: 4,
    creepScore: 203,
    durationSeconds: 1_811,
    items: [6655, 3020, 4645, 3102],
  },
  {
    hoursAgo: 25.0,
    championId: 103,
    role: "middle",
    win: true,
    kills: 21,
    deaths: 2,
    assists: 9,
    creepScore: 256,
    durationSeconds: 1_967,
    items: [6655, 3020, 4645, 3089, 3135, 3157],
  },
  {
    hoursAgo: 49.3,
    championId: 99,
    role: "support",
    win: true,
    kills: 2,
    deaths: 1,
    assists: 24,
    creepScore: 38,
    durationSeconds: 1_699,
    items: [3870, 3020, 3165, 6653],
  },
  {
    hoursAgo: 50.1,
    championId: 134,
    role: "middle",
    win: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 12,
    durationSeconds: 211,
    items: [1056],
  },
  {
    hoursAgo: 51.0,
    championId: 163,
    role: "jungle",
    win: false,
    kills: 4,
    deaths: 7,
    assists: 8,
    creepScore: 172,
    durationSeconds: 2_034,
    items: [3137, 3020, 4645],
  },
  {
    hoursAgo: 72.8,
    championId: 893,
    role: "middle",
    win: true,
    kills: 8,
    deaths: 3,
    assists: 6,
    creepScore: 229,
    durationSeconds: 1_702,
    items: [4646, 3020, 4645, 3089],
  },
];

export function matchesFromSeeds(list: MatchSeed[], idPrefix = "EUW1_75102"): MatchSummary[] {
  return list.map(({ hoursAgo, queueId = 420, ...rest }, i) => ({
    ...rest,
    queueId,
    matchId: `${idPrefix}${String(40_000 + i).padStart(5, "0")}`,
    endedAt: FIXTURE_NOW - Math.round(hoursAgo * HOUR),
  }));
}

export const profile: PlayerProfile = {
  riotId: { gameName: "Nightfall", tagLine: "EUW" },
  region: "EUW",
  level: 347,
  profileIconId: 6311,
  soloQueue: {
    tier: "emerald",
    division: "II",
    leaguePoints: 67,
    wins: 142,
    losses: 128,
  },
  recentMatches: matchesFromSeeds(seeds),
};

export const newPlayerProfile: PlayerProfile = {
  riotId: { gameName: "FreshStart", tagLine: "1234" },
  region: "EUW",
  level: 31,
  profileIconId: 29,
  soloQueue: null,
  recentMatches: [],
};

/** Worst-case strings and numbers: layout must hold without overflow. */
export const extremeProfile: PlayerProfile = {
  riotId: { gameName: "WWWWWWWWWWWWWWWW", tagLine: "WWWWW" },
  region: "EUNE",
  level: 2_847,
  profileIconId: 4568,
  soloQueue: {
    tier: "challenger",
    division: null,
    leaguePoints: 2_487,
    wins: 1_988,
    losses: 1_502,
  },
  recentMatches: matchesFromSeeds(
    seeds.map((s) => ({
      ...s,
      kills: s.kills * 3,
      assists: s.assists * 3,
      creepScore: s.creepScore * 2,
      durationSeconds: s.durationSeconds + 1_500,
    })),
  ),
};

/** A payload the matches panel can't render (items: null): only that widget may fail. */
export const corruptProfile: PlayerProfile = {
  ...profile,
  recentMatches: profile.recentMatches.map((m, i) => (i === 2 ? { ...m, items: null as unknown as number[] } : m)),
};
