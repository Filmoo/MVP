import type { Page } from "@playwright/test";
import { scenarioNames } from "../src/data/mock/scenarios";
import { expect, FRENCH_SIZES, isFrench, openApp, SIZES, settle, test, trackErrors, VIEWS } from "./app";
import { auditLayout } from "./layout-rules";

const EXPECTED_ERRORS: Record<string, RegExp> = {
  "widget-crash": /widget:recent-matches|Cannot read properties/,
};

/** The French runs cover the matrix at 400, 820, 1280 and 2560 px (see FRENCH_SIZES). */
const FRENCH_ONLY_AT = "French: the matrix at 400, 820, 1280 and 2560 px";

// Every view × every window size, on the richest data.
for (const view of VIEWS) {
  for (const size of SIZES) {
    test(`${view} @ ${size.name} ${size.width}×${size.height}`, async ({ page, locale }) => {
      test.skip(isFrench(locale) && !FRENCH_SIZES.has(size.name), FRENCH_ONLY_AT);
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
  { view: "/draft", scenario: "import-lock-in" },
  // After a trade: the warning's line under the buttons.
  { view: "/draft", scenario: "import-warning" },
  { view: "/draft", scenario: "draft-no-stats" },
  { view: "/draft", scenario: "aram-champ-select" },
  { view: "/settings", scenario: "settings-custom" },
  { view: "/settings", scenario: "settings-error" },
  { view: "/live", scenario: "live" },
  { view: "/live", scenario: "live-extreme" },
  { view: "/live", scenario: "live-failed" },
  // Names waiting for the game: the longest head line (Riot doesn't share the queue).
  { view: "/live", scenario: "live-filtered" },
  { view: "/player/euw1/Blade%20Dancer/IRE", scenario: "default" },
  { view: "/player/euw1/WWWWWWWWWWWWWWWW/WWWWW", scenario: "default" },
  { view: "/champions?id=103", scenario: "default" },
  // A support (both halves of the bot lane in matchups), ARAM (no roles, no matchups, no bans).
  { view: "/champions?id=412", scenario: "default" },
  { view: "/champions?id=99&queue=450", scenario: "default" },
  { view: "/tier-list?queue=450", scenario: "default" },
  // The champion list in one role (a link picks it), and in ARAM (no roles).
  { view: "/champions?role=support", scenario: "default" },
  { view: "/champions?queue=450", scenario: "default" },
] as const;

// Their other states at the extreme sizes.
const STATE_VIEWS = [
  { view: "/draft", scenario: "draft-planning" },
  { view: "/draft", scenario: "draft-no-comps" },
  { view: "/live", scenario: "live-error" },
  { view: "/live", scenario: "live-scouting" },
  { view: "/live", scenario: "live-bots" },
  { view: "/live", scenario: "live-hidden" },
  { view: "/player/euw1/Nobody/404", scenario: "default" },
  { view: "/player/euw1/Busy/429", scenario: "default" },
  { view: "/settings", scenario: "crash-reports-on" },
  { view: "/settings", scenario: "update-available" },
  { view: "/settings", scenario: "auto-accept-paused" },
  { view: "/live", scenario: "banners" },
  { view: "/live?tab=build", scenario: "live" },
  { view: "/", scenario: "emblems" },
  { view: "/live", scenario: "emblems" },
  { view: "/tier-list", scenario: "stats-empty" },
  { view: "/tier-list", scenario: "stats-offline" },
  { view: "/tier-list", scenario: "stats-aram-only" },
  { view: "/champions?id=103", scenario: "stats-empty" },
  { view: "/champions?id=103", scenario: "stats-offline" },
  { view: "/champions?id=904", scenario: "default" },
  { view: "/champions", scenario: "stats-offline" },
  { view: "/champions", scenario: "stats-empty" },
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
    test(`${view}/${scenario} @ ${size.name} ${size.width}×${size.height}`, async ({ page, locale }) => {
      test.skip(isFrench(locale) && !FRENCH_SIZES.has(size.name), FRENCH_ONLY_AT);
      const errors = trackErrors(page);
      await openApp(page, { view, scenario, width: size.width, height: size.height });
      expect(await page.evaluate(auditLayout)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

/** An opened game's sheet: the whole window stays inside the window, at its top and at its end. */
async function auditSheet(page: Page, size: { name: string; width: number; height: number }): Promise<void> {
  // Once it has risen in (its own animations only: a loading skeleton pulses for good).
  await page.getByTestId("game").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = await page.getByTestId("game").boundingBox();
  const inside = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height;
  expect(inside, `${size.name}: the sheet inside the window: ${JSON.stringify(box)}`).toBe(true);
  expect(await page.evaluate(auditLayout), `${size.name} opened`).toEqual([]);
  await page.getByTestId("game-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await page.evaluate(auditLayout), `${size.name} scrolled to its stats`).toEqual([]);
  await page.getByTestId("game-body").evaluate((el) => {
    el.scrollTop = 0;
  });
}

// An opened game at every size (its sheet at its top, then scrolled to its stats), and a grade's
// why in it: a popover, which the audit leaves out (fixed), so it is held inside the window here.
test("home: an opened game and a grade's why lay out at every size", async ({ page, locale }) => {
  // Eight sizes, each settled, audited twice and hovered twice: more than 30 s on a busy machine.
  test.slow();
  const errors = trackErrors(page);
  await openApp(page);
  await page.locator("[data-testid=match-row] > button").first().click();
  await expect(page.getByTestId("game-player")).toHaveCount(10);
  for (const size of SIZES) {
    if (isFrench(locale) && !FRENCH_SIZES.has(size.name)) continue;
    await page.mouse.move(0, 0);
    await page.setViewportSize({ width: size.width, height: size.height });
    await settle(page);
    await auditSheet(page, size);
    for (const at of [0, 6]) {
      await page.getByTestId("game").locator("[data-grade]").nth(at).hover();
      const why = await page.getByTestId("grade-why").boundingBox();
      expect(why, `${size.name} why ${at}`).not.toBeNull();
      const inside = why && why.x >= 0 && why.y >= 0 && why.x + why.width <= size.width && why.y + why.height <= size.height;
      expect(inside, `${size.name} why ${at} inside the window: ${JSON.stringify(why)}`).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

// An opened game on Howling Abyss (no vision column, no vision stats there) at every size.
test("home: an opened game on Howling Abyss lays out at every size", async ({ page, locale }) => {
  test.slow();
  const errors = trackErrors(page);
  await openApp(page, { scenario: "howling-abyss" });
  await page.locator("[data-testid=match-row] > button").first().click();
  await expect(page.getByTestId("game-player")).toHaveCount(10);
  for (const size of SIZES) {
    if (isFrench(locale) && !FRENCH_SIZES.has(size.name)) continue;
    await page.setViewportSize({ width: size.width, height: size.height });
    await settle(page);
    await auditSheet(page, size);
  }
  expect(errors).toEqual([]);
});

// An opened game's other states (longest names and biggest numbers, loading, errors) at the
// extreme sizes; someone else's game (every stat row) too.
for (const { scenario, view } of [
  { scenario: "extreme", view: "/" },
  { scenario: "match-details-slow", view: "/" },
  { scenario: "match-details-error", view: "/" },
  { scenario: "match-details-gone", view: "/" },
  { scenario: "match-details-unavailable", view: "/" },
  { scenario: "default", view: "/player/euw1/Blade%20Dancer/IRE" },
] as const) {
  for (const size of [SIZES[0], SIZES[3], SIZES[6]]) {
    test(`${view}/${scenario}, a game opened @ ${size.name}`, async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page, { scenario, view, width: size.width, height: size.height });
      await page.locator("[data-testid=match-row] > button").first().click();
      const shown = page.getByTestId("game").locator("[data-testid=game-player], [role=alert], [data-state=loading]");
      await expect(shown.first()).toBeVisible();
      if (scenario !== "match-details-slow") await settle(page);
      await auditSheet(page, size);
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
// its own row on narrow ones (the side panel is stacked last there); both states must lay out
// cleanly.
test("draft: picking a suggestion updates the explanation at every size", async ({ page, t }) => {
  const errors = trackErrors(page);
  for (const size of SIZES) {
    await openApp(page, { view: "/draft", scenario: "champ-select", width: size.width, height: size.height });
    // 1080 px: the rail, the page's padding and the 960 px wide layout.
    const wide = size.width >= 1080;
    const shen = page.getByTestId("suggestion").filter({ hasText: "Shen" });
    await shen.click();
    await expect(shen, size.name).toHaveAttribute("aria-pressed", "true");
    if (wide) {
      await expect(page.locator("[data-widget=draft-why] h2"), size.name).toHaveText(t.why.title("Shen"));
    } else {
      const terms = page.locator("[data-widget=draft-suggestions] li:has(> button[aria-pressed=true]) ul");
      await expect(terms, size.name).toBeVisible();
      const teams = page.getByTestId("why-tabs").getByRole("radio", { name: t.why.tabs.teams });
      await expect(teams, `${size.name}: the panel below keeps the compositions`).toHaveAttribute("aria-checked", "true");
      await settle(page);
      expect(await page.evaluate(auditLayout), `${size.name} expanded`).toEqual([]);
      await shen.click();
      await expect(terms, `${size.name} folds on a second tap`).toHaveCount(0);
      await expect(shen, `${size.name} stays selected`).toHaveAttribute("aria-pressed", "true");
    }
  }
  expect(errors).toEqual([]);
});
