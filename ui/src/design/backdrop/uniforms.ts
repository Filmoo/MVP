/**
 * Pure inputs of the backdrop shaders: colors parsed from CSS, glass panes packed into one
 * vertex buffer, canvas and light-texture sizes. No DOM here, so all of it is unit-tested.
 */

export type Vec3 = [number, number, number];

/** At most this many glass panes refract; the rest simply show the plain backdrop. */
export const MAX_PANES = 16;
/** Floats per pane vertex: position (2), rect (4), shape (2). */
export const PANE_STRIDE = 8;
const VERTICES_PER_PANE = 6;

/** A glass element as measured in CSS px, relative to the window. */
export interface GlassRect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Corner radius, CSS px. */
  radius: number;
  /** Chrome (title bar, rail): always kept, drawn on top, bends the light less (it is thin). */
  chrome: boolean;
}

/** The page light: what pass 1 (the light texture) depends on. */
export interface Light {
  background: Vec3;
  glowA: Vec3;
  glowB: Vec3;
  glowC: Vec3;
  /** Where the light radiates from, 0..1 of the window, y down. */
  origin: [number, number];
}

export interface Frame {
  /** Window size, CSS px. */
  view: { width: number; height: number };
  /** Canvas size, its own px (scaled down from CSS px). */
  canvas: { width: number; height: number };
  /** Light texture size, its own px (a fraction of the canvas). */
  texture: { width: number; height: number };
  light: Light;
  /** Pane vertices (PANE_STRIDE floats each), `vertexCount` of them used. */
  panes: Float32Array;
  vertexCount: number;
}

/** Parses the computed CSS colors the backdrop reads: `#rgb`, `#rrggbb[aa]`, `rgb()` / `rgba()`. */
export function parseColor(value: string): Vec3 | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as Vec3;
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v)?.[1];
  if (fn) {
    const parts = fn
      .split(/[\s,/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((p) => (p.endsWith("%") ? (Number.parseFloat(p) / 100) * 255 : Number.parseFloat(p)));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
    return parts.map((n) => Math.min(255, Math.max(0, n)) / 255) as Vec3;
  }
  return null;
}

/** `50%` → 0.5, clamped to 0..1.5 (the light may sit below the window); fallback when unparsable. */
export function parsePercent(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? fallback : Math.min(1.5, Math.max(0, n / 100));
}

/** Refraction strength of a pane: thin chrome bends the light less than cards. */
const STRENGTH = { card: 1, chrome: 0.45 } as const;

/**
 * Keeps the panes on screen (all chrome, then cards in document order, MAX_PANES in all) and
 * packs them as two triangles each. Cards come first in the buffer so chrome is drawn over them
 * where a scrolled card slides under the title bar or the rail.
 */
export function packPanes(
  panes: readonly GlassRect[],
  view: { width: number; height: number },
  into: Float32Array = new Float32Array(MAX_PANES * VERTICES_PER_PANE * PANE_STRIDE),
): { vertices: Float32Array; vertexCount: number } {
  const visible = panes.filter(
    (p) => p.width > 0 && p.height > 0 && p.left < view.width && p.top < view.height && p.left + p.width > 0 && p.top + p.height > 0,
  );
  const chrome = visible.filter((p) => p.chrome).slice(0, MAX_PANES);
  const cards = visible.filter((p) => !p.chrome).slice(0, MAX_PANES - chrome.length);
  let o = 0;
  for (const p of [...cards, ...chrome]) {
    const hw = p.width / 2;
    const hh = p.height / 2;
    const cx = p.left + hw;
    const cy = p.top + hh;
    const radius = Math.max(0, Math.min(p.radius, hw, hh));
    const strength = p.chrome ? STRENGTH.chrome : STRENGTH.card;
    const [x0, y0, x1, y1] = [p.left, p.top, p.left + p.width, p.top + p.height];
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x0, y1],
      [x1, y0],
      [x1, y1],
    ] as const) {
      into.set([x, y, cx, cy, hw, hh, radius, strength], o);
      o += PANE_STRIDE;
    }
  }
  return { vertices: into, vertexCount: o / PANE_STRIDE };
}

/** Canvas size for a window: a fraction of CSS px, never above 1 device px per CSS px. */
export function canvasSize(
  css: { width: number; height: number },
  devicePixelRatio: number,
  fraction: number,
): { width: number; height: number } {
  const scale = Math.min(1, devicePixelRatio || 1) * fraction;
  return {
    width: Math.max(1, Math.round(css.width * scale)),
    height: Math.max(1, Math.round(css.height * scale)),
  };
}

/** Same light in both? Then pass 1 (the light texture) is skipped. */
export function sameLight(a: Light | undefined, b: Light): boolean {
  if (!a) return false;
  const eq = (x: readonly number[], y: readonly number[]) => x.every((v, i) => Math.abs(v - (y[i] ?? Number.NaN)) < 1e-4);
  return eq(a.background, b.background) && eq(a.glowA, b.glowA) && eq(a.glowB, b.glowB) && eq(a.glowC, b.glowC) && eq(a.origin, b.origin);
}
