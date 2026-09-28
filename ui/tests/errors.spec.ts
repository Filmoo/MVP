import { expect, test } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { openApp, settle, trackErrors } from "./app";

test("client not running: guidance instead of data", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "not-running" });
  await expect(page.getByRole("heading", { name: "Waiting for the League client" })).toBeVisible();
  await expect(page.getByTestId("client-status")).toContainText("Waiting for League client");
  expect(errors).toEqual([]);
});

test("profile failure: error state, retry calls the core again", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "profile-error" });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't load your profile");
  await expect(alert).toContainText("HTTP 503");
  await alert.getByRole("button", { name: "Try again" }).click();
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

test("a crashing widget is contained: the rest of the page works", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "widget-crash" });
  await expect(page.locator("[data-widget=recent-matches] [role=alert]")).toContainText("This panel failed to load");
  await expect(page.locator("[data-widget=performance-summary]")).toContainText("Champions");
  await expect(page.locator("[data-widget=profile-header]")).toContainText("Fillmo");
  await expect(page.getByTestId("toast")).toHaveCount(1);
  expect(errors.every((e) => e.includes("widget:recent-matches"))).toBe(true);
});

test("client connecting later: the profile loads without a restart", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "not-running" });
  await expect(page.getByRole("heading", { name: "Waiting for the League client" })).toBeVisible();
  const calls = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "current_profile").length);
  const before = await calls();
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("client-status", { connection: "connected", phase: "idle" }));
  await expect.poll(calls).toBe((before ?? 0) + 1);
  expect(errors).toEqual([]);
});

test("unknown route: not-found state, navigation still works", async ({ page }) => {
  await openApp(page, { view: "/does-not-exist" });
  await expect(page.getByText("Page not found")).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.locator("[data-widget=profile-header]")).toBeVisible();
});

test("game assets unreachable: placeholders, no crash", async ({ page }) => {
  const errors = trackErrors(page);
  await page.route("**/dd/**", (route) => route.abort());
  await openApp(page);
  await expect(page.locator("[data-widget=recent-matches]")).toBeVisible();
  await expect(page.getByRole("img", { name: "Champion 103" }).first()).toBeVisible();
  expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
});

// Player pages: every way a lookup can fail has its own words; the transient ones retry.
for (const { name, title, text, retry } of [
  { name: "Nobody/404", title: "Player not found", text: "No player named Nobody#404 on EUW", retry: false },
  { name: "Busy/429", title: "Too many lookups right now", text: "Try again in 12 s", retry: true },
  { name: "Down/503", title: "Player lookups are unavailable", text: "can't reach Riot", retry: true },
  { name: "Offline/0", title: "Can't reach MVP's servers", text: "internet connection", retry: true },
] as const) {
  test(`player lookup ${name}: ${title}`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: `/player/euw1/${name}` });
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("main")).toContainText(text);
    const lookups = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "search_player").length);
    if (retry) {
      await page.getByRole("button", { name: "Try again" }).click();
      await expect.poll(lookups).toBe(2);
    } else {
      await page.getByRole("button", { name: "Search again" }).click();
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

test("build import: the core can't be asked, the bar says so and can retry", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-error" });
  const items = page.getByRole("button", { name: "Import item set" });
  await items.click();
  await expect(page.getByTestId("import-status")).toHaveText("Couldn't import: MVP is still starting, try again in a moment");
  await expect(page.getByTestId("import-itemSet")).toHaveAttribute("data-tone", "failed");
  // Nothing is stuck: it can be tried again, and the rest of the draft still works.
  await expect(items).toBeEnabled();
  await items.click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "import_build").length)).toBe(2);
  await expect(page.locator("[data-widget=draft-suggestions]")).toContainText("Malphite");
  expect(errors).toEqual([]);
});

test("build import: every failure renders its own words, nothing crashes", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-failures" });
  const words = {
    runes: "No free rune page",
    itemSet: "The League client refused: Item sets are unavailable",
    spells: "only 3 s left in champion select",
  } as const;
  for (const [part, text] of Object.entries(words)) {
    await page.getByTestId(`import-${part}`).click();
    await expect(page.getByTestId("import-status")).toContainText(text);
  }
  await expect(page.locator("[data-widget=draft-imports] [role=alert]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("champion page for an unknown id: the champion list", async ({ page }) => {
  await openApp(page, { view: "/champions?id=999999" });
  await expect(page.getByRole("heading", { level: 1, name: "Champions" })).toBeVisible();
  await expect(page.getByTestId("champion-tile").first()).toBeVisible();
});

// Stats pages: nothing published is an empty state (no retry), failures say why and retry.
test("stats not published yet: the pages say so, champions still show", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/tier-list", scenario: "stats-empty" });
  await expect(page.locator("main")).toContainText("No stats published yet");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await openApp(page, { view: "/champions?id=103", scenario: "stats-empty" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ahri");
  await expect(page.locator("main")).toContainText("No stats published yet");
  await openApp(page, { view: "/champions", scenario: "stats-empty" });
  expect(await page.getByTestId("champion-tile").count(), "the list needs no stats").toBeGreaterThan(160);
  await expect(page.getByTestId("role-filter")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const { view, command } of [
  { view: "/tier-list", command: "tier_list" },
  { view: "/champions?id=103", command: "champion_stats" },
] as const) {
  test(`stats offline on ${view}: an error with a retry that asks again`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view, scenario: "stats-offline" });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Can't reach MVP's servers");
    const calls = () => page.evaluate((c) => window.__SCOUT_MOCK__?.calls.filter((name) => name === c).length, command);
    const before = await calls();
    await alert.getByRole("button", { name: "Try again" }).click();
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

test("only ARAM published: ranked says so, ARAM shows its tier list", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/tier-list", scenario: "stats-aram-only" });
  await expect(page.locator("main")).toContainText("No stats published yet");
  await page.getByTestId("queue-switch").getByRole("radio", { name: "ARAM" }).click();
  await expect(page.getByTestId("tier-row").first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("No stats published yet");
  expect(errors).toEqual([]);
});
