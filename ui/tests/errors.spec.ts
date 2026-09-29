import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { aramDraft } from "../src/data/mock/draft-fixtures";
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

test("client not answering: the title bar and Home say so, the profile loads once it answers", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "client-not-answering" });
  const status = page.getByTestId("client-status");
  await expect(status).toContainText(t.shell.connection.notAnswering);
  // Hovered, it says what that means (design/tip).
  await status.hover();
  await expect(page.locator("#hint")).toContainText(t.tip.status.notAnswering);
  await page.mouse.move(640, 700);
  // A wait, not an error: the title bar's words and MVP's own sentence, never the request's address.
  const card = page.getByRole("status").filter({ has: page.getByRole("heading", { name: t.shell.connection.notAnswering }) });
  await expect(card).toContainText(t.home.notAnswering.text);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("127.0.0.1");
  // It answers again: the profile loads by itself, nothing to click.
  const reads = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "current_profile").length);
  expect(await reads()).toBe(1);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("client-status", { connection: "connected", phase: "idle" }));
  await expect(status).toContainText(t.shell.connection.connected);
  await expect(page.locator("[data-widget=profile-header]")).toContainText("Fillmo");
  await expect(card).toHaveCount(0);
  expect(await reads()).toBe(2);
  expect(errors).toEqual([]);
});

test("client not answering: Retry now asks again at once", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "client-not-answering" });
  const reads = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "current_profile").length);
  await page.getByRole("button", { name: t.home.notAnswering.retry }).click();
  await expect.poll(reads).toBe(2);
  await expect(page.locator("[data-widget=profile-header]")).toContainText("Fillmo");
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

test("draft: team compositions wait for picks, and say when the stats don't have them yet", async ({ page, t }) => {
  const errors = trackErrors(page);
  const teams = page.getByTestId("why-tabs").getByRole("radio", { name: t.why.tabs.teams });
  const comps = page.locator("[data-widget=draft-comps]");
  // Planning: nobody has picked or hovered yet, no numbers to add up.
  await openApp(page, { view: "/draft", scenario: "draft-planning" });
  await teams.click();
  await expect(comps.getByRole("row").filter({ hasText: t.comps.rows.champions })).toContainText(t.comps.waiting);
  const magic = comps.getByRole("row").filter({ has: page.getByRole("rowheader", { name: t.comps.rows.magic }) });
  await expect(magic.getByRole("cell")).toHaveText([t.comps.none, t.comps.none]);
  // Stats published before compositions were: the picks work, the tab says so.
  await openApp(page, { view: "/draft", scenario: "draft-no-comps" });
  await teams.click();
  await expect(comps).toContainText(t.comps.noComps.title);
  await expect(page.locator("[data-widget=draft-suggestions]")).toContainText("Shen");
  // No stats at all.
  await openApp(page, { view: "/draft", scenario: "draft-no-stats" });
  await teams.click();
  await expect(comps).toContainText(t.comps.noStats.title);
  expect(errors).toEqual([]);
});

test("aram: before your champion is there, the list says what will show", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "aram-champ-select" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.nav.draft.label);
  await page.evaluate((next) => window.__SCOUT_MOCK__?.emit("draft", next), { ...aramDraft, suggestions: [] });
  await expect(page.locator("[data-widget=draft-suggestions]")).toContainText(t.draft.aramWaiting.title);
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
  await expect(page.getByText(t.champions.noStats(t.stats.errors.notFound.title)), "why it isn't sorted by stats").toBeVisible();
  await expect(page.getByRole("button", { name: t.common.tryAgain }), "asking again can't help").toHaveCount(0);
  expect(errors).toEqual([]);
});

