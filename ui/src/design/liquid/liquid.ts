/**
 * Liquid glass over the page: floating chrome (title bar, search panel, toasts) and controls
 * (the rail's selection lens, pressed toggles and slider thumbs) bend what is behind them, like
 * iOS glass. An SVG filter per element, used as a CSS `backdrop-filter`: the page content under
 * the rim is displaced by a map computed from real optics (optics.ts), then frosted and
 * brightened. It all runs in the compositor on the GPU: nothing is scheduled, no pixel is
 * computed in JS after the first use (maps are cached nine-slice images), and resizing only
 * moves slices.
 *
 * Only while the WebGL backdrop runs (`data-effects="shader"`: a GPU that draws it cheaply, the
 * Full visual effects level); otherwise the same elements keep their plain CSS blur. This module
 * only registers the elements: the optics and the filter builder (lens.ts) load with the first
 * lens, so Light and Off never download them.
 *
 * Usage: `<div ref={(el) => liquid(el, "panel")}>`. The element's CSS applies the filter with
 * `backdrop-filter: var(--lg-filter, <fallback>)` (on a layer of its own: an element with a
 * backdrop-filter hides the page from its descendants' glass, and an outer shadow on it would
 * shift the filter). Its tint is declared once, as `--lg-tint: <colour token>` with
 * `background: var(--lg-fill, <the same token>)`: while the lens runs, the filter takes the tint
 * over (deeper where the glass is thicker, clearer at the rim) and `--lg-fill` turns the flat
 * fill off.
 */
import { onCleanup } from "solid-js";
import type { LiquidSpec } from "./filter";
import type { Entry } from "./lens";

export type { LiquidSpec };

/** The kinds of glass the app uses (see docs/architecture.md, "Glass and light"). */
export const LIQUID = {
  /** Title bar: content scrolls under it; its lower rim bends it, the rest is frosted. */
  // Glass floats above the page (elevation): the light it bends crosses that gap too, which is
  // what makes the bend visible. The rim stays sharp so what is behind stays recognizable, bent;
  // past the bezel (where labels sit) a deeper frost keeps it calm. The tint (from the element's
  // CSS) deepens with the glass' thickness, so the rim is the clearest part. No colour split
  // over the page: over text it reads as fringing, not as optics.
  // Owner, 2026-09-28: "more distortion, less blur, a softer gradient". A strong bend (thickness,
  // elevation) on a rim narrow enough to stay under the labels; a light frost (the core's, eased
  // in) instead of a deep one; a 1 px pre-blur so the band at the rim that mirrors what is behind
  // it doesn't show text upside down, crisp enough to read as a bug.
  bar: {
    glass: { profile: "parabola", bezel: 14, thickness: 16, elevation: 20 },
    rims: "bottom",
    frost: 1,
    frostCore: 4,
    saturate: 1.3,
    brightness: 1.04,
    specular: 0.55,
  },
  /** The rail, and the floating tab bar on narrow windows: labels over scrolling content. */
  dock: {
    glass: { profile: "parabola", bezel: 12, thickness: 13, elevation: 20 },
    frost: 1,
    frostCore: 6,
    saturate: 1.2,
    brightness: 1,
    specular: 0.8,
  },
  /** Floating panels holding text (search results, toasts): the page bends along a clear rim. */
  panel: {
    glass: { profile: "parabola", bezel: 14, thickness: 13, elevation: 18 },
    frost: 1,
    frostCore: 6,
    saturate: 1.5,
    brightness: 1.06,
    specular: 0.8,
  },
  /**
   * Clear glass over art (the rank pane, a champion's tier): a wide bent rim, the art frosted a
   * little in the middle for the text on it. Their CSS corners match the bezel (`--radius-5`).
   */
  clear: {
    glass: { profile: "parabola", bezel: 20, thickness: 18, elevation: 14 },
    frost: 0.5,
    frostCore: 2,
    saturate: 1.25,
    brightness: 1.08,
    specular: 0.9,
  },
  /**
   * Drops of glass on controls (rail selection, segment thumbs, a held switch): a flat pill whose
   * edge bends what is under it a little (≈ 3 px, smoothly: less than the 4 px to a track's border,
   * which a deeper bend drew again inside the thumb). Always behind the labels, moving or
   * not. Owner, 2026-09-28: the loupe it replaced (a magnifying dome lifted over the labels while
   * gliding) swelled and shrank the icon it passed, pixelated it (the displacement filter doesn't
   * smooth what it enlarges), and drew the control's own border again inside the thumb.
   */
  lens: {
    glass: { profile: "parabola", bezel: 8, thickness: 6, elevation: 4 },
    frost: 0.5,
    saturate: 1.2,
    brightness: 1.06,
    // The CSS rim ring is its one edge: a second rim of light read as a double outline.
    specular: 0,
  },
} as const satisfies Record<string, LiquidSpec>;

