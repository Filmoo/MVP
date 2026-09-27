/**
 * The page light glides between palettes like the CSS does (tokens.css: `--amb-*` transitions,
 * 450 ms for colors, 600 ms for the position, `--ease`). The backdrop mirrors that in JS instead
 * of reading computed styles every frame, which would force a style recalc of the whole tree.
 */
import type { Light, Vec3 } from "./uniforms";

export const COLOR_MS = 450;
export const POSITION_MS = 600;

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  const y = (s: number) => ((ay * s + by) * s + cy) * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton on x(s) = t, bisection when the slope is flat.
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = x(s) - t;
      if (Math.abs(err) < 1e-5) return y(s);
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 30; i++) {
      if (x(s) < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return y(s);
  };
}

/** tokens.css `--ease`. */
export const ease = cubicBezier(0.2, 0, 0, 1);

const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The light `elapsed` ms into a glide from `from` to `to`; `done` once both transitions ended. */
export function glideAt(from: Light, to: Light, elapsed: number): { light: Light; done: boolean } {
  const c = ease(elapsed / COLOR_MS);
  const p = ease(elapsed / POSITION_MS);
  return {
    light: {
      background: to.background,
      glowA: mix3(from.glowA, to.glowA, c),
      glowB: mix3(from.glowB, to.glowB, c),
      glowC: mix3(from.glowC, to.glowC, c),
      origin: [from.origin[0] + (to.origin[0] - from.origin[0]) * p, from.origin[1] + (to.origin[1] - from.origin[1]) * p],
    },
    done: elapsed >= Math.max(COLOR_MS, POSITION_MS),
  };
}
