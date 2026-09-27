import { resolve } from "node:path";
import { test } from "@playwright/test";
import { openApp, VIEWS } from "./app";

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

for (const { scenario, sizes } of SHOTS) {
  for (const [width, height] of sizes) {
    test(`home ${scenario} ${width}x${height}`, async ({ page }) => {
      await openApp(page, { scenario, width, height });
      // Narrow layouts scroll: capture the whole page so everything can be reviewed.
      await page.screenshot({ path: `${OUT}/home-${scenario}-${width}x${height}.png`, fullPage: width < 900 });
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
    await page.screenshot({ path: `${OUT}/draft-champ-select-${width}x${height}.png`, fullPage: width < 900 });
  });
}

for (const view of VIEWS.slice(1)) {
  test(`${view} 1280x800`, async ({ page }) => {
    await openApp(page, { view });
    await page.screenshot({ path: `${OUT}/${view.slice(1)}-default-1280x800.png` });
  });
}