export type LiquidKind = keyof typeof LIQUID;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Lensing follows the rendering level: on only while the WebGL backdrop draws. A plain flag, not
 * a signal: it is set from inside the backdrop's effect, which must not come to depend on it.
 */
let lensing = false;

const entries = new Map<HTMLElement, Entry>();
let defs: SVGSVGElement | undefined;
let resizes: ResizeObserver | undefined;
let nextId = 0;

/** The filter builder, once loaded (the first time something lenses). */
let lens: typeof import("./lens") | undefined;
let loading = false;

function load(): void {
  if (loading) return;
  loading = true;
  import("./lens").then(
    (module) => {
      lens = module;
      for (const entry of entries.values()) apply(entry);
    },
    () => {
      // Without it the glass keeps its plain blur; the next lens tries again.
      loading = false;
    },
  );
}

/** Turns lensing on or off for every glass element (the backdrop decides, see Backdrop.tsx). */
export function setLensing(on: boolean): void {
  if (on === lensing) return;
  lensing = on;
  for (const entry of entries.values()) apply(entry);
}

/** Whether glass bends the page right now (tests read it through the DOM: `--lg-filter`). */
export function isLensing(): boolean {
  return lensing;
}

function container(): SVGSVGElement {
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "svg");
    defs.setAttribute("aria-hidden", "true");
    defs.setAttribute("width", "0");
    defs.setAttribute("height", "0");
    defs.setAttribute("data-liquid-defs", "");
    defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    document.body.appendChild(defs);
  }
  return defs;
}

function observer(): ResizeObserver {
  resizes ??= new ResizeObserver((records) => {
    for (const record of records) {
      const entry = entries.get(record.target as HTMLElement);
      const box = record.borderBoxSize[0];
      if (!entry || !box) continue;
      entry.width = box.inlineSize;
      entry.height = box.blockSize;
      // Style is clean after layout: a radius or tint changed by a media query is cheap to read here.
      entry.radius = Number.parseFloat(getComputedStyle(entry.el).borderTopLeftRadius) || 0;
      entry.tint = undefined;
      apply(entry);
    }
  });
  return resizes;
}

function apply(entry: Entry): void {
  const { el } = entry;
  if (!lensing || entry.width <= 0 || entry.height <= 0) {
    el.style.removeProperty("--lg-filter");
    el.style.removeProperty("--lg-fill");
    return;
  }
  if (!lens) {
    load();
    return;
  }
  // The tint the CSS declares, read once (style is clean here: after layout or a frame).
  entry.tint ??= lens.parseColor(getComputedStyle(el).getPropertyValue("--lg-tint")) ?? null;
  lens.build(entry);
  const value = `url(#${entry.filter.id})`;
  if (el.style.getPropertyValue("--lg-filter") !== value) el.style.setProperty("--lg-filter", value);
  if (entry.tint) el.style.setProperty("--lg-fill", "transparent");
}

/**
 * Makes `el` liquid glass of `kind` while it is mounted (call from a `ref`). Its CSS decides
 * where the filter goes: `backdrop-filter: var(--lg-filter, <fallback>)`.
 */
export function liquid(el: HTMLElement, kind: LiquidKind | LiquidSpec): void {
  const spec: LiquidSpec = typeof kind === "string" ? LIQUID[kind] : kind;
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.id = `lg-${++nextId}`;
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("primitiveUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  container().appendChild(filter);
  const entry: Entry = { el, spec, filter, width: 0, height: 0, radius: 0, tint: undefined, built: "" };
  entries.set(el, entry);
  el.dataset.liquid = typeof kind === "string" ? kind : "custom";
  // The radius is read once the element is styled (it's mounted by then, or on the next frame).
  const measure = () => {
    if (entries.get(el) !== entry) return; // unmounted before its first frame
    entry.radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    apply(entry);
  };
  requestAnimationFrame(measure);
  observer().observe(el, { box: "border-box" });
  onCleanup(() => {
    resizes?.unobserve(el);
    entries.delete(el);
    filter.remove();
    el.style.removeProperty("--lg-filter");
    el.style.removeProperty("--lg-fill");
  });
}
