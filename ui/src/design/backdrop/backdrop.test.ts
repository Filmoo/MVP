import { describe, expect, it } from "vitest";
import { COLOR_MS, cubicBezier, ease, glideAt, POSITION_MS } from "./glide";
import { isEffects, loadEffects, plan, saveEffects } from "./quality";
import { canvasSize, type GlassRect, type Light, MAX_PANES, PANE_STRIDE, packPanes, parseColor, parsePercent, sameLight } from "./uniforms";

const view = { width: 1280, height: 800 };
const card = (left: number, top: number, extra: Partial<GlassRect> = {}): GlassRect => ({
  left,
  top,
  width: 300,
  height: 200,
  radius: 12,
  chrome: false,
  ...extra,
});
/** The pane each group of 6 vertices describes: [cx, cy, hw, hh, radius, strength]. */
const packed = (vertices: Float32Array, count: number) =>
  Array.from({ length: count / 6 }, (_, i) => [...vertices.slice(i * 6 * PANE_STRIDE + 2, i * 6 * PANE_STRIDE + PANE_STRIDE)]);

describe("quality", () => {
  const env = { reducedTransparency: false, reducedMotion: false };

  it("auto draws the shader and animates its glides", () => {
    expect(plan("auto", env)).toEqual({ rendering: "shader", animate: true });
  });

  it("light keeps the CSS light, off turns everything down", () => {
    expect(plan("light", env).rendering).toBe("css");
    expect(plan("off", env).rendering).toBe("flat");
  });

  it("respects the OS: less transparency means no glass effects, less motion means no glides", () => {
    expect(plan("auto", { ...env, reducedTransparency: true }).rendering).toBe("css");
    expect(plan("auto", { ...env, reducedMotion: true })).toEqual({ rendering: "shader", animate: false });
    // An explicit choice still wins over "auto" defaults.
    expect(plan("off", { reducedTransparency: true, reducedMotion: true }).rendering).toBe("flat");
  });

  it("persists the preference and ignores anything unknown", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadEffects(storage)).toBe("auto");
    saveEffects("off", storage);
    expect(loadEffects(storage)).toBe("off");
    store.set("mvp.effects", "ultra");
    expect(loadEffects(storage)).toBe("auto");
    expect(isEffects("light")).toBe(true);
    expect(isEffects(3)).toBe(false);
  });

  it("falls back to auto when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadEffects(broken)).toBe("auto");
    expect(loadEffects(undefined)).toBe("auto");
  });
});

describe("colors from CSS", () => {
  it("parses the computed forms the backdrop reads", () => {
    expect(parseColor("#0d0e15")).toEqual([13 / 255, 14 / 255, 21 / 255]);
    expect(parseColor("#fff")).toEqual([1, 1, 1]);
    expect(parseColor("#1617249c")).toEqual([22 / 255, 23 / 255, 36 / 255]);
    expect(parseColor("rgb(185, 169, 255)")).toEqual([185 / 255, 169 / 255, 1]);
    expect(parseColor(" rgb(185 169 255) ")).toEqual([185 / 255, 169 / 255, 1]);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual([10 / 255, 20 / 255, 30 / 255]);
  });

  it("rejects what it can't read (the caller keeps its defaults)", () => {
    for (const bad of ["", "red", "#12", "#12345", "rgb(1, 2)", "oklch(0.7 0.1 200)"]) expect(parseColor(bad), bad).toBeNull();
  });

  it("reads the light's position in percent", () => {
    expect(parsePercent("50%", 0)).toBe(0.5);
    expect(parsePercent("0%", 0.5)).toBe(0);
    expect(parsePercent("", 0.5)).toBe(0.5);
    expect(parsePercent("400%", 0)).toBe(1.5);
  });
});

