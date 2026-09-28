/**
 * Optics of liquid glass: a pane of glass lying on the page, seen from straight above.
 *
 * The pane's top is flat, and curves down to the page across a bezel along its rim. A ray from
 * the eye refracts where the surface slopes (Snell's law) and crosses the glass down to the page,
 * landing further inside than where it entered: what is under the rim is pulled inward and
 * squeezed, the way the edge of a thick lens bends what's behind it. A dome (the bezel spanning
 * the whole pane) magnifies what's under it. The rim also reflects more light at grazing angles
 * (Fresnel), which is where the bright edge of glass comes from.
 *
 * Pure and unit-tested. The same tables drive the SVG lens over the page (liquid.ts) and the
 * glass cards drawn by the WebGL backdrop, so both bend light the same way.
 */

/** Refractive index of the glass (window glass ≈ 1.5). */
export const IOR = 1.5;

/** How the surface falls from the flat top to the rim across the bezel. */
export type Profile = "squircle" | "circle";

export interface Glass {
  /** `squircle`: flat for longest, then a steep rim (Apple's shape); `circle`: a round bevel. */
  profile: Profile;
  /** Bezel width, CSS px: how far in from the rim the surface curves. */
  bezel: number;
  /** Height of the flat top above the page, CSS px (thicker bends more). */
  thickness: number;
  ior?: number;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Height of the surface across the bezel: 0 at the rim (t = 0), 1 where the top turns flat (t = 1). */
export function surface(profile: Profile, t: number): number {
  const u = 1 - clamp01(t);
  return profile === "squircle" ? (1 - u ** 4) ** 0.25 : Math.sqrt(1 - u * u);
}

/** Slope of `surface` (d height / d t): infinite at the rim, 0 on the flat top. */
export function surfaceSlope(profile: Profile, t: number): number {
  const u = 1 - clamp01(t);
  const inner = profile === "squircle" ? 1 - u ** 4 : 1 - u * u;
  if (inner <= 0) return Number.POSITIVE_INFINITY;
  return profile === "squircle" ? u ** 3 / inner ** 0.75 : u / Math.sqrt(inner);
}

/**
 * How far inward (CSS px) the light seen at `t` across the bezel comes from on the page.
 * The view ray (straight down) refracts at the surface, whose normal leans outward by the
 * slope, then travels down through the glass to the page.
 */
export function displacement(glass: Glass, t: number): number {
  const height = glass.thickness * surface(glass.profile, t);
  if (height <= 0) return 0;
  const slope = (glass.thickness / Math.max(1e-6, glass.bezel)) * surfaceSlope(glass.profile, t);
  const eta = 1 / (glass.ior ?? IOR);
  // Normal (lateral, up) = (slope, 1) normalized; the limit at the rim is (1, 0).
  const cos = Number.isFinite(slope) ? 1 / Math.sqrt(1 + slope * slope) : 0;
  const sin = Number.isFinite(slope) ? slope * cos : 1;
  const k = Math.sqrt(1 - eta * eta * sin * sin);
  // Refracted direction: lateral (eta·cos − k)·sin (inward), down −(eta·sin² + k·cos).
  const lateral = (k - eta * cos) * sin;
  const down = eta * sin * sin + k * cos;
  return (height * lateral) / down;
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
  /** Inward displacement at t = i / (size − 1), CSS px. */
  displacement: Float32Array;
  /** Reflectance at the same points (0–1). */
  reflectance: Float32Array;
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
  let max = 0;
  for (let i = 0; i < size; i++) {
    const t = (i + 0.5) / size;
    d[i] = displacement(glass, t);
    r[i] = reflectance(glass, t);
    max = Math.max(max, d[i] ?? 0);
  }
  return { displacement: d, reflectance: r, max };
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
