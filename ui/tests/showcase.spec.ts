import { resolve } from "node:path";
import { type Page, test } from "@playwright/test";
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

test("home match accepted toast 1280x800", async ({ page }) => {
  await openApp(page, { scenario: "match-accepted" });
  await page.getByTestId("toast").waitFor();
  await capture(page, `${OUT}/home-match-accepted-1280x800.png`, false);
});
