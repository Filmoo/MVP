import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { winPostGame } from "../src/data/mock/progress-fixtures";
import { integer, signedPoints } from "../src/lib/format";
import { expect, openApp, settle, test, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

// Home's history (filters, older games, the LP of each ranked game), the last game's summary on
// top of it, the LP graph and your mastery.

const rows = (page: Page) => page.locator("[data-testid=match-row]");
/** Every call of `command` with its arguments, in order. */
const calls = (page: Page, command: string) =>
  page.evaluate((name) => window.__SCOUT_MOCK__?.log.filter((c) => c.command === name).map((c) => c.args) ?? [], command);

test("history: the queue and champion filters choose among the games loaded; grades only for rows shown", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "history-long" });
  await expect(rows(page)).toHaveCount(20);
  // Grades are asked for the rows on screen: the first 20 (the remakes aside).
  await expect(page.locator("[data-grade] [data-chip]").first()).toBeVisible();
  const first = (await calls(page, "match_grades")) as Array<{ matchIds: string[] }>;
  expect(first).toHaveLength(1);

  const queue = page.getByTestId("queue-filter");
  await queue.getByRole("radio", { name: t.matches.filters.queues.flex }).click();
  await expect(rows(page)).toHaveCount(2);
  for (const row of await rows(page).all()) await expect(row).toContainText(t.queues[440]);
  await queue.getByRole("radio", { name: t.matches.filters.queues.aram }).click();
  await expect(rows(page)).toHaveCount(2);
  await queue.getByRole("radio", { name: t.matches.filters.queues.all }).click();
  await expect(rows(page)).toHaveCount(20);
  expect(await calls(page, "match_grades"), "filters never ask again for rows already asked").toHaveLength(1);

  // A champion: its games only, its portrait in the pill.
  await page.getByTestId("champion-filter").selectOption({ label: t.matches.filters.championGames("Ahri", 6) });
  await expect(rows(page)).toHaveCount(6);
  for (const row of await rows(page).all()) await expect(row).toContainText("Ahri");
  // With a queue: nothing left, and one click gives everything back.
  await queue.getByRole("radio", { name: t.matches.filters.queues.flex }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText(t.matches.filters.none.title)).toBeVisible();
  await expect(page.getByText(t.matches.filters.none.text(20, true))).toBeVisible();
  await page.getByRole("button", { name: t.matches.filters.clear }).click();
  await expect(rows(page)).toHaveCount(20);
  await expect(page.getByTestId("champion-filter")).toHaveValue("0");
  expect(errors).toEqual([]);
});

test("history: a link sets the filters; a short history has nothing further back", async ({ page, t }) => {
  // The fixture's 12 games: every game already there, and none of them flex.
  await openApp(page, { view: "/?queue=flex" });
  await expect(page.getByTestId("queue-filter").getByRole("radio", { name: t.matches.filters.queues.flex })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByText(t.matches.filters.none.text(12, false))).toBeVisible();
  await expect(page.getByTestId("load-more")).toHaveCount(0);
  expect(await page.evaluate(auditLayout)).toEqual([]);
});

test("history: load more pages further back until the end, the list never moving", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "history-long" });
  const more = page.getByTestId("load-more");
  // The older games come under the ones on screen, which stay put.
  await more.scrollIntoViewIfNeeded();
  const last = await rows(page).nth(19).boundingBox();
  await more.click();
  await expect(rows(page)).toHaveCount(40);
  expect((await rows(page).nth(19).boundingBox())?.y).toBe(last?.y);
  await more.click();
  await expect(rows(page)).toHaveCount(47);
  await expect(more).toHaveCount(0);
  await expect(page.getByText(t.matches.more.end)).toBeVisible();
  // Both indexes inclusive: 20–39, then 40–59.
  expect(await calls(page, "older_matches")).toEqual([{ begIndex: 20 }, { begIndex: 40 }]);
  // The older rows got their grades, asked once each.
  await expect(page.locator("[data-grade] [data-chip]")).not.toHaveCount(0);
  const asked = ((await calls(page, "match_grades")) as Array<{ matchIds: string[] }>).flatMap((c) => c.matchIds);
  expect(new Set(asked).size).toBe(asked.length);
  expect(errors).toEqual([]);
});

test("history: loading older games says so, keeps the focus, and a failure can be retried", async ({ page, t }) => {
  await openApp(page, { scenario: "history-more-slow" });
  const more = page.getByTestId("load-more");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveText(t.matches.more.loading);
  await expect(more).toBeFocused();
  await settle(page);
  expect(await page.evaluate(auditLayout)).toEqual([]);
  await expect(rows(page)).toHaveCount(40, { timeout: 10_000 });
  await expect(more).toHaveText(t.matches.more.load);

  await openApp(page, { scenario: "history-more-error" });
  await page.getByTestId("load-more").click();
  await expect(page.getByRole("alert").filter({ hasText: t.matches.more.failed })).toBeVisible();
  await expect(rows(page)).toHaveCount(20);
  await page.getByTestId("load-more").click();
  expect(await calls(page, "older_matches")).toHaveLength(2);
});

