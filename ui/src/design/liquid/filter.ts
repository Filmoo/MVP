/**
 * The SVG filter of a liquid glass element, as data (pure, unit-tested): liquid.ts turns it into
 * `<filter>` primitives. Frost → a nine-slice displacement map → the lens (optionally three
 * displaced copies, one per colour channel) → vibrancy → the glass' own tint, deeper where it is
 * thicker → light on the rim, from the surface's normals (the same map).
 */
import { type Rims, type Slice, scaleFor } from "./maps";
import type { Glass } from "./optics";

export interface LiquidSpec {
  /** The glass; a dome's bezel and thickness come from its size instead (see `dome`). */
  glass: Glass;
  /**
   * A dome lens: the bezel spans half the element's smaller side and the top rises this share
   * of it, so the whole pane magnifies.
   */
  dome?: number;
  /** A dome floats this share of its half size above the page: higher magnifies more (0.5 ≈ ×1.27). */
  lift?: number;
  rims?: Rims;
  /** Frost before the light bends, CSS px of blur (0 = clear glass). */
  frost?: number;
  /** Colour split at the rim: blue bends this share more than green, red this share less. */
  dispersion?: number;
  /**
   * Vibrancy after the lens: colour saturation and brightness (1 = unchanged). Done inside the
   * SVG filter: Chromium mishandles CSS filter functions chained after a `url()` backdrop filter.
   */
  saturate?: number;
  brightness?: number;
  /**
   * Light on the rim, 0–1: the rim facing the light (top left, like the rest of the app's light)
   * catches this much at its steepest, the far rim a third of it.
   */
  specular?: number;
}

/**
 * The glass' own colour where it is thickest, channels 0–1 (from the element's CSS: see
 * liquid.ts). Toward the rim it thins out, like glass absorbing less where it is thin.
 */
