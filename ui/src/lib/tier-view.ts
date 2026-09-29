/** How the tier list is shown (shelves or table) and the table's sort: remembered on this machine. */
import { createSignal } from "solid-js";
import { defaultDir, type SortDir, type TierSortKey } from "./stats";

export type TierView = "shelves" | "table";
export const TIER_VIEWS: readonly TierView[] = ["shelves", "table"];

export interface TableSort {
  key: TierSortKey;
  dir: SortDir;
}

interface Saved {
  view: TierView;
  sort: TableSort;
}

const STORE = "mvp.tier-view.v1";
const KEYS: readonly TierSortKey[] = ["rank", "name", "role", "tier", "winRate", "pickRate", "banRate", "games"];
const DEFAULT: Saved = { view: "shelves", sort: { key: "rank", dir: "asc" } };

export const parseView = (value: unknown): TierView | undefined => TIER_VIEWS.find((v) => v === value);

/** Saved choices, each field checked on its own (a bad one falls back to its default). */
export function parseSaved(raw: string | null): Saved {
  try {
    const saved = JSON.parse(raw ?? "{}") as { view?: unknown; sort?: { key?: unknown; dir?: unknown } } | null;
    const key = KEYS.find((k) => k === saved?.sort?.key);
    const dir = saved?.sort?.dir === "asc" || saved?.sort?.dir === "desc" ? saved.sort.dir : undefined;
    return {
      view: parseView(saved?.view) ?? DEFAULT.view,
      sort: key ? { key, dir: dir ?? defaultDir(key) } : DEFAULT.sort,
    };
  } catch {
    return DEFAULT;
  }
}

function load(): Saved {
  try {
    return parseSaved(localStorage.getItem(STORE));
  } catch {
    return DEFAULT;
  }
}

const [saved, setSaved] = createSignal<Saved>(load());

function remember(next: Saved): void {
  setSaved(next);
  try {
    localStorage.setItem(STORE, JSON.stringify(next));
  } catch {
    // storage unavailable: the choice still holds for this session
  }
}

/** Shelves (the default) or table. */
export const tierView = (): TierView => saved().view;
export const setTierView = (view: TierView): void => remember({ ...saved(), view });

/** The table's sort (best rank first by default). */
export const tableSort = (): TableSort => saved().sort;

/** A header picked: that column, in its first direction; picked again, the other way. */
export function sortBy(key: TierSortKey): void {
  const now = saved().sort;
  remember({ ...saved(), sort: now.key === key ? { key, dir: now.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) } });
}
