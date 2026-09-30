import { describe, expect, it } from "vitest";
import type { TierGrade } from "../data/generated/TierGrade";
import { mapDomain, placeOnMap, tierBands, xOf, yOf } from "./meta-map";

const row = (score: number, pickRate: number) => ({ score, pickRate, role: "middle" as const });

describe("the meta map's plane", () => {
  it("spans the rows' popularity, from the least to the most picked", () => {
    const d = mapDomain([row(1, 0.005), row(-1, 0.2), row(0, 0.03)]);
    expect(xOf(d, 0.005)).toBeGreaterThan(0);
    expect(xOf(d, 0.005)).toBeLessThan(0.1);
    expect(xOf(d, 0.2)).toBeLessThan(1);
    expect(xOf(d, 0.2)).toBeGreaterThan(0.9);
  });

  it("spreads close pick rates over at least 8× across, ARAM's (no lanes) over 4×, in the middle", () => {
    const close = [row(0, 0.04), row(1, 0.05), row(-1, 0.06)];
    const d = mapDomain(close);
    expect(Math.exp(d.x1 - d.x0)).toBeCloseTo(8);
    const left = xOf(d, 0.04);
    const right = xOf(d, 0.06);
    expect(left).toBeGreaterThan(0.25);
    expect(right).toBeLessThan(0.75);
    expect(right - left).toBeGreaterThan(0.15);
    const aram = mapDomain(close.map(({ score, pickRate }) => ({ score, pickRate })));
    expect(Math.exp(aram.x1 - aram.x0)).toBeCloseTo(4);
    expect(xOf(aram, 0.06) - xOf(aram, 0.04)).toBeGreaterThan(right - left);
  });

  it("keeps every tier's cut-off in view: scores from −3 to +3 at least, strongest on top", () => {
    const d = mapDomain([row(0.2, 0.05)]);
    expect(d.y0).toBeLessThanOrEqual(-3);
    expect(d.y1).toBeGreaterThanOrEqual(3);
    expect(yOf(d, 3)).toBeLessThan(yOf(d, -3));
    expect(tierBands(d).map((b) => b.tier)).toEqual(["S", "A", "B", "C", "D"]);
  });

  it("stacks the bands from the top, each where its scores are", () => {
    const d = mapDomain([row(5, 0.05), row(-5, 0.05)]);
    const bands = tierBands(d);
    expect(bands[0]?.top).toBe(0);
    const last = bands.at(-1);
    expect((last?.top ?? 0) + (last?.height ?? 0)).toBeCloseTo(1);
    for (const [i, band] of bands.entries()) {
      const next = bands[i + 1];
      if (next) expect(band.top + band.height).toBeCloseTo(next.top);
    }
  });

  it("frames an empty list like a lane's", () => {
    const d = mapDomain([]);
    expect(xOf(d, 0.01)).toBeGreaterThan(0);
    expect(xOf(d, 0.1)).toBeLessThan(1);
  });
});

describe("faces on the map", () => {
  const size = { w: 800, h: 480 };
  // A crowd right on the A/B cut-off (score 0.75), all as popular: half A, half B.
  const crowd = Array.from({ length: 12 }, (_, i) => ({
    score: i % 2 ? 0.76 : 0.74,
    pickRate: 0.05,
    role: "middle" as const,
    tier: (i % 2 ? "A" : "B") as TierGrade,
  }));
  const d = mapDomain(crowd);
  const placed = placeOnMap(crowd, d, size, 16, 22);

  it("keeps each face, all of it, in its own tier's band, however crowded", () => {
    const bands = new Map(tierBands(d).map((b) => [b.tier, b]));
    for (const p of placed) {
      const band = bands.get(p.e.tier);
      expect(p.y - 16).toBeGreaterThanOrEqual((band?.top ?? 0) * size.h - 1e-6);
      expect(p.y + 16).toBeLessThanOrEqual(((band?.top ?? 0) + (band?.height ?? 0)) * size.h + 1e-6);
    }
  });

  it("spreads a crowd along popularity, apart and inside the plot", () => {
    const xs = placed.map((p) => p.x);
    const ys = placed.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(22);
      expect(p.x).toBeLessThanOrEqual(size.w - 22);
    }
    const overlapping = placed.flatMap((a, i) => placed.slice(i + 1).filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < 32));
    expect(overlapping).toEqual([]);
  });

  it("leaves dots where they are, touching or not", () => {
    const b = { score: 0, pickRate: 0.05, role: "middle" as const, tier: "B" as TierGrade };
    const dots = placeOnMap([b, b], d, size, 0, 9);
    for (const dot of dots) {
      expect(dot.x).toBeCloseTo(xOf(d, 0.05) * size.w);
      expect(dot.y).toBeCloseTo(yOf(d, 0) * size.h);
    }
  });
});
