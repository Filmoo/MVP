import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { expect, openApp, SIZES, settle, test, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

const input = (page: Page) => page.getByTestId("search-input");
const panel = (page: Page) => page.getByTestId("search-panel");
const options = (page: Page) => page.getByTestId("search-option");
const selected = (page: Page) => page.locator("[data-testid=search-option][aria-selected=true]");
const hash = (page: Page) => page.evaluate(() => decodeURIComponent(window.location.hash));
const lookups = (page: Page) => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "search_player").length ?? 0);

async function typeQuery(page: Page, text: string): Promise<void> {
  await input(page).click();
  await page.keyboard.type(text);
}

/** Boxes of the panel, its sections and rows, rounded to the half pixel. */
const boxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-testid=search-panel], [data-section], [data-testid=search-option]")].map((el) => {
      const r = el.getBoundingClientRect();
      const round = (n: number) => Math.round(n * 2) / 2;
      return [round(r.x), round(r.y), round(r.width), round(r.height)];
    }),
  );

test("Enter opens the highlighted champion even while a slow player lookup is in flight", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "search-slow" });
  await typeQuery(page, "Ahri#EUW");
  // A full Riot ID highlights the player; the champion of that name is one row up.
  await expect(selected(page)).toHaveAttribute("data-kind", "player");
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toHaveAttribute("data-kind", "champion");
  await expect(selected(page)).toContainText("Ahri");
  // The lookup is running (2.5 s) when Enter is pressed.
  await expect(options(page).filter({ hasText: t.search.searching("EUW") })).toBeVisible();
  await page.keyboard.press("Enter");
  expect(await hash(page)).toBe("#/champions?id=103");
  await expect(page.getByRole("heading", { level: 1, name: "Ahri" })).toBeVisible();
  // The answer lands later and changes nothing.
  await page.waitForTimeout(2_800);
  expect(await hash(page)).toBe("#/champions?id=103");
  await expect(panel(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("typing a champion name and pressing Enter at once opens the champion (no network involved)", async ({ page }) => {
  await openApp(page, { scenario: "search-slow" });
  await typeQuery(page, "ahri");
  await page.keyboard.press("Enter");
  expect(await hash(page)).toBe("#/champions?id=103");
  expect(await lookups(page)).toBe(0);
});

test("a lookup landing late fills its row in place: no row moves, the highlight stays", async ({ page, t }) => {
  await openApp(page, { scenario: "search-slow" });
  await typeQuery(page, "Ahri#EUW");
  await page.keyboard.press("ArrowUp");
  const player = options(page).filter({ has: page.locator("text=#EUW") });
  await expect(player).toContainText(t.search.searching("EUW"));
  const before = await boxes(page);
  await expect(player).toContainText(t.search.level(512, "EUW"), { timeout: 5_000 });
  await expect(player).toContainText(t.tiers.master);
  expect(await boxes(page)).toEqual(before);
  await expect(selected(page)).toHaveAttribute("data-kind", "champion");
  await page.keyboard.press("Enter");
  expect(await hash(page)).toBe("#/champions?id=103");
});

test("the local list never waits: champions show on the first key, lookups wait for a pause", async ({ page }) => {
  await openApp(page, { freezeClock: false });
  // The page's timers follow a fake clock from here: typing at 40 ms a key is exactly that, however
  // loaded the machine running the test is (a slow runner used to fire a lookup mid-word).
  await page.clock.install();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  await input(page).click();
  for (const key of "Fillmo#7272") {
    await page.keyboard.type(key);
    await page.clock.runFor(40);
  }
  await expect(options(page).first()).toBeVisible();
  expect(await lookups(page)).toBe(0);
  // One lookup for the finished Riot ID once typing pauses, none for the prefixes typed on the way.
  await page.clock.runFor(300);
  await expect.poll(() => lookups(page)).toBe(1);
  await page.clock.runFor(1_000);
  expect(await lookups(page)).toBe(1);
});

test("keyboard: arrows move and wrap, Escape clears then closes, Ctrl+K and / focus", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("Control+k");
  await expect(input(page)).toBeFocused();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.type("a");
  const count = await options(page).count();
  expect(count).toBeGreaterThan(2);
  await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(options(page).nth(count - 1), "wraps to the last row").toHaveAttribute("aria-selected", "true");
  await expect(input(page)).toHaveAttribute("aria-activedescendant", `search-option-${count - 1}`);

  await page.keyboard.press("Escape");
  await expect(input(page)).toHaveValue("");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(input(page)).not.toBeFocused();

  await page.keyboard.press("/");
  await expect(input(page)).toBeFocused();
  await expect(input(page), "the shortcut isn't typed").toHaveValue("");
  await page.keyboard.type("Name/x");
  await expect(input(page), "typing / in the field is text").toHaveValue("Name/x");
});

test("Enter on a player opens their page, which reuses the lookup", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await typeQuery(page, "Blade Dancer#IRE");
  await expect(options(page).filter({ hasText: t.search.level(512, "EUW") })).toBeVisible();
  await page.keyboard.press("Enter");
  expect(await hash(page)).toBe("#/player/euw1/Blade Dancer/IRE");
  await expect(page.locator("[data-widget=profile-header]")).toContainText("Blade Dancer");
  await expect(input(page)).toHaveValue("");
  expect(await lookups(page), "one lookup for the row and the page").toBe(1);
  expect(errors).toEqual([]);
});

