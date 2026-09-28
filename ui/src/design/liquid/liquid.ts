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
 * Full visual effects level); otherwise the same elements keep their plain CSS blur.
 *
 * Usage: `<div ref={(el) => liquid(el, "panel")}>`. The element's CSS applies the filter with
 * `backdrop-filter: var(--lg-filter, <fallback>)`, on itself or on a pseudo-element (so that
 * glass inside glass still sees the page: an element with its own backdrop-filter would hide
 * what's behind it from its descendants' glass).
 */
import { onCleanup } from "solid-js";
import { type Rims, type Slice, scaleFor, slicePixels, slices } from "./maps";
import { type Glass, type OpticsTable, opticsTable } from "./optics";

export interface LiquidSpec {
  /** The glass; a dome's bezel and thickness come from its size instead (see `dome`). */
  glass: Glass;
  /**
   * A dome lens: the bezel spans half the element's smaller side and the top rises this share
   * of it, so the whole pane magnifies (0.6 ≈ ×1.15 in the middle).
   */
  dome?: number;
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
}

/** The kinds of glass the app uses (see docs/architecture.md, "Glass and light"). */
export const LIQUID = {
  /** Title bar: content scrolls under it; its lower rim bends it, the rest is frosted. */
  bar: {
    glass: { profile: "squircle", bezel: 12, thickness: 16 },
    rims: "bottom",
    frost: 4,
    dispersion: 0.06,
    saturate: 1.7,
    brightness: 1.06,
  },
  /** Floating panels holding text (search results, toasts): frosted, with a lensing rim. */
  panel: {
    glass: { profile: "squircle", bezel: 16, thickness: 22 },
    frost: 8,
    dispersion: 0.08,
    saturate: 1.6,
    brightness: 1.08,
  },
  /** Clear lenses over controls (rail selection, pressed toggles, slider thumbs): they magnify. */
  lens: {
    glass: { profile: "circle", bezel: 0, thickness: 0 },
    dome: 0.6,
    frost: 0,
    dispersion: 0.04,
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

interface Entry {
  el: HTMLElement;
  spec: LiquidSpec;
  filter: SVGFilterElement;
  width: number;
  height: number;
  radius: number;
  /** What the filter was last built for. */
  built: string;
}

const entries = new Map<HTMLElement, Entry>();
let defs: SVGSVGElement | undefined;
let resizes: ResizeObserver | undefined;
let nextId = 0;

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

/** Glass geometry in effect for an element: domes take their bezel and height from its size. */
function glassFor(spec: LiquidSpec, width: number, height: number): Glass {
  if (!spec.dome) return spec.glass;
  const half = Math.min(width, height) / 2;
  return { ...spec.glass, bezel: half, thickness: half * spec.dome };
}

const tables = new Map<string, OpticsTable>();
function table(glass: Glass): OpticsTable {
  const key = `${glass.profile}:${glass.bezel.toFixed(2)}:${glass.thickness.toFixed(2)}:${glass.ior ?? ""}`;
  let t = tables.get(key);
  if (!t) {
    t = opticsTable(glass);
    tables.set(key, t);
  }
  return t;
}

/** Slice images as data URLs (the app's CSP allows `data:` images), shared by every element. */
const images = new Map<string, string>();
let canvas: HTMLCanvasElement | undefined;
function image(slice: Slice, radius: number, glass: Glass, optics: OpticsTable): string {
  const key = `${slice.name}:${slice.imageWidth}x${slice.imageHeight}:${radius.toFixed(2)}:${glass.profile}:${glass.bezel.toFixed(2)}:${glass.thickness.toFixed(2)}`;
  const hit = images.get(key);
  if (hit) return hit;
  canvas ??= document.createElement("canvas");
  canvas.width = slice.imageWidth;
  canvas.height = slice.imageHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const pixels = slicePixels(slice, { radius }, glass, optics);
  ctx.putImageData(new ImageData(pixels, slice.imageWidth, slice.imageHeight), 0, 0);
  const url = canvas.toDataURL("image/png");
  images.set(key, url);
  return url;
}

function node<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, String(v));
  return el;
}

/** Keeps one colour channel of a displaced copy (alpha kept). */
const CHANNEL = {
  r: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  g: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  b: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
};

