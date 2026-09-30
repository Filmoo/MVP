import { describe, expect, it } from "vitest";
import type { ChampionPage } from "../data/generated/ChampionPage";
import type { MatchupEntry } from "../data/generated/MatchupEntry";
import type { TierEntry } from "../data/generated/TierEntry";
import type { TierList } from "../data/generated/TierList";
import { mockChampionPage, mockStatsIndex } from "../data/mock/stats-fixtures";
import {
  bestAndWorst,
  defaultDir,
  entryKey,
  groupByTier,
  matchingEntries,
  optionShare,
  patchName,
  pickRole,
  rankEntries,
  roleTabs,
  share,
  sortEntries,
  statsErrorWords,
  trendsOf,
  winRateOf,
  wrSide,
} from "./stats";

const entry = (
  id: number,
  role: TierEntry["role"],
  score: number,
  winRate: number,
  pickRate: number,
  extra: Partial<TierEntry> = {},
): TierEntry => ({
  id,
  ...(role ? { role } : {}),
  tier: "B",
  score,
  g: Math.round(pickRate * 100_000),
  w: 0,
  winRate,
  pickRate,
  banRate: 0,
  ...extra,
});

const list = (patch: string, entries: TierEntry[], queue = 420): TierList => ({
  info: { schema: 1, patch, queue, bracket: "emeraldPlus", games: 100_000, updatedAt: 0 },
  entries,
});

describe("stats helpers", () => {
  it("name patches from the index, and fall back to the game version", () => {
    expect(patchName(mockStatsIndex(), "16.19")).toBe("26.19");
    expect(patchName(mockStatsIndex(), "16.10")).toBe("16.10");
    expect(patchName(null, "16.19")).toBe("16.19");
  });

  it("share and win rates never divide by zero", () => {
    expect(share(3, 0)).toBe(0);
    expect(share(1, 4)).toBe(0.25);
    expect(winRateOf({ g: 0, w: 0 })).toBeNull();
    expect(winRateOf({ g: 4, w: 3 })).toBe(0.75);
    expect(optionShare({ ids: [1], g: 5, w: 3 }, { n: 20, top: [] })).toBe(0.25);
  });

  it("word each backend error: nothing published is empty, the rest retries", () => {
    expect(statsErrorWords({ kind: "notFound" })).toMatchObject({ empty: true, retry: false });
    expect(statsErrorWords({ kind: "network", message: "x" })).toMatchObject({
      empty: false,
      retry: true,
      title: "Can't reach MVP's servers",
    });
    expect(statsErrorWords({ kind: "unavailable", message: "x" }).retry).toBe(true);
    expect(statsErrorWords({ kind: "rateLimited", retryAfter: 7 }).text).toContain("7 s");
    expect(statsErrorWords({ kind: "rateLimited", retryAfter: null }).text).toContain("a moment");
  });
});

