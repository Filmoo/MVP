import type { BackendError } from "../../data/generated/BackendError";
import type { ScoutCard } from "../../data/generated/ScoutCard";
import type { ScoutTag } from "../../data/generated/ScoutTag";

/** A chip on a scouting card: short, positive or neutral (docs/policy.md). */
export interface Chip {
  kind: "otp" | "streak" | "veteran";
  label: string;
  title: string;
}

/**
 * Chips for a card's tags. The main role already has its own line, so it isn't repeated.
 * `championName` words the one-trick tag.
 */
export function chips(tags: readonly ScoutTag[], championName: (id: number) => string): Chip[] {
  const out: Chip[] = [];
  for (const tag of tags) {
    switch (tag.kind) {
      case "otp":
        out.push({
          kind: "otp",
          label: `${championName(tag.championId)} one-trick`,
          title: `${Math.round(tag.share * 100)}% of recent ranked games on ${championName(tag.championId)}`,
        });
        break;
      case "hotStreak":
        out.push({ kind: "streak", label: `${tag.wins} wins in a row`, title: `Won the last ${tag.wins} ranked games` });
        break;
      case "veteran":
        out.push({ kind: "veteran", label: "Veteran", title: `${tag.games} ranked games this season` });
        break;
      case "mainRole":
        break;
    }
  }
  return out;
}

/** The player's record on `championId` within the card's sample, if they played it. */
export function championRecord(card: ScoutCard, championId: number | null) {
  return championId === null ? undefined : card.topChampions.find((c) => c.championId === championId);
}

/** One line for the whole view when the cards couldn't come. */
export function scoutingFailure(error: BackendError): string {
  switch (error.kind) {
    case "rateLimited":
      return error.retryAfter === null
        ? "Riot is busy: player cards paused"
        : `Riot is busy: player cards paused for ${error.retryAfter} s`;
    case "network":
      return "Can't reach MVP's servers: no player cards";
    case "unavailable":
    case "notFound":
      return "Player cards are unavailable right now";
  }
}
