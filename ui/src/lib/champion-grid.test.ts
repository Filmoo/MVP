import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChampionInfo } from "../data/generated/ChampionInfo";
import type { Role } from "../data/generated/Role";
import type { TierEntry } from "../data/generated/TierEntry";
import type { TierGrade } from "../data/generated/TierGrade";
import { type GridGroup, gridGroups } from "./champion-grid";

const champion = (id: number, name: string, tags: string[]): ChampionInfo => ({ id, key: name, name, tags });

// Game data's order isn't the grid's: it sorts by itself.
const CHAMPIONS = [
  champion(238, "Zed", ["Assassin"]),
  champion(103, "Ahri", ["Mage", "Assassin"]),
  champion(86, "Garen", ["Fighter", "Tank"]),
  champion(99, "Lux", ["Mage", "Support"]),
  champion(904, "Zaahen", ["Fighter"]),
];

const row = (id: number, role: Role, tier: TierGrade, score: number, g: number, pickRate: number): TierEntry => ({
  id,
  role,
  tier,
  score,
  g,
  w: Math.round(g / 2),
  winRate: 0.5 + score / 100,
  pickRate,
  banRate: 0.01,
});

// Lux is played in two roles (support most); Zaahen has too few games for any row.
const ENTRIES = [
  row(238, "middle", "S", 2.2, 18_000, 0.07),
  row(86, "top", "S", 2.5, 15_000, 0.05),
  row(103, "middle", "A", 1, 20_000, 0.08),
  row(99, "support", "B", 0.1, 12_000, 0.06),
  row(99, "middle", "C", -1, 4_000, 0.03),
];

/** A grid as read top to bottom: `[S:2]` for a heading and its size, names for tiles. */
const read = (groups: readonly GridGroup[]) =>
  groups.flatMap((g) => [...(g.head === undefined ? [] : [`[${g.head}:${g.tiles.length}]`]), ...g.tiles.map((t) => t.champion.name)]);
/** Every tile, in order. */
const tiles = (groups: readonly GridGroup[]) => groups.flatMap((g) => g.tiles);

describe("champion grid", () => {
  it("by tier: groups from S to D, best first, champions with too few games last", () => {
    expect(read(gridGroups(CHAMPIONS, ENTRIES, "all", "tier", ""))).toEqual([
      "[S:2]",
      "Garen",
      "Zed",
      "[A:1]",
      "Ahri",
      "[B:1]",
      "Lux",
      "[:1]",
      "Zaahen",
    ]);
    // Where each group's tiles start among all of them (the grid builds them in that order).
    expect(gridGroups(CHAMPIONS, ENTRIES, "all", "tier", "").map((g) => g.start)).toEqual([0, 2, 3, 4]);
  });

  it("a role holds every champion with a row in it (one played in two roles is in both), with that role's tier", () => {
    expect(read(gridGroups(CHAMPIONS, ENTRIES, "middle", "tier", ""))).toEqual(["[S:1]", "Zed", "[A:1]", "Ahri", "[C:1]", "Lux"]);
    expect(read(gridGroups(CHAMPIONS, ENTRIES, "support", "tier", ""))).toEqual(["[B:1]", "Lux"]);
    expect(tiles(gridGroups(CHAMPIONS, ENTRIES, "jungle", "tier", ""))).toEqual([]);
  });

  it("all roles: the most played role gives the tier, every role adds to the pick rate", () => {
    const lux = tiles(gridGroups(CHAMPIONS, ENTRIES, "all", "name", "")).find((tile) => tile.champion.id === 99);
    expect(lux).toMatchObject({ entry: { role: "support", tier: "B" } });
    expect(lux?.pickRate).toBeCloseTo(0.09);
    const middle = tiles(gridGroups(CHAMPIONS, ENTRIES, "middle", "name", "")).find((tile) => tile.champion.id === 99);
    expect(middle).toMatchObject({ entry: { role: "middle", tier: "C" }, pickRate: 0.03 });
  });

  it("by pick rate (most picked first) and by name: no groups", () => {
    expect(read(gridGroups(CHAMPIONS, ENTRIES, "all", "pickRate", ""))).toEqual(["Lux", "Ahri", "Zed", "Garen", "Zaahen"]);
    expect(read(gridGroups(CHAMPIONS, ENTRIES, "middle", "pickRate", ""))).toEqual(["Ahri", "Zed", "Lux"]);
    expect(read(gridGroups(CHAMPIONS, ENTRIES, "all", "name", ""))).toEqual(["Ahri", "Garen", "Lux", "Zaahen", "Zed"]);
  });

  it("a query shows its matches in the role shown, best first, without groups", () => {
    expect(read(gridGroups(CHAMPIONS, ENTRIES, "all", "tier", "ah"))).toEqual(["Ahri", "Zaahen"]);
    expect(read(gridGroups(CHAMPIONS, ENTRIES, "middle", "pickRate", " ah "))).toEqual(["Ahri"]);
    expect(tiles(gridGroups(CHAMPIONS, ENTRIES, "all", "tier", "zzz"))).toEqual([]);
    expect(read(gridGroups(CHAMPIONS, undefined, "all", "tier", "lu"))).toEqual(["Lux"]);
  });

  it("without stats: every champion under its first class, by name, whatever the role and sort", () => {
    const byClass = ["[Assassin:1]", "Zed", "[Fighter:2]", "Garen", "Zaahen", "[Mage:2]", "Ahri", "Lux"];
    expect(read(gridGroups(CHAMPIONS, undefined, "all", "tier", ""))).toEqual(byClass);
    expect(read(gridGroups(CHAMPIONS, undefined, "middle", "pickRate", ""))).toEqual(byClass);
    // A class Data Dragon doesn't have (yet) goes last, never missing.
    const odd = [...CHAMPIONS, champion(1, "Nobody", []), champion(2, "Newcomer", ["Artillery"])];
    expect(read(gridGroups(odd, undefined, "all", "name", "")).slice(-3)).toEqual(["[:2]", "Newcomer", "Nobody"]);
  });
});

describe("the grid's sort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const fresh = () => {
    vi.resetModules();
    return import("./champion-grid");
  };

  it("is remembered on this machine; a saved one it doesn't know reads as the tier", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    const grid = await fresh();
    expect(grid.gridSort(), "best tier first at first").toBe("tier");
    grid.setGridSort("pickRate");
    expect(grid.gridSort()).toBe("pickRate");
    expect((await fresh()).gridSort(), "the next start").toBe("pickRate");
    store.set("mvp.champion-sort.v1", "best");
    expect((await fresh()).gridSort()).toBe("tier");
  });

  it("holds for the session when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    const grid = await fresh();
    expect(grid.gridSort()).toBe("tier");
    grid.setGridSort("name");
    expect(grid.gridSort()).toBe("name");
  });
});
