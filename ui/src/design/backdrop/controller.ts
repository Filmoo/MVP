import { createSignal } from "solid-js";
import { setLensing } from "../liquid/liquid";
import { glideAt } from "./glide";
import { type Effects, loadEffects, type Rendering, SLOW_FIRST_RENDER_MS, saveEffects } from "./quality";
import { Renderer } from "./renderer";
import { canvasSize, type GlassRect, type Light, packPanes, parseColor, parsePercent, type Vec3 } from "./uniforms";

/**
 * The window backdrop, drawn by WebGL ON DEMAND only: when the page light changes (every frame
 * only while it glides), when the window or a glass pane resizes, when panes come and go, and
 * when what contains them scrolls. Nothing is scheduled while nothing changes.
 *
 * Glass panes are elements marked `data-refract` (`data-refract="chrome"` for the title bar and
 * rail); the shader bends the light under them.
 */

/** Canvas resolution as a fraction of CSS px (device pixel ratio capped at 1). */
const RESOLUTION = 0.5;
/** The light texture: one texel per this many CSS px (the light is very low-frequency). */
const LIGHT_TEXEL = 8;
/** Trim the performance timeline now and then: renders are measured, never accumulated. */
const MEASURE_TRIM = 500;

const [effects, setEffectsSignal] = createSignal<Effects>(loadEffects());

