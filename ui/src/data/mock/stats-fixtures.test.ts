import { describe, expect, it } from "vitest";
import { CHAMPION_SEEDS, DATASET_GAMES, mockChampionPage, mockStatsIndex, mockTierList } from "./stats-fixtures";

describe("mock stats", () => {
  it("cover every champion once", () => {
    const ids = CHAMPION_SEEDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(170);
  });

  it("are deterministic", () => {
    expect(mockTierList(420, "emeraldPlus")).toEqual(mockTierList(420, "emeraldPlus"));
    expect(mockChampionPage(103, 420, "diamondPlus")).toEqual(mockChampionPage(103, 420, "diamondPlus"));
  });

  it("index the published data sets", () => {
    const index = mockStatsIndex();
    expect(index.current).toBe("16.19");
    expect(index.patches[0]?.name).toBe("26.19");
    expect(index.patches[0]?.sets).toContainEqual({ queue: 450, bracket: "masterPlus", games: DATASET_GAMES[450].masterPlus });
  });

  for (const queue of [420, 450] as const) {
    for (const bracket of ["emeraldPlus", "diamondPlus", "masterPlus"] as const) {
      it(`look like real data: ${queue} ${bracket}`, () => {
        const list = mockTierList(queue, bracket);
        expect(list.info.games).toBe(DATASET_GAMES[queue][bracket]);
        expect(list.entries.length).toBeGreaterThan(queue === 420 ? 150 : 160);
        const scores = list.entries.map((e) => e.score);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
        for (const e of list.entries) {
          expect(e.g).toBeGreaterThanOrEqual(50);
          expect(e.pickRate).toBeGreaterThanOrEqual(0.005);
          expect(e.winRate).toBeGreaterThan(0.44);
          expect(e.winRate).toBeLessThan(0.56);
          expect(e.role === undefined).toBe(queue === 450);
          const grade = e.score >= 2 ? "S" : e.score >= 0.75 ? "A" : e.score >= -0.75 ? "B" : e.score >= -2 ? "C" : "D";
          expect(e.tier).toBe(grade);
        }
        // Every grade shows up, B the most common.
        const count = (t: string) => list.entries.filter((e) => e.tier === t).length;
        for (const t of ["S", "A", "B", "C", "D"]) expect(count(t), t).toBeGreaterThan(0);
        expect(count("B")).toBeGreaterThan(count("S"));
        if (queue === 420) {
          // Two players per role per game.
          const perRole = new Map<string, number>();
          for (const e of list.entries) perRole.set(e.role ?? "", (perRole.get(e.role ?? "") ?? 0) + e.pickRate);
          for (const total of perRole.values()) {
            expect(total).toBeLessThanOrEqual(2.001);
            expect(total).toBeGreaterThan(1.6);
          }
          expect(Math.max(...list.entries.map((e) => e.banRate))).toBeGreaterThan(0.1);
        } else {
          expect(list.entries.every((e) => e.banRate === 0)).toBe(true);
        }
      });
    }
  }

  it("give a champion its roles, builds and matchups", () => {
    const page = mockChampionPage(103, 420, "emeraldPlus");
    expect(page.stats?.roles[0]?.role).toBe("middle");
    expect(page.tiers.length).toBeGreaterThan(0);
    const build = page.builds?.roles[0];
    expect(build?.role).toBe("middle");
    for (const key of [
      "runes",
      "keystones",
      "spells",
      "skills",
      "skillStart",
      "starts",
      "core",
      "boots",
      "item4",
      "item5",
      "item6",
    ] as const) {
      const section = build?.[key];
      expect(section?.top.length, key).toBeGreaterThan(0);
      const games = section?.top.reduce((sum, o) => sum + o.g, 0) ?? 0;
      expect(games, key).toBeLessThanOrEqual(section?.n ?? 0);
      expect(new Set(section?.top.map((o) => o.ids.join(","))).size, `${key} options are distinct`).toBe(section?.top.length);
    }
    expect(build?.runes.top[0]?.ids).toHaveLength(11);
    expect(build?.core.top[0]?.ids).toHaveLength(3);
    const mid = page.matchups?.roles.find((r) => r.role === "middle");
    expect(mid?.lane.length).toBeGreaterThan(10);
    expect(mid?.jungle.length).toBeGreaterThan(10);
    expect(mid?.duos.length).toBeGreaterThan(10);
  });

  it("make matchups two-sided: one champion's edge is the other's deficit", () => {
    const ahri = mockChampionPage(103, 420, "emeraldPlus").matchups?.roles.find((r) => r.role === "middle");
    const vsSyndra = ahri?.lane.find((e) => e.id === 134);
    const syndra = mockChampionPage(134, 420, "emeraldPlus").matchups?.roles.find((r) => r.role === "middle");
    const vsAhri = syndra?.lane.find((e) => e.id === 103);
    expect(vsSyndra?.g).toBe(vsAhri?.g);
    expect(vsSyndra?.d).toBeCloseTo(-(vsAhri?.d ?? 0), 5);
  });

  it("list both halves of the enemy bot lane for bottom and support", () => {
    const thresh = mockChampionPage(412, 420, "emeraldPlus").matchups?.roles[0];
    expect(new Set(thresh?.lane.map((e) => e.role))).toEqual(new Set(["support", "bottom"]));
  });

  it("have no roles or matchups in ARAM", () => {
    const page = mockChampionPage(103, 450, "emeraldPlus");
    expect(page.stats?.roles).toHaveLength(1);
    expect(page.stats?.roles[0]?.role).toBeUndefined();
    expect(page.builds?.roles[0]?.spells.top[0]?.ids).toContain(32);
    expect(page.matchups).toBeNull();
  });

  it("leave a champion without games empty", () => {
    const page = mockChampionPage(904, 420, "emeraldPlus");
    expect(page).toMatchObject({ stats: null, tiers: [], builds: null, matchups: null });
    expect(mockTierList(420, "emeraldPlus").entries.some((e) => e.id === 904)).toBe(false);
  });
});
