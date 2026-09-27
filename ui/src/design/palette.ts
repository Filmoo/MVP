/** Pure color math for the ambient background: dominant colors of an image, made pastel. */

export type Rgb = readonly [number, number, number];

const HUE_BINS = 12;
/** Pastel target: soft saturation, light. */
const PASTEL_S: readonly [number, number] = [0.55, 0.85];
const PASTEL_L = 0.66;

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [Math.round(channel(h + 1 / 3) * 255), Math.round(channel(h) * 255), Math.round(channel(h - 1 / 3) * 255)];
}

/** Same hue, pastel saturation and lightness; near-greys (low chroma) stay grey. */
export function pastel(color: Rgb): Rgb {
  const chroma = (Math.max(...color) - Math.min(...color)) / 255;
  if (chroma < 0.06) return hslToRgb(0, 0, PASTEL_L);
  const [h, s] = rgbToHsl(color);
  return hslToRgb(h, Math.min(Math.max(s, PASTEL_S[0]), PASTEL_S[1]), PASTEL_L);
}

/**
 * Up to three pastel colors from RGBA pixels: the two most vivid hue families (weighted by
 * saturation × brightness), then the overall average. Greyscale images give just the average.
 */
export function dominantColors(pixels: ArrayLike<number>): Rgb[] {
  const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  let [sumR, sumG, sumB] = [0, 0, 0];
  let count = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    if ((pixels[i + 3] ?? 0) < 200) continue;
    sumR += r;
    sumG += g;
    sumB += b;
    count++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const vivid = max === 0 ? 0 : ((max - min) / max) * (max / 255);
    if (vivid < 0.15) continue;
    const [h] = rgbToHsl([r, g, b]);
    const bin = bins[Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS))];
    if (!bin) continue;
    bin.weight += vivid;
    bin.r += r * vivid;
    bin.g += g * vivid;
    bin.b += b * vivid;
    total += vivid;
  }
  if (count === 0) return [];
  const colors: Rgb[] = bins
    .filter((bin) => bin.weight > total * 0.08)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((bin) => pastel([bin.r / bin.weight, bin.g / bin.weight, bin.b / bin.weight]));
  colors.push(pastel([sumR / count, sumG / count, sumB / count]));
  return colors;
}

export function css([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}
