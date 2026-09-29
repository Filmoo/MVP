/** The match history's filters and pages: pure, shared by the list and its tests. */
import { onHowlingAbyss } from "../../lib/queues";

/** Games per page of the League client's history: a shorter page is its end. */
export const PAGE = 20;

export type QueueFilter = "all" | "solo" | "flex" | "aram" | "other";
export const QUEUES: readonly QueueFilter[] = ["all", "solo", "flex", "aram", "other"];

/** The filter a queue falls under: ARAM takes every Howling Abyss queue (Clash, Mayhem, Poro King…). */
export function queueGroup(queueId: number): Exclude<QueueFilter, "all"> {
  if (queueId === 420) return "solo";
  if (queueId === 440) return "flex";
  return onHowlingAbyss(queueId) ? "aram" : "other";
}

/** `EUW1_7000000001` → 7000000001, the game an LP entry names. */
export const gameIdOf = (matchId: string): number => Number(matchId.slice(matchId.lastIndexOf("_") + 1));
