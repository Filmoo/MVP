import type { BackendError } from "../data/generated/BackendError";
import type { PlayerProfile } from "../data/generated/PlayerProfile";
import type { RiotId } from "../data/generated/RiotId";
import { CommandError, type Transport } from "../data/transport";
import { t } from "../i18n";
import { formatRiotId, platformLabel, riotIdKey } from "./riot-id";

/** Same freshness as the backend's own cache: a lookup the search bar made is reused by the page. */
const TTL_MS = 2 * 60_000;
const cache = new Map<string, { at: number; answer: Promise<PlayerProfile> }>();

/**
 * A player's profile, shared by the search bar (preview) and the player page, so opening a
 * result doesn't ask twice. Failures are never cached: "Try again" really asks again.
 */
export function lookupPlayer(transport: Transport, platform: string, riotId: RiotId): Promise<PlayerProfile> {
  const key = riotIdKey(platform, riotId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.answer;
  const answer = transport.call("search_player", { riotId, platform });
  cache.set(key, { at: Date.now(), answer });
  answer.catch(() => {
    if (cache.get(key)?.answer === answer) cache.delete(key);
  });
  return answer;
}

/** The backend error behind a failed call (anything else reads as "unreachable"). */
export function backendError(error: unknown): BackendError {
  const detail = error instanceof CommandError ? error.detail : undefined;
  if (detail && typeof detail === "object" && "kind" in detail) return detail as BackendError;
  return { kind: "network", message: error instanceof Error ? error.message : String(error) };
}

export interface ErrorWords {
  title: string;
  text: string;
  /** Asking again can help. */
  retry: boolean;
}

/** How a failed player lookup reads, for `riotId` on `platform`. */
export function lookupErrorWords(error: BackendError, riotId: RiotId, platform: string): ErrorWords {
  const words = t().players;
  switch (error.kind) {
    case "notFound":
      return { title: words.notFound.title, text: words.notFound.text(formatRiotId(riotId), platformLabel(platform)), retry: false };
    case "rateLimited":
      return { title: words.rateLimited.title, text: words.rateLimited.text(error.retryAfter), retry: true };
    case "unavailable":
      return { ...words.unavailable, retry: true };
    case "network":
      return { ...words.network, retry: true };
  }
}
