import type { CompMember } from "../generated/CompMember";
import type { CompReading } from "../generated/CompReading";
import type { DraftSlot } from "../generated/DraftSlot";
import type { DraftView } from "../generated/DraftView";
import type { Reason } from "../generated/Reason";
import type { TeamComp } from "../generated/TeamComp";
import { FIXTURE_NOW } from "./fixtures";

// Champion ids (Data Dragon keys).
const C = {
  malphite: 54,
  shen: 98,
  ornn: 516,
  ksante: 897,
  camille: 164,
  garen: 86,
  darius: 122,
  gwen: 887,
  jax: 24,
  irelia: 39,
  leeSin: 64,
  ahri: 103,
  thresh: 412,
  viego: 234,
  hwei: 910,
  yone: 777,
  zed: 238,
  kaisa: 145,
  nautilus: 111,
  sylas: 517,
  aatrox: 266,
  ambessa: 799,
  mel: 800,
  smolder: 901,
  lux: 99,
  jinx: 222,
  sona: 37,
  ziggs: 115,
  brand: 63,
  sion: 14,
  ashe: 22,
  karthus: 30,
} as const;

/** A champion of a composition: its damage shares (physical, magic, true), frontline share, CC. */
const member = (
  championId: number,
  [physical, magic, trueDamage]: [number, number, number],
  frontline: number,
  cc: number,
  games: number,
  hovering = false,
): CompMember => ({ championId, hovering, games, damage: { physical, magic, trueDamage }, frontline, cc });

/** A team's composition (numbers as the core sums them up). */
const team = (
  [physical, magic, trueDamage]: [number, number, number],
  frontline: number,
  [cc, ccUsual]: [number, number],
  lengths: number[],
  readings: CompReading[],
  members: CompMember[] = [],
  counted = members.length || 5,
): TeamComp => ({
  members,
  counted,
  damage: { physical, magic, trueDamage },
  frontline,
  cc,
  ccUsual,
  lengths,
  games: members.length > 0 ? Math.min(...members.map((m) => m.games)) : 30_110,
  readings,
});

/** Nobody picked yet on that side. */
const nobody: TeamComp = team([0, 0, 0], 0, [0, 0], [0, 0, 0], [], [], 0);

const r = (
  kind: Reason["kind"],
  points: number,
  games: number,
  kept: number,
  championId: number | null = null,
  probability = 1,
): Reason => ({
  kind,
  championId,
  points,
  games,
  kept,
  probability,
});

