import { createSignal } from "solid-js";
import type { RiotId } from "../data/generated/RiotId";
import { riotIdKey } from "./riot-id";

/** A search the player opened: kept locally (this machine only), newest first. */
export type RecentSearch = { kind: "champion"; championId: number } | { kind: "player"; platform: string; riotId: RiotId };

export const MAX_RECENT = 8;
const STORE = "mvp.recent-searches.v1";

function load(): RecentSearch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed.filter(valid).slice(0, MAX_RECENT) as RecentSearch[]) : [];
  } catch {
    return [];
  }
}

function valid(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Partial<RecentSearch> & { riotId?: Partial<RiotId> };
  if (e.kind === "champion") return typeof (e as { championId?: unknown }).championId === "number";
  return (
    e.kind === "player" &&
    typeof (e as { platform?: unknown }).platform === "string" &&
    typeof e.riotId?.gameName === "string" &&
    typeof e.riotId.tagLine === "string"
  );
}

function save(list: RecentSearch[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    // storage unavailable: the list still works for this session
  }
}

export function recentKey(entry: RecentSearch): string {
  return entry.kind === "champion" ? `c:${entry.championId}` : `p:${riotIdKey(entry.platform, entry.riotId)}`;
}

const [recent, setRecent] = createSignal<RecentSearch[]>(load());

/** Recent searches, newest first (at most `MAX_RECENT`). */
export { recent };

export function remember(entry: RecentSearch): void {
  const key = recentKey(entry);
  const next = [entry, ...recent().filter((e) => recentKey(e) !== key)].slice(0, MAX_RECENT);
  setRecent(next);
  save(next);
}

export function clearRecent(): void {
  setRecent([]);
  save([]);
}
