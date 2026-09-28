/**
 * Motion that feels physical but runs on the compositor: a damped spring sampled into a CSS
 * `linear()` easing, for Web Animations on `transform` / `opacity` only. A move can overshoot a
 * hair and settle, like a drop of liquid; nothing runs once it has settled.
 */

export interface Spring {
  /** CSS easing: `linear(0, …, 1)`. */
  easing: string;
  /** Until it settles, ms. */
  duration: number;
}

/** Position of a unit spring released from 0 toward 1, `t` seconds in. */
export function springAt(t: number, stiffness: number, damping: number, mass = 1): number {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  // Critically (or over-) damped: no overshoot.
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/**
 * A spring as an easing. Settled means within 0.1 % of the target for good; the samples are
 * spaced evenly over that time.
 */
export function spring({ stiffness = 380, damping = 30, mass = 1, points = 40 } = {}): Spring {
  const step = 1 / 600;
  let settled = 0;
  for (let t = 0; t < 3; t += step) {
    if (Math.abs(1 - springAt(t, stiffness, damping, mass)) > 0.001) settled = t + step;
  }
  const values: string[] = [];
  for (let i = 0; i <= points; i++) {
    const v = i === points ? 1 : springAt((settled * i) / points, stiffness, damping, mass);
    values.push(String(Math.round(v * 10_000) / 10_000));
  }
  return { easing: `linear(${values.join(", ")})`, duration: Math.round(settled * 1000) };
}

/** The player asked for less motion: moves jump to their end. */
export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
