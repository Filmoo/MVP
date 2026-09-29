import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { API, type Api, mockGitHub } from "./github";

// Screenshots for design review (`pnpm --filter @scout/site shots`), not assertions:
// reports/site/<lang>-<page>-<width>-<scheme>.png, and each page's transfer size in weights.json.
const OUT = fileURLToPath(new URL("../../reports/site/", import.meta.url));

const PAGES: { name: string; en: string; fr: string; api: Api }[] = [
  { name: "home", en: "/", fr: "/fr/", api: API.releases },
  { name: "home-no-release", en: "/", fr: "/fr/", api: API.empty },
  { name: "versions", en: "/versions/", fr: "/fr/versions/", api: API.releases },
  { name: "versions-no-release", en: "/versions/", fr: "/fr/versions/", api: API.empty },
  { name: "privacy", en: "/privacy/", fr: "/fr/confidentialite/", api: API.empty },
  { name: "terms", en: "/terms/", fr: "/fr/conditions/", api: API.empty },
  { name: "404", en: "/lost", fr: "/fr/perdu", api: API.empty },
];

async function open(page: Page, path: string, api: Api) {
  await mockGitHub(page, api);
  await page.goto(path);
  await expect(page.locator("[data-states]:not([data-shown])")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

for (const lang of ["en", "fr"] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [360, 1280]) {
      test.describe(`${lang} ${colorScheme} ${width}`, () => {
        test.use({ viewport: { width, height: width < 600 ? 780 : 900 }, colorScheme, contextOptions: { reducedMotion: "reduce" } });
        for (const shot of PAGES) {
          test(shot.name, async ({ page }) => {
            await open(page, shot[lang], shot.api);
            mkdirSync(OUT, { recursive: true });
            await page.screenshot({ path: `${OUT}${lang}-${shot.name}-${width}-${colorScheme}.png`, fullPage: true });
          });
        }
      });
    }
  }
}

test("page weights", async ({ page }) => {
  const weights: Record<string, { requests: number; kilobytes: number }> = {};
  for (const shot of PAGES) {
    for (const lang of ["en", "fr"] as const) {
      await page.goto("about:blank");
      await open(page, shot[lang], shot.api);
      const entries = await page.evaluate(() =>
        [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")]
          .filter((entry) => entry.name.startsWith(location.origin))
          .map((entry) => (entry as PerformanceResourceTiming).transferSize),
      );
      weights[`${lang} ${shot.name}`] = {
        requests: entries.length,
        kilobytes: Math.round(entries.reduce((sum, size) => sum + size, 0) / 102.4) / 10,
      };
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}weights.json`, `${JSON.stringify(weights, null, 2)}\n`);
});
