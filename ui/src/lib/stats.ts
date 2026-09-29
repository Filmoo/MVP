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
import type { TierGrade } from "../data/generated/TierGrade";
import type { TierList } from "../data/generated/TierList";
import type { SegmentedOption } from "../design/Segmented";
import { t } from "../i18n";
import { bestMatches } from "./fuzzy";
import { ROLES } from "./roles";
import { ARAM, type Queue, RANKED, type RoleFilter } from "./stats-filters";

/** A stats queue's name: `Ranked Solo`, `ARAM`. */
export const queueLabel = (queue: Queue): string => t().queues[queue];

/** A rank bracket's name: `Emerald+`. */
export const bracketLabel = (bracket: Bracket): string => t().brackets[bracket];

const BRACKETS = ["emeraldPlus", "diamondPlus", "masterPlus"] as const;

/** How the core labels brackets in `DataInfo` (`crates/domain` `Bracket::label`). */
const CORE_LABELS: Record<string, Bracket> = { "Emerald+": "emeraldPlus", "Diamond+": "diamondPlus", "Master+": "masterPlus" };

/** A bracket as the core labels it (`Emerald+`), in the current language. */
export function bracketName(label: string): string {
  const bracket = CORE_LABELS[label];
  return bracket ? bracketLabel(bracket) : label;
}

/** `Ranked Solo · Emerald+`: which data a number comes from. */
export const scopeLabel = (queue: Queue, bracket: Bracket): string => `${queueLabel(queue)} · ${bracketLabel(bracket)}`;

export const queueOptions = (): SegmentedOption<Queue>[] => [
  { value: 420, label: queueLabel(420) },
  { value: 450, label: queueLabel(450) },
];

export const bracketOptions = (): SegmentedOption<Bracket>[] => BRACKETS.map((value) => ({ value, label: bracketLabel(value) }));

/** A stats queue the core named (a game's builds: from its map, as imports decide), if published. */
export function asStatsQueue(queue: number | null | undefined): Queue | undefined {
  return queue === RANKED || queue === ARAM ? queue : undefined;
}

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
  const words = t().stats.errors;
  switch (error.kind) {
    case "notFound":
      return { ...words.notFound, retry: false, empty: true };
    case "rateLimited":
      return { title: words.rateLimited.title, text: words.rateLimited.text(error.retryAfter), retry: true, empty: false };
    case "unavailable":
      return { ...words.unavailable, retry: true, empty: false };
    case "network":
      return { ...words.network, retry: true, empty: false };
  }
}

// ——— Tier list ———

/** A tier-list row with its rank by score within the rows shown (1 = best). */
export type RankedEntry = TierEntry & { rank: number };

/** The table's columns, each sortable. `tier` sorts by the score the tier comes from. */
export type TierSortKey = "rank" | "name" | "role" | "tier" | "winRate" | "pickRate" | "banRate" | "games";
export type SortDir = "asc" | "desc";

/** A row's key: a champion once per role it is played in. */
export const entryKey = (e: { id: number; role?: Role | undefined }): string => `${e.id}:${e.role ?? ""}`;

/** Rows of one role (or all: a champion once per role), ranked by score as published (best first). */
export function rankEntries(entries: readonly TierEntry[], role: RoleFilter): RankedEntry[] {
  const rows = role === "all" ? entries : entries.filter((e) => e.role === role);
  return [...rows].sort((a, b) => b.score - a.score || b.g - a.g || a.id - b.id).map((e, i) => ({ ...e, rank: i + 1 }));
}

/** First direction when a column is picked: names A→Z, ranks 1→n, lanes in map order, the rest high→low. */
export function defaultDir(key: TierSortKey): SortDir {
  return key === "name" || key === "rank" || key === "role" ? "asc" : "desc";
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
      case "tier":
        return e.score;
      case "games":
        return e.g;
      // Map order, then the champions most played there first.
      case "role":
        return (e.role ? ROLES.indexOf(e.role) : 0) - (e.share ?? 0) / 2;
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

export interface TierGroup {
  tier: TierGrade;
  entries: RankedEntry[];
}

const GRADES: readonly TierGrade[] = ["S", "A", "B", "C", "D"];

/** Rows by tier, best tier first (rows keep their order inside a tier; empty tiers left out). */
export function groupByTier(rows: readonly RankedEntry[]): TierGroup[] {
  return GRADES.map((tier) => ({ tier, entries: rows.filter((e) => e.tier === tier) })).filter((g) => g.entries.length > 0);
}

/** Over, under or at 50 % as shown (one decimal): `50.0%` is even, whichever side it is on. */
export const wrSide = (winRate: number): "win" | "loss" | "even" =>
  Math.abs(winRate - 0.5) < 0.0005 ? "even" : winRate > 0.5 ? "win" : "loss";

/** Since the previous patch, in points (`+0.8`: 0.8 points more than then). */
export interface Trend {
  winRate: number;
  pickRate: number;
}

/**
 * Each row's change since the previous patch's list, by `entryKey`: nothing when there is no
 * previous list, when it is the same patch (the current one's files standing in offline) or
 * another data set. A row that wasn't in the previous list has no trend.
 */
export function trendsOf(current: TierList, previous: TierList | null | undefined): Map<string, Trend> | undefined {
  const same = previous && previous.info.queue === current.info.queue && previous.info.bracket === current.info.bracket;
  if (!previous || !same || previous.info.patch === current.info.patch) return undefined;
  const before = new Map(previous.entries.map((e) => [entryKey(e), e]));
  const trends = new Map<string, Trend>();
  for (const e of current.entries) {
    const then = before.get(entryKey(e));
    if (then) trends.set(entryKey(e), { winRate: (e.winRate - then.winRate) * 100, pickRate: (e.pickRate - then.pickRate) * 100 });
  }
  return trends;
}

/** Rows whose champion matches `query`, best match first (champion filter). */
export function matchingEntries(rows: readonly RankedEntry[], query: string, name: (id: number) => string): RankedEntry[] {
  const q = query.trim();
  return q ? bestMatches(q, [...rows], (e) => name(e.id), rows.length) : [...rows];
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
