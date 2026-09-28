import { resolve } from "node:path";
import { type Page, test } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { FIXTURE_NOW } from "../src/data/mock/fixtures";
import { lockInImport } from "../src/data/mock/import-fixtures";
import { openApp, settle, VIEWS } from "./app";

// Screenshots for human/UI-agent review. Not asserted: layout, coherence and
// error specs are the gates. Output: reports/screenshots/<view>-<scenario>-<size>.png
const OUT = resolve(import.meta.dirname, "../../reports/screenshots");

const SHOTS = [
  {
    scenario: "default",
    sizes: [
      [1280, 800],
      [1920, 1080],
      [820, 760],
      [420, 800],
    ],
  },
  { scenario: "not-running", sizes: [[1280, 800]] },
  { scenario: "new-player", sizes: [[1280, 800]] },
  { scenario: "profile-error", sizes: [[1280, 800]] },
  {
    scenario: "extreme",
    sizes: [
      [1280, 800],
      [420, 800],
    ],
  },
] as const;

/**
 * The app scrolls inside <main>, so Playwright's fullPage sees one window's worth: grow the
 * window by what <main> hides, then capture.
 */
async function capture(page: Page, path: string, full: boolean): Promise<void> {
  if (full) {
    const hidden = await page.locator("main").evaluate((main) => main.scrollHeight - main.clientHeight);
    const size = page.viewportSize();
    if (size && hidden > 0) {
      await page.setViewportSize({ width: size.width, height: size.height + hidden });
      await settle(page);
    }
  }
  await page.screenshot({ path });
}

for (const { scenario, sizes } of SHOTS) {
  for (const [width, height] of sizes) {
    test(`home ${scenario} ${width}x${height}`, async ({ page }) => {
      await openApp(page, { scenario, width, height });
      // Narrow layouts scroll: capture the whole page so everything can be reviewed.
      await capture(page, `${OUT}/home-${scenario}-${width}x${height}.png`, width < 900);
    });
  }
}

for (const [width, height] of [
  [1280, 800],
  [1920, 1080],
  [820, 760],
  [420, 800],
] as const) {
  test(`draft champ-select ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/draft", scenario: "champ-select", width, height });
    await capture(page, `${OUT}/draft-champ-select-${width}x${height}.png`, width < 900);
  });
}

for (const view of VIEWS.slice(1)) {
  test(`${view} 1280x800`, async ({ page }) => {
    await openApp(page, { view });
    await page.screenshot({ path: `${OUT}/${view.slice(1)}-default-1280x800.png` });
  });
}

// Build imports: every state of the import bar, the lock-in toast, and the draft without stats.
for (const [width, height] of [
  [1280, 800],
  [420, 800],
] as const) {
  test(`draft import failures ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/draft", scenario: "import-failures", width, height });
    for (const name of ["Import item set", "Import spells", "Import runes"]) {
      await page.getByRole("button", { name }).click();
      await page.getByRole("button", { name }).and(page.locator(":not([aria-busy])")).waitFor();
    }
    await page.mouse.move(0, 0);
    await settle(page);
    await capture(page, `${OUT}/draft-import-failures-${width}x${height}.png`, false);
  });
}

test("draft import flash 1280x800", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "import-flash" });
  await page.getByRole("button", { name: "Import runes" }).click();
  await page.getByRole("button", { name: "Import spells" }).click();
  await page.getByTestId("import-spells").and(page.locator("[data-tone=warn]")).waitFor();
  await page.mouse.move(0, 0);
  await settle(page);
  await capture(page, `${OUT}/draft-import-flash-1280x800.png`, false);
});

test("draft import lock-in 1280x800", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "import-lock-in" });
  await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
  await page.getByTestId("toast").waitFor();
  await settle(page);
  await capture(page, `${OUT}/draft-import-lock-in-1280x800.png`, false);
});

test("draft no stats 1280x800", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "draft-no-stats" });
  await capture(page, `${OUT}/draft-no-stats-1280x800.png`, false);
});

test("draft champ-select 420x800 tapped", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select", width: 420, height: 800 });
  await page.getByTestId("suggestion").filter({ hasText: "Shen" }).click();
  await capture(page, `${OUT}/draft-champ-select-420x800-tapped.png`, true);
});

