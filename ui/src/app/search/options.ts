import type { ChampionInfo } from "../../data/generated/ChampionInfo";
import type { RiotId } from "../../data/generated/RiotId";
import { bestMatches } from "../../lib/fuzzy";
import { type RecentSearch, recentKey } from "../../lib/recent";
import { parseRiotId } from "../../lib/riot-id";

/** Something Enter (or a click) opens. */
export type SearchOption =
  | { kind: "champion"; key: string; championId: number; recent: boolean }
  | { kind: "player"; key: string; platform: string; riotId: RiotId; recent: boolean };

/** A note row in a section: not selectable. */
export type SearchNote = "noChampion" | "typeRiotId";

export interface SearchSection {
  id: "recent" | "champions" | "players";
  title: string;
  options: SearchOption[];
  note?: SearchNote;
}

export const MAX_CHAMPIONS = 5;

/**
 * The dropdown's content: a pure function of what is typed (plus local data), so nothing that
 * arrives later (a player lookup) can add, remove or reorder rows. Sections are always
 * Champions then Players; an empty query lists recent searches.
 */
export function buildSections(
  query: string,
  platform: string,
  champions: readonly ChampionInfo[],
  recent: readonly RecentSearch[],
): SearchSection[] {
  const text = query.trim();
  if (!text) {
    return recent.length === 0
      ? []
      : [
          {
            id: "recent",
            title: "Recent",
            options: recent.map((r) =>
              r.kind === "champion"
                ? { kind: "champion", key: recentKey(r), championId: r.championId, recent: true }
                : { kind: "player", key: recentKey(r), platform: r.platform, riotId: r.riotId, recent: true },
            ),
          },
        ];
  }
  const riotId = parseRiotId(text);
  // "Ahri#EUW" is a player, but its name still finds the champion.
  const hash = text.indexOf("#");
  const championQuery = hash >= 0 ? text.slice(0, hash) : text;
  const matches = bestMatches(championQuery, champions, (c) => c.name, MAX_CHAMPIONS);
  const championSection: SearchSection = {
    id: "champions",
    title: "Champions",
    options: matches.map((c) => ({ kind: "champion", key: `c:${c.id}`, championId: c.id, recent: false })),
  };
  if (matches.length === 0) championSection.note = "noChampion";
  const players: SearchSection = { id: "players", title: "Players", options: [] };
  if (riotId) players.options.push({ kind: "player", key: `p:${platform}`, platform, riotId, recent: false });
  else players.note = "typeRiotId";
  return [championSection, players];
}

/**
 * The option highlighted when the query changes: a full Riot ID means a player, anything else
 * the best champion. Also a pure function of the query.
 */
export function defaultIndex(query: string, options: readonly SearchOption[]): number {
  if (options.length === 0) return -1;
  if (parseRiotId(query.trim())) {
    const player = options.findIndex((o) => o.kind === "player");
    if (player >= 0) return player;
  }
  return 0;
}