/** Mid-draft: you're picking top, Irelia is locked on the enemy team. */
const rankedDraft: DraftView = {
  phase: "picking",
  secondsLeft: 24,
  myRole: "top",
  allies: [
    { championId: C.malphite, hovering: true, role: "top", roleOdds: [], isMe: true, picking: true },
    { championId: C.leeSin, hovering: false, role: "jungle", roleOdds: [], isMe: false, picking: false },
    { championId: C.ahri, hovering: false, role: "middle", roleOdds: [], isMe: false, picking: false },
    { championId: null, hovering: false, role: "bottom", roleOdds: [], isMe: false, picking: false },
    { championId: C.thresh, hovering: true, role: "support", roleOdds: [], isMe: false, picking: false },
  ],
  enemies: [
    {
      championId: C.irelia,
      hovering: false,
      role: "top",
      roleOdds: [
        { role: "top", probability: 0.94 },
        { role: "middle", probability: 0.06 },
      ],
      isMe: false,
      picking: false,
    },
    {
      championId: C.viego,
      hovering: false,
      role: "jungle",
      roleOdds: [{ role: "jungle", probability: 0.97 }],
      isMe: false,
      picking: false,
    },
    {
      championId: C.hwei,
      hovering: false,
      role: "middle",
      roleOdds: [
        { role: "middle", probability: 0.71 },
        { role: "support", probability: 0.29 },
      ],
      isMe: false,
      picking: false,
    },
    { championId: null, hovering: false, role: null, roleOdds: [], isMe: false, picking: true },
    { championId: null, hovering: false, role: null, roleOdds: [], isMe: false, picking: true },
  ],
  allyBans: [C.yone, C.zed, C.kaisa, C.ambessa, C.smolder],
  enemyBans: [C.sylas, C.aatrox, C.mel, C.nautilus, C.gwen],
  team: { percent: 51.5, plusMinus: 1.6 },
  suggestions: [
    {
      championId: C.malphite,
      estimate: { percent: 54.6, plusMinus: 2.0 },
      gain: 3.1,
      tier: 0,
      mine: { games: 41, wins: 23 },
      mastery: { level: 9, points: 245_800 },
      reasons: [
        r("lane", 4.3, 3244, 0.85, C.irelia, 0.94),
        r("base", 0.9, 127_400, 1),
        r("jungle", 0.2, 6021, 0.72, C.viego),
        r("duo", 0.3, 11_020, 0.24, C.ahri),
        r("matchup", -0.4, 8104, 0.31, C.hwei, 0.71),
      ],
    },
    {
      championId: C.shen,
      estimate: { percent: 54.0, plusMinus: 2.1 },
      gain: 2.5,
      tier: 0,
      mine: null,
      mastery: { level: 5, points: 41_200 },
      reasons: [
        r("lane", 2.2, 2911, 0.83, C.irelia, 0.94),
        r("base", 0.4, 88_200, 1),
        r("duo", 0.5, 4880, 0.18, C.leeSin),
        r("jungle", -0.1, 3002, 0.57, C.viego),
      ],
    },
    {
      championId: C.ornn,
      estimate: { percent: 53.7, plusMinus: 2.3 },
      gain: 2.2,
      tier: 0,
      mine: { games: 6, wins: 4 },
      mastery: { level: 7, points: 98_400 },
      reasons: [r("lane", 1.9, 1802, 0.76, C.irelia, 0.94), r("base", 0.6, 61_000, 1), r("matchup", -0.2, 2104, 0.21, C.hwei, 0.71)],
    },
    {
      championId: C.jax,
      estimate: { percent: 52.1, plusMinus: 1.9 },
      gain: 0.6,
      tier: 1,
      mine: null,
      reasons: [r("base", 0.7, 142_900, 1), r("lane", -0.3, 7820, 0.93, C.irelia, 0.94), r("jungle", 0.2, 9010, 0.8, C.viego)],
    },
    {
      championId: C.ksante,
      estimate: { percent: 51.8, plusMinus: 2.2 },
      gain: 0.3,
      tier: 1,
      mine: null,
      reasons: [r("lane", 0.8, 2206, 0.79, C.irelia, 0.94), r("base", -0.6, 70_300, 1)],
    },
    {
      championId: C.garen,
      estimate: { percent: 50.2, plusMinus: 2.0 },
      gain: -1.3,
      tier: 2,
      mine: { games: 12, wins: 5 },
      reasons: [r("lane", -1.8, 4410, 0.89, C.irelia, 0.94), r("base", 0.3, 98_700, 1)],
    },
    {
      championId: C.camille,
      estimate: { percent: 49.4, plusMinus: 2.1 },
      gain: -2.1,
      tier: 2,
      mine: null,
      reasons: [r("lane", -2.6, 5102, 0.9, C.irelia, 0.94), r("base", 0.2, 83_100, 1)],
    },
  ],
  data: { queue: 420, bracket: "Emerald+", patch: "26.19", games: 1_912_400, updatedAt: FIXTURE_NOW - 3 * 3_600_000 },
  queue: 420,
  bench: null,
  rerolls: null,
  comps: null,
};

/** Your team as it stands: your Malphite hover, Lee Sin, Ahri and Thresh's hover. */
const allies = team(
  [0.33, 0.61, 0.06],
  1.12,
  [110, 78],
  [-0.8, 0.3, 1.9],
  ["lotsOfCc"],
  [
    member(C.malphite, [0.16, 0.8, 0.04], 0.33, 38, 127_400, true),
    member(C.leeSin, [0.82, 0.08, 0.1], 0.23, 14, 88_200),
    member(C.ahri, [0.06, 0.9, 0.04], 0.15, 17, 98_000),
    member(C.thresh, [0.3, 0.62, 0.08], 0.24, 41, 61_000, true),
  ],
);

