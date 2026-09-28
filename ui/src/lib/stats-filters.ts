import { createSignal } from "solid-js";
import type { Bracket } from "../data/generated/Bracket";
import type { Role } from "../data/generated/Role";
import { settingsBracket } from "./settings";

/** Queues with published stats: 420 = ranked solo/duo, 450 = ARAM. */
export type Queue = 420 | 450;
export const RANKED: Queue = 420;
export const ARAM: Queue = 450;

export type RoleFilter = Role | "all";

/** What the stats pages show: remembered on this machine, shared by the tier list and champion pages. */
export interface StatsFilters {
  queue: Queue;
  /** The bracket picked on the pages, else the one of the player's settings. */
  bracket: Bracket;
  /** Tier list only (champion pages have their own role tabs). */
  role: RoleFilter;
}

/**
 * As saved: a bracket picked on the pages holds while the settings' bracket is still the one it
 * was picked over (`over`); changing the settings' bracket brings the pages to it.
 */
interface Saved {
  queue: Queue;
  role: RoleFilter;
  bracket?: Bracket;
  over?: Bracket;
}

const STORE = "mvp.stats-filters.v1";
export const DEFAULT_FILTERS: StatsFilters = { queue: RANKED, bracket: "emeraldPlus", role: "all" };

const BRACKETS: readonly Bracket[] = ["emeraldPlus", "diamondPlus", "masterPlus"];
const ROLE_FILTERS: readonly RoleFilter[] = ["all", "top", "jungle", "middle", "bottom", "support"];

export function parseQueue(value: unknown): Queue | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === RANKED) return RANKED;
  return n === ARAM ? ARAM : undefined;
}

export function parseBracket(value: unknown): Bracket | undefined {
  return BRACKETS.find((b) => b === value);
}

export function parseRoleFilter(value: unknown): RoleFilter | undefined {
  return ROLE_FILTERS.find((r) => r === value);
}

/** Saved choices, each field checked on its own (a bad one falls back to its default). */
function parseSaved(raw: string | null): Saved {
  try {
    const saved = JSON.parse(raw ?? "{}") as Partial<Record<keyof Saved, unknown>> | null;
    const bracket = parseBracket(saved?.bracket);
    return {
      queue: parseQueue(saved?.queue) ?? DEFAULT_FILTERS.queue,
      role: parseRoleFilter(saved?.role) ?? DEFAULT_FILTERS.role,
      // Saved before the setting existed: picked over Emerald+, the only bracket then.
      ...(bracket ? { bracket, over: parseBracket(saved?.over) ?? DEFAULT_FILTERS.bracket } : {}),
    };
  } catch {
    return { queue: DEFAULT_FILTERS.queue, role: DEFAULT_FILTERS.role };
  }
}

function resolve(saved: Saved, setting: Bracket): StatsFilters {
  return {
    queue: saved.queue,
    bracket: saved.bracket && saved.over === setting ? saved.bracket : setting,
    role: saved.role,
  };
}

/** What saved choices show while the settings' bracket is `setting` (Emerald+ by default). */
export function parseFilters(raw: string | null, setting: Bracket = DEFAULT_FILTERS.bracket): StatsFilters {
  return resolve(parseSaved(raw), setting);
}

function load(): Saved {
  try {
    return parseSaved(localStorage.getItem(STORE));
  } catch {
    return parseSaved(null);
  }
}

function save(value: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(value));
  } catch {
    // storage unavailable: the choice still holds for this session
  }
}

const [saved, setSaved] = createSignal<Saved>(load());

/** Current stats filters (queue, bracket, tier-list role). */
export const filters = (): StatsFilters => resolve(saved(), settingsBracket());

/** Changes some filters and remembers them; picking the settings' own bracket follows it again. */
export function setFilter(patch: Partial<StatsFilters>): void {
  const { bracket, over, ...rest } = saved();
  let next: Saved = { ...rest, queue: patch.queue ?? rest.queue, role: patch.role ?? rest.role };
  if (patch.bracket === undefined) {
    if (bracket) next = { ...next, bracket, over: over ?? DEFAULT_FILTERS.bracket };
  } else if (patch.bracket !== settingsBracket()) {
    next = { ...next, bracket: patch.bracket, over: settingsBracket() };
  }
  setSaved(next);
  save(next);
}

/**
 * A link can pick the queue, bracket or role (`#/tier-list?queue=450&role=middle`): valid values
 * are applied (and remembered, like a click), anything else is ignored.
 */
export function applyLinkFilters(params: { queue?: string | null; bracket?: string | null; role?: string | null }): void {
  const patch: Partial<StatsFilters> = {};
  const queue = parseQueue(params.queue);
  const bracket = parseBracket(params.bracket);
  const role = parseRoleFilter(params.role);
  if (queue !== undefined) patch.queue = queue;
  if (bracket !== undefined) patch.bracket = bracket;
  if (role !== undefined) patch.role = role;
  if (Object.keys(patch).length > 0) setFilter(patch);
}
