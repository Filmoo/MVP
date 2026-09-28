/**
 * Optics of liquid glass: a pane of glass floating above the page, seen from straight above.
 *
 * The pane's top is flat, and curves down to its flat underside across a bezel along its rim.
 * A ray from the eye refracts where the surface slopes (Snell's law), crosses the glass, refracts
 * again leaving the underside, and crosses the gap of air down to the page, landing further
 * inside than where it entered: what is under the rim is pulled inward and squeezed, the way the
 * edge of a thick lens bends what's behind it. Most of that bend comes from the gap: glass that
 * floats higher bends more. A dome (the bezel spanning the whole pane) magnifies what's under it.
 * The rim also reflects more light at grazing angles (Fresnel): the bright edge of glass.
 *
 * Pure and unit-tested. The same tables drive the SVG lens over the page (liquid.ts) and the
 * glass cards drawn by the WebGL backdrop, so both bend light the same way.
 */

/** Refractive index of the glass (window glass ≈ 1.5). */
export const IOR = 1.5;

/** How the surface falls from the flat top to the rim across the bezel. */
export type Profile = "squircle" | "circle" | "parabola";

export interface Glass {
  /**
   * `squircle`: flat for longest, then a steep rim (Apple's shape); `circle`: a round bevel;
   * `parabola`: a lens (its slope grows evenly from the middle, so it magnifies evenly).
   */
  profile: Profile;
  /** Bezel width, CSS px: how far in from the rim the surface curves. */
  bezel: number;
  /** Height of the flat top above the underside, CSS px (thicker bends more). */
  thickness: number;
  /**
   * How high the underside floats above the page, CSS px (0: lying on it). Light leaving the
   * glass keeps its angle across this gap: floating glass bends much more than a sheet on paper.
   */
  elevation?: number;
  ior?: number;
}

/**
 * The steepest ray that leaves the underside (sine of its angle): past it, the underside would
 * reflect the light back into the glass (total internal reflection, a hair along the rim).
 * Capped so the rim's last pixel stays finite.
 */
const MAX_EXIT_SIN = 0.92;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Height of the surface across the bezel: 0 at the rim (t = 0), 1 where the top turns flat (t = 1). */
export function surface(profile: Profile, t: number): number {
  const u = 1 - clamp01(t);
  if (profile === "parabola") return 1 - u * u;
  return profile === "squircle" ? (1 - u ** 4) ** 0.25 : Math.sqrt(1 - u * u);
}

/** Slope of `surface` (d height / d t): 0 on the flat top; infinite at the rim but a lens's. */
export function surfaceSlope(profile: Profile, t: number): number {
  const u = 1 - clamp01(t);
  if (profile === "parabola") return 2 * u;
  const inner = profile === "squircle" ? 1 - u ** 4 : 1 - u * u;
  if (inner <= 0) return Number.POSITIVE_INFINITY;
  return profile === "squircle" ? u ** 3 / inner ** 0.75 : u / Math.sqrt(inner);
}

/**
 * How far inward (CSS px) the light seen at `t` across the bezel comes from on the page.
 * The view ray (straight down) refracts at the surface, whose normal leans outward by the
 * slope, travels down through the glass, refracts again leaving the flat underside, and crosses
 * the gap to the page.
 */
export function displacement(glass: Glass, t: number): number {
  const height = glass.thickness * surface(glass.profile, t);
  const gap = Math.max(0, glass.elevation ?? 0);
  if (height <= 0 && gap <= 0) return 0;
  const slope = (glass.thickness / Math.max(1e-6, glass.bezel)) * surfaceSlope(glass.profile, t);
  const ior = glass.ior ?? IOR;
  const eta = 1 / ior;
  // Normal (lateral, up) = (slope, 1) normalized; the limit at the rim is (1, 0).
  const cos = Number.isFinite(slope) ? 1 / Math.sqrt(1 + slope * slope) : 0;
  const sin = Number.isFinite(slope) ? slope * cos : 1;
  const k = Math.sqrt(1 - eta * eta * sin * sin);
  // Refracted direction: lateral (eta·cos − k)·sin (inward), down −(eta·sin² + k·cos).
  const lateral = (k - eta * cos) * sin;
  const down = eta * sin * sin + k * cos;
  const inGlass = height > 0 ? (height * lateral) / down : 0;
  if (gap <= 0) return inGlass;
  // Leaving the underside (flat, facing the page): sin(air) = n · sin(glass).
  const exit = Math.min(MAX_EXIT_SIN, (ior * lateral) / Math.hypot(lateral, down));
  return inGlass + (gap * exit) / Math.sqrt(1 - exit * exit);
}