export interface Tint {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Toward the light, in screen space (y down): up and a little to the left. */
const LIGHT = { x: -0.5, y: -0.866 };
/** The far rim's share of the light (its reflection of the room behind). */
const ECHO = 0.35;

/** One filter primitive: its tag, attributes and children. */
export interface Primitive {
  tag: string;
  attrs: Record<string, string | number>;
  children?: Primitive[];
}

/** Glass geometry in effect for an element: domes take their bezel and height from its size. */
export function glassFor(spec: LiquidSpec, width: number, height: number): Glass {
  if (!spec.dome) return spec.glass;
  const half = Math.min(width, height) / 2;
  return { ...spec.glass, bezel: half, thickness: half * spec.dome, elevation: half * (spec.lift ?? 0) };
}

/**
 * The optical outline's corner radius: a dome is a stadium (smooth normals everywhere its
 * surface slopes); a slab's corners are rounded at least as much as its bezel is wide, so the
 * rim's normals turn smoothly instead of creasing along the corner's diagonal.
 */
export function opticalRadius(spec: LiquidSpec, glass: Glass, width: number, height: number, cssRadius: number): number {
  const half = Math.min(width, height) / 2;
  return spec.dome ? half : Math.min(half, Math.max(cssRadius, glass.bezel));
}

/** Keeps one colour channel of a displaced copy (alpha kept). */
const CHANNEL = {
  r: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  g: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  b: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
} as const;

const num = (n: number) => Number(n.toFixed(4));

/**
 * Rim light from the map: red and green hold the inward pull, i.e. the outward normal scaled by
 * how steep the surface is (Fresnel grows with it). Lit where that normal faces the light.
 * Returns an feColorMatrix's values: white, alpha = gain · (normal · light) · steepness.
 */
function rimLight(gain: number): string {
  // (2R − 1, 2G − 1) ≈ −normal · steepness, so normal · light = −(2R − 1)·x − (2G − 1)·y.
  const a = [num(-2 * gain * LIGHT.x), num(-2 * gain * LIGHT.y), 0, 0, num(gain * (LIGHT.x + LIGHT.y))];
  return `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${a.join(" ")}`;
}

const add = (a: string, b: string, result: string): Primitive => ({
  tag: "feComposite",
  attrs: { in: a, in2: b, operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result },
});

/**
 * The primitives of a lens. `slices` are the map's pieces with their image URLs; `max` is the
 * largest displacement the map stands for, CSS px; `tint` the glass' colour where it is thickest.
 */
export function lensPrimitives(
  spec: LiquidSpec,
  slices: ReadonlyArray<{ slice: Slice; href: string }>,
  max: number,
  tint?: Tint,
): Primitive[] {
  // The middle of the pane: no pull, full thickness.
  const out: Primitive[] = [{ tag: "feFlood", attrs: { "flood-color": "#8080ff", result: "neutral" } }];
  slices.forEach(({ slice, href }, i) => {
    out.push({
      tag: "feImage",
      attrs: { href, x: slice.x, y: slice.y, width: slice.width, height: slice.height, preserveAspectRatio: "none", result: `s${i}` },
    });
  });
  out.push({
    tag: "feMerge",
    attrs: { result: "map" },
    children: [{ tag: "feMergeNode", attrs: { in: "neutral" } }, ...slices.map((_, i) => ({ tag: "feMergeNode", attrs: { in: `s${i}` } }))],
  });
  let source = "SourceGraphic";
  if (spec.frost) {
    out.push({ tag: "feGaussianBlur", attrs: { in: "SourceGraphic", stdDeviation: spec.frost, edgeMode: "duplicate", result: "frost" } });
    source = "frost";
  }
  const scale = scaleFor(max);
  const displace = (s: number, result: string): Primitive => ({
    tag: "feDisplacementMap",
    attrs: { in: source, in2: "map", scale: s, xChannelSelector: "R", yChannelSelector: "G", result },
  });
  const split = spec.dispersion ?? 0;
  if (split > 0) {
    out.push(
      displace(scale * (1 - split), "dr"),
      { tag: "feColorMatrix", attrs: { in: "dr", type: "matrix", values: CHANNEL.r, result: "r" } },
      displace(scale, "dg"),
      { tag: "feColorMatrix", attrs: { in: "dg", type: "matrix", values: CHANNEL.g, result: "g" } },
      displace(scale * (1 + split), "db"),
      { tag: "feColorMatrix", attrs: { in: "db", type: "matrix", values: CHANNEL.b, result: "b" } },
      add("r", "g", "rg"),
      add("rg", "b", "lens"),
    );
  } else {
    out.push(displace(scale, "lens"));
  }
  if (spec.saturate && spec.saturate !== 1) {
    out.push({ tag: "feColorMatrix", attrs: { in: "lens", type: "saturate", values: spec.saturate, result: "lens" } });
  }
  if (spec.brightness && spec.brightness !== 1) {
    const slope = spec.brightness;
    out.push({
      tag: "feComponentTransfer",
      attrs: { in: "lens", result: "lens" },
      children: ["feFuncR", "feFuncG", "feFuncB"].map((tag) => ({ tag, attrs: { type: "linear", slope } })),
    });
  }
  if (tint && tint.a > 0) {
    // The tint's alpha follows blue: full past the bezel, none at the rim.
    const values = `0 0 0 0 ${num(tint.r)}  0 0 0 0 ${num(tint.g)}  0 0 0 0 ${num(tint.b)}  0 0 ${num(tint.a)} 0 0`;
    out.push(
      { tag: "feColorMatrix", attrs: { in: "map", type: "matrix", values, result: "tint" } },
      { tag: "feComposite", attrs: { in: "tint", in2: "lens", operator: "over", result: "lens" } },
    );
  }
  const shine = spec.specular ?? 0;
  if (shine > 0) {
    out.push(
      { tag: "feColorMatrix", attrs: { in: "map", type: "matrix", values: rimLight(shine), result: "lit" } },
      { tag: "feColorMatrix", attrs: { in: "map", type: "matrix", values: rimLight(-shine * ECHO), result: "echo" } },
      add("lit", "echo", "shine"),
      // Tighter toward the steepest part of the rim, like a real highlight.
      {
        tag: "feComponentTransfer",
        attrs: { in: "shine", result: "shine" },
        children: [{ tag: "feFuncA", attrs: { type: "gamma", amplitude: 1, exponent: 1.6, offset: 0 } }],
      },
      add("lens", "shine", "lens"),
    );
  }
  return out;
}