/** Your team with each pick in your seat. */
const withPick: Record<number, TeamComp> = {
  [C.malphite]: { ...allies, members: [] },
  [C.shen]: team([0.45, 0.47, 0.08], 1.1, [101, 78], [-0.6, 0.4, 1.4], ["lotsOfCc"], [], 4),
  [C.ornn]: team([0.39, 0.55, 0.06], 1.16, [115, 78], [-1.2, 0.3, 2.6], ["lotsOfFrontline", "lotsOfCc"], [], 4),
  [C.jax]: team([0.52, 0.41, 0.07], 0.97, [79, 78], [-0.2, 0.1, 0.9], [], [], 4),
  [C.ksante]: team([0.44, 0.49, 0.07], 1.13, [98, 78], [-0.4, 0.2, 1.1], ["lotsOfCc"], [], 4),
  [C.garen]: team([0.47, 0.42, 0.11], 1.01, [74, 78], [0.1, 0.2, 0.4], [], [], 4),
  [C.camille]: team([0.49, 0.38, 0.13], 0.99, [81, 78], [-0.3, 0.4, 0.6], [], [], 4),
};

/** Mid-draft: you're picking top, Irelia is locked on the enemy team. */
export const champSelectDraft: DraftView = {
  ...rankedDraft,
  suggestions: rankedDraft.suggestions.map((s) => {
    const comp = withPick[s.championId];
    return comp ? { ...s, comp } : s;
  }),
  comps: {
    allies,
    // Irelia (top or mid), Viego, Hwei (mid or support).
    enemies: team(
      [0.62, 0.33, 0.05],
      0.82,
      [41, 58],
      [1.4, 0.2, -2.3],
      ["littleFrontline", "early"],
      [
        member(C.irelia, [0.88, 0.02, 0.1], 0.27, 12, 70_300),
        member(C.viego, [0.85, 0.05, 0.1], 0.21, 7, 60_100),
        member(C.hwei, [0.04, 0.93, 0.03], 0.14, 22, 30_110),
      ],
    ),
    lengths: [25, 35],
  },
};

/** Planning: nobody has picked or hovered yet; your pool's picks are there already. */
export const champSelectPlanning: DraftView = {
  ...champSelectDraft,
  phase: "planning",
  secondsLeft: 27,
  allies: champSelectDraft.allies.map((slot) => ({ ...slot, championId: null, hovering: false, picking: false })),
  enemies: champSelectDraft.enemies.map((slot) => ({ ...slot, championId: null, role: null, roleOdds: [], picking: false })),
  allyBans: [],
  enemyBans: [],
  comps: { allies: nobody, enemies: nobody, lengths: [25, 35] },
};

/** Stats published before compositions were: the draft's numbers without them. */
export const champSelectNoComps: DraftView = {
  ...rankedDraft,
  comps: null,
};

/** Finalization: you locked Malphite in, the enemy team is complete. */
export const champSelectLocked: DraftView = {
  ...champSelectDraft,
  phase: "finalizing",
  secondsLeft: 21,
  allies: champSelectDraft.allies.map((slot) => (slot.isMe ? { ...slot, hovering: false, picking: false } : slot)),
  enemies: champSelectDraft.enemies.map((slot, i) =>
    slot.championId === null ? { ...slot, championId: i % 2 === 0 ? C.kaisa : C.nautilus, picking: false } : slot,
  ),
  comps: {
    allies: { ...allies, members: allies.members.map((m) => (m.championId === C.malphite ? { ...m, hovering: false } : m)) },
    enemies: team(
      [0.58, 0.37, 0.05],
      0.97,
      [83, 78],
      [0.9, 0.1, -1.6],
      [],
      [
        member(C.irelia, [0.88, 0.02, 0.1], 0.27, 12, 70_300),
        member(C.viego, [0.85, 0.05, 0.1], 0.21, 7, 60_100),
        member(C.hwei, [0.04, 0.93, 0.03], 0.14, 22, 30_110),
        member(C.nautilus, [0.18, 0.76, 0.06], 0.26, 44, 41_800),
        member(C.kaisa, [0.62, 0.33, 0.05], 0.13, 5, 97_300),
      ],
    ),
    lengths: [25, 35],
  },
};

