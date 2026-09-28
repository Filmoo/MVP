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
    const top = slicePixels({ name: "top", imageWidth: 1, imageHeight: 12 }, { radius: 12 }, glass, table);
    const [r, g, b, a] = pixel(top, 1, 0, 2);
    expect(r).toBe(128);
    expect(g).toBeGreaterThan(128);
    expect([b, a]).toEqual([128, 255]);
    const left = slicePixels({ name: "left", imageWidth: 12, imageHeight: 1 }, { radius: 12 }, glass, table);
    expect(pixel(left, 12, 2, 0)[0]).toBeGreaterThan(128);
    expect(pixel(left, 12, 2, 0)[1]).toBe(128);
  });

  it("stay neutral past the bezel", () => {
    const corner = slicePixels(
      { name: "tl", imageWidth: 20, imageHeight: 20 },
      { radius: 20 },
      { ...glass, bezel: 8 },
      opticsTable({ ...glass, bezel: 8 }),
    );
    expect(pixel(corner, 20, 19, 19).slice(0, 2)).toEqual([128, 128]);
  });

  it("mirror across the corners", () => {
    const tl = slicePixels({ name: "tl", imageWidth: 12, imageHeight: 12 }, { radius: 12 }, glass, table);
    const br = slicePixels({ name: "br", imageWidth: 12, imageHeight: 12 }, { radius: 12 }, glass, table);
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

  it("scale ±127 to ±max px", () => {
    expect((scaleFor(10) * 127) / 255).toBeCloseTo(10, 9);
  });
});
