/**
 * Pure color math for ambient light: the key colors of an image, as pastels.
 *
 * Works in OKLCH (perceptual lightness, chroma, hue) so every pastel has the same perceived
 * brightness whatever the source: a brown champion and a neon one both come out as soft, equally
 * light tints of their own hue.
 */

export type Rgb = readonly [number, number, number];

export interface Palette {
  /** The image's dominant hue. */
  primary: Rgb;
  /** A second, clearly different hue (or a neighbour of the first when there is none). */
  secondary: Rgb;
  /** A quiet tint of the primary, for large areas. */
  quiet: Rgb;
}

const BINS = 24; // 15° hue bins
/** Pastel target in OKLCH: light, soft chroma. */
const PASTEL_L = 0.8;
const PASTEL_C: readonly [number, number] = [0.07, 0.13];
const QUIET_C = 0.05;
/** Hues closer than this count as the same family. */
const MIN_HUE_GAP = 45;
/** How strongly the center (the subject) outweighs the edges: exp(-focus × d²). */
const CENTER_FOCUS = 12;

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

/** sRGB → OKLab (Björn Ottosson). */
export function oklab([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → sRGB, lowering chroma until the color fits the sRGB gamut. */
export function fromOklch(L: number, C: number, hueDeg: number): Rgb {
  const h = (hueDeg * Math.PI) / 180;
  for (let c = C; c >= 0; c -= 0.005) {
    const lin = oklabToLinear(L, c * Math.cos(h), c * Math.sin(h));
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) return [fromLinear(lin[0]), fromLinear(lin[1]), fromLinear(lin[2])];
  }
  const grey = fromLinear(oklabToLinear(L, 0, 0)[0]);
  return [grey, grey, grey];
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Key colors of RGBA pixels (`width` wide), or `null` for a colorless image. Vivid pixels count
 * more (chroma), and so do pixels near the center, where the subject of art and icons sits.
 */
export function extractPalette(pixels: ArrayLike<number>, width: number): Palette | null {
  const height = Math.max(1, Math.floor(pixels.length / 4 / width));
  const bins = Array.from({ length: BINS }, () => ({ weight: 0, a: 0, b: 0, chroma: 0 }));
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 200) continue;
    const [L, a, b] = oklab([pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0]);
    const chroma = Math.hypot(a, b);
    if (L < 0.2 || chroma < 0.03) continue; // shadows and greys carry no hue
    const px = i / 4;
    const dx = ((px % width) + 0.5) / width - 0.5;
    const dy = (Math.floor(px / width) + 0.5) / height - 0.5;
    const weight = chroma * Math.exp(-(dx * dx + dy * dy) * CENTER_FOCUS);
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    const bin = bins[Math.floor(hue / (360 / BINS)) % BINS];
    if (!bin) continue;
    bin.weight += weight;
    bin.a += a * weight;
    bin.b += b * weight;
    bin.chroma += chroma * weight;
    total += weight;
  }
  if (total === 0) return null;

  // Families: each bin plus half of its neighbours, so a hue split across two bins still wins.
  const families = bins
    .map((bin, i) => {
      const prev = bins[(i + BINS - 1) % BINS];
      const next = bins[(i + 1) % BINS];
      return {
        score: bin.weight + 0.5 * ((prev?.weight ?? 0) + (next?.weight ?? 0)),
        hue: ((Math.atan2(bin.b, bin.a) * 180) / Math.PI + 360) % 360,
        chroma: bin.weight > 0 ? bin.chroma / bin.weight : 0,
        weight: bin.weight,
      };
    })
    .filter((f) => f.weight > 0)
    .sort((x, y) => y.score - x.score);

  const [first] = families;
  if (!first) return null;
  const second = families.find((f) => hueGap(f.hue, first.hue) >= MIN_HUE_GAP && f.score >= first.score * 0.15);
  const pastel = (hue: number, chroma: number) => fromOklch(PASTEL_L, Math.min(Math.max(chroma, PASTEL_C[0]), PASTEL_C[1]), hue);

  return {
    primary: pastel(first.hue, first.chroma),
    secondary: second ? pastel(second.hue, second.chroma) : pastel(first.hue + 35, first.chroma * 0.8),
    quiet: fromOklch(PASTEL_L, QUIET_C, first.hue),
  };
}

export function css([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}