test("Enter on a player before the lookup answers opens the page, which loads", async ({ page }) => {
  await openApp(page, { scenario: "search-slow" });
  await typeQuery(page, "Blade Dancer#IRE");
  await page.keyboard.press("Enter");
  expect(await hash(page)).toBe("#/player/euw1/Blade Dancer/IRE");
  await expect(page.locator("main [data-state=loading]").first()).toBeVisible();
  await expect(page.locator("[data-widget=profile-header]")).toContainText("Blade Dancer", { timeout: 6_000 });
});

test("the region picker searches another platform and is remembered", async ({ page, t }) => {
  await openApp(page);
  await page.getByTestId("search-region").selectOption("na1");
  await typeQuery(page, "Blade Dancer#IRE");
  await expect(selected(page)).toContainText(t.search.searchOn("Blade Dancer#IRE", "NA"));
  await page.keyboard.press("Enter");
  expect(await hash(page)).toBe("#/player/na1/Blade Dancer/IRE");
  await page.reload();
  await expect(page.getByTestId("search-region")).toHaveValue("na1");
});

test("a player that doesn't exist says so in its row, and Enter still opens the page", async ({ page, t }) => {
  await openApp(page);
  await typeQuery(page, "Nobody#404");
  await expect(selected(page)).toContainText(t.search.noPlayerOn("EUW"));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: t.players.notFound.title })).toBeVisible();
});

test("recent searches: newest first, at most 8, clearable", async ({ page, t }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const players = Array.from({ length: 8 }, (_, i) => ({
      kind: "player",
      platform: "euw1",
      riotId: { gameName: `Old ${i}`, tagLine: "EUW" },
    }));
    localStorage.setItem("mvp.recent-searches.v1", JSON.stringify(players));
  });
  await openApp(page);
  await typeQuery(page, "ahri");
  await page.keyboard.press("Enter");
  await input(page).click();
  const recent = page.locator("[data-section=recent] [data-testid=search-option]");
  await expect(recent).toHaveCount(8);
  await expect(recent.first()).toContainText("Ahri");
  await expect(recent.last()).toContainText("Old 6");
  // Opening a recent entry again moves it to the top without duplicating it.
  await recent.nth(3).click();
  expect(await hash(page)).toBe("#/player/euw1/Old 2/EUW");
  await input(page).click();
  await expect(recent.first()).toContainText("Old 2");
  await expect(recent).toHaveCount(8);
  await page.getByRole("button", { name: t.search.clearRecent }).click();
  await expect(recent).toHaveCount(0);
  await expect(panel(page)).toContainText(t.search.hint);
  await expect(input(page)).toBeFocused();
});

test("the panel lays out at every window size, while loading and once resolved", async ({ page, t }) => {
  const errors = trackErrors(page);
  for (const size of SIZES) {
    await openApp(page, { width: size.width, height: size.height });
    await typeQuery(page, "a");
    await expect(panel(page)).toBeVisible();
    expect(await page.evaluate(auditLayout), `${size.name} champions`).toEqual([]);
    await input(page).fill("WWWWWWWWWWWWWWWW#WWWWW");
    await expect(options(page).filter({ hasText: t.search.level(512, "EUW") })).toBeVisible();
    await settle(page);
    expect(await page.evaluate(auditLayout), `${size.name} player`).toEqual([]);
    const box = await panel(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height, `${size.name} in the window`).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});
