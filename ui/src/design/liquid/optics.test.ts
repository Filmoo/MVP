import { describe, expect, it } from "vitest";
import { displacement, type Glass, IOR, lookup, opticsTable, reflectance, rim, surface, surfaceSlope } from "./optics";

const slab: Glass = { profile: "squircle", bezel: 16, thickness: 22 };

describe("glass surface", () => {
  it("rises from the rim to a flat top", () => {
    for (const profile of ["squircle", "circle", "parabola"] as const) {
      expect(surface(profile, 0)).toBe(0);
      expect(surface(profile, 1)).toBe(1);
      let last = -1;
      for (let t = 0; t <= 1; t += 0.05) {
        const h = surface(profile, t);
        expect(h).toBeGreaterThanOrEqual(last);
        last = h;
      }
      expect(surfaceSlope(profile, 1)).toBe(0);
    }
    expect(surfaceSlope("squircle", 0)).toBe(Number.POSITIVE_INFINITY);
    expect(surfaceSlope("circle", 0)).toBe(Number.POSITIVE_INFINITY);
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

describe("floating glass", () => {
  const floating: Glass = { ...slab, elevation: 12 };

  it("bends more, the higher it floats above the page", () => {
    for (const t of [0.05, 0.2, 0.5]) {
      expect(displacement({ ...slab, elevation: 6 }, t)).toBeGreaterThan(displacement(slab, t));
      expect(displacement(floating, t)).toBeGreaterThan(displacement({ ...slab, elevation: 6 }, t));
    }
    // Lying on the page (no gap) is the plain slab.
    expect(displacement({ ...slab, elevation: 0 }, 0.3)).toBe(displacement(slab, 0.3));
  });

  it("stays finite at the very rim (total internal reflection is capped)", () => {
    const rim = displacement(floating, 0);
    expect(Number.isFinite(rim)).toBe(true);
    expect(rim).toBeGreaterThan(displacement(floating, 0.1));
    expect(displacement(floating, 1)).toBe(0);
  });

  it("magnifies like a drop of water under a dome floating half its radius up (about ×1.27)", () => {
    const half = 26;
    const drop: Glass = { profile: "circle", bezel: half, thickness: half * 0.5, elevation: half * 0.5 };
    for (const t of [0.95, 0.8]) {
      const r = half * (1 - t);
      const zoom = r / (r - displacement(drop, t));
      expect(zoom).toBeGreaterThan(1.2);
      expect(zoom).toBeLessThan(1.35);
    }
  });

  it("magnifies evenly under a parabolic dome, like a loupe (about ×1.3 across it)", () => {
    const half = 26;
    const loupe: Glass = { profile: "parabola", bezel: half, thickness: half * 0.3, elevation: half * 0.6 };
    const zooms = [0.95, 0.8, 0.6, 0.4, 0.2].map((t) => {
      const r = half * (1 - t);
      return r / (r - displacement(loupe, t));
    });
    for (const zoom of zooms) {
      expect(zoom).toBeGreaterThan(1.2);
      expect(zoom).toBeLessThan(1.36);
    }
    // Its rim is not a cliff: the slope stays finite.
    expect(Number.isFinite(surfaceSlope("parabola", 0))).toBe(true);
  });

  it("does not bend at all without a lens (ior 1), however high", () => {
    expect(displacement({ ...floating, ior: 1 }, 0.3)).toBeCloseTo(0, 9);
  });
});

describe("Fresnel reflectance", () => {
  it("reflects 4 % straight on and nearly everything at the rim", () => {
    expect(reflectance(slab, 1)).toBeCloseTo(0.04, 3);
    expect(reflectance(slab, 0.001)).toBeGreaterThan(0.9);
  });
});

describe("tables", () => {
  it("sample the curves at pixel centers and know their peak", () => {
    const table = opticsTable(slab, 32);
    expect(table.displacement).toHaveLength(32);
    // The tint eases in across the bezel: clear at the rim, full where the top turns flat.
    expect(table.tint[0]).toBeLessThan(0.01);
    expect(table.tint[16]).toBeCloseTo(0.5, 1);
    expect(table.tint[31]).toBeGreaterThan(0.99);
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
