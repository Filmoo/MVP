/**
 * The meta map's plane (tier list: the small map by the podium, the full one): strength (the
 * score) up, popularity (pick rate, on a log scale) across, each tier a band of the strength axis.
 */
import type { TierGrade } from "../data/generated/TierGrade";
import type { RankedEntry } from "./stats";

export interface MapDomain {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

/** Across, at least this many times more picked at the right than at the left. */
const MIN_SPREAD = Math.log(8);

/**
 * The plane around the rows: every tier's cut-off near 0 in view (scores from −3 to +3 at least),
 * popularity from the least to the most picked; close pick rates (ARAM's) are spread over at
 * least 8× across rather than bunched on one side.
 */
export function mapDomain(rows: readonly Pick<RankedEntry, "score" | "pickRate">[]): MapDomain {
  let low = -3;
  let high = 3;
  let few = Number.POSITIVE_INFINITY;
  let many = 0;
  for (const e of rows) {
    low = Math.min(low, e.score);
    high = Math.max(high, e.score);
    if (e.pickRate > 0) {
      few = Math.min(few, e.pickRate);
      many = Math.max(many, e.pickRate);
    }
  }
  if (many === 0) {
    few = 0.004;
    many = 0.12;
  }
  let x0 = Math.log(few / 1.2);
  let x1 = Math.log(many * 1.25);
  const short = MIN_SPREAD - (x1 - x0);
  if (short > 0) {
    x0 -= short / 2;
    x1 += short / 2;
  }
  return { y0: low - 0.5, y1: high + 0.5, x0, x1 };
}

/** Across, 0 (rarely picked) to 1 (most picked). */
export const xOf = (d: MapDomain, pickRate: number): number => (Math.log(Math.max(pickRate, 1e-4)) - d.x0) / (d.x1 - d.x0);
/** Down, 0 (strongest, at the top) to 1. */
export const yOf = (d: MapDomain, score: number): number => 1 - (score - d.y0) / (d.y1 - d.y0);

/** Score cut-offs (crates/aggregate): each tier is a band of the strength axis. */
const CUTS: Record<TierGrade, [number, number]> = { S: [2, 99], A: [0.75, 2], B: [-0.75, 0.75], C: [-2, -0.75], D: [-99, -2] };

/** Each tier's band, top and height as shares of the plot (empty bands left out). */
export function tierBands(d: MapDomain): Array<{ tier: TierGrade; top: number; height: number }> {
  return (Object.keys(CUTS) as TierGrade[]).flatMap((tier) => {
    const [lo, hi] = CUTS[tier];
    const top = Math.max(0, yOf(d, Math.min(hi, d.y1)));
    const bottom = Math.min(1, yOf(d, Math.max(lo, d.y0)));
    return bottom > top ? [{ tier, top, height: bottom - top }] : [];
  });
}

/** A dot's colour: its tier's, always (lane colours match tier colours: one meaning per page). */
export const dotTone = (e: Pick<RankedEntry, "tier">): string => `var(--tier-${e.tier.toLowerCase()})`;