/** (Re)builds an element's filter for its current size. */
function build(entry: Entry): void {
  const { spec, width: w, height: h } = entry;
  const glass = glassFor(spec, w, h);
  // The optical outline: a dome is a stadium (smooth normals everywhere its surface slopes);
  // a slab's corners are rounded at least as much as its bezel is wide, so the rim's normals
  // turn smoothly instead of creasing along the corner's diagonal.
  const half = Math.min(w, h) / 2;
  const radius = spec.dome ? half : Math.min(half, Math.max(entry.radius, glass.bezel));
  const key = `${w.toFixed(1)}x${h.toFixed(1)}:${radius.toFixed(1)}`;
  if (entry.built === key) return;
  entry.built = key;
  const optics = table(glass);
  const parts = slices({ width: w, height: h, radius }, glass.bezel, spec.rims);
  const f = entry.filter;
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h })) f.setAttribute(k, String(v));
  const children: SVGElement[] = [node("feFlood", { "flood-color": "#808080", result: "neutral" })];
  parts.forEach((slice, i) => {
    const href = image(slice, radius, glass, optics);
    children.push(
      node("feImage", {
        href,
        x: slice.x,
        y: slice.y,
        width: slice.width,
        height: slice.height,
        preserveAspectRatio: "none",
        result: `s${i}`,
      }),
    );
  });
  const merge = node("feMerge", { result: "map" });
  merge.append(node("feMergeNode", { in: "neutral" }), ...parts.map((_, i) => node("feMergeNode", { in: `s${i}` })));
  children.push(merge);
  let source = "SourceGraphic";
  if (spec.frost) {
    children.push(node("feGaussianBlur", { in: "SourceGraphic", stdDeviation: spec.frost, edgeMode: "duplicate", result: "frost" }));
    source = "frost";
  }
  const scale = scaleFor(optics.max);
  const displace = (s: number, result: string) =>
    node("feDisplacementMap", { in: source, in2: "map", scale: s, xChannelSelector: "R", yChannelSelector: "G", result });
  const split = spec.dispersion ?? 0;
  if (split > 0) {
    children.push(
      displace(scale * (1 - split), "dr"),
      node("feColorMatrix", { in: "dr", type: "matrix", values: CHANNEL.r, result: "r" }),
      displace(scale, "dg"),
      node("feColorMatrix", { in: "dg", type: "matrix", values: CHANNEL.g, result: "g" }),
      displace(scale * (1 + split), "db"),
      node("feColorMatrix", { in: "db", type: "matrix", values: CHANNEL.b, result: "b" }),
      node("feComposite", { in: "r", in2: "g", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "rg" }),
      node("feComposite", { in: "rg", in2: "b", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "lens" }),
    );
  } else {
    children.push(displace(scale, "lens"));
  }
  if (spec.saturate && spec.saturate !== 1) {
    children.push(node("feColorMatrix", { in: "lens", type: "saturate", values: spec.saturate, result: "lens" }));
  }
  if (spec.brightness && spec.brightness !== 1) {
    const transfer = node("feComponentTransfer", { in: "lens", result: "lens" });
    transfer.append(...(["feFuncR", "feFuncG", "feFuncB"] as const).map((fn) => node(fn, { type: "linear", slope: spec.brightness ?? 1 })));
    children.push(transfer);
  }
  f.replaceChildren(...children);
}

function apply(entry: Entry): void {
  if (!lensing || entry.width <= 0 || entry.height <= 0) {
    entry.el.style.removeProperty("--lg-filter");
    return;
  }
  build(entry);
  const value = `url(#${entry.filter.id})`;
  if (entry.el.style.getPropertyValue("--lg-filter") !== value) entry.el.style.setProperty("--lg-filter", value);
}

/**
 * Makes `el` liquid glass of `kind` while it is mounted (call from a `ref`). Its CSS decides
 * where the filter goes: `backdrop-filter: var(--lg-filter, <fallback>)`.
 */
export function liquid(el: HTMLElement, kind: LiquidKind | LiquidSpec): void {
  const spec: LiquidSpec = typeof kind === "string" ? LIQUID[kind] : kind;
  const filter = node("filter", {
    id: `lg-${++nextId}`,
    filterUnits: "userSpaceOnUse",
    primitiveUnits: "userSpaceOnUse",
    "color-interpolation-filters": "sRGB",
  });
  container().appendChild(filter);
  const entry: Entry = { el, spec, filter, width: 0, height: 0, radius: 0, built: "" };
  entries.set(el, entry);
  el.dataset.liquid = typeof kind === "string" ? kind : "custom";
  // The radius is read once the element is styled (it's mounted by then, or on the next frame).
  const measure = () => {
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
