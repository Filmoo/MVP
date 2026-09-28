/** Pure helpers for the published champion statistics (tier list, champion pages). */
import type { BackendError } from "../data/generated/BackendError";
import type { Bracket } from "../data/generated/Bracket";
import type { BuildOption } from "../data/generated/BuildOption";
import type { BuildSection } from "../data/generated/BuildSection";
import type { BuildStats } from "../data/generated/BuildStats";
import type { ChampionPage } from "../data/generated/ChampionPage";
import type { MatchupEntry } from "../data/generated/MatchupEntry";
import type { Role } from "../data/generated/Role";
import type { StatsIndex } from "../data/generated/StatsIndex";
import type { TierEntry } from "../data/generated/TierEntry";
import type { SegmentedOption } from "../design/Segmented";
import { ROLE_ICON, ROLE_LABEL, ROLES } from "./roles";
import type { Queue, RoleFilter } from "./stats-filters";

export const QUEUE_LABEL: Record<Queue, string> = { 420: "Ranked Solo", 450: "ARAM" };
export const BRACKET_LABEL: Record<Bracket, string> = { emeraldPlus: "Emerald+", diamondPlus: "Diamond+", masterPlus: "Master+" };

export const QUEUE_OPTIONS: SegmentedOption<Queue>[] = [
  { value: 420, label: QUEUE_LABEL[420] },
  { value: 450, label: QUEUE_LABEL[450] },
];

export const BRACKET_OPTIONS: SegmentedOption<Bracket>[] = (["emeraldPlus", "diamondPlus", "masterPlus"] as const).map((value) => ({
  value,
  label: BRACKET_LABEL[value],
}));

export const ROLE_FILTER_OPTIONS: SegmentedOption<RoleFilter>[] = [
  { value: "all", label: "All", icon: "champions" },
  ...ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role], icon: ROLE_ICON[role] })),
];

/** Public name of a game-version patch (`16.19` → `26.19`), from the index; the patch itself without one. */
export function patchName(index: StatsIndex | null | undefined, patch: string): string {
  return index?.patches.find((p) => p.patch === patch)?.name || patch;
}

/** Share of `n` (0 when there is nothing to share). */
export function share(part: number, n: number): number {
  return n > 0 ? part / n : 0;
}

/** Raw win rate of a record, `null` without games. */
export function winRateOf(r: { g: number; w: number }): number | null {
  return r.g > 0 ? r.w / r.g : null;
}

export interface StatsErrorWords {
  title: string;
  text: string;
  /** Asking again can help. */
  retry: boolean;
  /** Nothing is published (an empty state, not an error). */
  empty: boolean;
}

/** How a failed stats request reads. */
export function statsErrorWords(error: BackendError): StatsErrorWords {
  switch (error.kind) {
    case "notFound":
      return {
        title: "No stats published yet",
        text: "Nothing is counted for this queue and rank on the current patch yet. Stats appear here as soon as they are published.",
        retry: false,
        empty: true,
      };
    case "rateLimited":
      return {
        title: "Too many requests right now",
        text: error.retryAfter === null ? "Try again in a moment." : `Try again in ${error.retryAfter} s.`,
        retry: true,
        empty: false,
      };
    case "unavailable":
      return {
        title: "Stats are unavailable",
        text: "Our stats service can't answer right now. Try again in a moment.",
        retry: true,
        empty: false,
      };
    case "network":
      return {
        title: "Can't reach MVP's servers",
        text: "Check your internet connection, then try again. Stats you opened before stay available offline.",
        retry: true,
        empty: false,
      };
  }
}

// ——— Tier list ———

/** A tier-list row with its rank by score within the rows shown (1 = best). */
export type RankedEntry = TierEntry & { rank: number };

export type TierSortKey = "rank" | "name" | "winRate" | "pickRate" | "banRate" | "score";
export type SortDir = "asc" | "desc";

/** Rows of one role (or all), ranked by score as published (best first). */
export function rankEntries(entries: readonly TierEntry[], role: RoleFilter): RankedEntry[] {
  const rows = role === "all" ? entries : entries.filter((e) => e.role === role);
  return [...rows].sort((a, b) => b.score - a.score || b.g - a.g || a.id - b.id).map((e, i) => ({ ...e, rank: i + 1 }));
}

/** First direction when a column is picked: names A→Z, ranks 1→n, numbers high→low. */
export function defaultDir(key: TierSortKey): SortDir {
  return key === "name" || key === "rank" ? "asc" : "desc";
}

export function sortEntries(rows: readonly RankedEntry[], key: TierSortKey, dir: SortDir, name: (id: number) => string): RankedEntry[] {
  const value = (e: RankedEntry): number => {
    switch (key) {
      case "winRate":
        return e.winRate;
      case "pickRate":
        return e.pickRate;
      case "banRate":
        return e.banRate;
      case "score":
        return e.score;
      default:
        return e.rank;
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  const compare =
    key === "name"
      ? (a: RankedEntry, b: RankedEntry) => name(a.id).localeCompare(name(b.id)) * sign || a.rank - b.rank
      : (a: RankedEntry, b: RankedEntry) => (value(a) - value(b)) * sign || a.rank - b.rank;
  return [...rows].sort(compare);
}

// ——— Champion pages ———

/** One role tab of a champion page: `role` is `undefined` in ARAM. */
export interface RoleTab {
  role: Role | undefined;
  g: number;
  /** Share of the champion's games. */
  share: number;
}

/** Below this share, a role without builds or a tier row is noise: no tab. */
const MIN_TAB_SHARE = 0.05;

/** The roles a champion is played in, most played first: those with builds or a tier row. */
export function roleTabs(page: ChampionPage): RoleTab[] {
  const stats = page.stats;
  if (!stats || stats.g === 0) return [];
  const published = new Set<Role | undefined>([...(page.builds?.roles ?? []).map((b) => b.role), ...page.tiers.map((t) => t.role)]);
  return stats.roles
    .filter((r) => published.has(r.role) || share(r.g, stats.g) >= MIN_TAB_SHARE)
    .map((r) => ({ role: r.role, g: r.g, share: share(r.g, stats.g) }));
}

/** The role to show: the asked one when the champion is played there, else its main role. */
export function pickRole(tabs: readonly RoleTab[], wanted: Role | undefined): Role | undefined {
  return tabs.find((t) => t.role === wanted)?.role ?? tabs[0]?.role;
}

export function buildFor(page: ChampionPage, role: Role | undefined): BuildStats | undefined {
  return page.builds?.roles.find((b) => b.role === role);
}

export function tierFor(page: ChampionPage, role: Role | undefined): TierEntry | undefined {
  return page.tiers.find((t) => t.role === role);
}

/** A build option's pick share within its section. */
export function optionShare(option: BuildOption, section: BuildSection): number {
  return share(option.g, section.n);
}

/** Best and worst pairs by shrunk effect `d` (positive = good for this champion), `n` of each. */
export function bestAndWorst(entries: readonly MatchupEntry[], n: number): { best: MatchupEntry[]; worst: MatchupEntry[] } {
  const best = entries
    .filter((e) => e.d > 0)
    .sort((a, b) => b.d - a.d || b.g - a.g)
    .slice(0, n);
  const worst = entries
    .filter((e) => e.d < 0)
    .sort((a, b) => a.d - b.d || b.g - a.g)
    .slice(0, n);
  return { best, worst };
}

/** Ability keys by slot (1 = Q … 4 = R). */
export const SKILL_KEYS: Record<number, string> = { 1: "Q", 2: "W", 3: "E", 4: "R" };