describe("pane packing", () => {
  it("packs each visible pane as two triangles with its center, half size, radius and strength", () => {
    const { vertices, vertexCount } = packPanes([card(100, 50)], view);
    expect(vertexCount).toBe(6);
    expect(packed(vertices, vertexCount)).toEqual([[250, 150, 150, 100, 12, 1]]);
    // The quad covers the pane exactly.
    const xs = Array.from({ length: 6 }, (_, i) => vertices[i * PANE_STRIDE] ?? Number.NaN);
    const ys = Array.from({ length: 6 }, (_, i) => vertices[i * PANE_STRIDE + 1] ?? Number.NaN);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([100, 400, 50, 250]);
  });

  it("drops panes that are off screen or empty", () => {
    const panes = [card(0, -300), card(0, 900), card(1300, 10), card(-400, 10), card(10, 10, { width: 0 }), card(10, 10)];
    expect(packPanes(panes, view).vertexCount).toBe(6);
  });

  it("clamps the corner radius to the pane", () => {
    const { vertices, vertexCount } = packPanes([card(0, 0, { width: 10, height: 8, radius: 999 })], view);
    expect(packed(vertices, vertexCount)[0]?.[4]).toBe(4);
  });

  it("keeps all chrome, draws it last (over scrolled cards) and bends less through it", () => {
    const bar = card(0, 0, { width: 1280, height: 40, radius: 0, chrome: true });
    const panes = [bar, ...Array.from({ length: 20 }, (_, i) => card(10 + i, 60 + i))];
    const { vertices, vertexCount } = packPanes(panes, view);
    expect(vertexCount).toBe(MAX_PANES * 6);
    const all = packed(vertices, vertexCount);
    expect(all.at(-1)?.slice(0, 5)).toEqual([640, 20, 640, 20, 0]);
    expect(all.at(-1)?.[5]).toBeCloseTo(0.45, 5);
    // Cards in document order before it.
    expect(all[0]?.[0]).toBe(160);
    expect(all[1]?.[0]).toBe(161);
  });

  it("reuses the caller's buffer", () => {
    const buffer = packPanes([], view).vertices;
    expect(packPanes([card(1, 1)], view, buffer).vertices).toBe(buffer);
  });
});

describe("sizes", () => {
  it("renders at half the CSS size, never above one device pixel per CSS px", () => {
    expect(canvasSize({ width: 1920, height: 1080 }, 1, 0.5)).toEqual({ width: 960, height: 540 });
    expect(canvasSize({ width: 1280, height: 800 }, 2, 0.5)).toEqual({ width: 640, height: 400 });
    expect(canvasSize({ width: 1280, height: 720 }, 0.75, 0.5)).toEqual({ width: 480, height: 270 });
    expect(canvasSize({ width: 0, height: 0 }, 1, 0.5)).toEqual({ width: 1, height: 1 });
  });
});

describe("glides", () => {
  const a: Light = { background: [0, 0, 0], glowA: [1, 0, 0], glowB: [0, 1, 0], glowC: [0, 0, 1], origin: [0.2, 0] };
  const b: Light = { background: [0, 0, 0], glowA: [0, 0, 1], glowB: [1, 0, 0], glowC: [0, 1, 0], origin: [0.8, 0.4] };

  it("matches CSS cubic-bezier easing", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0, 0.25, 0.5, 0.9, 1]) expect(linear(t)).toBeCloseTo(t, 4);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    // --ease starts fast: well past half way at half time, and never overshoots.
    expect(ease(0.5)).toBeGreaterThan(0.8);
    for (let t = 0; t <= 1; t += 0.05) expect(ease(t)).toBeLessThanOrEqual(1);
  });

  it("glides colors in COLOR_MS and the position in POSITION_MS, then stops", () => {
    expect(glideAt(a, b, 0).light).toEqual(a);
    const mid = glideAt(a, b, COLOR_MS);
    expect(mid.light.glowA).toEqual(b.glowA);
    expect(mid.light.origin[0]).toBeLessThan(b.origin[0]);
    expect(mid.done).toBe(false);
    const end = glideAt(a, b, POSITION_MS);
    expect(end.light).toEqual(b);
    expect(end.done).toBe(true);
  });

  it("knows when the light didn't change (the light pass is skipped)", () => {
    expect(sameLight(undefined, a)).toBe(false);
    expect(sameLight(a, { ...a, glowA: [1, 0, 0] })).toBe(true);
    expect(sameLight(a, { ...a, origin: [0.2, 0.01] })).toBe(false);
  });
});
