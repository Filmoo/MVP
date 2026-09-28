/**
 * Builds liquid glass filters (liquid.ts registers the elements): the displacement maps from the
 * optics, as cached nine-slice images, and the SVG primitives that bend, frost and brighten.
 * Loaded with the first lens.
 */
import { glassFor, type LiquidSpec, lensPrimitives, opticalRadius, type Primitive } from "./filter";
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
  /** What the filter was last built for. */
  built: string;
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
  const key = `${w.toFixed(1)}x${h.toFixed(1)}:${radius.toFixed(1)}`;
  if (entry.built === key) return;
  entry.built = key;
  const optics = table(glass);
  const parts = slices({ width: w, height: h, radius }, glass.bezel, spec.rims).map((slice) => ({
    slice,
    href: image(slice, radius, glass, optics),
  }));
  const f = entry.filter;
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h })) f.setAttribute(k, String(v));
  f.replaceChildren(...lensPrimitives(spec, parts, optics.max).map(toSvg));
}
