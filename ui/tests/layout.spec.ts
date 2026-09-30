import type { Page } from "@playwright/test";
import { scenarioNames } from "../src/data/mock/scenarios";
import { expect, FRENCH_SIZES, isFrench, openApp, SIZES, settle, test, trackErrors, VIEWS } from "./app";
import { auditLayout } from "./layout-rules";
import { body, current, openGame, rows, stack } from "./stack";

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
  // ARAM: Mayhem: augments by tier, a champion's per rarity, the champion page's tab, Draft.
  { view: "/mayhem", scenario: "default" },
  { view: "/mayhem?champion=103", scenario: "default" },
  { view: "/champions?id=103&mode=mayhem", scenario: "default" },
  { view: "/draft", scenario: "mayhem-champ-select" },
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
  // Home's history filtered down to nothing (a link sets the filter).
  { view: "/?queue=flex", scenario: "default" },
  { view: "/?queue=aram&champion=103", scenario: "history-long" },
  { view: "/live", scenario: "emblems" },
  { view: "/tier-list", scenario: "stats-empty" },
  { view: "/tier-list", scenario: "stats-offline" },
  { view: "/tier-list", scenario: "stats-aram-only" },
  { view: "/champions?id=103", scenario: "stats-empty" },
  { view: "/champions?id=103", scenario: "stats-offline" },
  { view: "/champions?id=904", scenario: "default" },
  { view: "/champions", scenario: "stats-offline" },
  { view: "/champions", scenario: "stats-empty" },
  // ARAM: Mayhem's other states: nothing published yet, not built, offline, the longest names,
  // a champion without shared games (Teemo), a Mayhem game's build.
  { view: "/mayhem", scenario: "mayhem-empty" },
  { view: "/mayhem", scenario: "mayhem-unbuilt" },
  { view: "/mayhem", scenario: "mayhem-offline" },
  { view: "/mayhem", scenario: "mayhem-extreme" },
  { view: "/mayhem?champion=17", scenario: "default" },
  { view: "/live?tab=build", scenario: "mayhem-live" },
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

/**
 * The stack of opened games: the current window inside the room beside the rail and under the
 * title bar, laid out on its scoreboard (at its top and its end) and its details (at their end).
 */
async function auditStack(page: Page, size: { name: string; width: number; height: number }): Promise<void> {
  // Once it has risen in (its own animations only: a loading skeleton pulses for good).
  await stack(page)
    .locator("div")
    .first()
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = await current(page).boundingBox();
  const inside = box && box.x >= 0 && box.y >= 40 && box.x + box.width <= size.width && box.y + box.height <= size.height;
  expect(inside, `${size.name}: the window under the title bar, inside the window: ${JSON.stringify(box)}`).toBe(true);
  expect(await page.evaluate(auditLayout), `${size.name} opened`).toEqual([]);
  const end = () =>
    body(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await end();
  expect(await page.evaluate(auditLayout), `${size.name} at its end`).toEqual([]);
  const tabs = current(page).getByTestId("game-tabs").getByRole("radio");
  if ((await tabs.count()) === 0) return;
  await tabs.nth(1).click();
  await end();
  expect(await page.evaluate(auditLayout), `${size.name} its details`).toEqual([]);
  await tabs.nth(0).click();
}

// An opened game at every size (its window at its top, its end, its details), and a grade's why
// in it: a popover, which the audit leaves out (fixed), so it is held inside the window here.
test("home: the stack of opened games and a grade's why lay out at every size", async ({ page, locale }) => {
  // Eight sizes, each settled, audited three times and hovered twice: more than 30 s on a busy machine.
  test.slow();
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page, 2);
  for (const size of SIZES) {
    if (isFrench(locale) && !FRENCH_SIZES.has(size.name)) continue;
    await page.mouse.move(0, 0);
    await page.setViewportSize({ width: size.width, height: size.height });
    await settle(page);
    await auditStack(page, size);
    await body(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    for (const at of [0, 6]) {
      const grade = current(page).locator("[data-grade]").nth(at);
      await grade.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
      await grade.hover();
      const why = await page.getByTestId("grade-why").boundingBox();
      expect(why, `${size.name} why ${at}`).not.toBeNull();
      const inside = why && why.x >= 0 && why.y >= 0 && why.x + why.width <= size.width && why.y + why.height <= size.height;
      expect(inside, `${size.name} why ${at} inside the window: ${JSON.stringify(why)}`).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

// An opened game on Howling Abyss (no vision stats there) at every size.
test("home: an opened game on Howling Abyss lays out at every size", async ({ page, locale }) => {
  test.slow();
  const errors = trackErrors(page);
  await openApp(page, { scenario: "howling-abyss" });
  await openGame(page, 0);
  for (const size of SIZES) {
    if (isFrench(locale) && !FRENCH_SIZES.has(size.name)) continue;
    await page.setViewportSize({ width: size.width, height: size.height });
    await settle(page);
    await auditStack(page, size);
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
      await rows(page).first().click();
      const shown = current(page).locator("[data-testid=game-player], [role=alert], [data-state=loading]");
      await expect(shown.first()).toBeVisible();
      if (scenario !== "match-details-slow") await settle(page);
      await auditStack(page, size);
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
