import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import budgets from "../perf-budgets.json" with { type: "json" };
// Brings the window.__SCOUT_HARNESS__ declaration into scope.
import type {} from "../src/widgets/harness-types";
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

const RUNS = 15;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

test("every widget renders within its budget, measured in isolation", async ({ page }) => {
  // Widgets actually on screen must all be registered for isolated measurement.
  await openApp(page, { freezeClock: false });
  const onScreen = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-widget]")].map((el) => el.dataset.widget ?? ""),
  );

  await openApp(page, { view: "/__harness", freezeClock: false });
  const names = await page.evaluate(() => window.__SCOUT_HARNESS__?.names ?? []);
  for (const name of onScreen) expect(names, `widget "${name}" missing from src/widgets/registry.tsx`).toContain(name);

  const table = budgets.widgets as Record<string, { renderMs: number; domNodes: number }>;
  const report = [];
  for (const name of names) {
    const m = await page.evaluate(([n, runs]) => window.__SCOUT_HARNESS__?.measure(n, runs), [name, RUNS] as const);
    expect(m, name).toBeDefined();
    report.push({ name, renderMs: median(m?.renderMs ?? []), domNodes: m?.domNodes ?? 0 });
  }
  results.widgets = report;
  for (const w of report) {
    const budget = table[w.name];
    expect(budget, `widget "${w.name}" has no entry in perf-budgets.json`).toBeDefined();
    expect(w.renderMs, `${w.name} render time (median of ${RUNS})`).toBeLessThanOrEqual(budget?.renderMs ?? 0);
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

// Stats pages load data on open: once shown, they're as quiet as Home (the champion list too, once
// its last tiles are built).
for (const view of ["/tier-list", "/champions?id=103", "/champions"]) {
  test(`idle on ${view}: no scripts, layouts or style work`, async ({ page }) => {
    await openApp(page, { view, freezeClock: false });
    await page.waitForTimeout(800);
    const cdp = await cdpFor(page);
    const before = await metrics(cdp);
    await page.waitForTimeout(3_000);
    const after = await metrics(cdp);
    expect(((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1_000, "script ms").toBeLessThanOrEqual(budgets.idle.scriptMs);
    expect((after.LayoutCount ?? 0) - (before.LayoutCount ?? 0), "layouts").toBeLessThanOrEqual(budgets.idle.layouts);
    expect((after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0), "style recalcs").toBeLessThanOrEqual(budgets.idle.styleRecalcs);
  });
}

// The stack of opened games (three windows of glass, the whole game, its stats table), once it has
// risen in and after it moved on to the next game: as quiet as the page under it; closed, too.
test("idle with a game open: no scripts, layouts or style work", async ({ page }) => {
  await openApp(page, { freezeClock: false });
  await page.locator("[data-testid=match-row] > button").nth(1).click();
  const current = page.locator("[data-testid=game-window][data-current]");
  await current.getByTestId("game-tabs").getByRole("radio").nth(1).click();
  await expect(current.getByTestId("game-stats")).toBeVisible();
  // On to the oldest game (none below it then).
  await current.getByTestId("game-body").focus();
  await page.keyboard.press("End");
  await expect(page.locator("[data-testid=game-window][data-place=older]")).toHaveCount(0);
  await settle(page);
  await page.waitForTimeout(800);
  const measure = async () => {
    const cdp = await cdpFor(page);
    const before = await metrics(cdp);
    await page.waitForTimeout(3_000);
    const after = await metrics(cdp);
    await cdp.detach();
    return {
      scriptMs: ((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1_000,
      layouts: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
      styleRecalcs: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
    };
  };
  const open = await measure();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("game-stack")).toHaveCount(0);
  await page.waitForTimeout(800);
  const closed = await measure();
  results.idleGame = { open, closed };
  for (const [state, idle] of Object.entries({ open, closed })) {
    expect(idle.scriptMs, `${state}: script ms`).toBeLessThanOrEqual(budgets.idle.scriptMs);
    expect(idle.layouts, `${state}: layouts`).toBeLessThanOrEqual(budgets.idle.layouts);
    expect(idle.styleRecalcs, `${state}: style recalcs`).toBeLessThanOrEqual(budgets.idle.styleRecalcs);
  }
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

test("colors from content: each palette samples in a few ms, then comes from the cache", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select", freezeClock: false });
  const sample = () =>
    page.evaluate(() =>
      performance
        .getEntriesByType("measure")
        .filter((e) => e.name === "palette")
        .map((e) => e.duration),
    );
  await expect.poll(async () => (await sample()).length).toBeGreaterThan(3);
  const first = (await sample()).sort((a, b) => a - b);
  const median = first[Math.floor(first.length / 2)] ?? 0;
  const max = first.at(-1) ?? 0;
  results.palette = { count: first.length, medianMs: median, maxMs: max };
  expect(median, "median sample").toBeLessThanOrEqual(budgets.palette.medianMs);
  expect(max, "slowest sample (first one warms up)").toBeLessThanOrEqual(budgets.palette.maxMs);

  // A second launch reads every palette from storage: no sampling at all.
  await page.reload();
  await settle(page);
  expect(await sample()).toEqual([]);
});

test("backdrop: renders only on demand, each in a fraction of a frame", async ({ page }) => {
  await openApp(page, { freezeClock: false });
  const durations = () => page.evaluate(() => performance.getEntriesByName("backdrop").map((e) => e.duration));
  const clear = () => page.evaluate(() => performance.clearMeasures("backdrop"));
  expect(await page.evaluate(() => document.documentElement.dataset.effects)).toBe("shader");

  // At rest: not a single frame.
  await page.waitForTimeout(500);
  await clear();
  await page.waitForTimeout(3_000);
  const idleRenders = (await durations()).length;

  // Scrolling (the glass moves), with the frame rate meanwhile.
  await clear();
  await page.mouse.move(640, 500);
  const fps = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          if (performance.now() - t0 < 1_500) {
            n++;
            requestAnimationFrame(tick);
          } else resolve((n * 1_000) / (performance.now() - t0));
        };
        requestAnimationFrame(tick);
      }),
  );
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, i < 12 ? 80 : -80);
    await page.waitForTimeout(40);
  }
  const scrollFps = await fps;
  const scroll = await durations();

  // Resizing, then a view switch (new panes; the light glides to the new view's colors).
  await clear();
  for (const width of [1200, 1100, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  await page.evaluate(() => {
    window.location.hash = "/draft";
  });
  await settle(page);
  await page.waitForTimeout(800);
  const other = await durations();

  const all = [...scroll, ...other];
  results.backdrop = {
    idleRenders,
    scrollRenders: scroll.length,
    scrollFps,
    otherRenders: other.length,
    renderMedianMs: median(all),
    renderMaxMs: Math.max(...all),
    probeMs: await page.evaluate(() => performance.getEntriesByName("backdrop:probe")[0]?.duration ?? -1),
  };
  expect(idleRenders, "renders over 3 s at rest").toBeLessThanOrEqual(budgets.backdrop.idleRenders);
  expect(scroll.length, "scrolling re-renders").toBeGreaterThan(0);
  expect(other.length, "resizing and switching views re-render").toBeGreaterThan(0);
  expect(median(all), `median render of ${all.length}`).toBeLessThanOrEqual(budgets.backdrop.renderMedianMs);
});
