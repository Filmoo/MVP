/** The champion grid (`/champions`): which tiles show, in which order and groups; the sort is remembered. */
import { createSignal } from "solid-js";
import type { ChampionInfo } from "../data/generated/ChampionInfo";
import type { TierEntry } from "../data/generated/TierEntry";
import { bestMatches } from "./fuzzy";
import type { RoleFilter } from "./stats-filters";

/** Best tier first (grouped by tier), most picked first, or by name. */
export type GridSort = "tier" | "pickRate" | "name";
export const GRID_SORTS: readonly GridSort[] = ["tier", "pickRate", "name"];

export interface GridTile {
  champion: ChampionInfo;
  /** Its tier-list row in the role shown (its most played one for "all"): none without stats or games. */
  entry: TierEntry | undefined;
  /** Share of games it's picked in: in the role shown, or in every role it has a row in ("all"). */
  pickRate: number;
}

export interface GridGroup {
  /** A tier (`S`…`D`, `""` for too few games) or, without stats, a class (`""`: none); no heading when ungrouped. */
  head?: string;
  tiles: GridTile[];
  /** Its first tile's place among all the tiles, in order (the grid builds them a slice at a time). */
  start: number;
}

/** Data Dragon's classes, in the League client's order. */
const CLASSES = ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"];
export const TIERS = ["S", "A", "B", "C", "D"];

/** Each group in `keys` order; empty groups are left out. */
function grouped(tiles: readonly GridTile[], keys: readonly string[], key: (t: GridTile) => string): GridGroup[] {
  let start = 0;
  return keys.flatMap((head) => {
    const members = tiles.filter((t) => key(t) === head);
    start += members.length;
    return members.length > 0 ? [{ head, tiles: members, start: start - members.length }] : [];
  });
}

/**
 * What the grid shows. With stats (`entries`), a role holds the champions with a tier-list row in
 * it (one played in two roles is in both), sorted as asked, grouped by tier when sorted by tier.
 * Without, every champion, grouped by its first class, by name. A query shows its matches, best
 * first, ungrouped.
 */
export function gridGroups(
  champions: readonly ChampionInfo[],
  entries: readonly TierEntry[] | undefined,
  role: RoleFilter,
  sort: GridSort,
  query: string,
): GridGroup[] {
  const rows = new Map<number, TierEntry[]>();
  for (const e of entries ?? []) rows.set(e.id, [...(rows.get(e.id) ?? []), e]);
  const tiles: GridTile[] = [];
  for (const champion of champions) {
    const own = rows.get(champion.id) ?? [];
    const entry =
      role === "all"
        ? own.reduce<TierEntry | undefined>((main, e) => (main && main.g >= e.g ? main : e), undefined)
        : own.find((e) => e.role === role);
    if (entries && role !== "all" && !entry) continue;
    tiles.push({ champion, entry, pickRate: role === "all" ? own.reduce((sum, e) => sum + e.pickRate, 0) : (entry?.pickRate ?? 0) });
  }
  if (query.trim()) return [{ tiles: bestMatches(query.trim(), tiles, (t) => t.champion.name, tiles.length), start: 0 }];
  // Sorts are stable: ties stay in name order.
  tiles.sort((a, b) => a.champion.name.localeCompare(b.champion.name));
  if (!entries) return grouped(tiles, [...CLASSES, ""], (t) => CLASSES.find((c) => c === t.champion.tags[0]) ?? "");
  if (sort === "pickRate") tiles.sort((a, b) => b.pickRate - a.pickRate);
  if (sort !== "tier") return [{ tiles, start: 0 }];
  tiles.sort((a, b) => (b.entry?.score ?? -1e9) - (a.entry?.score ?? -1e9));
  return grouped(tiles, [...TIERS, ""], (t) => t.entry?.tier ?? "");
}

const STORE = "mvp.champion-sort.v1";

function load(): GridSort {
  try {
    return GRID_SORTS.find((s) => s === localStorage.getItem(STORE)) ?? "tier";
  } catch {
    return "tier";
  }
}

const [sort, setSort] = createSignal<GridSort>(load());

/** The grid's sort, as last picked on this machine (best tier first at first). */
export const gridSort = sort;

export function setGridSort(next: GridSort): void {
  setSort(next);
  try {
    localStorage.setItem(STORE, next);
  } catch {
    // storage unavailable: the choice still holds for this session
  }
}
