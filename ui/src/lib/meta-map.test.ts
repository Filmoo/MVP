import { describe, expect, it } from "vitest";
import { mapDomain, tierBands, xOf, yOf } from "./meta-map";

const row = (score: number, pickRate: number) => ({ score, pickRate });

describe("the meta map's plane", () => {
  it("spans the rows' popularity, from the least to the most picked", () => {
    const d = mapDomain([row(1, 0.005), row(-1, 0.2), row(0, 0.03)]);
    expect(xOf(d, 0.005)).toBeGreaterThan(0);
    expect(xOf(d, 0.005)).toBeLessThan(0.1);
    expect(xOf(d, 0.2)).toBeLessThan(1);
    expect(xOf(d, 0.2)).toBeGreaterThan(0.9);
  });

  it("spreads close pick rates (ARAM's) over at least 8× across, in the middle", () => {
    const d = mapDomain([row(0, 0.04), row(1, 0.05), row(-1, 0.06)]);
    expect(Math.exp(d.x1 - d.x0)).toBeCloseTo(8);
    const left = xOf(d, 0.04);
    const right = xOf(d, 0.06);
    expect(left).toBeGreaterThan(0.25);
    expect(right).toBeLessThan(0.75);
    expect(right - left).toBeGreaterThan(0.15);
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
