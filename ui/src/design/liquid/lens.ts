/**
 * Builds liquid glass filters (liquid.ts registers the elements): the displacement maps from the
 * optics, as cached nine-slice images, and the SVG primitives that bend, frost, tint and light.
 * Loaded with the first lens.
 */
import { glassFor, type LiquidSpec, lensPrimitives, opticalRadius, type Primitive, type Tint } from "./filter";
import { type Slice, slicePixels, slices } from "./maps";
import { type Glass, type OpticsTable, opticsTable } from "./optics";

const SVG_NS = "http://www.w3.org/2000/svg";

/** An element made liquid glass, with the size and radius its filter is built for. */
export interface Entry {
  el: HTMLElement;
  spec: LiquidSpec;
  filter: SVGFilterElement;
  width: number;
  height: number;
  radius: number;
  /** The glass' colour where it is thickest (the element's `--lg-tint`), once read (`null`: none). */
  tint?: Tint | null | undefined;
  /** What the filter was last built for. */
  built: string;
}

/** `#rrggbbaa`, `#rgb`, `rgb()` / `rgba()` → channels 0–1 (what a token's value computes to). */
export function parseColor(value: string): Tint | undefined {
  const v = value.trim();
  const hex = /^#([\da-f]{3,8})$/i.exec(v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const byte = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) : 1 };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v)?.[1];
  if (!rgb) return undefined;
  const [r = 0, g = 0, b = 0, a = 1] = rgb
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return { r: r / 255, g: g / 255, b: b / 255, a };
}

const tables = new Map<string, OpticsTable>();
function table(glass: Glass): OpticsTable {
  const key = `${glass.profile}:${glass.bezel.toFixed(2)}:${glass.thickness.toFixed(2)}:${(glass.elevation ?? 0).toFixed(2)}:${glass.ior ?? ""}`;
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
  // Strips only depend on their thickness; corners on their size.
  const across =
    slice.name === "top" || slice.name === "bottom"
      ? `h${slice.height.toFixed(2)}`
      : slice.name === "left" || slice.name === "right"
        ? `w${slice.width.toFixed(2)}`
        : `${slice.width.toFixed(2)}x${slice.height.toFixed(2)}`;
  const key = `${slice.name}:${slice.imageWidth}x${slice.imageHeight}:${across}:${radius.toFixed(2)}:${glass.profile}:${glass.bezel.toFixed(2)}:${glass.thickness.toFixed(2)}:${(glass.elevation ?? 0).toFixed(2)}`;
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

function toSvg(p: Primitive): SVGElement {
  const el = document.createElementNS(SVG_NS, p.tag);
  for (const [k, v] of Object.entries(p.attrs)) el.setAttribute(k, String(v));
  if (p.children) el.append(...p.children.map(toSvg));
  return el;
}

/** (Re)builds an element's filter for its current size (only when the size or radius changed). */
export function build(entry: Entry): void {
  const { spec, width: w, height: h } = entry;
  const glass = glassFor(spec, w, h);
  const radius = opticalRadius(spec, glass, w, h, entry.radius);
  const tint = entry.tint ?? undefined;
  const key = `${w.toFixed(1)}x${h.toFixed(1)}:${radius.toFixed(1)}:${tint ? `${tint.r},${tint.g},${tint.b},${tint.a}` : ""}`;
  if (entry.built === key) return;
  entry.built = key;
  const optics = table(glass);
  // As sharp as the screen (capped: a 4K laptop at 250 % doesn't need maps finer than 2×).
  const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const parts = slices({ width: w, height: h, radius }, glass.bezel, spec.rims, density).map((slice) => ({
    slice,
    href: image(slice, radius, glass, optics),
  }));
  const f = entry.filter;
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h })) f.setAttribute(k, String(v));
  f.replaceChildren(...lensPrimitives(spec, parts, optics.max, tint).map(toSvg));
}
