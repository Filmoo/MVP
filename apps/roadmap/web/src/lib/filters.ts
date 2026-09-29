/** Filters (area, status, who proposed) and search, kept in the URL so a reload keeps them. */
import { type Feature, LANES, type Proposer, STATUSES, type Status } from "../types";

export interface Filters {
  query: string;
  areas: string[];
  /** Empty: every status but rejected. */
  statuses: Status[];
  proposers: Proposer[];
}

export const NO_FILTERS: Filters = { query: "", areas: [], statuses: [], proposers: [] };

/** Lowercase without accents, for matching ("Épée" finds "epee"). */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function shownStatuses(filters: Filters): readonly Status[] {
  return filters.statuses.length > 0 ? filters.statuses : LANES;
}

export function isFiltered(filters: Filters): boolean {
  return filters.query.trim() !== "" || filters.areas.length > 0 || filters.statuses.length > 0 || filters.proposers.length > 0;
}

/** Whether a (live) feature shows: every word of the search in its title, description or area. */
export function matches(feature: Feature, filters: Filters, areaName: (key: string) => string): boolean {
  if (feature.removedAt) return false;
  if (!shownStatuses(filters).includes(feature.status)) return false;
  if (filters.areas.length > 0 && !filters.areas.includes(feature.area)) return false;
  if (filters.proposers.length > 0 && !filters.proposers.includes(feature.proposedBy)) return false;
  const words = fold(filters.query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(`${feature.title} ${feature.description} ${areaName(feature.area)} #${feature.id}`);
  return words.every((word) => haystack.includes(word));
}

const PROPOSERS: readonly Proposer[] = ["owner", "claude"];

/** `area=draft,live&status=done&by=claude&q=glass` → filters (unknown values dropped). */
export function fromParams(params: URLSearchParams, areaKeys: readonly string[] | null = null): Filters {
  const list = (name: string) =>
    (params.get(name) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  return {
    query: params.get("q") ?? "",
    areas: list("area").filter((a) => areaKeys === null || areaKeys.includes(a)),
    statuses: list("status").filter((s): s is Status => (STATUSES as readonly string[]).includes(s)),
    proposers: list("by").filter((p): p is Proposer => (PROPOSERS as readonly string[]).includes(p)),
  };
}

export function toParams(filters: Filters, into = new URLSearchParams()): URLSearchParams {
  const set = (name: string, values: readonly string[]) => {
    if (values.length > 0) into.set(name, values.join(","));
    else into.delete(name);
  };
  set("area", filters.areas);
  set("status", filters.statuses);
  set("by", filters.proposers);
  if (filters.query.trim()) into.set("q", filters.query);
  else into.delete("q");
  return into;
}

/** Adds or removes one value of a list filter. */
export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
