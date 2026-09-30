/**
 * Synthetic published stats (stats_index, tier_list, champion_stats) for the mock transport:
 * deterministic, generated from a small table of champion ids (numbers only, names come from
 * game data), shaped like the real files: a few hundred thousand games, 45–55 % win rates,
 * long-tail pick rates, builds with a tail of rare options, shrunk matchup effects.
 */
import type { Bracket } from "../generated/Bracket";
import type { BuildSection } from "../generated/BuildSection";
import type { BuildStats } from "../generated/BuildStats";
import type { ChampionPage } from "../generated/ChampionPage";
import type { ChampionStats } from "../generated/ChampionStats";
import type { DataSetInfo } from "../generated/DataSetInfo";
import type { MatchupEntry } from "../generated/MatchupEntry";
import type { MatchupsFile } from "../generated/MatchupsFile";
import type { Role } from "../generated/Role";
import type { RoleMatchups } from "../generated/RoleMatchups";
import type { StatsIndex } from "../generated/StatsIndex";
import type { TierEntry } from "../generated/TierEntry";
import type { TierGrade } from "../generated/TierGrade";
import type { TierList } from "../generated/TierList";
import { FIXTURE_NOW } from "./fixtures";

type Queue = 420 | 450;
/** Build class: Mage, AD Assassin, Fighter, Tank, marKsman, Enchanter, AP fighter/assassin. */
type Cls = "M" | "A" | "F" | "T" | "K" | "E" | "P";

const HOUR = 3_600_000;
export const STATS_UPDATED_AT = FIXTURE_NOW - 2 * HOUR;
export const STATS_PATCH = "16.19";
export const PREVIOUS_PATCH = "16.18";

/**
 * `id:roles` + popularity (0–5) + class. Roles most played first (t/j/m/b/s). Popularity 0 =
 * released this patch, no games yet (its page shows that state).
 */
const TABLE =
  "1:ms2M 2:jt2F 3:ms3P 4:m3M 5:j3F 6:t2F 7:m3M 8:mt3P 9:j2P 10:tm2P 11:j3K 12:s3T 13:mt2M 14:t2T 15:b2K 16:s3E 17:t3P " +
  "18:bm3K 19:jt2F 20:j2T 21:b4K 22:bs4K 23:t2F 24:tj4F 25:sj3M 26:sm2E 27:t1T 28:j2P 29:bj2K 30:jm2M 31:tm2T 32:js3T " +
  "33:j2T 34:m2M 35:js2A 36:tj2T 37:s2E 38:m3M 39:tm3F 40:s3E 41:t2F 42:m2K 43:sm3E 44:s1T 45:mb2M 48:tj1F 50:smb2M " +
  "51:b5K 53:s3T 54:ts3T 55:m3P 56:j2F 57:sjt2T 58:t3F 59:j3F 60:j2P 61:m3M 62:jt2F 63:sj2M 64:j5F 67:bt4K 68:t2P " +
  "69:m2M 72:jt1T 74:mst1M 75:t2F 76:j2P 77:jt1F 78:jts2T 79:jt2P 80:stm2A 81:b5K 82:t3P 83:t2F 84:mt4P 85:t1P 86:t3F " +
  "89:s3T 90:m2M 91:jm2A 92:t3F 96:b2K 98:ts2T 99:sm4M 101:sm2M 102:j1F 103:m5M 104:j3A 105:m2P 106:jt2F 107:jt2A " +
  "110:bm3K 111:s4T 112:m3M 113:j2T 114:t3F 115:bm2M 117:s3E 119:b2K 120:j2F 121:j3A 122:t3F 126:tm2A 127:m1M 131:jm3P " +
  "133:t1A 134:m3M 136:m2M 141:j4A 142:m2M 143:s2M 145:b5K 147:sb2E 150:t2F 154:j2T 157:mtb4K 161:sm1M 163:jm2M 164:t2F " +
  "166:m2A 200:j2F 201:s2T 202:b4K 203:j1K 221:b2K 222:b4K 223:st2T 233:j2F 234:j4F 235:sb3K 236:bm3K 238:m4A 240:t1F " +
  "245:jm3P 246:mj1A 254:j3F 266:t3F 267:s3E 268:m2M 350:s2E 360:b3K 412:s5T 420:t2F 421:j1F 427:j1E 429:b1K 432:s2E " +
  "497:s2T 498:b2K 516:t2T 517:mjt3P 518:sm2M 523:b2K 526:s2T 555:s3A 711:m2M 777:mt4K 799:t3F 800:ms3M 804:b2K 805:mj2P " +
  "875:ts3F 876:j2P 887:t2P 888:s1E 893:mt3M 895:b1K 897:t2T 901:bm3K 902:s3E 904:tj0F 910:ms2M 950:m2A";

