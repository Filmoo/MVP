#!/usr/bin/env node
// Design pre-shoot screenshots (not a test): true renders of prototypes from a running dev server.
//   pnpm exec vite --port 1436 --strictPort          (never 1420: the owner's app)
//   node scripts/design-shots.mjs [filter…]           → reports/design/<name>.png
// Full effects (the WebGL backdrop trusted on a software rasterizer, as the UI suites do), the
// fixture clock, fonts, game data and images settled before each capture.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.MVP_DESIGN_URL ?? "http://127.0.0.1:1436";
const OUT = resolve(import.meta.dirname, "../../reports/design");
const FIXTURE_NOW = 1_790_510_400_000;

/**
 * name, route (hash), size, and optional steps:
 * - full: grow the window by what <main> hides (narrow pages scroll)
 * - hover: a selector to rest the pointer on
 * - tabs: Tab presses from the page start (keyboard focus states)
 * - keys: keys pressed after the tabs
 * - clip: a selector to capture alone
 * - lang: "fr" for the French UI
 */
const SHOTS = [
  // The tier list hub: shelves (the default) and table, at 420, 1280 and 2560.
  { name: "after-shelves-1280x800", route: "/tier-list?view=shelves&role=middle", size: [1280, 800] },
  { name: "after-shelves-420x800", route: "/tier-list?view=shelves&role=middle", size: [420, 800], full: true },
  { name: "after-shelves-2560x1440", route: "/tier-list?view=shelves&role=middle", size: [2560, 1440] },
  { name: "after-shelves-all-1280x800", route: "/tier-list?view=shelves&role=all", size: [1280, 800] },
  { name: "after-table-1280x800", route: "/tier-list?view=table&role=all", size: [1280, 800] },
  { name: "after-table-420x800", route: "/tier-list?view=table&role=all", size: [420, 800] },
  { name: "after-table-2560x1440", route: "/tier-list?view=table&role=all", size: [2560, 1440] },
  { name: "after-table-aram-1280x800", route: "/tier-list?view=table&queue=450", size: [1280, 800] },
  // States: the hover card, a lane's tooltip, the rank menu, the filter, the full map.
  {
    name: "state-peek-1280x800",
    route: "/tier-list?view=shelves&role=middle&queue=420",
    size: [1280, 800],
    scroll: 280,
    hover: "[data-testid=tier-row]",
  },
  {
    name: "state-lane-tip-1280x800",
    route: "/tier-list?view=shelves&role=middle",
    size: [1280, 800],
    hover: "[data-testid=role-filter] [role=radio]:nth-of-type(3)",
  },
  { name: "state-rank-menu-1280x800", route: "/tier-list?view=shelves&role=middle", size: [1280, 800], click: "[data-testid=rank-button]" },
  {
    name: "state-filter-1280x800",
    route: "/tier-list?view=table&role=all",
    size: [1280, 800],
    type: ["[data-testid=champion-filter]", "ah"],
  },
  { name: "state-map-1280x800", route: "/tier-list?view=shelves&role=middle", size: [1280, 800], click: "[data-testid=open-map]" },
  { name: "state-map-all-1280x800", route: "/tier-list?view=shelves&role=all", size: [1280, 800], click: "[data-testid=open-map]" },
  { name: "state-map-420x800", route: "/tier-list?view=shelves&role=middle", size: [420, 800], click: "[data-testid=open-map]" },
  { name: "state-no-trends-1280x800", route: "/tier-list?view=table&role=middle", scenario: "stats-first-patch", size: [1280, 800] },
  { name: "state-offline-1280x800", route: "/tier-list", scenario: "stats-offline", size: [1280, 800] },
  { name: "state-empty-1280x800", route: "/tier-list", scenario: "stats-empty", size: [1280, 800] },
  { name: "state-champion-1280x800", route: "/champions?id=103", size: [1280, 800] },
  { name: "state-french-1280x800", route: "/tier-list?view=table&role=all", size: [1280, 800], lang: "fr" },
  // The penguin's places and the lab.
  { name: "P-home-waiting-1280x800", route: "/", scenario: "not-running", size: [1280, 800] },
  { name: "P-about-x2", route: "/settings", size: [1280, 800], dpr: 2, region: [846, 110, 404, 130] },
  { name: "L-design-lab-x2", route: "/__harness?show=design", size: [1280, 800], dpr: 2, full: true },
];

