import { describe, expect, it } from "vitest";
import { extractPalette, fromOklch, oklab, type Rgb } from "./palette";

/** A width×width image: `fill` everywhere, `center` in the middle half (like a portrait). */
function image(width: number, fill: Rgb, center?: Rgb): number[] {
  const px: number[] = [];
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const inside = center && x >= width / 4 && x < (3 * width) / 4 && y >= width / 4 && y < (3 * width) / 4;
      px.push(...(inside ? center : fill), 255);
    }
  }
  return px;
}

const lightness = (c: Rgb) => oklab(c)[0];
const hue = (c: Rgb) => {
  const [, a, b] = oklab(c);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};

describe("palette", () => {
  it("round-trips OKLCH and keeps colors in gamut", () => {
    for (const h of [0, 60, 140, 220, 300]) {
      const c = fromOklch(0.8, 0.3, h); // far too much chroma: must be clamped, not clipped
      expect(c.every((v) => v >= 0 && v <= 255)).toBe(true);
      expect(lightness(c)).toBeCloseTo(0.8, 1);
    }
  });

  it("gives every image pastels of the same perceived lightness", () => {
    const brown = extractPalette(image(12, [110, 70, 40]), 12);
    const neon = extractPalette(image(12, [20, 240, 255]), 12);
    expect(brown && neon).toBeTruthy();
    for (const p of [brown, neon]) {
      if (!p) continue;
      expect(lightness(p.primary)).toBeCloseTo(0.8, 1);
      expect(lightness(p.secondary)).toBeCloseTo(0.8, 1);
    }
  });

  it("keeps the source hue", () => {
    const red = extractPalette(image(12, [200, 30, 40]), 12);
    expect(red).toBeTruthy();
    const h = hue(red?.primary ?? [0, 0, 0]);
    expect(h < 45 || h > 340).toBe(true);
  });

  it("favours the subject in the center over a bigger background", () => {
    // Blue background (3/4 of pixels) around a red subject: the subject still leads.
    const p = extractPalette(image(12, [30, 60, 200], [220, 40, 50]), 12);
    const h = hue(p?.primary ?? [0, 0, 0]);
    expect(h < 45 || h > 340).toBe(true);
    const h2 = hue(p?.secondary ?? [0, 0, 0]);
    expect(h2).toBeGreaterThan(220);
    expect(h2).toBeLessThan(300);
  });

  it("returns null for colorless or transparent images", () => {
    expect(extractPalette(image(8, [128, 128, 128]), 8)).toBeNull();
    expect(extractPalette([0, 0, 0, 0], 1)).toBeNull();
  });
});

describe("palette glows", () => {
  it("are deeper than the pastels and keep chroma, so they stay colored over near-black", () => {
    const p = extractPalette(image(12, [200, 30, 40]), 12);
    expect(p).toBeTruthy();
    if (!p) return;
    expect(lightness(p.glowA)).toBeLessThan(lightness(p.primary));
    const [, a, b] = oklab(p.glowA);
    expect(Math.hypot(a, b)).toBeGreaterThan(0.1);
  });

  it("don't lead with mud: a dull brown mass loses to a small vivid accent", () => {
    // Rock-brown everywhere, a teal glow in the middle quarter.
    const p = extractPalette(image(12, [120, 95, 70], [40, 210, 200]), 12);
    const h = hue(p?.primary ?? [0, 0, 0]);
    expect(h).toBeGreaterThan(150);
    expect(h).toBeLessThan(230);
  });
});
