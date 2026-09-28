import { expect, type Page, test } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { champSelectDraft } from "../src/data/mock/draft-fixtures";
import { liveGame, liveScouting } from "../src/data/mock/live-fixtures";
import { openApp, SIZES, settle, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

const cards = (page: Page) => page.getByTestId("live-card");

const cardBoxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-testid=live-card]")].map((el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }),
  );

// Live screens don't scroll: all ten players fit the window from 1280×720 (1080p at 150 %) up.
for (const [width, height] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`all ten cards fit ${width}×${height} without scrolling`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/live", scenario: "live", width, height });
    await expect(cards(page)).toHaveCount(10);
    const main = await page.locator("main").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(main.scroll, "main doesn't scroll").toBeLessThanOrEqual(main.client);
    for (const box of await cardBoxes(page)) expect((box[1] ?? 0) + (box[3] ?? 0), "card fully visible").toBeLessThanOrEqual(height);
    expect(errors).toEqual([]);
  });
}

test("cards: identity, rank, experience on the champion, form, positive tags; hidden players stay hidden", async ({ page }) => {
  await openApp(page, { view: "/live", scenario: "live" });
  const me = cards(page).filter({ hasText: "Fillmo" });
  await expect(me).toContainText("You");
  await expect(me).toContainText("Emerald II");
  await expect(me).toContainText("67 LP");
  await expect(me).toContainText("6 games");
  await expect(me.getByRole("list", { name: /^Last 10: / })).toBeVisible();
  const quiet = cards(page).filter({ hasText: "Quiet Storm" });
  await expect(quiet).toContainText("Ahri one-trick");
  await expect(quiet).toContainText("Veteran");
  const hidden = cards(page).and(page.locator("[data-card=hidden]"));
  await expect(hidden).toHaveCount(1);
  await expect(hidden).toContainText("Hidden player");
  await expect(cards(page).and(page.locator("[data-card=unavailable]"))).toContainText("No ranked data");
  // Spells for everyone, hidden players included (spells aren't identity).
  await expect(hidden.getByRole("img", { name: /Smite|Spell 11/ })).toHaveCount(1);
  // Main roles have their own line: no duplicate chip.
  const hook = cards(page).filter({ hasText: "Hook City" });
  await expect(hook).toContainText("Support main");
  await expect(hook.locator("li", { hasText: "Support main" })).toHaveCount(0);
  await expect(hook.locator("li", { hasText: "4 wins in a row" })).toHaveCount(1);
});

test("cards land in place: nothing moves when scouting finishes", async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?scenario=live-scouting#/live");
  await expect(cards(page)).toHaveCount(10);
  await expect(page.getByTestId("scouting-status")).toHaveText("Looking players up…");
  await expect(cards(page).and(page.locator("[data-card=pending]"))).toHaveCount(9);
  const before = await cardBoxes(page);
  await expect(cards(page).and(page.locator("[data-card=scouted]"))).toHaveCount(8, { timeout: 5_000 });
  await expect(page.getByTestId("scouting-status")).toHaveCount(0);
  expect(await cardBoxes(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("waiting cards lay out at every window size", async ({ page }) => {
  // The core says the game is loading and the cards never come: the waiting state holds still.
  await openApp(page, { view: "/live" });
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveScouting);
  await expect(cards(page).and(page.locator("[data-card=pending]"))).toHaveCount(9);
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(auditLayout), size.name).toEqual([]);
  }
});

test("scouting failure: the game still shows, Try again asks the core", async ({ page }) => {
  await openApp(page, { view: "/live", scenario: "live-failed" });
  const status = page.getByTestId("scouting-status");
  await expect(status).toContainText("Can't reach MVP's servers");
  await expect(cards(page)).toHaveCount(10);
  await expect(cards(page).and(page.locator("[data-card=unavailable]")).first()).toContainText("Card unavailable");
  await status.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "retry_scouting").length)).toBe(1);
});

test("my build: the build of my champion and role, for this game's mode", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/live", scenario: "live" });
  await expect(cards(page)).toHaveCount(10);
  await page.getByTestId("live-tabs").getByRole("radio", { name: "My build" }).click();
  const build = page.getByTestId("my-build");
  const me = liveGame.allies.find((p) => p.isMe);
  await expect(build).toContainText("most played in Ranked Solo · Emerald+");
  await expect(page.locator("[data-widget=champion-runes]")).toBeVisible();
  await expect(page.locator("[data-widget=champion-matchups]")).toBeVisible();
  const asked = await page.evaluate(() => window.__SCOUT_MOCK__?.log.filter((c) => c.command === "champion_stats").map((c) => c.args));
  expect(asked).toEqual([{ championId: me?.championId, queue: 420, bracket: "emeraldPlus" }]);
  await settle(page);
  expect(await page.evaluate(auditLayout)).toEqual([]);
  // Back to the players, as they were.
  await page.getByTestId("live-tabs").getByRole("radio", { name: "Players" }).click();
  await expect(cards(page)).toHaveCount(10);
  expect(errors).toEqual([]);
});

test("my build: a link opens it; modes without builds say so", async ({ page }) => {
  await openApp(page, { view: "/live?tab=build", scenario: "live" });
  await expect(page.locator("[data-widget=champion-runes]")).toBeVisible();
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", { ...game, queueId: 1700 }), liveGame);
  await expect(page.getByTestId("my-build")).toContainText("No builds for this mode");
});

test("a banner never makes the live screens scroll: their panels take what's left", async ({ page }) => {
  const errors = trackErrors(page);
  const scrolls = () => page.locator("main").evaluate((el) => el.scrollHeight - el.clientHeight);
  await openApp(page, { view: "/live", scenario: "banners", width: 1280, height: 800 });
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveGame);
  await expect(cards(page)).toHaveCount(10);
  await expect(page.getByTestId("banner").first()).toBeVisible();
  await settle(page);
  expect(await scrolls(), "live").toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: "Draft" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate((draft) => window.__SCOUT_MOCK__?.emit("draft", draft), champSelectDraft);
  await expect(page.locator("[data-widget=draft-suggestions]")).toBeVisible();
  await settle(page);
  expect(await scrolls(), "draft").toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the core pushes the game in and out", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/live" });
  await expect(page.getByText("Not in a game")).toBeVisible();
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveGame);
  await expect(cards(page)).toHaveCount(10);
  await settle(page);
  expect(await page.evaluate(auditLayout)).toEqual([]);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("live", null));
  await expect(page.getByText("Not in a game")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the core can't read the game: error with retry", async ({ page }) => {
  await openApp(page, { view: "/live", scenario: "live-error" });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't read the game");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "live_game").length)).toBe(2);
});