test("stats offline on /champions: every champion by class, why, and a retry that asks again", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/champions", scenario: "stats-offline" });
  const notice = page.getByText(t.champions.noStats(t.stats.errors.network.title));
  await expect(notice).toBeVisible();
  await expect(page.getByTestId("role-filter")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: t.champions.sort })).toHaveCount(0);
  const heads = await page
    .locator("[data-widget=champion-grid] h2")
    .evaluateAll((els) => els.map((el) => el.firstElementChild?.textContent));
  expect(heads).toEqual(["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"].map((tag) => t.classes[tag]));
  const tiles = page.getByTestId("champion-tile");
  expect(await tiles.count()).toBeGreaterThan(160);
  await expect(tiles.first().getByRole("img", { name: /^Tier/ }), "no tiers").toHaveCount(0);
  const calls = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((name) => name === "tier_list").length ?? 0);
  const before = await calls();
  await page.getByRole("button", { name: t.common.tryAgain }).click();
  await expect.poll(calls).toBe(before + 1);
  await expect(notice, "still offline: still says so").toBeVisible();
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

for (const view of ["/tier-list", "/champions?id=103", "/champions"]) {
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
    await expect(page.locator("[data-widget=tier-list], [data-widget=champion-runes], [data-testid=champion-tile]").first()).toBeVisible();
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, "cumulative layout shift").toBeLessThan(0.1);
  });
}

test("only ARAM published: ranked says so, ARAM shows its tier list", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/tier-list", scenario: "stats-aram-only" });
  await expect(page.locator("main")).toContainText(t.stats.errors.notFound.title);
  await page.getByTestId("queue-switch").getByRole("radio", { name: t.queues[450], exact: true }).click();
  await expect(page.getByTestId("tier-row").first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText(t.stats.errors.notFound.title);
  expect(errors).toEqual([]);
});

// An opened game: it fails in its sheet (its head still says which game), nothing else does.
const firstGame = (page: Page) => page.locator("[data-testid=match-row] > button").first();

test("an opened game that can't load: its error in place, and a retry asks again", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "match-details-error" });
  await firstGame(page).click();
  const sheet = page.getByTestId("game-sheet");
  const alert = sheet.getByRole("alert");
  await expect(alert).toContainText(t.players.network.title);
  await expect(alert).toContainText(t.players.network.text);
  await expect(sheet.getByRole("heading", { level: 2 })).toContainText(t.matches.outcome.win);
  await alert.getByRole("button", { name: t.common.tryAgain }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "match_details").length)).toBe(2);
  await expect(sheet.getByTestId("game-stats")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("match-row").nth(1)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a game that isn't there anymore says so, without a retry", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "match-details-gone" });
  await firstGame(page).click();
  const alert = page.getByTestId("game-sheet").getByRole("alert");
  await expect(alert).toContainText(t.matchDetails.errors.notFound);
  await expect(alert.getByRole("button", { name: t.common.tryAgain })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("MVP's server can't open games right now: says so, with a retry", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "match-details-unavailable" });
  await firstGame(page).click();
  const alert = page.getByTestId("game-sheet").getByRole("alert");
  await expect(alert).toContainText(t.matchDetails.errors.title);
  await expect(alert).toContainText(t.matchDetails.errors.unavailable);
  await expect(alert.getByRole("button", { name: t.common.tryAgain })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a slow game: its head at once, a skeleton the tables' height, then the tables in its place", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "match-details-slow" });
  await firstGame(page).click();
  const sheet = page.getByTestId("game-sheet");
  await expect(sheet.getByRole("heading", { level: 2 })).toContainText(t.matches.outcome.win);
  const skeleton = sheet.locator("[data-widget=match-details] [data-state=loading]");
  await expect(skeleton).toBeVisible();
  const loading = await skeleton.boundingBox();
  await expect(sheet.getByTestId("game-player")).toHaveCount(10, { timeout: 5_000 });
  const loaded = await sheet.locator("[data-widget=match-details]").boundingBox();
  // Measured through the sheet's rise: a transformed box is off by a hair.
  expect(loaded?.height, "the teams' height, loading then loaded").toBeCloseTo(loading?.height ?? 0, 0);
  await expect(sheet.getByTestId("game-stats")).toBeVisible();
  expect(errors).toEqual([]);
});
