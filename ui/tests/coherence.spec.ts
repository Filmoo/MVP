import { expect, test } from "@playwright/test";
import { scenarioNames } from "../src/data/mock/scenarios";
import { openApp, VIEWS } from "./app";
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

for (const { view, scenario } of [
  { view: "/live", scenario: "live" },
  { view: "/live", scenario: "live-extreme" },
  { view: "/live", scenario: "live-failed" },
  { view: "/player/euw1/Blade%20Dancer/IRE", scenario: "default" },
  { view: "/player/euw1/Busy/429", scenario: "default" },
  { view: "/player/euw1/Nobody/404", scenario: "default" },
  { view: "/champions?id=103", scenario: "default" },
] as const) {
  test(`${view}/${scenario} only uses design tokens`, async ({ page }) => {
    await openApp(page, { view, scenario });
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

test("live cards while scouting only use design tokens", async ({ page }) => {
  await page.goto("/?scenario=live-scouting#/live");
  await page.getByTestId("live-card").first().waitFor();
  expect(await page.evaluate(auditTokens)).toEqual([]);
});

test("the search panel only uses design tokens (recent, champions, players)", async ({ page }) => {
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
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  expect(await page.evaluate(auditTokens), "recent").toEqual([]);
  await page.keyboard.type("Ahri#EUW");
  await page.getByTestId("search-option").filter({ hasText: "Level" }).waitFor();
  expect(await page.evaluate(auditTokens), "resolved").toEqual([]);
  await input.fill("Nobody#404");
  await page.getByTestId("search-option").filter({ hasText: "No player" }).waitFor();
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
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    }
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
