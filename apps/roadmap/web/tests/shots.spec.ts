import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, open, reset, settle, test } from "./app";

/** Screenshots for design review, from the committed roadmap: reports/roadmap/<name>-<width>.png. */
const OUT = resolve(import.meta.dirname, "../../../../reports/roadmap");

const SIZES = [
  { width: 1280, height: 800 },
  { width: 420, height: 860 },
];

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

for (const size of SIZES) {
  test(`screens at ${size.width}`, async ({ page }) => {
    await reset(page, "builtin");
    await page.setViewportSize(size);
    await open(page);
    const shot = async (name: string) => {
      // Past the one-time entrance (rings filling, nodes landing).
      await page.waitForTimeout(1_800);
      await settle(page);
      await page.screenshot({ path: resolve(OUT, `${name}-${size.width}.png`) });
    };

    await shot("board");

    await page.goto("/#/roadmap");
    await expect(page.getByTestId("roadmap")).toBeVisible();
    await shot("roadmap");

    await page.goto("/#/board?panel=inbox");
    await expect(page.getByTestId("inbox")).toBeVisible();
    await shot("proposals");

    await page.goto("/#/list");
    await expect(page.getByTestId("list")).toBeVisible();
    await shot("list");

    await page.goto("/#/board");
    await page.getByTestId("board").locator("[data-feature]", { hasText: "Tier list hub" }).click();
    await expect(page.getByTestId("feature-sheet")).toBeVisible();
    await shot("feature");

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("tier");
    await shot("palette");
  });
}
