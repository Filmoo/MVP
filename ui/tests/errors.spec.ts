import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { importFailures } from "../src/data/mock/import-fixtures";
import type { Messages } from "../src/i18n";
import { expect, openApp, settle, test, trackErrors } from "./app";

test("client not running: guidance instead of data", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "not-running" });
  await expect(page.getByRole("heading", { name: t.home.waiting.title })).toBeVisible();
  await expect(page.getByTestId("client-status")).toContainText(t.shell.connection.notRunning);
  expect(errors).toEqual([]);
});

test("profile failure: error state, retry calls the core again", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "profile-error" });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(t.home.loadFailed);
  await expect(alert).toContainText("HTTP 503");
  await alert.getByRole("button", { name: t.common.tryAgain }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "current_profile").length)).toBe(2);
  expect(errors).toEqual([]);
});

test("slow core: skeletons first, then content without layout jumps", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/?scenario=slow-loading#/");
  await expect(page.locator("[data-state=loading]").first()).toBeVisible();
  await settle(page);
  await expect(page.locator("[data-widget=recent-matches]")).toBeVisible();
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls, "cumulative layout shift").toBeLessThan(0.1);
});

test("a crashing widget is contained: the rest of the page works", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "widget-crash" });
  await expect(page.locator("[data-widget=recent-matches] [role=alert]")).toContainText(t.common.panelFailed);
  await expect(page.locator("[data-widget=performance-summary]")).toContainText(t.summary.championsTitle);
  await expect(page.locator("[data-widget=profile-header]")).toContainText("Fillmo");
  await expect(page.getByTestId("toast")).toHaveCount(1);
  expect(errors.every((e) => e.includes("widget:recent-matches"))).toBe(true);
});

test("client connecting later: the profile loads without a restart", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "not-running" });
  await expect(page.getByRole("heading", { name: t.home.waiting.title })).toBeVisible();
  const calls = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "current_profile").length);
  const before = await calls();
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("client-status", { connection: "connected", phase: "idle" }));
  await expect.poll(calls).toBe((before ?? 0) + 1);
  expect(errors).toEqual([]);
});

test("unknown route: not-found state, navigation still works", async ({ page, t }) => {
  await openApp(page, { view: "/does-not-exist" });
  await expect(page.getByText(t.shell.notFound.title)).toBeVisible();
  await page.getByRole("link", { name: t.nav.home.label }).click();
  await expect(page.locator("[data-widget=profile-header]")).toBeVisible();
});

test("game assets unreachable: placeholders, no crash", async ({ page, t }) => {
  const errors = trackErrors(page);
  await page.route("**/dd/**", (route) => route.abort());
  await openApp(page);
  await expect(page.locator("[data-widget=recent-matches]")).toBeVisible();
  await expect(page.getByRole("img", { name: t.common.championN(103) }).first()).toBeVisible();
  expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
});

// Player pages: every way a lookup can fail has its own words; the transient ones retry.
for (const { name, words, retry } of [
  {
    name: "Nobody/404",
    words: (t: Messages) => ({ title: t.players.notFound.title, text: t.players.notFound.text("Nobody#404", "EUW") }),
    retry: false,
  },
  { name: "Busy/429", words: (t: Messages) => ({ title: t.players.rateLimited.title, text: t.players.rateLimited.text(12) }), retry: true },
  { name: "Down/503", words: (t: Messages) => t.players.unavailable, retry: true },
  { name: "Offline/0", words: (t: Messages) => t.players.network, retry: true },
] as const) {
  test(`player lookup ${name}: its own words`, async ({ page, t }) => {
    const errors = trackErrors(page);
    const { title, text } = words(t);
    await openApp(page, { view: `/player/euw1/${name}` });
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("main")).toContainText(text);
    const lookups = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "search_player").length);
    if (retry) {
      await page.getByRole("button", { name: t.common.tryAgain }).click();
      await expect.poll(lookups).toBe(2);
    } else {
      await page.getByRole("button", { name: t.search.again }).click();
      await expect(page.getByTestId("search-input")).toBeFocused();
    }
    expect(errors).toEqual([]);
  });
}

test("player page: skeleton first, then the profile without layout jumps", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/?scenario=search-slow#/player/euw1/Blade%20Dancer/IRE");
  await expect(page.locator("main [data-state=loading]").first()).toBeVisible();
  await settle(page);
  await expect(page.locator("[data-widget=profile-header]")).toContainText("Blade Dancer");
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls, "cumulative layout shift").toBeLessThan(0.1);
});

test("build import: the core can't be asked, the bar says so and can retry", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-error" });
  const items = page.getByRole("button", { name: t.imports.importPart("itemSet") });
  await items.click();
  // The core's own words, in the bar's sentence.
  await expect(page.getByTestId("import-status")).toHaveText(t.imports.failed("MVP is still starting, try again in a moment"));
  await expect(page.getByTestId("import-itemSet")).toHaveAttribute("data-tone", "failed");
  // Nothing is stuck: it can be tried again, and the rest of the draft still works.
  await expect(items).toBeEnabled();
  await items.click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "import_build").length)).toBe(2);
  await expect(page.locator("[data-widget=draft-suggestions]")).toContainText("Malphite");
  expect(errors).toEqual([]);
});

