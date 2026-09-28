/**
 * Displacement maps for the SVG lens (liquid.ts), cut in nine slices so one set of small images
 * serves a glass element of any size: four corners, four edges stretched along the element, and
 * a neutral middle (a flood). Resizing an element only moves slices, it never redraws pixels.
 *
 * A map pixel stores where to look instead, as an offset from the pixel: red = x, green = y,
 * 128 = no offset, ±127 = ±`max` CSS px (feDisplacementMap `scale` = `scaleFor(max)`). Blue is
 * how much of its tint the glass shows there (0 at the rim, 255 past the bezel): clear where it
 * bends the light, so what it bends stays visible. The middle (a flood) is 128, 128, 255.
 * Pure: pixels come out as bytes; the DOM side turns them into images.
 */
import { type Glass, lookup, type OpticsTable, rim, type Shape } from "./optics";

export type SliceName = "tl" | "tr" | "bl" | "br" | "top" | "bottom" | "left" | "right";

/** Which sides of the element are glass rims. A bar along the window's top only has its bottom rim. */
export type Rims = "all" | "bottom";

export interface Slice {
  name: SliceName;
  /** Where it sits on the element, CSS px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Size of its image, device px (the map is as sharp as the screen): corners are drawn whole,
   * edges one pixel long and stretched along the element.
   */
  imageWidth: number;
  imageHeight: number;
}

/** Bezel and corner radius as they fit in the element (both at most half its smaller side). */
export function fitted(shape: Shape, bezel: number): { radius: number; bezel: number; corner: number } {
  const half = Math.max(0, Math.min(shape.width, shape.height) / 2);
  const radius = Math.min(Math.max(0, shape.radius), half);
  const b = Math.min(Math.max(0, bezel), half);
  return { radius, bezel: b, corner: Math.max(radius, b) };
}

/**
 * The slices of an element: where each image goes. Empty slices (zero length) are left out.
 * `density`: device pixels per CSS px (the images' resolution).
 */
export function slices(shape: Shape, bezel: number, rims: Rims = "all", density = 1): Slice[] {
  const { width: w, height: h } = shape;
  const f = fitted(shape, bezel);
  if (w <= 0 || h <= 0 || f.bezel <= 0) return [];
  const px = (css: number) => Math.max(1, Math.ceil(css * density));
  if (rims === "bottom") {
    const b = Math.min(f.bezel, h);
    return [{ name: "bottom", x: 0, y: h - b, width: w, height: b, imageWidth: 1, imageHeight: px(b) }];
  }
  const c = f.corner;
  const b = f.bezel;
  const side = px(c);
  const strip = px(b);
  const out: Slice[] = [
    { name: "tl", x: 0, y: 0, width: c, height: c, imageWidth: side, imageHeight: side },
    { name: "tr", x: w - c, y: 0, width: c, height: c, imageWidth: side, imageHeight: side },
    { name: "bl", x: 0, y: h - c, width: c, height: c, imageWidth: side, imageHeight: side },
    { name: "br", x: w - c, y: h - c, width: c, height: c, imageWidth: side, imageHeight: side },
    { name: "top", x: c, y: 0, width: w - 2 * c, height: b, imageWidth: 1, imageHeight: strip },
    { name: "bottom", x: c, y: h - b, width: w - 2 * c, height: b, imageWidth: 1, imageHeight: strip },
    { name: "left", x: 0, y: c, width: b, height: h - 2 * c, imageWidth: strip, imageHeight: 1 },
    { name: "right", x: w - b, y: c, width: b, height: h - 2 * c, imageWidth: strip, imageHeight: 1 },
  ];
  return out.filter((s) => s.width > 0.01 && s.height > 0.01);
}

/** feDisplacementMap `scale` for a map whose ±127 means ±`max` px. */
export function scaleFor(max: number): number {
  return (max * 255) / 127;
}

/**
 * Pixels (RGBA bytes) of one slice's image. Corner and edge images don't depend on the
 * element's size, only on its radius and bezel, so they are rendered on a stand-in element
 * just big enough to hold every slice.
 */
export function slicePixels(
  slice: Pick<Slice, "name" | "width" | "height" | "imageWidth" | "imageHeight">,
  shape: Pick<Shape, "radius">,
  glass: Glass,
  table: OpticsTable,
): Uint8ClampedArray<ArrayBuffer> {
  const { imageWidth: iw, imageHeight: ih } = slice;
  const bezel = Math.max(1e-6, glass.bezel);
  // Strips are one pixel long: they sample the middle of their side.
  const horizontal = slice.name === "top" || slice.name === "bottom";
  const vertical = slice.name === "left" || slice.name === "right";
  // The image's extent across the rim, CSS px (strips: their thickness only).
  const cw = horizontal ? 0 : slice.width;
  const ch = vertical ? 0 : slice.height;
  // A stand-in element with the same corner geometry, large enough that its corners and edges
  // never interact (2 corners + 2 px along each side).
  const span = 2 * Math.ceil(Math.max(shape.radius, bezel, cw, ch)) + 2;
  const stand: Shape = { width: span, height: span, radius: shape.radius };
  // Top-left of the slice on the stand-in, CSS px.
  const origin: Record<SliceName, [number, number]> = {
    tl: [0, 0],
    tr: [span - cw, 0],
    bl: [0, span - ch],
    br: [span - cw, span - ch],
    top: [span / 2, 0],
    bottom: [span / 2, span - ch],
    left: [0, span / 2],
    right: [span - cw, span / 2],
  };
  const [ox, oy] = origin[slice.name];
  const out = new Uint8ClampedArray(iw * ih * 4);
  const max = Math.max(1e-6, table.max);
  // Image pixels per CSS px may differ from 1 (a sharper map on a high-density screen).
  const pitchX = cw / iw;
  const pitchY = ch / ih;
  for (let j = 0; j < ih; j++) {
    for (let i = 0; i < iw; i++) {
      const x = horizontal ? ox : ox + (i + 0.5) * pitchX;
      const y = vertical ? oy : oy + (j + 0.5) * pitchY;
      const { distance, nx, ny } = rim(stand, x, y);
      const t = -distance / bezel;
      const inside = distance < 0;
      const d = inside && t < 1 ? lookup(table.displacement, t) : 0;
      const h = inside ? (t < 1 ? lookup(table.tint, t) : 1) : 0;
      // Look inward: against the outward normal.
      const o = (j * iw + i) * 4;
      out[o] = Math.round(128 - (127 * nx * d) / max);
      out[o + 1] = Math.round(128 - (127 * ny * d) / max);
      out[o + 2] = Math.round(255 * h);
      out[o + 3] = 255;
    }
  }
  return out;
}