async function settle(page, ready = "main h1, main [data-widget], main [data-harness] > *") {
  // A lazy view (Vite compiles it on first load) and its data: its heading or widget is in.
  await page.locator(ready).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-state=loading]").length === 0, null, { timeout: 15_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 80 && document.documentElement.dataset.gameData !== "settled"; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const img of document.images) img.loading = "eager";
    const deadline = performance.now() + 4_000;
    while (performance.now() < deadline) {
      const pending = [...document.images].filter((img) => !img.complete);
      if (pending.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await Promise.race([
      Promise.all([...document.images].map((img) => img.decode().catch(() => undefined))),
      new Promise((r) => setTimeout(r, 2_000)),
    ]);
    for (let round = 0; round < 10; round++) {
      const running = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY);
      if (running.length === 0) break;
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  // The backdrop renders on demand: give it a frame or two after the last layout change.
  await page.waitForTimeout(250);
}

async function shoot(browser, shot) {
  const [width, height] = shot.size;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: shot.dpr ?? 1,
    colorScheme: "dark",
    locale: shot.lang === "fr" ? "fr-FR" : "en-US",
    reducedMotion: shot.reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(FIXTURE_NOW));
  await page.addInitScript(() => {
    localStorage.setItem("mvp.effects", "full");
    window.__MVP_TRUST_WEBGL__ = true;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/?scenario=${shot.scenario ?? "default"}#${shot.route}`);
  await settle(page, shot.ready);
  if (shot.full) {
    const hidden = await page.locator("main").evaluate((main) => main.scrollHeight - main.clientHeight);
    if (hidden > 0) {
      await page.setViewportSize({ width, height: height + hidden });
      await settle(page);
    }
  }
  if (shot.scroll) {
    await page.locator("main").evaluate((main, y) => main.scrollTo(0, y), shot.scroll);
    // The backdrop redraws the cards' glass edges on demand once the scroll settles.
    await page.waitForTimeout(900);
    await settle(page);
  }
  if (shot.focus) await page.locator(shot.focus).first().focus();
  for (let i = 0; i < (shot.tabs ?? 0); i++) await page.keyboard.press("Tab");
  for (const key of shot.keys ?? []) await page.keyboard.press(key);
  if (shot.click) await page.locator(shot.click).first().click();
  if (shot.type) await page.locator(shot.type[0]).first().fill(shot.type[1]);
  if (shot.hover) {
    const box = await page.locator(shot.hover).first().boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2 + (shot.hoverDx ?? 0), box.y + box.height / 2 + (shot.hoverDy ?? 0), { steps: 6 });
  } else if (!shot.tabs && !shot.focus && !shot.click && !shot.type) {
    await page.mouse.move(0, 0);
  }
  if (shot.hover || shot.tabs || shot.keys || shot.focus || shot.click || shot.type) await settle(page);
  const path = `${OUT}/${shot.name}.png`;
  if (shot.clip) await page.locator(shot.clip).first().screenshot({ path });
  else if (shot.region) {
    const [x, y, w, h] = shot.region;
    await page.screenshot({ path, clip: { x, y, width: w, height: h } });
  } else await page.screenshot({ path });
  await context.close();
  return { path, errors };
}

const filters = process.argv.slice(2);
const chosen = SHOTS.filter((s) => filters.length === 0 || filters.some((f) => s.name.includes(f)));
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const shot of chosen) {
  const { path, errors } = await shoot(browser, shot);
  console.log(`${path}${errors.length ? `  (${errors.length} errors: ${errors.slice(0, 2).join(" | ")})` : ""}`);
}
await browser.close();
