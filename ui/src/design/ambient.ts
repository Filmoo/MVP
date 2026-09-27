import { type Accessor, createEffect, onCleanup } from "solid-js";
import { css, dominantColors, type Rgb } from "./palette";

/**
 * Ambient light: the app's background glow takes the colors of what a view shows (a champion,
 * the player's main). Colors are sampled once per image from a 24×24 thumbnail and cached; the
 * glow itself is static CSS, so it costs nothing while idle.
 */
const SAMPLE = 24;
const cache = new Map<string, Promise<Rgb[]>>();
const PROPS = ["--amb-a", "--amb-b", "--amb-c"] as const;

function sample(url: string): Promise<Rgb[]> {
  let colors = cache.get(url);
  if (!colors) {
    colors = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = SAMPLE;
          canvas.height = SAMPLE;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve([]);
          ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
          resolve(dominantColors(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data));
        } catch {
          resolve([]); // tainted canvas (no CORS): keep the default glow
        }
      };
      img.onerror = () => resolve([]);
      img.src = url;
    });
    cache.set(url, colors);
  }
  return colors;
}

function apply(colors: readonly Rgb[]): void {
  const root = document.documentElement;
  PROPS.forEach((prop, i) => {
    const color = colors[i] ?? colors[0];
    if (color) root.style.setProperty(prop, css(color));
    else root.style.removeProperty(prop);
  });
  // Later changes (view switches, new picks) glide; the first paint doesn't animate.
  requestAnimationFrame(() => root.setAttribute("data-ambient", "ready"));
}

/** Tints the ambient light with the colors of `source` (an image URL) while the caller is mounted. */
export function useAmbient(source: Accessor<string | undefined>): void {
  let generation = 0;
  createEffect(() => {
    const url = source();
    const mine = ++generation;
    if (!url) return apply([]);
    void sample(url).then((colors) => {
      if (mine === generation) apply(colors);
    });
  });
  onCleanup(() => {
    generation++;
    apply([]);
  });
}
