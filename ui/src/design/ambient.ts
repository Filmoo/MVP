import { type Accessor, createEffect, onCleanup } from "solid-js";
import { css, extractPalette, type Palette } from "./palette";

/**
 * Colors from content. A view (or a single widget) names the image it shows: its palette is
 * sampled once, cached in memory and across launches, and exposed as CSS variables that static
 * gradients use. Nothing runs while idle; a change glides via registered properties.
 *
 * - Page light (`useAmbient`): `--amb-a/b/c` on <main>, for the backdrop and hero cards.
 * - Widget tone (`useTone`): `--tone-a/b/c` on one element, e.g. a champion slot.
 */

const STORE = "mvp.palettes.v2";
const memory = new Map<string, Promise<Palette | null>>();
let stored: Record<string, Palette | null> | undefined;

function persisted(): Record<string, Palette | null> {
  if (!stored) {
    try {
      stored = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, Palette | null>;
    } catch {
      stored = {};
    }
  }
  return stored;
}

function persist(url: string, palette: Palette | null): void {
  const all = persisted();
  all[url] = palette;
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // storage full or unavailable: memory cache still works
  }
}

/** One small CPU-backed canvas, reused for every sample. */
const SAMPLE_MAX = 48;
let context: OffscreenCanvasRenderingContext2D | null | undefined;
function sampler(): OffscreenCanvasRenderingContext2D | null {
  if (context === undefined) context = new OffscreenCanvas(SAMPLE_MAX, SAMPLE_MAX).getContext("2d", { willReadFrequently: true });
  return context;
}

/** Sample size: small enough to be instant, big enough to find the subject. */
function sampleSize(img: HTMLImageElement): [number, number] {
  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
  return ratio > 1.2 ? [SAMPLE_MAX, Math.round(SAMPLE_MAX / ratio)] : [32, 32];
}

/** Palette of an image URL; `null` when it has no usable color or can't be read (CORS). */
export function samplePalette(url: string): Promise<Palette | null> {
  const hit = memory.get(url);
  if (hit) return hit;
  const saved = persisted()[url];
  if (saved !== undefined) {
    const ready = Promise.resolve(saved);
    memory.set(url, ready);
    return ready;
  }
  const palette = new Promise<Palette | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = async () => {
      try {
        // Decode and shrink off the main thread; only the tiny extraction runs here.
        const [w, h] = sampleSize(img);
        const bitmap = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
        const started = performance.now();
        const ctx = sampler();
        if (!ctx) return resolve(null);
        ctx.clearRect(0, 0, SAMPLE_MAX, SAMPLE_MAX);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const result = extractPalette(ctx.getImageData(0, 0, w, h).data, w);
        performance.measure("palette", { start: started, end: performance.now() });
        persist(url, result);
        resolve(result);
      } catch {
        resolve(null); // tainted canvas: keep the default colors
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  memory.set(url, palette);
  return palette;
}

const VARS = { amb: ["--amb-a", "--amb-b", "--amb-c"], tone: ["--tone-a", "--tone-b", "--tone-c"] } as const;

function apply(el: HTMLElement, names: readonly string[], palette: Palette | null): void {
  const values = palette ? [palette.primary, palette.secondary, palette.quiet] : [];
  names.forEach((name, i) => {
    const color = values[i];
    if (color) el.style.setProperty(name, css(color));
    else el.style.removeProperty(name);
  });
  // Later changes glide; the first paint doesn't animate.
  if (!el.hasAttribute("data-tone")) requestAnimationFrame(() => el.setAttribute("data-tone", "ready"));
}

function follow(el: () => HTMLElement | null, names: readonly string[], source: Accessor<string | undefined>): void {
  let generation = 0;
  createEffect(() => {
    const url = source();
    const mine = ++generation;
    const target = el();
    if (!target) return;
    if (!url) return apply(target, names, null);
    void samplePalette(url).then((palette) => {
      if (mine === generation) apply(target, names, palette);
    });
  });
  onCleanup(() => {
    generation++;
    const target = el();
    if (target) apply(target, names, null);
  });
}

/** Lights the page (backdrop, heroes) with the colors of `source` while the caller is mounted. */
export function useAmbient(source: Accessor<string | undefined>): void {
  follow(() => document.querySelector("main"), VARS.amb, source);
}

/** Tints one element (`--tone-a/b/c`) with the colors of `source`. Use from a ref callback. */
export function useTone(el: HTMLElement, source: Accessor<string | undefined>): void {
  follow(() => el, VARS.tone, source);
}