test("history: your ranked games carry the LP they were worth", async ({ page, t }) => {
  await openApp(page);
  // The fixture: +18 for the last game, a loss before it; no LP for a remake.
  await expect(rows(page).first()).toContainText(t.matches.lp(signedPoints(18, 0)));
  await expect(rows(page).nth(1)).toContainText(t.matches.lp(signedPoints(-17, 0)));
  await expect(page.locator("[data-outcome=remake]")).not.toContainText(t.matches.lp(""));
  // Another player's page has none (MVP only follows your games).
  await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE" });
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator("[data-lp]")).toHaveCount(0);
});

test("profile: the LP graph sums your tracked ranked games; mastery in the champions card", async ({ page, t }) => {
  await openApp(page);
  const graph = page.getByRole("img", { name: t.profile.lpTrend(11, t.matches.lp(signedPoints(86, 0))) });
  await expect(graph).toBeVisible();
  await expect(graph.locator("polyline")).toHaveAttribute("points", /(\S+ ){11}\S+/);
  const mastery = page.locator("[data-widget=performance-summary] li[title]");
  await expect(mastery).toHaveCount(5);
  await expect(mastery.first()).toHaveAttribute("title", t.summary.masteryTitle("Ahri", 12, integer(412_300)));
  await expect(mastery.first()).toContainText("12");
});

test("post-game: the last game tops Home, with its LP, until closed for good", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "post-game" });
  const card = page.locator("[data-widget=post-game]");
  await expect(card.getByTestId("post-game")).toContainText(t.matches.outcome.win);
  await expect(card.getByTestId("post-game-grade")).toContainText(t.gradeWhy.mvp);
  await expect(card.getByTestId("post-game-lp")).toContainText(t.matches.lp(signedPoints(21, 0)));
  await expect(card).toContainText(t.postGame.laneOpponent);
  // The opponent's name opens their page.
  await expect(card.getByRole("link")).toHaveAttribute("href", /^#\/player\/euw1\//);
  // Its row says the same LP.
  await expect(rows(page).first()).toContainText(t.matches.lp(signedPoints(21, 0)));

  await card.getByRole("button", { name: t.postGame.close }).click();
  await expect(card).toHaveCount(0);
  expect(await calls(page, "dismiss_post_game")).toEqual([{ matchId: "EUW1_7510240000" }]);
  // Gone for good: back on Home, it doesn't come back.
  await page.evaluate(() => {
    window.location.hash = "#/champions";
  });
  await settle(page);
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  await settle(page);
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator("[data-widget=post-game]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("post-game: a demotion, an unknown LP, an LP on its way, ARAM", async ({ page, t }) => {
  await openApp(page, { scenario: "post-game-demotion" });
  const lp = page.getByTestId("post-game-lp");
  await expect(lp).toContainText(t.matches.lp(signedPoints(-35, 0)));
  await expect(lp).toContainText(t.postGame.lp.demoted);
  await expect(lp).toContainText(t.tiers.platinum);

  await openApp(page, { scenario: "post-game-lp-unknown" });
  await expect(page.getByTestId("post-game-lp")).toHaveText(t.postGame.lp.unknown);

  // The client counts the game a moment later: the summary and its row follow.
  await openApp(page, { scenario: "post-game-lp-pending" });
  await expect(page.getByTestId("post-game-lp")).toHaveText(t.postGame.lp.pending);
  await expect(rows(page).first()).not.toContainText(t.matches.lp(signedPoints(21, 0)));
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("post-game", game), winPostGame);
  await expect(page.getByTestId("post-game-lp")).toContainText(t.matches.lp(signedPoints(21, 0)));
  await expect(rows(page).first()).toContainText(t.matches.lp(signedPoints(21, 0)));
  expect(await calls(page, "current_profile"), "the same game again: only its LP is read again").toHaveLength(1);

  await openApp(page, { scenario: "post-game-aram" });
  await expect(page.getByTestId("post-game")).toContainText(t.queues[450]);
  await expect(page.getByTestId("post-game-lp")).toHaveCount(0);
  await expect(page.locator("[data-widget=post-game]")).toContainText(t.postGame.closestDamage);
});

test("post-game: the summary lays out at every size", async ({ page }) => {
  test.slow();
  const errors = trackErrors(page);
  for (const scenario of ["post-game", "post-game-demotion"] as const) {
    for (const width of [400, 560, 820, 1280, 2560]) {
      await openApp(page, { scenario, width, height: 900 });
      expect(await page.evaluate(auditLayout), `${scenario} @ ${width}`).toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});
