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
  // Before: the page as it ships.
  { name: "before-tier-list-1280x800", route: "/tier-list", size: [1280, 800] },
  { name: "before-tier-list-420x800", route: "/tier-list", size: [420, 800] },
  { name: "before-tier-list-2560x1440", route: "/tier-list", size: [2560, 1440] },
  // Context: the app's other pages.
  { name: "ctx-home-1280x800", route: "/", size: [1280, 800] },
  { name: "ctx-champions-1280x800", route: "/champions", size: [1280, 800] },
  { name: "ctx-champion-1280x800", route: "/champions?id=103", size: [1280, 800] },
  { name: "ctx-draft-1280x800", route: "/draft", size: [1280, 800], scenario: "champ-select" },
  { name: "ctx-settings-1280x800", route: "/settings", size: [1280, 800] },
  { name: "ctx-brand-x4", route: "/tier-list", size: [400, 200], dpr: 4, clip: "header [class*=brand]" },
  // Direction A — Shelves.
  { name: "A-shelves-1280x800", route: "/tier-list?design=shelves&role=middle", size: [1280, 800] },
  { name: "A-shelves-420x800", route: "/tier-list?design=shelves&role=middle", size: [420, 800] },
  { name: "A-shelves-all-1280x800", route: "/tier-list?design=shelves&role=all", size: [1280, 800] },
  {
    name: "A-shelves-peek-1280x800",
    route: "/tier-list?design=shelves&role=middle",
    size: [1280, 800],
    hover: "[data-rank='3']",
  },
  { name: "A-shelves-2560x1440", route: "/tier-list?design=shelves&role=middle", size: [2560, 1440] },
  {
    name: "A-shelves-fr-rail-1280x800",
    route: "/tier-list?design=shelves&role=middle",
    size: [1280, 800],
    lang: "fr",
    hover: "[data-testid=role-filter] [role=radio]:nth-of-type(1)",
  },
  // Direction B — Ledger.
  { name: "B-ledger-1280x800", route: "/tier-list?design=ledger&role=top", size: [1280, 800] },
  { name: "B-ledger-420x800", route: "/tier-list?design=ledger&role=top", size: [420, 800] },
  { name: "B-ledger-scrolled-1280x800", route: "/tier-list?design=ledger&role=top", size: [1280, 800], scroll: 620 },
  // The role rail: rest, open under the pointer, reached with the keyboard.
  { name: "R-rail-rest-x2", route: "/tier-list?design=shelves&role=middle", size: [1280, 800], dpr: 2, region: [80, 150, 620, 300] },
  {
    name: "R-rail-hover-x2",
    route: "/tier-list?design=shelves&role=middle",
    size: [1280, 800],
    dpr: 2,
    hover: "[data-testid=role-filter] [role=radio]:nth-of-type(3)",
    region: [80, 150, 620, 300],
  },
  {
    name: "R-rail-keyboard-x2",
    route: "/tier-list?design=shelves&role=middle",
    size: [1280, 800],
    dpr: 2,
    focus: "[data-testid=bracket-switch] [aria-checked=true]",
    keys: ["Tab", "ArrowDown"],
    region: [80, 150, 620, 300],
  },
  {
    name: "R-rail-hover-420x800",
    route: "/tier-list?design=shelves&role=middle",
    size: [420, 800],
    hover: "[data-testid=role-filter] [role=radio]:nth-of-type(5)",
  },
  // Direction C — Meta map.
  { name: "C-map-1280x800", route: "/tier-list?design=map&role=middle", size: [1280, 800] },
  { name: "C-map-420x800", route: "/tier-list?design=map&role=middle", size: [420, 800] },
  { name: "C-map-all-1280x800", route: "/tier-list?design=map&role=all", size: [1280, 800] },
  {
    name: "C-map-lit-1280x800",
    route: "/tier-list?design=map&role=middle",
    size: [1280, 800],
    // Zed's face on the map (its list row lights up with it).
    hover: "a[aria-label][href*='id=238&']",
  },
  { name: "C-map-scope-1280x800", route: "/tier-list?design=map&role=middle", size: [1280, 800], click: "[data-testid=scope-button]" },
  // The penguin: first start (no League), nothing published, About.
  { name: "P-home-waiting-1280x800", route: "/", scenario: "not-running", size: [1280, 800] },
  { name: "P-home-waiting-420x800", route: "/", scenario: "not-running", size: [420, 800] },
  { name: "P-stats-empty-1280x800", route: "/tier-list", scenario: "stats-empty", size: [1280, 800] },
  { name: "P-about-x2", route: "/settings", size: [1280, 800], dpr: 2, region: [846, 110, 404, 130] },
  // The lab: icons, tier medallions, the penguin at every size.
  { name: "L-design-lab-1280", route: "/__harness?show=design", size: [1280, 800], full: true },
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
  if (shot.hover) {
    const box = await page.locator(shot.hover).first().boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2 + (shot.hoverDx ?? 0), box.y + box.height / 2 + (shot.hoverDy ?? 0), { steps: 6 });
  } else if (!shot.tabs && !shot.focus && !shot.click) {
    await page.mouse.move(0, 0);
  }
  if (shot.hover || shot.tabs || shot.keys || shot.focus || shot.click) await settle(page);
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
