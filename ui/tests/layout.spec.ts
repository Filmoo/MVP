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

// Views that only show content in a specific scenario, at every window size.
const SCENARIO_VIEWS = [
  { view: "/draft", scenario: "champ-select" },
  { view: "/settings", scenario: "settings-custom" },
  { view: "/settings", scenario: "settings-error" },
  { view: "/live", scenario: "live" },
  { view: "/live", scenario: "live-extreme" },
  { view: "/live", scenario: "live-failed" },
  { view: "/player/euw1/Blade%20Dancer/IRE", scenario: "default" },
  { view: "/player/euw1/WWWWWWWWWWWWWWWW/WWWWW", scenario: "default" },
  { view: "/champions?id=103", scenario: "default" },
] as const;

// Their other states at the extreme sizes.
const STATE_VIEWS = [
  { view: "/live", scenario: "live-error" },
  { view: "/live", scenario: "live-scouting" },
  { view: "/player/euw1/Nobody/404", scenario: "default" },
  { view: "/player/euw1/Busy/429", scenario: "default" },
] as const;
for (const { view, scenario } of STATE_VIEWS) {
  for (const size of [SIZES[0], SIZES[3], SIZES[6]]) {
    test(`${view}/${scenario} @ ${size.name}`, async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page, { view, scenario, width: size.width, height: size.height });
      expect(await page.evaluate(auditLayout)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
for (const { view, scenario } of SCENARIO_VIEWS) {
  for (const size of SIZES) {
    test(`${view}/${scenario} @ ${size.name} ${size.width}×${size.height}`, async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page, { view, scenario, width: size.width, height: size.height });
      expect(await page.evaluate(auditLayout)).toEqual([]);
      expect(errors).toEqual([]);
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

// Draft interactions: the selected pick is explained beside the list on wide windows and under
// its own row on narrow ones; both states must lay out cleanly.
test("draft: picking a suggestion updates the explanation at every size", async ({ page }) => {
  const errors = trackErrors(page);
  for (const size of SIZES) {
    await openApp(page, { view: "/draft", scenario: "champ-select", width: size.width, height: size.height });
    const wide = await page.locator("[data-widget=draft-why]").isVisible();
    const shen = page.getByTestId("suggestion").filter({ hasText: "Shen" });
    await shen.click();
    await expect(shen, size.name).toHaveAttribute("aria-pressed", "true");
    if (wide) {
      await expect(page.locator("[data-widget=draft-why] h2"), size.name).toHaveText("Why Shen");
    } else {
      const terms = page.locator("[data-widget=draft-suggestions] li:has(> button[aria-pressed=true]) ul");
      await expect(terms, size.name).toBeVisible();
      await settle(page);
      expect(await page.evaluate(auditLayout), `${size.name} expanded`).toEqual([]);
      await shen.click();
      await expect(terms, `${size.name} folds on a second tap`).toHaveCount(0);
      await expect(shen, `${size.name} stays selected`).toHaveAttribute("aria-pressed", "true");
    }
  }
  expect(errors).toEqual([]);
});