const ROLE_CODES: Record<string, Role> = { t: "top", j: "jungle", m: "middle", b: "bottom", s: "support" };

export interface ChampionSeed {
  id: number;
  roles: Role[];
  popularity: number;
  cls: Cls;
}

export const CHAMPION_SEEDS: readonly ChampionSeed[] = TABLE.split(" ").map((entry) => {
  const m = /^(\d+):([tjmbs]+)(\d)([MAFTKEP])$/.exec(entry);
  if (!m) throw new Error(`bad champion seed ${entry}`);
  const [, id = "", roles = "", popularity = "", cls = ""] = m;
  return { id: Number(id), roles: [...roles].map((r) => ROLE_CODES[r] as Role), popularity: Number(popularity), cls: cls as Cls };
});

const SEED_BY_ID = new Map(CHAMPION_SEEDS.map((c) => [c.id, c]));

// ——— Deterministic randomness ———

function hash(text: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** mulberry32 seeded from a string. */
function random(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gauss(next: () => number): number {
  const u = Math.max(next(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Wins out of `g` games at win rate `p`, with binomial-sized noise. */
function wins(g: number, p: number, next: () => number): number {
  return clamp(Math.round(g * p + gauss(next) * Math.sqrt(g * p * (1 - p))), 0, g);
}

// ——— Data sets ———

export const DATASET_GAMES: Record<Queue, Record<Bracket, number>> = {
  420: { emeraldPlus: 412_380, diamondPlus: 118_940, masterPlus: 21_470 },
  450: { emeraldPlus: 186_210, diamondPlus: 52_870, masterPlus: 9_630 },
};

const POPULARITY = [0, 0.25, 0.55, 1, 1.9, 3.4];
const ROLE_SHARES: Record<number, number[]> = { 1: [1], 2: [0.84, 0.16], 3: [0.72, 0.2, 0.08] };
/** Published thresholds (crates/aggregate `Options`). */
const MIN_ROLE_GAMES = 50;
const MIN_PICK_RATE = 0.005;
const MIN_PAIR_GAMES = 10;
const BASE_PRIOR_GAMES = 1_000;

interface Slot {
  id: number;
  role: Role | undefined;
  g: number;
  w: number;
  /** True win rate (0–1) the record was drawn from. */
  p: number;
  prev: { g: number; w: number };
}

interface Dataset {
  info: DataSetInfo;
  /** Per champion, most played role first. */
  slots: Map<number, Slot[]>;
  bans: Map<number, number>;
  /** Games per role across champions (ranked), for pair sizes. */
  byRole: Map<Role, Slot[]>;
}

function info(queue: Queue, bracket: Bracket): DataSetInfo {
  return { schema: 1, patch: STATS_PATCH, queue, bracket, games: DATASET_GAMES[queue][bracket], updatedAt: STATS_UPDATED_AT };
}

const datasets = new Map<string, Dataset>();

function dataset(queue: Queue, bracket: Bracket): Dataset {
  const key = `${queue}/${bracket}`;
  const cached = datasets.get(key);
  if (cached) return cached;
  const games = DATASET_GAMES[queue][bracket];
  const live = CHAMPION_SEEDS.filter((c) => c.popularity > 0);
  const slots = new Map<number, Slot[]>();
  const bans = new Map<number, number>();

  const draw = (c: ChampionSeed, role: Role | undefined, g: number, index: number) => {
    const next = random(`${key}/${c.id}/${role ?? "aram"}`);
    // Win rate in points around 50: ARAM spreads wider; off-roles play a little worse.
    const strength = queue === 450 ? gauss(random(`aram/${c.id}`)) * 1.9 : gauss(random(`str/${c.id}/${role}`)) * 1.5 - index * 0.8;
    const p = 0.5 + clamp(strength + gauss(next) * 0.5, -4.5, 4.5) / 100;
    const prevG = Math.round(g * (0.9 + 0.2 * next()));
    return { id: c.id, role, g, w: wins(g, p, next), p, prev: { g: prevG, w: wins(prevG, p - 0.003, next) } };
  };

  if (queue === 450) {
    const weight = (c: ChampionSeed) =>
      (0.55 + (0.45 * (POPULARITY[c.popularity] ?? 1)) / 3.4) * Math.exp(0.2 * gauss(random(`${key}/w/${c.id}`)));
    const total = live.reduce((sum, c) => sum + weight(c), 0);
    for (const c of live) slots.set(c.id, [draw(c, undefined, Math.round((10 * games * weight(c)) / total), 0)]);
  } else {
    const weights = new Map<string, number>();
    const totals = new Map<Role, number>();
    for (const c of live) {
      const shares = ROLE_SHARES[c.roles.length] ?? [1];
      const jitter = Math.exp(0.25 * gauss(random(`${key}/w/${c.id}`)));
      c.roles.forEach((role, i) => {
        const w = (POPULARITY[c.popularity] ?? 1) * (shares[i] ?? 0) * jitter;
        weights.set(`${c.id}/${role}`, w);
        totals.set(role, (totals.get(role) ?? 0) + w);
      });
    }
    for (const c of live) {
      const own = c.roles.map((role, i) =>
        draw(c, role, Math.round((2 * games * (weights.get(`${c.id}/${role}`) ?? 0)) / (totals.get(role) ?? 1)), i),
      );
      slots.set(
        c.id,
        own.sort((a, b) => b.g - a.g),
      );
      const main = own[0];
      const next = random(`${key}/bans/${c.id}`);
      // Popular and strong champions get banned: a long tail from 0.2 % to about 40 %.
      const rate = clamp(
        0.002 +
          0.12 * ((POPULARITY[c.popularity] ?? 1) / 3.4) ** 1.5 * Math.exp(0.55 * gauss(next)) +
          Math.max(0, (main?.p ?? 0.5) - 0.5) * 4,
        0,
        0.48,
      );
      bans.set(c.id, Math.round(rate * games));
    }
  }

  const byRole = new Map<Role, Slot[]>();
  for (const list of slots.values()) {
    for (const s of list) {
      if (!s.role) continue;
      byRole.set(s.role, [...(byRole.get(s.role) ?? []), s]);
    }
  }
  const made = { info: info(queue, bracket), slots, bans, byRole };
  datasets.set(key, made);
  return made;
}

/** Base win rate shrunk toward 50 % (as the aggregator does). */
function shrunk(s: { g: number; w: number }): number {
  return (s.w + BASE_PRIOR_GAMES * 0.5) / (s.g + BASE_PRIOR_GAMES);
}

function grade(score: number): TierGrade {
  if (score >= 2) return "S";
  if (score >= 0.75) return "A";
  if (score >= -0.75) return "B";
  if (score >= -2) return "C";
  return "D";
}

/** A tier-list row of `record` (this patch's, or the previous one's for trends). */
function tierEntry(ds: Dataset, s: Slot, record: { g: number; w: number } = s): TierEntry | undefined {
  const games = ds.info.games;
  if (record.g < MIN_ROLE_GAMES || record.g / games < MIN_PICK_RATE) return undefined;
  const wr = shrunk(record);
  const score = round((wr - 0.5) * 100, 2);
  // Out of every game of the champion, in any role (as the aggregator counts it).
  const all = (ds.slots.get(s.id) ?? []).reduce((sum, own) => sum + (record === s ? own.g : own.prev.g), 0);
  return {
    id: s.id,
    ...(s.role ? { role: s.role, share: round(record.g / Math.max(1, all), 4) } : {}),
    tier: grade(score),
    score,
    g: record.g,
    w: record.w,
    winRate: round(wr, 4),
    pickRate: round(record.g / games, 4),
    // Bans moved a little since the previous patch (0.9 to 1.09 times this patch's).
    banRate: round(((ds.bans.get(s.id) ?? 0) * (record === s ? 1 : 0.9 + ((s.id * 7) % 20) / 100)) / games, 4),
  };
}

export function mockStatsIndex(): StatsIndex {
  const sets = (scale: number) =>
    ([420, 450] as const).flatMap((queue) =>
      (["emeraldPlus", "diamondPlus", "masterPlus"] as const).map((bracket) => ({
        queue,
        bracket,
        games: Math.round(DATASET_GAMES[queue][bracket] * scale),
      })),
    );
  return {
    schema: 1,
    current: STATS_PATCH,
    patches: [
      { patch: STATS_PATCH, name: "26.19", sets: sets(1), updatedAt: STATS_UPDATED_AT },
      { patch: PREVIOUS_PATCH, name: "26.18", sets: sets(1.84), updatedAt: STATS_UPDATED_AT - 13 * 24 * HOUR },
    ],
    updatedAt: STATS_UPDATED_AT,
  };
}

export function mockTierList(queue: Queue, bracket: Bracket): TierList {
  const ds = dataset(queue, bracket);
  const entries = [...ds.slots.values()]
    .flat()
    .map((s) => tierEntry(ds, s))
    .filter((e): e is TierEntry => e !== undefined)
    .sort((a, b) => b.score - a.score || b.g - a.g || a.id - b.id);
  return { info: ds.info, entries };
}

/** The previous patch's list (`previous_tier_list`), from each slot's record on that patch. */
export function mockPreviousTierList(queue: Queue, bracket: Bracket): TierList {
  const ds = dataset(queue, bracket);
  const entries = [...ds.slots.values()]
    .flat()
    .map((s) => tierEntry(ds, s, s.prev))
    .filter((e): e is TierEntry => e !== undefined)
    .sort((a, b) => b.score - a.score || b.g - a.g || a.id - b.id);
  return { info: { ...ds.info, patch: PREVIOUS_PATCH, updatedAt: ds.info.updatedAt - 13 * 24 * HOUR }, entries };
}

// ——— Builds ———

const SHARES = [0.44, 0.2, 0.12, 0.08, 0.05, 0.03];

/** Options most games first, each with a share of `n` and a win rate near `p`. */
function section(n: number, options: readonly number[][], p: number, next: () => number): BuildSection {
  const coverage = 0.9 + 0.07 * next();
  const weights = options.map((_, i) => (SHARES[i] ?? 0.02) * Math.exp(0.3 * gauss(next)));
  const total = weights.reduce((a, b) => a + b, 0);
  const top = options
    .map((ids, i) => {
      const g = Math.round((n * coverage * (weights[i] ?? 0)) / total);
      return { ids: [...ids], g, w: wins(g, clamp(p + gauss(next) * 0.012 - i * 0.002, 0.35, 0.65), next) };
    })
    .filter((o) => o.g > 0)
    .sort((a, b) => b.g - a.g);
  return { n, top };
}

/** Deterministic shuffle that keeps the head in front most of the time. */
function rotate<T>(items: readonly T[], by: number): T[] {
  const k = items.length === 0 ? 0 : by % items.length;
  return [...items.slice(k), ...items.slice(0, k)];
}

const PAGES: Record<Cls, number[][]> = {
  M: [
    [8100, 8200, 8112, 8139, 8140, 8106, 8226, 8210, 5008, 5008, 5001],
    [8200, 8300, 8229, 8226, 8210, 8237, 8345, 8347, 5008, 5008, 5011],
    [8300, 8200, 8369, 8304, 8345, 8347, 8226, 8210, 5008, 5008, 5011],
  ],
  A: [
    [8100, 8200, 8112, 8143, 8140, 8106, 8234, 8237, 5008, 5008, 5011],
    [8100, 8000, 8128, 8139, 8140, 8135, 9111, 8014, 5008, 5008, 5011],
    [8300, 8100, 8369, 8304, 8345, 8347, 8143, 8135, 5008, 5008, 5011],
  ],
  F: [
    [8000, 8400, 8010, 9111, 9104, 8299, 8444, 8242, 5005, 5008, 5011],
    [8400, 8300, 8437, 8446, 8444, 8451, 8304, 8347, 5008, 5008, 5011],
    [8200, 8000, 8230, 8224, 8234, 8236, 9111, 9104, 5005, 5010, 5011],
  ],
  T: [
    [8400, 8300, 8437, 8446, 8429, 8451, 8304, 8347, 5007, 5001, 5011],
    [8400, 8200, 8439, 8463, 8473, 8453, 8234, 8232, 5007, 5010, 5011],
    [8200, 8400, 8230, 8275, 8234, 8232, 8444, 8451, 5007, 5010, 5011],
  ],
  K: [
    [8000, 8100, 8008, 8009, 9104, 8017, 8139, 8135, 5005, 5008, 5011],
    [8000, 8300, 8021, 9111, 9104, 8014, 8345, 8347, 5005, 5008, 5011],
    [8000, 8400, 8005, 9111, 9103, 8014, 8444, 8242, 5005, 5008, 5011],
  ],
  E: [
    [8200, 8400, 8214, 8226, 8210, 8236, 8463, 8453, 5007, 5008, 5011],
    [8400, 8200, 8465, 8463, 8444, 8453, 8226, 8210, 5007, 5008, 5011],
    [8300, 8200, 8351, 8304, 8345, 8347, 8226, 8210, 5007, 5008, 5011],
  ],
  P: [
    [8100, 8200, 8112, 8143, 8140, 8106, 8234, 8237, 5008, 5008, 5011],
    [8000, 8400, 8010, 9111, 9105, 8299, 8444, 8242, 5008, 5008, 5011],
    [8200, 8100, 8230, 8226, 8234, 8237, 8139, 8135, 5008, 5010, 5011],
  ],
};

/** Tanks in the support role engage. */
const ENGAGE_PAGES = [
  [8400, 8300, 8439, 8463, 8473, 8242, 8345, 8347, 5007, 5010, 5011],
  [8300, 8400, 8351, 8306, 8345, 8347, 8463, 8473, 5007, 5010, 5011],
  [8400, 8100, 8465, 8446, 8444, 8242, 8126, 8105, 5007, 5010, 5011],
];

/** A page with one shard swapped (the usual minor variation). */
function withShard(page: readonly number[], slot: 8 | 9 | 10, shard: number): number[] {
  const copy = [...page];
  copy[slot] = shard;
  return copy;
}

interface Kit {
  starts: number[][];
  core: number[][];
  boots: number[];
  later: number[];
}

const KITS: Record<Cls, Kit> = {
  M: {
    starts: [
      [1056, 2003, 2003],
      [1082, 2003, 2003],
      [1056, 2003],
    ],
    core: [
      [6655, 4645, 3089],
      [2503, 4645, 3089],
      [6655, 3089, 4645],
      [3118, 4645, 3089],
      [6653, 3089, 3135],
    ],
    boots: [3020, 3158, 3111],
    later: [3157, 3135, 3089, 3102, 4646, 3137, 4645],
  },
  A: {
    starts: [
      [1055, 2003],
      [1036, 2003, 2003],
    ],
    core: [
      [3142, 6698, 6694],
      [6698, 3142, 3814],
      [6692, 6698, 6694],
      [3142, 6676, 6694],
    ],
    boots: [3158, 3047, 3111, 3006],
    later: [6694, 3814, 6333, 3036, 3179, 3026, 6676],
  },
  F: {
    starts: [
      [1055, 2003],
      [1054, 2003],
    ],
    core: [
      [3078, 6333, 3053],
      [6610, 3071, 3053],
      [3161, 3071, 6333],
      [3074, 6333, 3053],
      [2501, 3053, 6333],
    ],
    boots: [3047, 3111, 3006],
    later: [3053, 6333, 3026, 3065, 3071, 3742, 3181],
  },
  T: {
    starts: [
      [1054, 2003],
      [1055, 2003],
    ],
    core: [
      [3068, 2502, 3075],
      [6665, 3068, 4401],
      [3084, 2502, 3065],
      [3068, 3742, 6665],
    ],
    boots: [3047, 3111],
    later: [3075, 4401, 3143, 2504, 3065, 3742, 6665],
  },
  K: {
    starts: [[1055, 2003], [1083]],
    core: [
      [3032, 3031, 3094],
      [6672, 3031, 3046],
      [3032, 3031, 3036],
      [3153, 3124, 3085],
      [6672, 3094, 3031],
    ],
    boots: [3006, 3009],
    later: [3036, 3072, 3046, 3033, 6673, 3026, 3085, 6675],
  },
  E: {
    starts: [[2003, 2003, 3865]],
    core: [
      [6620, 3504, 6617],
      [6617, 6620, 3107],
      [2065, 3107, 3222],
      [4005, 6617, 3504],
    ],
    boots: [3158, 3009, 3020],
    later: [3222, 3107, 2065, 3504, 3050, 4005],
  },
  P: {
    starts: [
      [1056, 2003, 2003],
      [1054, 2003],
      [1082, 2003, 2003],
    ],
    core: [
      [4633, 6653, 3157],
      [3152, 4645, 3157],
      [6653, 3116, 3157],
      [3115, 4633, 3089],
      [4645, 3089, 3157],
    ],
    boots: [3020, 3047, 3111],
    later: [3157, 3089, 3135, 3102, 4645, 6653, 3065],
  },
};

const SUPPORT_START = [[2003, 2003, 3865]];
const SUPPORT_MAGE: Partial<Kit> = {
  core: [
    [6653, 3165, 3116],
    [6655, 4628, 3089],
    [6653, 3116, 3165],
  ],
  later: [3157, 3135, 3089, 3165, 3116, 4645],
};
const ENGAGE: Partial<Kit> = {
  core: [
    [3190, 3050, 3109],
    [2065, 3190, 3109],
    [8020, 3190, 3050],
  ],
  boots: [3047, 3111, 3009],
  later: [3109, 3050, 8020, 3075, 4401, 2504, 3222],
};
const JUNGLE_STARTS: Record<Cls, number[][]> = {
  M: [
    [1102, 2003],
    [1101, 2003],
  ],
  A: [
    [1101, 2003],
    [1102, 2003],
  ],
  F: [
    [1101, 2003],
    [1103, 2003],
  ],
  T: [
    [1103, 2003],
    [1101, 2003],
  ],
  K: [
    [1101, 2003],
    [1102, 2003],
  ],
  E: [
    [1102, 2003],
    [1103, 2003],
  ],
  P: [
    [1102, 2003],
    [1101, 2003],
    [1103, 2003],
  ],
};
const ARAM_STARTS: Record<Cls, number[][]> = {
  M: [
    [1052, 2003, 3070],
    [1052, 1082, 2003],
  ],
  A: [
    [1036, 1036, 2003],
    [1037, 2003],
  ],
  F: [
    [1036, 1036, 2003],
    [1037, 2003],
  ],
  T: [
    [1028, 1029, 2003],
    [1028, 2003, 2003],
  ],
  K: [
    [1036, 1042, 2003],
    [1042, 1042, 2003],
  ],
  E: [
    [1052, 2003, 3070],
    [1027, 1052, 2003],
  ],
  P: [
    [1052, 2003, 3070],
    [1052, 1082, 2003],
  ],
};

const SPELLS: Record<Role | "aram", number[][]> = {
  top: [
    [4, 12],
    [4, 14],
    [6, 12],
    [4, 6],
  ],
  jungle: [
    [4, 11],
    [6, 11],
    [11, 14],
  ],
  middle: [
    [4, 14],
    [4, 12],
    [4, 21],
    [4, 6],
  ],
  bottom: [
    [4, 7],
    [4, 21],
    [1, 4],
    [3, 4],
  ],
  support: [
    [4, 14],
    [3, 4],
    [4, 7],
    [4, 21],
  ],
  aram: [
    [4, 32],
    [6, 32],
    [4, 6],
    [4, 7],
    [3, 32],
    [1, 32],
  ],
};

const SKILL_ORDERS: Record<Cls, number[][]> = {
  M: [
    [1, 3, 2],
    [1, 2, 3],
  ],
  A: [
    [1, 3, 2],
    [1, 2, 3],
  ],
  F: [
    [1, 3, 2],
    [3, 1, 2],
  ],
  T: [
    [1, 3, 2],
    [2, 1, 3],
    [3, 1, 2],
  ],
  K: [
    [1, 2, 3],
    [1, 3, 2],
  ],
  E: [
    [3, 1, 2],
    [2, 1, 3],
  ],
  P: [
    [1, 3, 2],
    [1, 2, 3],
    [2, 1, 3],
  ],
};

function kitFor(c: ChampionSeed, role: Role | undefined, queue: Queue): Kit {
  const base = KITS[c.cls];
  if (queue === 450) return { ...base, starts: ARAM_STARTS[c.cls] };
  if (role === "support") {
    const special = c.cls === "M" ? SUPPORT_MAGE : c.cls === "T" ? ENGAGE : {};
    return { ...base, ...special, starts: SUPPORT_START };
  }
  if (role === "jungle") return { ...base, starts: JUNGLE_STARTS[c.cls] };
  // Enchanters played in a lane start like mages.
  return c.cls === "E" ? { ...base, starts: KITS.M.starts } : base;
}

/** The class's pages and their usual variations (one shard swapped), each page once. */
function pagesFor(c: ChampionSeed, role: Role | undefined): number[][] {
  const templates = role === "support" && c.cls === "T" ? ENGAGE_PAGES : PAGES[c.cls];
  // Mages in the support role lead with the comet page; a few champions pick their second page.
  const lead = (role === "support" && c.cls === "M") !== (c.id % 7 === 0) ? 1 : 0;
  const [a = [], b = [], d = []] = rotate(templates, lead);
  const candidates = [
    a,
    b,
    withShard(a, 10, a[10] === 5013 ? 5001 : 5013),
    d,
    withShard(b, 9, b[9] === 5010 ? 5008 : 5010),
    withShard(a, 8, a[8] === 5007 ? 5008 : 5007),
  ];
  const seen = new Set<string>();
  return candidates.filter((page) => {
    const key = page.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildStats(ds: Dataset, c: ChampionSeed, s: Slot, queue: Queue): BuildStats {
  const next = random(`${ds.info.queue}/${ds.info.bracket}/build/${c.id}/${s.role ?? "aram"}`);
  const kit = kitFor(c, s.role, queue);
  const timeline = Math.round(s.g * 0.93);
  const pages = pagesFor(c, s.role);
  const runes = section(s.g, pages, s.p, next);
  const keystones = new Map<number, { g: number; w: number }>();
  for (const o of runes.top) {
    const k = o.ids[2] ?? 0;
    const acc = keystones.get(k) ?? { g: 0, w: 0 };
    keystones.set(k, { g: acc.g + o.g, w: acc.w + o.w });
  }
  const orders = rotate(SKILL_ORDERS[c.cls], c.id % 5 === 0 ? 1 : 0);
  const [a = 1, b = 3, d = 2] = orders[0] ?? [];
  const core = rotate(kit.core, c.id % 3);
  const inCore = new Set(core[0]);
  const later = rotate(
    kit.later.filter((i) => !inCore.has(i)),
    c.id % 2,
  ).map((i) => [i]);
  const spells = s.role ? SPELLS[s.role] : SPELLS.aram;
  return {
    ...(s.role ? { role: s.role } : {}),
    g: s.g,
    w: s.w,
    runes,
    keystones: {
      n: s.g,
      top: [...keystones.entries()].map(([k, r]) => ({ ids: [k], g: r.g, w: r.w })).sort((x, y) => y.g - x.g),
    },
    spells: section(s.g, rotate(spells, c.id % 4 === 0 ? 1 : 0), s.p, next),
    skills: section(timeline, orders, s.p, next),
    skillStart: section(
      timeline,
      [
        [a, b, d, a],
        [a, d, b, a],
        [b, a, d, a],
      ],
      s.p,
      next,
    ),
    starts: section(
      timeline,
      kit.starts.map((ids) => [...ids].sort((x, y) => x - y)),
      s.p,
      next,
    ),
    core: section(Math.round(timeline * 0.78), core, s.p, next),
    boots: section(
      Math.round(timeline * 0.86),
      kit.boots.map((i) => [i]),
      s.p,
      next,
    ),
    item4: section(Math.round(timeline * 0.58), later.slice(0, 6), s.p + 0.01, next),
    item5: section(Math.round(timeline * 0.33), rotate(later, 1).slice(0, 6), s.p + 0.02, next),
    item6: section(Math.round(timeline * 0.12), rotate(later, 2).slice(0, 6), s.p + 0.03, next),
  };
}

// ——— Matchups ———

/** Lane opponents' roles: bottom and support also face the other half of the bot lane. */
function laneRoles(role: Role): Role[] {
  if (role === "bottom") return ["bottom", "support"];
  if (role === "support") return ["support", "bottom"];
  return [role];
}

function pairs(
  ds: Dataset,
  me: Slot,
  others: readonly Slot[],
  kind: string,
  spread: number,
  k: number,
  limit: number,
  ally: boolean,
): MatchupEntry[] {
  const games = ds.info.games;
  const list: MatchupEntry[] = [];
  for (const o of others) {
    if (o.id === me.id || !o.role) continue;
    const g = Math.round((me.g * o.g) / games);
    if (g < MIN_PAIR_GAMES) continue;
    const [lo, hi] = me.id < o.id ? [me, o] : [o, me];
    const effect =
      gauss(random(`${ds.info.queue}/${kind}/${lo.id}/${lo.role}/${hi.id}/${hi.role}`)) * spread * (ally || me === lo ? 1 : -1);
    const base = ally ? sigmoid(logit(shrunk(me)) + logit(shrunk(o))) : sigmoid(logit(shrunk(me)) - logit(shrunk(o)));
    const next = random(`${ds.info.bracket}/${kind}/${me.id}/${o.id}/${o.role}`);
    list.push({ id: o.id, role: o.role, g, w: wins(g, clamp(base + effect / 100, 0.3, 0.7), next), d: round((effect * g) / (g + k), 2) });
  }
  return list.sort((x, y) => y.g - x.g || x.id - y.id).slice(0, limit);
}

function roleMatchups(ds: Dataset, me: Slot & { role: Role }): RoleMatchups {
  const lane = laneRoles(me.role).flatMap((r) => ds.byRole.get(r) ?? []);
  const junglers = me.role === "jungle" ? [] : (ds.byRole.get("jungle") ?? []);
  const mates = (["top", "jungle", "middle", "bottom", "support"] as const)
    .filter((r) => r !== me.role)
    .flatMap((r) => ds.byRole.get(r) ?? []);
  return {
    role: me.role,
    g: me.g,
    w: me.w,
    lane: pairs(ds, me, lane, "lane", 2.2, 600, 30, false),
    jungle: pairs(ds, me, junglers, "jungle", 1.3, 900, 30, false),
    duos: pairs(ds, me, mates, "duo", 1.5, 800, 40, true),
  };
}

// ——— Champion pages ———

export function mockChampionPage(championId: number, queue: Queue, bracket: Bracket): ChampionPage {
  const ds = dataset(queue, bracket);
  const seed = SEED_BY_ID.get(championId);
  const own = ds.slots.get(championId) ?? [];
  if (!seed || own.length === 0) return { info: ds.info, stats: null, tiers: [], builds: null, matchups: null };
  const total = own.reduce((acc, s) => ({ g: acc.g + s.g, w: acc.w + s.w }), { g: 0, w: 0 });
  const stats: ChampionStats = {
    id: championId,
    g: total.g,
    w: total.w,
    bans: ds.bans.get(championId) ?? 0,
    roles: own.map((s) => ({ ...(s.role ? { role: s.role } : {}), g: s.g, w: s.w, prev: s.prev })),
  };
  const qualified = own.filter((s) => s.g >= MIN_ROLE_GAMES);
  const tiers = own
    .map((s) => tierEntry(ds, s))
    .filter((e): e is TierEntry => e !== undefined)
    .sort((a, b) => b.score - a.score);
  const matchups: MatchupsFile | null =
    queue === 420
      ? {
          info: ds.info,
          id: championId,
          roles: qualified.filter((s): s is Slot & { role: Role } => s.role !== undefined).map((s) => roleMatchups(ds, s)),
        }
      : null;
  return {
    info: ds.info,
    stats,
    tiers,
    builds: qualified.length > 0 ? { info: ds.info, id: championId, roles: qualified.map((s) => buildStats(ds, seed, s, queue)) } : null,
    matchups,
  };
}