describe("tier list rows", () => {
  const entries = [
    entry(1, "top", 2.5, 0.525, 0.05),
    entry(2, "middle", 1.2, 0.512, 0.12),
    entry(3, "top", -0.4, 0.496, 0.2),
    entry(4, "middle", -2.2, 0.478, 0.01),
  ];

  it("rank by score within the role shown", () => {
    expect(rankEntries(entries, "all").map((e) => [e.id, e.rank])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(rankEntries(entries, "middle").map((e) => [e.id, e.rank])).toEqual([
      [2, 1],
      [4, 2],
    ]);
  });

  it("sort by any column, both ways, ties by rank", () => {
    const ranked = rankEntries(entries, "all");
    const ids = (key: Parameters<typeof sortEntries>[1], dir: "asc" | "desc") =>
      sortEntries(ranked, key, dir, (id) => ["", "Zed", "Ahri", "Garen", "Lux"][id] ?? "").map((e) => e.id);
    expect(ids("pickRate", "desc")).toEqual([3, 2, 1, 4]);
    expect(ids("winRate", "asc")).toEqual([4, 3, 2, 1]);
    expect(ids("name", "asc")).toEqual([2, 3, 4, 1]);
    expect(ids("rank", "asc")).toEqual([1, 2, 3, 4]);
    // The tier comes from the score.
    expect(ids("tier", "desc")).toEqual([1, 2, 3, 4]);
    expect(ids("games", "desc")).toEqual([3, 2, 1, 4]);
    expect(defaultDir("name")).toBe("asc");
    expect(defaultDir("rank")).toBe("asc");
    expect(defaultDir("role")).toBe("asc");
    expect(defaultDir("winRate")).toBe("desc");
    expect(defaultDir("games")).toBe("desc");
  });

  it("sort by lane in map order, the champion most played there first", () => {
    const rows = rankEntries(
      [
        entry(1, "middle", 1, 0.5, 0.1, { share: 0.6 }),
        entry(2, "top", 0.5, 0.5, 0.1, { share: 0.9 }),
        entry(3, "middle", 0, 0.5, 0.1, { share: 0.99 }),
        entry(4, "top", -1, 0.5, 0.1, { share: 0.4 }),
      ],
      "all",
    );
    expect(sortEntries(rows, "role", "asc", () => "").map((e) => e.id)).toEqual([2, 4, 3, 1]);
  });

  it("list a champion once per lane in all roles, and key its rows apart", () => {
    const flex = [entry(1, "top", 1, 0.51, 0.1), entry(1, "middle", 0.5, 0.505, 0.02)];
    const all = rankEntries(flex, "all");
    expect(all).toHaveLength(2);
    expect(new Set(all.map(entryKey)).size).toBe(2);
  });

  it("group rows by tier, best first, in their order", () => {
    const rows = rankEntries(
      [
        entry(1, "top", 2.5, 0.52, 0.1, { tier: "S" }),
        entry(2, "top", 0.2, 0.5, 0.1, { tier: "B" }),
        entry(3, "top", 1.0, 0.51, 0.1, { tier: "A" }),
        entry(4, "top", 0.1, 0.5, 0.1, { tier: "B" }),
      ],
      "top",
    );
    expect(groupByTier(rows).map((g) => [g.tier, g.entries.map((e) => e.id)])).toEqual([
      ["S", [1]],
      ["A", [3]],
      ["B", [2, 4]],
    ]);
  });

  it("read 50.0 % as even, whichever side of it", () => {
    expect(wrSide(0.5004)).toBe("even");
    expect(wrSide(0.4996)).toBe("even");
    expect(wrSide(0.5006)).toBe("win");
    expect(wrSide(0.4994)).toBe("loss");
  });

  it("filter by champion name, the ranking kept", () => {
    const rows = rankEntries(entries, "all");
    const name = (id: number) => ["", "Zed", "Ahri", "Garen", "Lux"][id] ?? "";
    expect(matchingEntries(rows, "a", name).map((e) => e.id)).toEqual([2, 3]);
    // A better match ranked lower stays lower: the list's order, not the match's.
    const ka = (id: number) => ["", "Kassadin", "Ahri", "Garen", "Ka"][id] ?? "";
    expect(matchingEntries(rows, "ka", ka).map((e) => e.id)).toEqual([1, 4]);
    expect(matchingEntries(rows, "  ", name)).toHaveLength(4);
    expect(matchingEntries(rows, "zzz", name)).toEqual([]);
  });
});

describe("trends", () => {
  const now = list("16.19", [
    entry(1, "top", 1, 0.52, 0.05, { banRate: 0.12 }),
    entry(2, "middle", 0, 0.5, 0.1),
    entry(3, "top", 0, 0.5, 0.01),
  ]);
  const before = list("16.18", [entry(1, "top", 1, 0.51, 0.06, { banRate: 0.1 }), entry(2, "middle", 0, 0.505, 0.08)]);

  it("compare each row with the previous patch's, in points", () => {
    const trends = trendsOf(now, before);
    expect(trends?.get("1:top")?.winRate).toBeCloseTo(1);
    expect(trends?.get("1:top")?.pickRate).toBeCloseTo(-1);
    expect(trends?.get("1:top")?.banRate).toBeCloseTo(2);
    expect(trends?.get("2:middle")?.winRate).toBeCloseTo(-0.5);
    expect(trends?.has("3:top"), "not listed then: no trend").toBe(false);
  });

  it("show none without a previous list, for the same patch or another data set", () => {
    expect(trendsOf(now, null)).toBeUndefined();
    expect(trendsOf(now, list("16.19", before.entries))).toBeUndefined();
    expect(trendsOf(now, list("16.18", before.entries, 450))).toBeUndefined();
  });
});

describe("champion pages", () => {
  it("offer the roles a champion is played in, most played first", () => {
    const lux = mockChampionPage(99, 420, "emeraldPlus");
    const tabs = roleTabs(lux);
    expect(tabs.map((t) => t.role)).toEqual(["support", "middle"]);
    expect(tabs[0]?.share).toBeGreaterThan(0.5);
    expect(pickRole(tabs, "middle")).toBe("middle");
    expect(pickRole(tabs, "jungle"), "not played there: the main role").toBe("support");
    expect(pickRole(tabs, undefined)).toBe("support");
  });

  it("have one role-less tab in ARAM, none without games", () => {
    expect(roleTabs(mockChampionPage(99, 450, "emeraldPlus")).map((t) => t.role)).toEqual([undefined]);
    const empty: ChampionPage = { ...mockChampionPage(99, 420, "emeraldPlus"), stats: null, tiers: [], builds: null, matchups: null };
    expect(roleTabs(empty)).toEqual([]);
  });

  it("split matchups into the best and worst by shrunk effect", () => {
    const m = (id: number, d: number, g = 100): MatchupEntry => ({ id, role: "middle", g, w: 50, d });
    const { best, worst } = bestAndWorst([m(1, 1.5), m(2, -3), m(3, 0.2), m(4, -0.1), m(5, 1.5, 900), m(6, 0)], 2);
    expect(best.map((e) => e.id)).toEqual([5, 1]);
    expect(worst.map((e) => e.id)).toEqual([2, 4]);
  });
});