/** The visual effects preference (`auto` | `light` | `off`), persisted on this machine. */
export { effects };
export function setEffects(next: Effects): void {
  saveEffects(next);
  setEffectsSignal(next);
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
function trustWebgl(): boolean {
  return (globalThis as { __MVP_TRUST_WEBGL__?: unknown }).__MVP_TRUST_WEBGL__ === true;
}

interface Pane {
  el: HTMLElement;
  radius: number;
  chrome: boolean;
}

/** The registered initial values of --amb-a/b/c (tokens.css): the light when no palette is set. */
const DEFAULT_GLOW: Record<"a" | "b" | "c", Vec3> = {
  a: [185 / 255, 169 / 255, 1],
  b: [147 / 255, 188 / 255, 1],
  c: [201 / 255, 194 / 255, 232 / 255],
};
const DEFAULT_BG: Vec3 = [13 / 255, 14 / 255, 21 / 255];

let measured = 0;

/**
 * Starts drawing into `canvas` for the shell `host`. Returns a stop function, or `null` when
 * WebGL is unavailable or too slow here (the CSS light stays then).
 */
export function startBackdrop(canvas: HTMLCanvasElement, host: HTMLElement, animate: boolean): (() => void) | null {
  const renderer = Renderer.create(canvas);
  if (!renderer) {
    setRendering("css", "no-webgl");
    return null;
  }

  const background = parseColor(getComputedStyle(document.documentElement).getPropertyValue("--bg-0")) ?? DEFAULT_BG;
  /** The light ambient.ts asks for: inline `--amb-*` on the host (cheap to read, no style recalc). */
  const target = (): Light => {
    const inline = (name: string) => host.style.getPropertyValue(name);
    return {
      background,
      glowA: parseColor(inline("--amb-a")) ?? DEFAULT_GLOW.a,
      glowB: parseColor(inline("--amb-b")) ?? DEFAULT_GLOW.b,
      glowC: parseColor(inline("--amb-c")) ?? DEFAULT_GLOW.c,
      origin: [parsePercent(inline("--amb-x"), 0.5), parsePercent(inline("--amb-y"), 0)],
    };
  };

  let light = target();
  let glide: { from: Light; to: Light; start: number } | undefined;
  let panes: Pane[] = [];
  let panesDirty = true;
  /** Panes move only on scroll, resize or DOM changes; a glide alone reuses the last rects. */
  let rectsDirty = true;
  let rects: GlassRect[] = [];
  let frame = 0;
  const vertices = packPanes([], { width: 0, height: 0 }).vertices;
  const resizes = new ResizeObserver(() => {
    rectsDirty = true;
    schedule();
  });

  const collect = () => {
    panesDirty = false;
    rectsDirty = true;
    const next = [...document.querySelectorAll<HTMLElement>("[data-refract]")];
    const kept = new Set(next);
    const known = new Set(panes.map((p) => p.el));
    for (const p of panes) if (!kept.has(p.el)) resizes.unobserve(p.el);
    for (const el of next) if (!known.has(el)) resizes.observe(el);
    panes = next.map((el) => ({
      el,
      radius: Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
      chrome: el.dataset.refract === "chrome",
    }));
  };

  const draw = () => {
    if (panesDirty) collect();
    const view = { width: window.innerWidth, height: window.innerHeight };
    if (rectsDirty) {
      rectsDirty = false;
      rects = panes.map((p) => {
        const r = p.el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height, radius: p.radius, chrome: p.chrome };
      });
    }
    const { vertexCount } = packPanes(rects, view, vertices);
    renderer.draw({
      view,
      canvas: canvasSize(view, window.devicePixelRatio, RESOLUTION),
      texture: canvasSize(view, 1, 1 / LIGHT_TEXEL),
      light,
      panes: vertices,
      vertexCount,
    });
  };

  /** A scheduled render, measured: tests and budgets read the "backdrop" entries. */
  const render = () => {
    frame = 0;
    if (!renderer.ready) return;
    const started = performance.now();
    if (glide) {
      const step = glideAt(glide.from, glide.to, started - glide.start);
      light = step.light;
      if (step.done) glide = undefined;
    }
    draw();
    performance.measure("backdrop", { start: started, end: performance.now() });
    if (++measured % MEASURE_TRIM === 0) performance.clearMeasures("backdrop");
    if (glide) schedule();
  };

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(render);
  }

  // One-off speed probe, GPU included: a software rasterizer or a very weak GPU keeps the CSS
  // light. The best of three, because the first draw also finishes compiling the programs.
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3 && best > SLOW_FIRST_RENDER_MS; i++) {
    const t0 = performance.now();
    renderer.invalidateLight();
    draw();
    renderer.sync();
    best = Math.min(best, performance.now() - t0);
  }
  performance.measure("backdrop:probe", { start: 0, duration: best });
  if (best > SLOW_FIRST_RENDER_MS && !trustWebgl()) {
    renderer.dispose();
    setRendering("css", "slow");
    return null;
  }
  setRendering("shader");
  schedule(); // show the frame now that the canvas is visible

  // The page light (ambient.ts writes --amb-* inline on the host). It glides like the CSS does,
  // except for the first palette (ambient.ts marks later ones with data-tone="ready").
  const styles = new MutationObserver(() => {
    const to = target();
    const glides = animate && host.dataset.tone === "ready";
    glide = glides ? { from: light, to, start: performance.now() } : undefined;
    if (!glides) light = to;
    schedule();
  });
  styles.observe(host, { attributes: true, attributeFilter: ["style"] });
  // Panes mounting and unmounting (views, loading states, widgets).
  const tree = new MutationObserver(() => {
    panesDirty = true;
    rectsDirty = true;
    schedule();
  });
  tree.observe(host, { childList: true, subtree: true });
  resizes.observe(host);

  // Panes move when what contains them scrolls (rAF-throttled; other scrollers are ignored).
  const onScroll = (event: Event) => {
    const scroller = event.target;
    if (scroller instanceof Element && !panes.some((p) => scroller !== p.el && scroller.contains(p.el))) return;
    rectsDirty = true;
    schedule();
  };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });

  const onLost = (event: Event) => {
    event.preventDefault(); // lets the browser restore the context
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    setRendering("css", "context-lost");
  };
  const onRestored = () => {
    if (!renderer.setup()) return;
    panesDirty = true;
    rectsDirty = true;
    setRendering("shader");
    schedule();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    styles.disconnect();
    tree.disconnect();
    resizes.disconnect();
    document.removeEventListener("scroll", onScroll, { capture: true });
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    renderer.dispose();
  };
}
