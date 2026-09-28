import { describe, expect, it } from "vitest";
import { displacement, type Glass, IOR, lookup, opticsTable, reflectance, rim, surface, surfaceSlope } from "./optics";

const slab: Glass = { profile: "squircle", bezel: 16, thickness: 22 };

describe("glass surface", () => {
  it("rises from the rim to a flat top", () => {
    for (const profile of ["squircle", "circle"] as const) {
      expect(surface(profile, 0)).toBe(0);
      expect(surface(profile, 1)).toBe(1);
      let last = -1;
      for (let t = 0; t <= 1; t += 0.05) {
        const h = surface(profile, t);
        expect(h).toBeGreaterThanOrEqual(last);
        last = h;
      }
      expect(surfaceSlope(profile, 0)).toBe(Number.POSITIVE_INFINITY);
      expect(surfaceSlope(profile, 1)).toBe(0);
    }
  });

  it("keeps a squircle flatter for longer than a circle", () => {
    expect(surface("squircle", 0.5)).toBeGreaterThan(surface("circle", 0.5));
  });
});

describe("refraction (Snell)", () => {
  it("bends light inward across the bezel and not at all on the flat top", () => {
    expect(displacement(slab, 1)).toBe(0);
    expect(displacement(slab, 0)).toBe(0); // the rim itself has no height to cross
    for (const t of [0.05, 0.2, 0.5, 0.8]) expect(displacement(slab, t)).toBeGreaterThan(0);
  });

  it("never bends further than a grazing ray could travel through the glass", () => {
    const eta = 1 / IOR;
    const bound = (slab.thickness * Math.sqrt(1 - eta * eta)) / eta;
    for (let t = 0.01; t < 1; t += 0.01) expect(displacement(slab, t)).toBeLessThanOrEqual(bound + 1e-9);
  });

  it("bends more through thicker glass and not at all without a lens (ior 1)", () => {
    expect(displacement({ ...slab, thickness: 30 }, 0.3)).toBeGreaterThan(displacement(slab, 0.3));
    expect(displacement({ ...slab, ior: 1 }, 0.3)).toBeCloseTo(0, 9);
  });

  it("magnifies under a dome: the pull grows with the distance from the middle", () => {
    const dome: Glass = { profile: "circle", bezel: 20, thickness: 12 };
    // t = 1 is the middle; the pull (and so the zoom) builds up toward the rim.
    expect(displacement(dome, 0.9)).toBeLessThan(displacement(dome, 0.7));
    expect(displacement(dome, 0.7)).toBeLessThan(displacement(dome, 0.5));
  });
});

describe("Fresnel reflectance", () => {
  it("reflects 4 % straight on and nearly everything at the rim", () => {
    expect(reflectance(slab, 1)).toBeCloseTo(0.04, 3);
    expect(reflectance(slab, 0.001)).toBeGreaterThan(0.9);
  });
});

describe("tables", () => {
  it("sample both curves at pixel centers and know their peak", () => {
    const table = opticsTable(slab, 32);
    expect(table.displacement).toHaveLength(32);
    expect(table.max).toBe(Math.max(...table.displacement));
    expect(lookup(table.displacement, 0.5 / 32)).toBeCloseTo(table.displacement[0] ?? 0, 6);
    expect(lookup(table.displacement, 1)).toBeCloseTo(table.displacement[31] ?? 0, 6);
    const mid = lookup(table.displacement, 1 / 32);
    expect(mid).toBeCloseTo(((table.displacement[0] ?? 0) + (table.displacement[1] ?? 0)) / 2, 6);
  });
});

describe("rim of a rounded rectangle", () => {
  const shape = { width: 100, height: 60, radius: 10 };
  it("measures the distance to the edge, negative inside", () => {
    expect(rim(shape, 50, 30).distance).toBeCloseTo(-30, 6);
    expect(rim(shape, 50, 0).distance).toBeCloseTo(0, 6);
    expect(rim(shape, 3, 30).distance).toBeCloseTo(-3, 6);
    expect(rim(shape, -5, 30).distance).toBeGreaterThan(0);
  });

  it("points its normal outward, diagonally in the corners", () => {
    expect(rim(shape, 50, 2)).toMatchObject({ nx: 0, ny: -1 });
    expect(rim(shape, 50, 58)).toMatchObject({ nx: 0, ny: 1 });
    expect(rim(shape, 2, 30)).toMatchObject({ nx: -1, ny: 0 });
    expect(rim(shape, 98, 30)).toMatchObject({ nx: 1, ny: 0 });
    const corner = rim(shape, 2, 2);
    expect(corner.nx).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(corner.ny).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});
