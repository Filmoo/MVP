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
 * `backdrop-filter: var(--lg-filter, <fallback>)`, on itself or on a pseudo-element (so that
 * glass inside glass still sees the page: an element with its own backdrop-filter would hide
 * what's behind it from its descendants' glass).
 */
import { onCleanup } from "solid-js";
import type { LiquidSpec } from "./filter";
import type { Entry } from "./lens";

export type { LiquidSpec };

/** The kinds of glass the app uses (see docs/architecture.md, "Glass and light"). */
export const LIQUID = {
  /** Title bar: content scrolls under it; its lower rim bends it, the rest is frosted. */
  // No colour split anywhere over the page: the glass sits over text, where a split reads as
  // fringing, not as optics (the backdrop shader keeps its own at card rims, over light only).
  bar: {
    glass: { profile: "squircle", bezel: 12, thickness: 16 },
    rims: "bottom",
    frost: 8,
    dispersion: 0,
    saturate: 1.4,
    brightness: 1.06,
  },
  /** Floating panels holding text (search results, toasts): frosted, with a lensing rim. */
  panel: {
    glass: { profile: "squircle", bezel: 16, thickness: 22 },
    frost: 8,
    dispersion: 0,
    saturate: 1.6,
    brightness: 1.08,
  },
  /** Clear lenses over controls (rail selection, pressed toggles, segment thumbs): they magnify. */
  lens: {
    glass: { profile: "circle", bezel: 0, thickness: 0 },
    // A shallow dome: labels under it grow a little and stay crisp.
    dome: 0.3,
    frost: 0,
    dispersion: 0,
    saturate: 1.5,
    brightness: 1.1,
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
      // Style is clean after layout: a radius changed by a media query is cheap to read here.
      entry.radius = Number.parseFloat(getComputedStyle(entry.el).borderTopLeftRadius) || 0;
      apply(entry);
    }
  });
  return resizes;
}

function apply(entry: Entry): void {
  if (!lensing || entry.width <= 0 || entry.height <= 0) {
    entry.el.style.removeProperty("--lg-filter");
    return;
  }
  if (!lens) {
    load();
    return;
  }
  lens.build(entry);
  const value = `url(#${entry.filter.id})`;
  if (entry.el.style.getPropertyValue("--lg-filter") !== value) entry.el.style.setProperty("--lg-filter", value);
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
  const entry: Entry = { el, spec, filter, width: 0, height: 0, radius: 0, built: "" };
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
  });
}