/** The app today, before stats are published: the draft without suggestions or odds. */
export const champSelectNoStats: DraftView = {
  ...champSelectDraft,
  team: null,
  suggestions: [],
  data: null,
  comps: null,
};

const aramSlot = (championId: number, isMe = false): DraftSlot => ({
  championId,
  hovering: false,
  role: null,
  roleOdds: [],
  isMe,
  picking: false,
});

/** Your ARAM team with each champion you can take instead of Lux. */
const aramWith = (damage: [number, number, number], frontline: number, cc: number, readings: CompReading[]) =>
  team(damage, frontline, [cc, 100], [0.4, -0.1, -0.6], readings);

/** ARAM: you have Lux; Brand, Karthus, Sion and Ashe are on the bench; one reroll left. */
export const aramDraft: DraftView = {
  phase: "finalizing",
  secondsLeft: 41,
  myRole: null,
  allies: [aramSlot(C.lux, true), aramSlot(C.jinx), aramSlot(C.malphite), aramSlot(C.sona), aramSlot(C.ziggs)],
  enemies: [],
  allyBans: [],
  enemyBans: [],
  team: { percent: 53.1, plusMinus: 1.2 },
  suggestions: [
    {
      championId: C.brand,
      estimate: { percent: 54.4, plusMinus: 1.3 },
      gain: 1.3,
      tier: 0,
      mine: null,
      mastery: { level: 6, points: 58_200 },
      reasons: [r("base", 3.8, 24_310, 1)],
      comp: aramWith([0.2, 0.76, 0.04], 0.93, 112, ["mostlyMagic"]),
    },
    {
      championId: C.lux,
      estimate: { percent: 53.1, plusMinus: 1.2 },
      gain: 0,
      tier: 0,
      mine: null,
      mastery: { level: 7, points: 96_700 },
      reasons: [r("base", 2.4, 31_870, 1)],
      comp: aramWith([0.22, 0.74, 0.04], 0.92, 126, ["mostlyMagic"]),
    },
    {
      championId: C.karthus,
      estimate: { percent: 52.9, plusMinus: 1.4 },
      gain: -0.2,
      tier: 0,
      mine: null,
      reasons: [r("base", 2.2, 12_040, 1)],
      comp: aramWith([0.2, 0.75, 0.05], 0.9, 108, ["mostlyMagic"]),
    },
    {
      championId: C.sion,
      estimate: { percent: 51.6, plusMinus: 1.3 },
      gain: -1.5,
      tier: 1,
      mine: null,
      reasons: [r("base", 0.8, 19_560, 1)],
      comp: aramWith([0.37, 0.59, 0.04], 1.21, 133, ["lotsOfFrontline"]),
    },
    {
      championId: C.ashe,
      estimate: { percent: 51.2, plusMinus: 1.2 },
      gain: -1.9,
      tier: 1,
      mine: null,
      mastery: { level: 4, points: 20_900 },
      reasons: [r("base", 0.4, 28_430, 1)],
      comp: aramWith([0.41, 0.54, 0.05], 0.9, 131, []),
    },
  ],
  data: { queue: 450, bracket: "Emerald+", patch: "26.19", games: 812_300, updatedAt: FIXTURE_NOW - 3 * 3_600_000 },
  queue: 450,
  bench: [C.brand, C.sion, C.ashe, C.karthus],
  rerolls: 1,
  comps: {
    allies: team(
      [0.22, 0.74, 0.04],
      0.92,
      [126, 100],
      [0.4, -0.1, -0.6],
      ["mostlyMagic"],
      [
        member(C.lux, [0.05, 0.93, 0.02], 0.12, 31, 31_870),
        member(C.jinx, [0.9, 0.04, 0.06], 0.14, 11, 40_210),
        member(C.malphite, [0.12, 0.85, 0.03], 0.31, 42, 29_990),
        member(C.sona, [0.04, 0.94, 0.02], 0.14, 24, 21_050),
        member(C.ziggs, [0.03, 0.95, 0.02], 0.12, 9, 33_600),
      ],
    ),
    enemies: nobody,
    lengths: [17, 22],
  },
};
