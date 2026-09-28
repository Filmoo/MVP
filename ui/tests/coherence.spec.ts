// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { lockInImport } from "../src/data/mock/import-fixtures";
import { scenarioNames } from "../src/data/mock/scenarios";
import { animationsDone, expect, openApp, test, VIEWS } from "./app";
import { auditTokens } from "./coherence-rules";

for (const view of VIEWS) {
  test(`${view} only uses design tokens`, async ({ page }) => {
    await openApp(page, { view });
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

for (const scenario of scenarioNames) {
  test(`home/${scenario} only uses design tokens`, async ({ page }) => {
    await openApp(page, { scenario });
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

test("/draft in champion select only uses design tokens", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  expect(await page.evaluate(auditTokens)).toEqual([]);
});

// The side panel's other tab: both teams' compositions (ARAM: yours, the enemy team hidden).
for (const scenario of ["champ-select", "aram-champ-select", "draft-planning"] as const) {
  test(`/draft/${scenario} team compositions only use design tokens`, async ({ page, t }) => {
    await openApp(page, { view: "/draft", scenario });
    await page.getByTestId("why-tabs").getByRole("radio", { name: t.why.tabs.teams }).click();
    await expect(page.locator("[data-widget=draft-comps]").getByRole("table")).toBeVisible();
    await animationsDone(page);
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

for (const scenario of ["import-lock-in", "draft-no-stats", "aram-champ-select"] as const) {
  test(`/draft/${scenario} only uses design tokens`, async ({ page }) => {
    await openApp(page, { view: "/draft", scenario });
    if (scenario === "import-lock-in") {
      // The import on lock-in: its toast and the marked buttons.
      await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
      await page.getByTestId("toast").waitFor();
      await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "warn");
    }
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

test("the import bar only uses design tokens in every state", async ({ page, t }) => {
  // Done and warn (the Flash note), then failed and skipped.
  await openApp(page, { view: "/draft", scenario: "import-flash" });
  await page.getByRole("button", { name: t.imports.importPart("runes") }).click();
  await page.getByRole("button", { name: t.imports.importPart("spells") }).click();
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "warn");
  await page.mouse.move(0, 0);
  await animationsDone(page);
  expect(await page.evaluate(auditTokens), "done, warn").toEqual([]);

  await openApp(page, { view: "/draft", scenario: "import-failures" });
  await page.getByRole("button", { name: t.imports.importPart("runes") }).click();
  await page.getByRole("button", { name: t.imports.importPart("spells") }).click();
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "skipped");
  await page.mouse.move(0, 0);
  await animationsDone(page);
  expect(await page.evaluate(auditTokens), "failed, skipped").toEqual([]);
});

for (const { view, scenario } of [
  { view: "/live", scenario: "live" },
  { view: "/live", scenario: "live-extreme" },
  { view: "/live", scenario: "live-failed" },
  { view: "/player/euw1/Blade%20Dancer/IRE", scenario: "default" },
  { view: "/player/euw1/Busy/429", scenario: "default" },
  { view: "/player/euw1/Nobody/404", scenario: "default" },
  { view: "/champions?id=103", scenario: "default" },
  { view: "/champions?id=412", scenario: "default" },
  { view: "/champions?id=99&queue=450", scenario: "default" },
  { view: "/champions?id=904", scenario: "default" },
  { view: "/champions?id=103", scenario: "stats-offline" },
  { view: "/champions?id=103", scenario: "stats-empty" },
  { view: "/tier-list?queue=450", scenario: "default" },
  { view: "/tier-list", scenario: "stats-empty" },
  { view: "/tier-list", scenario: "stats-offline" },
  { view: "/__harness?show=build-summary", scenario: "default" },
] as const) {
  test(`${view}/${scenario} only uses design tokens`, async ({ page }) => {
    await openApp(page, { view, scenario });
    // A page opened on ARAM switches its queue control as it loads: audit the colours it
    // settles on, not one caught halfway through the transition (seen on a busy machine).
    await animationsDone(page);
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

test("stats pages after switching (all rows, a role, duos, another rune page) only use design tokens", async ({ page, t }) => {
  await openApp(page, { view: "/tier-list" });
  await page.getByTestId("role-filter").getByRole("radio", { name: t.roles.bottom }).click();
  await page.getByTestId("tier-row").first().hover();
  expect(await page.evaluate(auditTokens), "tier list").toEqual([]);
  await openApp(page, { view: "/champions?id=99" });
  await page
    .getByTestId("role-tabs")
    .getByRole("radio", { name: new RegExp(`^${t.roles.middle}`) })
    .click();
  await page.getByTestId("matchup-kind").getByRole("radio", { name: t.champions.duos }).click();
  await page.getByTestId("rune-page").nth(1).click();
  await page.mouse.move(0, 0);
  // Segments and pills glide to their new colors: audit the settled ones.
  await animationsDone(page);
  expect(await page.evaluate(auditTokens), "champion page").toEqual([]);
});

test("live cards while scouting only use design tokens", async ({ page }) => {
  await page.goto("/?scenario=live-scouting#/live");
  await page.getByTestId("live-card").first().waitFor();
  expect(await page.evaluate(auditTokens)).toEqual([]);
});

test("the search panel only uses design tokens (recent, champions, players)", async ({ page, t }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mvp.recent-searches.v1",
      JSON.stringify([
        { kind: "champion", championId: 103 },
        { kind: "player", platform: "euw1", riotId: { gameName: "Blade Dancer", tagLine: "IRE" } },
      ]),
    );
  });
  await openApp(page);
  const input = page.getByTestId("search-input");
  await input.click();
  await page.getByTestId("search-panel").waitFor();
  // The field's border glides to the focus color: audit the settled colors.
  await animationsDone(page);
  expect(await page.evaluate(auditTokens), "recent").toEqual([]);
  await page.keyboard.type("Ahri#EUW");
  await page
    .getByTestId("search-option")
    .filter({ hasText: t.search.level(512, "EUW") })
    .waitFor();
  expect(await page.evaluate(auditTokens), "resolved").toEqual([]);
  await input.fill("Nobody#404");
  await page
    .getByTestId("search-option")
    .filter({ hasText: t.search.noPlayerOn("EUW") })
    .waitFor();
  expect(await page.evaluate(auditTokens), "not found").toEqual([]);
});

for (const scenario of [
  "settings-custom",
  "settings-error",
  "settings-save-error",
  "crash-reports-on",
  "update-available",
  "update-downloading",
  "auto-accept-paused",
] as const) {
  test(`/settings/${scenario} only uses design tokens`, async ({ page }) => {
    await openApp(page, { view: "/settings", scenario });
    if (scenario === "settings-save-error") {
      // Show the inline save error too.
      await page.getByTestId("setting-auto-accept").click();
      await page.getByRole("alert").waitFor();
      // The switch glides back as the alert shows: audit the settled colors.
      await page.mouse.move(0, 0);
      await animationsDone(page);
    }
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

// An opened match row (its game, or why it can't show) with a grade's why over it.
for (const scenario of ["default", "extreme", "match-details-error"] as const) {
  test(`home/${scenario}: an opened game and a grade's why only use design tokens`, async ({ page }) => {
    await openApp(page, { scenario });
    await page.locator("[data-testid=match-row] > button").first().click();
    await expect(page.getByTestId("game").locator("[data-testid=game-player], [role=alert]").first()).toBeVisible();
    await page.locator("[data-grade]").nth(1).hover();
    await expect(page.getByTestId("grade-why")).toBeVisible();
    await animationsDone(page);
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

test("every view has exactly one page heading", async ({ page }) => {
  for (const view of VIEWS) {
    await openApp(page, { view });
    await expect(page.locator("main h1"), view).toHaveCount(1);
  }
});

test("every view shares the same content frame", async ({ page }) => {
  const frames = new Map<string, { left: number; top: number }>();
  for (const view of VIEWS) {
    await openApp(page, { view, width: 1600, height: 900 });
    const box = await page.locator("main > * > *").first().boundingBox();
    expect(box, view).not.toBeNull();
    frames.set(view, { left: Math.round(box?.x ?? 0), top: Math.round(box?.y ?? 0) });
  }
  const [first] = frames.values();
  for (const [view, frame] of frames) expect(frame, view).toEqual(first);
});

test("navigation marks exactly one active item", async ({ page }) => {
  for (const view of VIEWS) {
    await openApp(page, { view });
    await expect(page.locator('nav [aria-current="page"]'), view).toHaveCount(1);
  }
});
