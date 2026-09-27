import { expect, test } from "@playwright/test";
import { scenarioNames } from "../src/data/mock/scenarios";
import { openApp, SIZES, settle, trackErrors, VIEWS } from "./app";
import { auditLayout } from "./layout-rules";

const EXPECTED_ERRORS: Record<string, RegExp> = {
  "widget-crash": /widget:recent-matches|Cannot read properties/,
};

// Every view × every window size, on the richest data.
for (const view of VIEWS) {
  for (const size of SIZES) {
    test(`${view} @ ${size.name} ${size.width}×${size.height}`, async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page, { view, width: size.width, height: size.height });
      expect(await page.evaluate(auditLayout)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

// Every data scenario on Home at the extreme sizes.
for (const scenario of scenarioNames) {
  for (const size of [SIZES[0], SIZES[3], SIZES[6]]) {
    test(`home/${scenario} @ ${size.name}`, async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page, { scenario, width: size.width, height: size.height });
      expect(await page.evaluate(auditLayout)).toEqual([]);
      const allowed = EXPECTED_ERRORS[scenario];
      expect(errors.filter((e) => !allowed?.test(e))).toEqual([]);
    });
  }
}

// Live resizing (no reload) must re-layout correctly at every step.
test("resize sweep keeps layout sound", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { width: 2560, height: 1440 });
  for (let width = 2560; width >= 400; width -= 180) {
    await page.setViewportSize({ width, height: 800 });
    await settle(page);
    const violations = await page.evaluate(auditLayout);
    expect(violations, `at width ${width}`).toEqual([]);
  }
  expect(errors).toEqual([]);
});
