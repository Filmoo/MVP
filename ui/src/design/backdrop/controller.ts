import { createSignal } from "solid-js";
import { setLensing } from "../liquid/liquid";
import { type Effects, type Environment, environment, loadEffects, MOTION_QUERY, type Rendering, saveEffects } from "./quality";

/**
 * What the window draws: the visual effects preference and the rendering in force. The WebGL
 * backdrop itself (engine.ts, with its renderer and shaders) loads only when it is drawn.
 */

const [effects, setEffectsSignal] = createSignal<Effects>(loadEffects());

/** The visual effects preference (`auto` | `light` | `off`), persisted on this machine. */
export { effects };
export function setEffects(next: Effects): void {
  saveEffects(next);
  setEffectsSignal(next);
}

const [os, setOs] = createSignal<Environment>(environment());
let following = false;

/**
 * The OS preferences (less transparency, less motion), followed as they change: turning Windows'
 * transparency switch applies at once. Media query events, nothing polls.
 */
export function osEnvironment(): Environment {
  if (!following && typeof matchMedia === "function") {
    following = true;
    for (const query of [MOTION_QUERY]) {
      matchMedia(query).addEventListener("change", () => setOs(environment()));
    }
  }
  return os();
}

const [rendered, setRendered] = createSignal<{ rendering: Rendering; reason: string | undefined }>({ rendering: "css", reason: undefined });

/** What is drawn right now, and why when it isn't what was asked (for Settings). */
export { rendered };

/** What is drawn right now, on <html data-effects>: the CSS keys off it. `reason` explains a fallback. */
export function setRendering(rendering: Rendering, reason?: string): void {
  setRendered({ rendering, reason });
  const root = document.documentElement;
  if (root.dataset.effects !== rendering) root.dataset.effects = rendering;
  if (reason) root.dataset.effectsFallback = reason;
  else delete root.dataset.effectsFallback;
  // Glass that bends the page runs on the same GPU budget: only with the shader.
  setLensing(rendering === "shader");
}

/**
 * Test switch: the UI suites run on a software rasterizer (headless Chromium's SwiftShader), which
 * the speed probe rightly rejects. `window.__MVP_TRUST_WEBGL__ = true` (set before the app loads)
 * keeps the shader anyway, so the suites exercise it deterministically at every window size.
 */
export function trustWebgl(): boolean {
  return (globalThis as { __MVP_TRUST_WEBGL__?: unknown }).__MVP_TRUST_WEBGL__ === true;
}
