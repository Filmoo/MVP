import type { Effects } from "../../data/generated/Effects";

/**
 * Visual effects level (pure parts are unit-tested). The core keeps the lasting choice in its
 * settings (`Settings.effects`); a copy in localStorage lets the first frame already match.
 *
 * - `auto` (default): the WebGL backdrop and liquid glass when the machine can draw them
 *   cheaply, else `light`.
 * - `light`: static CSS gradients and plain blur, nothing bends.
 * - `off`: flat background, no blur at all (the lightest possible).
 */
export type { Effects };

/** What is actually drawn. `shader` = WebGL backdrop; `css` = static gradients; `flat` = bg-0 only. */
export type Rendering = "shader" | "css" | "flat";

export const EFFECTS: readonly Effects[] = ["auto", "light", "off"];

const KEY = "mvp.effects";

export function isEffects(value: unknown): value is Effects {
  return typeof value === "string" && (EFFECTS as readonly string[]).includes(value);
}

/** The saved preference, `auto` when none (or storage is unavailable). */
export function loadEffects(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Effects {
  try {
    const saved = storage?.getItem(KEY);
    return isEffects(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

export function saveEffects(effects: Effects, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, effects);
  } catch {
    // unavailable storage: the choice lasts for this session
  }
}

export interface Environment {
  /** The user asked the OS for less transparency: no glass effects. */
  reducedTransparency: boolean;
  /** The user asked for less motion: the shader still draws, but colour changes jump. */
  reducedMotion: boolean;
}

export interface Plan {
  /** What to try first; `shader` falls back to `css` when WebGL fails or is too slow. */
  rendering: Rendering;
  /** Render every frame while the page light glides (else only its end state). */
  animate: boolean;
}

export function plan(effects: Effects, env: Environment): Plan {
  if (effects === "off") return { rendering: "flat", animate: false };
  if (effects === "light" || env.reducedTransparency) return { rendering: "css", animate: false };
  return { rendering: "shader", animate: !env.reducedMotion };
}

/** A first frame slower than this (GPU included) means a software or very weak GPU: use CSS. */
export const SLOW_FIRST_RENDER_MS = 8;

export function environment(): Environment {
  const query = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
  return {
    reducedTransparency: query("(prefers-reduced-transparency: reduce)"),
    reducedMotion: query("(prefers-reduced-motion: reduce)"),
  };
}
