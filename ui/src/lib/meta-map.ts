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
/** ARAM (rows without lanes): its close pick rates spread wider. */
const ARAM_SPREAD = Math.log(4);

/**
 * The plane around the rows: every tier's cut-off near 0 in view (scores from −3 to +3 at least),
 * popularity from the least to the most picked; close pick rates are spread over at least 8×
 * across (ARAM's, whose rows have no lane, 4×) rather than bunched on one side.
 */
export function mapDomain(rows: readonly Pick<RankedEntry, "score" | "pickRate" | "role">[]): MapDomain {
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
  const short = (rows.some((e) => e.role) ? MIN_SPREAD : ARAM_SPREAD) - (x1 - x0);
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

/** A dot's colour: its tier's (on the tier list, colours are the tiers' and win rates' alone). */
export const dotTone = (e: Pick<RankedEntry, "tier">): string => `var(--tier-${e.tier.toLowerCase()})`;

export interface Placed<T> {
  e: T;
  x: number;
  y: number;
}

/**
 * Where each row sits on a `w` × `h` plot, in px. Faces (`r` their radius) are pushed apart where
 * they would overlap, sideways (the push across tiers is damped) so a crowd spreads along
 * popularity; each stays inside its tier's band (2 px in) and `edge` px inside the plot. Dots
 * (`r` 0) only stay inside.
 */
export function placeOnMap<T extends Pick<RankedEntry, "score" | "pickRate" | "tier">>(
  rows: readonly T[],
  d: MapDomain,
  size: { w: number; h: number },
  r: number,
  edge: number,
): Placed<T>[] {
  const { w, h } = size;
  const bands = new Map(tierBands(d).map((b) => [b.tier, b]));
  const inside = (p: Placed<T>) => {
    const band = bands.get(p.e.tier);
    const top = Math.max(edge, band ? band.top * h + 2 : 0);
    const bottom = Math.max(top, Math.min(h - edge, band ? (band.top + band.height) * h - 2 : h));
    p.x = Math.min(Math.max(p.x, edge), w - edge);
    p.y = Math.min(Math.max(p.y, top), bottom);
  };
  const points = rows.map((e) => ({ e, x: xOf(d, e.pickRate) * w, y: yOf(d, e.score) * h }));
  const gap = r > 0 ? r * 2 + 2 : 0;
  for (let round = 0; round < 40; round++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= gap) continue;
        // Sideways in full (one above the other still parts left and right), across tiers a little.
        const push = (gap - dist) / 2;
        const side = dx < 0 ? -1 : 1;
        const uy = dist > 0.01 ? dy / dist : 0;
        a.x -= side * push;
        a.y -= uy * push * 0.4;
        b.x += side * push;
        b.y += uy * push * 0.4;
        moved = true;
      }
    }
    for (const p of points) inside(p);
    if (!moved) break;
  }
  return points;
}