/** Share of light the surface reflects toward the eye at `t` (Schlick's Fresnel): 4 % on top, 100 % at the rim. */
export function reflectance(glass: Glass, t: number): number {
  const slope = (glass.thickness / Math.max(1e-6, glass.bezel)) * surfaceSlope(glass.profile, t);
  const cos = Number.isFinite(slope) ? 1 / Math.sqrt(1 + slope * slope) : 0;
  const ior = glass.ior ?? IOR;
  const r0 = ((ior - 1) / (ior + 1)) ** 2;
  return r0 + (1 - r0) * (1 - cos) ** 5;
}

export interface OpticsTable {
  /** Inward displacement at t = (i + 0.5) / size, CSS px. */
  displacement: Float32Array;
  /** Reflectance at the same points (0–1). */
  reflectance: Float32Array;
  /**
   * How much of its tint the glass shows there (0 at the rim, 1 where it turns flat): it eases
   * in across the whole bezel, so the band where the light bends is the clearest part.
   */
  tint: Float32Array;
  /** Largest displacement, CSS px (the SVG map's scale). */
  max: number;
}

/**
 * Both curves sampled across the bezel. Points sit at pixel centers of a `size`-sample strip,
 * so the singular rim itself (t = 0) is never evaluated.
 */
export function opticsTable(glass: Glass, size = 64): OpticsTable {
  const d = new Float32Array(size);
  const r = new Float32Array(size);
  const tint = new Float32Array(size);
  let max = 0;
  for (let i = 0; i < size; i++) {
    const t = (i + 0.5) / size;
    d[i] = displacement(glass, t);
    r[i] = reflectance(glass, t);
    tint[i] = t * t * (3 - 2 * t);
    max = Math.max(max, d[i] ?? 0);
  }
  return { displacement: d, reflectance: r, tint, max };
}

/** Linear lookup of a table at t (0–1), the way a GPU samples it. */
export function lookup(values: Float32Array, t: number): number {
  const n = values.length;
  const x = clamp01(t) * n - 0.5;
  if (x <= 0) return values[0] ?? 0;
  if (x >= n - 1) return values[n - 1] ?? 0;
  const i = Math.floor(x);
  const f = x - i;
  return (values[i] ?? 0) * (1 - f) + (values[i + 1] ?? 0) * f;
}

/** A rounded rectangle, CSS px. */
export interface Shape {
  width: number;
  height: number;
  radius: number;
}

/**
 * Signed distance from (x, y) to the rim of `shape` (negative inside) and the rim's outward
 * normal there. (x, y) is relative to the shape's top-left corner.
 */
export function rim(shape: Shape, x: number, y: number): { distance: number; nx: number; ny: number } {
  const hw = shape.width / 2;
  const hh = shape.height / 2;
  const r = Math.max(0, Math.min(shape.radius, hw, hh));
  const px = x - hw;
  const py = y - hh;
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const distance = outside + Math.min(Math.max(qx, qy), 0) - r;
  let nx = 0;
  let ny = 0;
  if (qx > 0 && qy > 0) {
    nx = qx / outside;
    ny = qy / outside;
  } else if (qx > qy) nx = 1;
  else ny = 1;
  return { distance, nx: nx * (px < 0 ? -1 : 1), ny: ny * (py < 0 ? -1 : 1) };
}
