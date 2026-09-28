import { createSignal } from "solid-js";
import type { Bracket } from "../data/generated/Bracket";
import type { Role } from "../data/generated/Role";

/** Queues with published stats: 420 = ranked solo/duo, 450 = ARAM. */
export type Queue = 420 | 450;
export const RANKED: Queue = 420;
export const ARAM: Queue = 450;

export type RoleFilter = Role | "all";

/** What the stats pages show: remembered on this machine, shared by the tier list and champion pages. */
export interface StatsFilters {
  queue: Queue;
  bracket: Bracket;
  /** Tier list only (champion pages have their own role tabs). */
  role: RoleFilter;
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

/** Saved filters, each field checked on its own (a bad one falls back to its default). */
export function parseFilters(raw: string | null): StatsFilters {
  try {
    const saved = JSON.parse(raw ?? "{}") as Partial<Record<keyof StatsFilters, unknown>> | null;
    return {
      queue: parseQueue(saved?.queue) ?? DEFAULT_FILTERS.queue,
      bracket: parseBracket(saved?.bracket) ?? DEFAULT_FILTERS.bracket,
      role: parseRoleFilter(saved?.role) ?? DEFAULT_FILTERS.role,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function load(): StatsFilters {
  try {
    return parseFilters(localStorage.getItem(STORE));
  } catch {
    return DEFAULT_FILTERS;
  }
}

function save(value: StatsFilters): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(value));
  } catch {
    // storage unavailable: the choice still holds for this session
  }
}

const [filters, setFilters] = createSignal<StatsFilters>(load(), {
  equals: (a, b) => a.queue === b.queue && a.bracket === b.bracket && a.role === b.role,
});

/** Current stats filters (queue, bracket, tier-list role). */
export { filters };

/** Changes some filters and remembers them. */
export function setFilter(patch: Partial<StatsFilters>): void {
  const next = { ...filters(), ...patch };
  setFilters(next);
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