test("build import: every failure renders its own words, nothing crashes", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-failures" });
  const refused =
    importFailures.itemSet?.kind === "failed" && importFailures.itemSet.reason.kind === "client"
      ? importFailures.itemSet.reason.message
      : "";
  const words = {
    runes: t.imports.fail.noFreePage,
    itemSet: t.imports.fail.client(refused),
    spells: t.imports.skip.tooLate(3),
  } as const;
  for (const [part, text] of Object.entries(words)) {
    await page.getByTestId(`import-${part}`).click();
    await expect(page.getByTestId("import-status")).toContainText(text);
  }
  await expect(page.locator("[data-widget=draft-imports] [role=alert]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("champion page for an unknown id: the champion list", async ({ page, t }) => {
  await openApp(page, { view: "/champions?id=999999" });
  await expect(page.getByRole("heading", { level: 1, name: t.champions.title })).toBeVisible();
  await expect(page.getByTestId("champion-tile").first()).toBeVisible();
});

// Stats pages: nothing published is an empty state (no retry), failures say why and retry.
test("stats not published yet: the pages say so, champions still show", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/tier-list", scenario: "stats-empty" });
  await expect(page.locator("main")).toContainText(t.stats.errors.notFound.title);
  await expect(page.getByRole("button", { name: t.common.tryAgain })).toHaveCount(0);
  await openApp(page, { view: "/champions?id=103", scenario: "stats-empty" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ahri");
  await expect(page.locator("main")).toContainText(t.stats.errors.notFound.title);
  await openApp(page, { view: "/champions", scenario: "stats-empty" });
  expect(await page.getByTestId("champion-tile").count(), "the list needs no stats").toBeGreaterThan(160);
  await expect(page.getByTestId("role-filter")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const { view, command } of [
  { view: "/tier-list", command: "tier_list" },
  { view: "/champions?id=103", command: "champion_stats" },
] as const) {
  test(`stats offline on ${view}: an error with a retry that asks again`, async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view, scenario: "stats-offline" });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(t.stats.errors.network.title);
    const calls = () => page.evaluate((c) => window.__SCOUT_MOCK__?.calls.filter((name) => name === c).length, command);
    const before = await calls();
    await alert.getByRole("button", { name: t.common.tryAgain }).click();
    await expect.poll(calls).toBe((before ?? 0) + 1);
    expect(errors).toEqual([]);
  });
}

for (const view of ["/tier-list", "/champions?id=103"]) {
  test(`slow stats on ${view}: skeletons first, then the numbers without layout jumps`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`/?scenario=stats-slow#${view}`);
    await expect(page.locator("main [data-state=loading]").first()).toBeVisible();
    await settle(page);
    await expect(page.locator("[data-widget=tier-list], [data-widget=champion-runes]").first()).toBeVisible();
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, "cumulative layout shift").toBeLessThan(0.1);
  });
}

test("only ARAM published: ranked says so, ARAM shows its tier list", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/tier-list", scenario: "stats-aram-only" });
  await expect(page.locator("main")).toContainText(t.stats.errors.notFound.title);
  await page.getByTestId("queue-switch").getByRole("radio", { name: t.queues[450] }).click();
  await expect(page.getByTestId("tier-row").first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText(t.stats.errors.notFound.title);
  expect(errors).toEqual([]);
});

// An opened match row: its game fails in place, nothing else does.
const firstGame = (page: Page) => page.locator("[data-testid=match-row] > button").first();

test("an opened game that can't load: its error in place, and a retry asks again", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "match-details-error" });
  await firstGame(page).click();
  const alert = page.getByTestId("game").getByRole("alert");
  await expect(alert).toContainText(t.players.network.title);
  await expect(alert).toContainText(t.players.network.text);
  await alert.getByRole("button", { name: t.common.tryAgain }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "match_details").length)).toBe(2);
  await expect(page.getByTestId("match-row").nth(1)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a game that isn't there anymore says so, without a retry", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "match-details-gone" });
  await firstGame(page).click();
  const alert = page.getByTestId("game").getByRole("alert");
  await expect(alert).toContainText(t.matchDetails.errors.notFound);
  await expect(alert.getByRole("button", { name: t.common.tryAgain })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a slow game: a skeleton the table's height, then the table in its place", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "match-details-slow" });
  const row = page.getByTestId("match-row").first();
  await firstGame(page).click();
  await expect(row.locator("[data-state=loading]")).toBeVisible();
  const loading = await row.boundingBox();
  await expect(row.getByTestId("game-player")).toHaveCount(10, { timeout: 5_000 });
  const loaded = await row.boundingBox();
  expect(loaded?.height, "the row's height, loading then loaded").toBe(loading?.height);
  expect(errors).toEqual([]);
});
