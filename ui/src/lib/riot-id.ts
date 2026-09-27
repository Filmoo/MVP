import type { RiotId } from "../data/generated/RiotId";

/** Platforms the backend knows, EUW first (the app's first region). `label` is what players say. */
export const PLATFORMS = [
  { id: "euw1", label: "EUW" },
  { id: "eun1", label: "EUNE" },
  { id: "na1", label: "NA" },
  { id: "kr", label: "KR" },
  { id: "br1", label: "BR" },
  { id: "jp1", label: "JP" },
  { id: "la1", label: "LAN" },
  { id: "la2", label: "LAS" },
  { id: "me1", label: "ME" },
  { id: "oc1", label: "OCE" },
  { id: "ru", label: "RU" },
  { id: "sg2", label: "SEA" },
  { id: "tr1", label: "TR" },
  { id: "tw2", label: "TW" },
  { id: "vn2", label: "VN" },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]["id"];
export const DEFAULT_PLATFORM: PlatformId = "euw1";

export function isPlatform(id: string): id is PlatformId {
  return PLATFORMS.some((p) => p.id === id);
}

export function platformLabel(id: string): string {
  return PLATFORMS.find((p) => p.id === id)?.label ?? id.toUpperCase();
}

/** Riot's limits: game name up to 16 characters, tag line up to 5 letters or digits. */
const TAG = /^[\p{L}\p{N}]{1,5}$/u;

/** `Name#TAG` → Riot ID; `null` when the text isn't one (yet). */
export function parseRiotId(text: string): RiotId | null {
  const hash = text.lastIndexOf("#");
  if (hash < 0) return null;
  const gameName = text.slice(0, hash).trim().replace(/\s+/g, " ");
  const tagLine = text.slice(hash + 1).trim();
  if (gameName.length === 0 || [...gameName].length > 16 || !TAG.test(tagLine)) return null;
  return { gameName, tagLine };
}

export function formatRiotId(id: RiotId): string {
  return `${id.gameName}#${id.tagLine}`;
}

/** Same player whatever the case (Riot IDs are case-insensitive). */
export function riotIdKey(platform: string, id: RiotId): string {
  return `${platform}/${id.gameName.toLowerCase()}#${id.tagLine.toLowerCase()}`;
}

/** Route of a player's page. */
export function playerPath(platform: string, id: RiotId): string {
  return `/player/${platform}/${encodeURIComponent(id.gameName)}/${encodeURIComponent(id.tagLine)}`;
}

/** Inverse of `playerPath`; `null` for anything else. */
export function parsePlayerPath(path: string): { platform: string; riotId: RiotId } | null {
  const match = /^\/player\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
  if (!match) return null;
  try {
    const [, platform = "", name = "", tag = ""] = match;
    const riotId = { gameName: decodeURIComponent(name), tagLine: decodeURIComponent(tag) };
    return riotId.gameName && riotId.tagLine ? { platform: platform.toLowerCase(), riotId } : null;
  } catch {
    return null; // malformed escape
  }
}
