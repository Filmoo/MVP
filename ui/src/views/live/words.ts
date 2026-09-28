import type { BackendError } from "../../data/generated/BackendError";
import type { ScoutCard } from "../../data/generated/ScoutCard";
import type { ScoutTag } from "../../data/generated/ScoutTag";
import { t } from "../../i18n";
import { percent } from "../../lib/format";

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
  const words = t().live;
  const out: Chip[] = [];
  for (const tag of tags) {
    switch (tag.kind) {
      case "otp":
        out.push({
          kind: "otp",
          label: words.otp(championName(tag.championId)),
          title: words.otpTitle(percent(tag.share), championName(tag.championId)),
        });
        break;
      case "hotStreak":
        out.push({ kind: "streak", label: words.streak(tag.wins), title: words.streakTitle(tag.wins) });
        break;
      case "veteran":
        out.push({ kind: "veteran", label: words.veteran, title: words.veteranTitle(tag.games) });
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
  const words = t().live.scouting;
  switch (error.kind) {
    case "rateLimited":
      return words.busy(error.retryAfter);
    case "network":
      return words.network;
    case "unavailable":
    case "notFound":
      return words.unavailable;
  }
}
