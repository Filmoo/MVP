import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import budgets from "../perf-budgets.json" with { type: "json" };
import { openApp, settle, VIEWS } from "./app";

test.describe.configure({ mode: "serial" });

const results: Record<string, unknown> = {};

test.afterAll(() => {
  const dir = resolve(import.meta.dirname, "../../reports/perf");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "latest.json"), `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`);
});

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

async function cdpFor(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  return cdp;
}

test("each widget mounts within its time and DOM budget", async ({ page }) => {
  await openApp(page, { freezeClock: false });
  const widgets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-widget]")].map((el) => {
      const name = el.dataset.widget ?? "";
      const entry = performance.getEntriesByName(`widget:${name}`).at(-1);
      return { name, mountMs: entry?.duration ?? Number.NaN, domNodes: el.querySelectorAll("*").length };
    }),
  );
  expect(widgets.length).toBeGreaterThan(0);
  results.widgets = widgets;
  const table = budgets.widgets as Record<string, { mountMs: number; domNodes: number }>;
  for (const w of widgets) {
    const budget = table[w.name];
    expect(budget, `widget "${w.name}" has no entry in perf-budgets.json`).toBeDefined();
    expect(w.mountMs, `${w.name} mount time`).toBeLessThanOrEqual(budget?.mountMs ?? 0);
    expect(w.domNodes, `${w.name} DOM nodes`).toBeLessThanOrEqual(budget?.domNodes ?? 0);
  }
});

test("boot: all widgets painted within budget", async ({ page }) => {
  await openApp(page, { freezeClock: false });
  const bootMs = await page.evaluate(() =>
    Math.max(
      ...performance
        .getEntriesByType("measure")
        .filter((e) => e.name.startsWith("widget:"))
        .map((e) => e.startTime + e.duration),
    ),
  );
  results.bootMs = bootMs;
  expect(bootMs).toBeLessThanOrEqual(budgets.bootMs);
});

test("idle: no scripts, layouts or style work while nothing happens", async ({ page }) => {
  await openApp(page, { freezeClock: false });
  await page.waitForTimeout(500);
  const cdp = await cdpFor(page);
  const before = await metrics(cdp);
  await page.waitForTimeout(3_000);
  const after = await metrics(cdp);
  const idle = {
    scriptMs: ((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1_000,
    layouts: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
    styleRecalcs: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
  };
  results.idle = idle;
  expect(idle.scriptMs).toBeLessThanOrEqual(budgets.idle.scriptMs);
  expect(idle.layouts).toBeLessThanOrEqual(budgets.idle.layouts);
  expect(idle.styleRecalcs).toBeLessThanOrEqual(budgets.idle.styleRecalcs);
});

test("switching views is instant and memory stays small", async ({ page }) => {
  await openApp(page, { freezeClock: false });
  const switches: Record<string, number> = {};
  for (const view of [...VIEWS.slice(1), "/"]) {
    switches[view] = await page.evaluate(async (to) => {
      const t0 = performance.now();
      window.location.hash = to;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    }, view);
    await settle(page);
  }
  results.viewSwitchMs = switches;
  for (const [view, ms] of Object.entries(switches)) expect(ms, view).toBeLessThanOrEqual(budgets.viewSwitchMs);

  const cdp = await cdpFor(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const heapMb = ((await metrics(cdp)).JSHeapUsedSize ?? 0) / 1_048_576;
  results.heapMb = heapMb;
  expect(heapMb).toBeLessThanOrEqual(budgets.heapMb);
});

test("resizing the window re-lays out cheaply", async ({ page }) => {
  await openApp(page, { width: 1920, height: 1080, freezeClock: false });
  const cdp = await cdpFor(page);
  const before = await metrics(cdp);
  const widths = [1600, 1280, 1024, 820, 640, 480, 400, 560, 900, 1440, 1920];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  const after = await metrics(cdp);
  const avg = (((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)) * 1_000) / widths.length;
  results.resizeLayoutMsAvg = avg;
  expect(avg).toBeLessThanOrEqual(budgets.resizeLayoutMsAvg);
});
