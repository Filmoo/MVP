import { describe, expect, it } from "vitest";
import { glassFor, type LiquidSpec, lensPrimitives, opticalRadius } from "./filter";
import { scaleFor, slices } from "./maps";

const slab: LiquidSpec = {
  glass: { profile: "squircle", bezel: 16, thickness: 22 },
  frost: 8,
  dispersion: 0.1,
  saturate: 1.6,
  brightness: 1.08,
};
const dome: LiquidSpec = { glass: { profile: "circle", bezel: 0, thickness: 0 }, dome: 0.6 };
const parts = slices({ width: 300, height: 140, radius: 16 }, 16).map((slice, i) => ({ slice, href: `data:image/png;base64,${i}` }));

const tags = (spec: LiquidSpec) => lensPrimitives(spec, parts, 10).map((p) => p.tag);

describe("lens filter", () => {
  it("builds the map from a neutral flood and the slices, then frosts, bends and brightens", () => {
    expect(tags(slab)).toEqual([
      "feFlood",
      ...parts.map(() => "feImage"),
      "feMerge",
      "feGaussianBlur",
      "feDisplacementMap",
      "feColorMatrix",
      "feDisplacementMap",
      "feColorMatrix",
      "feDisplacementMap",
      "feColorMatrix",
      "feComposite",
      "feComposite",
      "feColorMatrix",
      "feComponentTransfer",
    ]);
  });

  it("splits colours by bending blue more than green and red less", () => {
    const scales = lensPrimitives(slab, parts, 10)
      .filter((p) => p.tag === "feDisplacementMap")
      .map((p) => p.attrs.scale);
    expect(scales).toEqual([scaleFor(10) * 0.9, scaleFor(10), scaleFor(10) * 1.1]);
    // The frosted backdrop is what bends.
    expect(lensPrimitives(slab, parts, 10).find((p) => p.tag === "feDisplacementMap")?.attrs.in).toBe("frost");
  });

  it("is a single clear displacement without frost, split or vibrancy", () => {
    expect(tags(dome)).toEqual(["feFlood", ...parts.map(() => "feImage"), "feMerge", "feDisplacementMap"]);
    expect(lensPrimitives(dome, parts, 10).at(-1)?.attrs.in).toBe("SourceGraphic");
  });

  it("places every slice where the map says", () => {
    const images = lensPrimitives(slab, parts, 10).filter((p) => p.tag === "feImage");
    expect(images.map((p) => [p.attrs.x, p.attrs.y, p.attrs.width, p.attrs.height])).toEqual(
      parts.map(({ slice }) => [slice.x, slice.y, slice.width, slice.height]),
    );
  });
});

describe("glass geometry", () => {
  it("gives a dome its bezel and height from its size", () => {
    expect(glassFor(dome, 60, 52)).toEqual({ profile: "circle", bezel: 26, thickness: 26 * 0.6 });
    expect(glassFor(slab, 60, 52)).toBe(slab.glass);
  });

  it("rounds a slab's optical corners at least as much as its bezel, a dome's into a stadium", () => {
    expect(opticalRadius(slab, slab.glass, 300, 140, 8)).toBe(16);
    expect(opticalRadius(slab, slab.glass, 300, 140, 24)).toBe(24);
    expect(opticalRadius(slab, slab.glass, 300, 20, 8)).toBe(10);
    expect(opticalRadius(dome, glassFor(dome, 60, 52), 60, 52, 12)).toBe(26);
  });
});