const SETTINGS_SHOTS = [
  {
    scenario: "default",
    sizes: [
      [1920, 1080],
      [820, 760],
      [420, 800],
      [2560, 1440],
    ],
  },
  { scenario: "settings-custom", sizes: [[1280, 800]] },
  { scenario: "settings-error", sizes: [[1280, 800]] },
] as const;

for (const { scenario, sizes } of SETTINGS_SHOTS) {
  for (const [width, height] of sizes) {
    test(`settings ${scenario} ${width}x${height}`, async ({ page }) => {
      await openApp(page, { view: "/settings", scenario, width, height });
      await capture(page, `${OUT}/settings-${scenario}-${width}x${height}.png`, width < 900);
    });
  }
}

test("settings save error 1280x800", async ({ page }) => {
  await openApp(page, { view: "/settings", scenario: "settings-save-error" });
  await page.getByRole("switch", { name: "Close to tray" }).click();
  await page.getByRole("alert").waitFor();
  await page.mouse.move(0, 0);
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await capture(page, `${OUT}/settings-save-error-1280x800.png`, false);
});

const WIDE_TO_NARROW = [
  [1280, 720],
  [1920, 1080],
  [820, 760],
  [420, 800],
] as const;

for (const [width, height] of WIDE_TO_NARROW) {
  test(`search open ${width}x${height}`, async ({ page }) => {
    await openApp(page, { width, height });
    await page.getByTestId("search-input").click();
    await page.keyboard.type("Ahri#EUW");
    await page.getByTestId("search-option").filter({ hasText: "Level" }).waitFor();
    await settle(page);
    await capture(page, `${OUT}/search-open-${width}x${height}.png`, false);
  });

  test(`player ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE", width, height });
    await capture(page, `${OUT}/player-default-${width}x${height}.png`, width < 900);
  });

  test(`live ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/live", scenario: "live", width, height });
    await capture(page, `${OUT}/live-ingame-${width}x${height}.png`, width < 900);
  });
}

test("search recent 1280x720", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mvp.recent-searches.v1",
      JSON.stringify([
        { kind: "player", platform: "euw1", riotId: { gameName: "Blade Dancer", tagLine: "IRE" } },
        { kind: "champion", championId: 103 },
        { kind: "player", platform: "kr", riotId: { gameName: "Hide on bush", tagLine: "KR1" } },
      ]),
    );
  });
  await openApp(page, { width: 1280, height: 720 });
  await page.keyboard.press("Control+k");
  await page.getByTestId("search-panel").waitFor();
  await settle(page);
  await capture(page, `${OUT}/search-recent-1280x720.png`, false);
});

test("search slow lookup 1280x720", async ({ page }) => {
  await openApp(page, { scenario: "search-slow", width: 1280, height: 720 });
  await page.getByTestId("search-input").click();
  await page.keyboard.type("Fillmo#7272");
  await page.getByTestId("search-option").filter({ hasText: "Searching" }).waitFor();
  await page.screenshot({ path: `${OUT}/search-loading-1280x720.png` });
});

for (const scenario of ["live-scouting", "live-failed", "live-extreme"] as const) {
  test(`live ${scenario} 1280x720`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.clock.setFixedTime(new Date(FIXTURE_NOW));
    await page.goto(`/?scenario=${scenario}#/live`);
    await page.getByTestId("live-card").first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/live-${scenario}-1280x720.png` });
  });
}

for (const name of ["Nobody/404", "Busy/429", "Offline/0"] as const) {
  test(`player ${name} 1280x720`, async ({ page }) => {
    await openApp(page, { view: `/player/euw1/${name}`, width: 1280, height: 720 });
    await capture(page, `${OUT}/player-${name.replace("/", "-")}-1280x720.png`, false);
  });
}

test("player loading 1280x720", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?scenario=search-slow#/player/euw1/Blade%20Dancer/IRE");
  await page.locator("main [data-state=loading]").first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/player-loading-1280x720.png` });
});

test("champion soon 1280x720", async ({ page }) => {
  await openApp(page, { view: "/champions?id=103", width: 1280, height: 720 });
  await capture(page, `${OUT}/champion-soon-1280x720.png`, false);
});

test("home match accepted toast 1280x800", async ({ page }) => {
  await openApp(page, { scenario: "match-accepted" });
  await page.getByTestId("toast").waitFor();
  await capture(page, `${OUT}/home-match-accepted-1280x800.png`, false);
});
