import { describe, expect, it } from "vitest";
import { fitted, scaleFor, slicePixels, slices } from "./maps";
import { type Glass, opticsTable } from "./optics";

const glass: Glass = { profile: "squircle", bezel: 12, thickness: 16 };
const table = opticsTable(glass);

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const o = (y * width + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
};

describe("nine slices", () => {
  it("fit the bezel and radius inside the element", () => {
    expect(fitted({ width: 40, height: 20, radius: 30 }, 16)).toEqual({ radius: 10, bezel: 10, corner: 10 });
    expect(fitted({ width: 300, height: 140, radius: 8 }, 16)).toEqual({ radius: 8, bezel: 16, corner: 16 });
  });

  it("frame the element without overlapping", () => {
    const parts = slices({ width: 300, height: 140, radius: 16 }, 16);
    expect(parts.map((p) => p.name)).toEqual(["tl", "tr", "bl", "br", "top", "bottom", "left", "right"]);
    const area = parts.reduce((sum, p) => sum + p.width * p.height, 0);
    // Four corners and four edge strips: exactly the bezel band plus the corner squares.
    expect(area).toBeCloseTo(4 * 16 * 16 + 2 * (300 - 32) * 16 + 2 * (140 - 32) * 16, 6);
    for (const p of parts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(300 + 1e-9);
      expect(p.y + p.height).toBeLessThanOrEqual(140 + 1e-9);
    }
  });

  it("drop edges of zero length (a round knob is four corners)", () => {
    expect(slices({ width: 20, height: 20, radius: 10 }, 10).map((p) => p.name)).toEqual(["tl", "tr", "bl", "br"]);
  });

  it("give a bar along the window's top only its lower rim", () => {
    expect(slices({ width: 1280, height: 40, radius: 0 }, 12, "bottom")).toEqual([
      { name: "bottom", x: 0, y: 28, width: 1280, height: 12, imageWidth: 1, imageHeight: 12 },
    ]);
  });
});

describe("slice pixels", () => {
  it("look inward: down under the top rim, right under the left rim", () => {
    const top = slicePixels({ name: "top", width: 1, height: 12, imageWidth: 1, imageHeight: 12 }, { radius: 12 }, glass, table);
    const [r, g, b, a] = pixel(top, 1, 0, 2);
    expect(r).toBe(128);
    expect(g).toBeGreaterThan(128);
    expect(a).toBe(255);
    // Blue: the tint eases in from the rim inward.
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(pixel(top, 1, 0, 8)[2] ?? 0);
    const left = slicePixels({ name: "left", width: 12, height: 1, imageWidth: 12, imageHeight: 1 }, { radius: 12 }, glass, table);
    expect(pixel(left, 12, 2, 0)[0]).toBeGreaterThan(128);
    expect(pixel(left, 12, 2, 0)[1]).toBe(128);
  });

  it("stay neutral past the bezel", () => {
    const corner = slicePixels(
      { name: "tl", width: 20, height: 20, imageWidth: 20, imageHeight: 20 },
      { radius: 20 },
      { ...glass, bezel: 8 },
      opticsTable({ ...glass, bezel: 8 }),
    );
    expect(pixel(corner, 20, 19, 19).slice(0, 3)).toEqual([128, 128, 255]);
    // Outside the rounded corner there is no glass at all.
    expect(pixel(corner, 20, 0, 0)[2]).toBe(0);
  });

  it("mirror across the corners", () => {
    const tl = slicePixels({ name: "tl", width: 12, height: 12, imageWidth: 12, imageHeight: 12 }, { radius: 12 }, glass, table);
    const br = slicePixels({ name: "br", width: 12, height: 12, imageWidth: 12, imageHeight: 12 }, { radius: 12 }, glass, table);
    for (const [x, y] of [
      [1, 1],
      [3, 7],
      [6, 2],
    ] as const) {
      const [r1, g1] = pixel(tl, 12, x, y);
      const [r2, g2] = pixel(br, 12, 11 - x, 11 - y);
      expect((r1 ?? 0) - 128).toBe(128 - (r2 ?? 0));
      expect((g1 ?? 0) - 128).toBe(128 - (g2 ?? 0));
    }
  });

  it("render the same map at twice the density, sharper", () => {
    const one = slicePixels({ name: "tl", width: 12, height: 12, imageWidth: 12, imageHeight: 12 }, { radius: 12 }, glass, table);
    const two = slicePixels({ name: "tl", width: 12, height: 12, imageWidth: 24, imageHeight: 24 }, { radius: 12 }, glass, table);
    // A CSS pixel's center at 1× falls between four pixels at 2×: close to their average.
    for (const [x, y] of [
      [3, 7],
      [6, 2],
      [8, 8],
    ] as const) {
      const [r1, g1, b1] = pixel(one, 12, x, y);
      const around = [
        [2 * x, 2 * y],
        [2 * x + 1, 2 * y],
        [2 * x, 2 * y + 1],
        [2 * x + 1, 2 * y + 1],
      ].map(([i, j]) => pixel(two, 24, i ?? 0, j ?? 0));
      const mean = (c: number) => around.reduce((sum, p) => sum + (p[c] ?? 0), 0) / 4;
      expect(Math.abs((r1 ?? 0) - mean(0))).toBeLessThan(6);
      expect(Math.abs((g1 ?? 0) - mean(1))).toBeLessThan(6);
      expect(Math.abs((b1 ?? 0) - mean(2))).toBeLessThan(6);
    }
    expect(slices({ width: 300, height: 140, radius: 16 }, 16, "all", 2)[0]).toMatchObject({ width: 16, imageWidth: 32 });
  });

  it("scale ±127 to ±max px", () => {
    expect((scaleFor(10) * 127) / 255).toBeCloseTo(10, 9);
  });
});
