import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { expect, openApp, test, trackErrors } from "./app";

// Match rows: every game's grade (and its why), and the whole game behind a row.

/** The match rows' buttons, newest first. */
const rows = (page: Page) => page.locator("[data-testid=match-row] > button");
const calls = (page: Page, command: string) =>
  page.evaluate((name) => window.__SCOUT_MOCK__?.calls.filter((c) => c === name).length ?? 0, command);

test("matches: your grades follow the list, asked once", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  // The fixture's 12 games: one remake, which gets none.
  await expect(page.locator("[data-grade] [data-chip]")).toHaveCount(11);
  await expect(page.locator("[data-grade]").first()).toContainText(t.grade.mvp);
  await expect(page.locator("[data-grade]").nth(1)).toContainText(t.grade.place(8));
  await expect(page.locator("[data-grade] [data-chip]").first()).toHaveAccessibleName(t.grade.label("S"));
  expect(await calls(page, "match_grades")).toBe(1);
  expect(errors).toEqual([]);
});

test("matches: the main role and the roles bar follow the roles of the whole games", async ({ page, t }) => {
  const errors = trackErrors(page);
  // The list guesses five of the mid games as top; the grades come with each game's real role.
  await openApp(page, { scenario: "roles-guessed" });
  await expect(page.locator("[data-grade] [data-chip]")).toHaveCount(11);
  const header = page.locator("[data-widget=profile-header]");
  await expect(header).toContainText(t.profile.stats.mainRole);
  await expect(header).toContainText(t.profile.roleShare(9, 11));
  await expect(header).not.toContainText(t.profile.roleShare(5, 11));
  // The roles bar says what it draws in its name: `Mid 9, Jungle 1, Support 1`.
  const roles = page.locator("[data-widget=performance-summary] [role=img]");
  await expect(roles).toHaveAccessibleName(new RegExp(`^${t.roles.middle} 9`));
  await expect(roles).not.toHaveAccessibleName(new RegExp(t.roles.top));
  expect(errors).toEqual([]);
});

test("matches: other players' games come graded: nothing more to ask", async ({ page }) => {
  await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE" });
  await expect(page.locator("[data-grade] [data-chip]").first()).toBeVisible();
  expect(await calls(page, "match_grades")).toBe(0);
});

test("matches: a row opens its whole game, one at a time, and the page doesn't jump", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const [first, second] = [rows(page).nth(0), rows(page).nth(1)];
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const game = page.getByTestId("game");
  await expect(game.getByTestId("game-player")).toHaveCount(10);
  await expect(game.getByRole("list")).toHaveCount(2);
  // Yours is marked; a player in streamer mode stays hidden.
  await expect(game.locator("[data-marked]")).toContainText("Fillmo");
  await expect(game.getByText(t.live.hidden)).toHaveCount(1);

  // Another row: the first game closes, and the row stays where it was.
  await second.evaluate((row) => row.scrollIntoView({ block: "center" }));
  const before = await second.boundingBox();
  await second.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("game")).toHaveCount(1);
  await expect(page.getByTestId("game-player")).toHaveCount(10);
  expect(Math.abs(((await second.boundingBox())?.y ?? 0) - (before?.y ?? 0)), "row moved").toBeLessThanOrEqual(1);

  // A second click closes it.
  await second.click();
  await expect(second).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("game")).toHaveCount(0);
  expect(await calls(page, "match_details")).toBe(2);
  expect(errors).toEqual([]);
});

test("matches: the keyboard opens and closes a game; Escape gives the focus back", async ({ page }) => {
  await openApp(page);
  const row = rows(page).nth(1);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("game-player")).toHaveCount(10);
  await page.getByTestId("game").click();
  await page.keyboard.press("Escape");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(row).toBeFocused();
  await page.keyboard.press("Space");
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Space");
  await expect(row).toHaveAttribute("aria-expanded", "false");
});

test("matches: Escape elsewhere leaves an opened game alone", async ({ page }) => {
  await openApp(page);
  await rows(page).first().click();
  await expect(page.getByTestId("game-player")).toHaveCount(10);
  await page.getByTestId("search-input").focus();
  await page.keyboard.press("Escape");
  await expect(rows(page).first()).toHaveAttribute("aria-expanded", "true");
});

test("matches: a grade's why shows on hover and on keyboard focus", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const why = page.getByTestId("grade-why");
  // Your grades come after the list: hovered while they land, the chip is drawn anew and the
  // pointer's retry scrolls the page, so wait for them.
  await expect(page.locator("[data-grade] [data-chip]").first()).toBeVisible();

  // Hovered: the grade, its place in the game, and the facts that moved it most, over the list
  // (which doesn't move).
  const below = async () => (await rows(page).nth(6).boundingBox())?.y;
  const before = await below();
  await page.locator("[data-grade]").first().hover();
  await expect(why).toBeVisible();
  expect(await below()).toBe(before);
  await expect(why).toContainText(t.gradeWhy.mvp);
  expect(await why.getByRole("listitem").count()).toBeGreaterThanOrEqual(2);
  await expect(rows(page).first()).toHaveAttribute("aria-describedby", "grade-why");
  await page.mouse.move(0, 0);
  await expect(why).toHaveCount(0);
  await expect(rows(page).first()).not.toHaveAttribute("aria-describedby", /./);

  // Focused from the keyboard: the row's grade explains itself; Escape dismisses it.
  await rows(page).first().focus();
  await page.keyboard.press("Tab");
  await expect(rows(page).nth(1)).toBeFocused();
  await expect(why).toContainText(t.gradeWhy.place(t.grade.place(8)));
  await page.keyboard.press("Escape");
  await expect(why).toHaveCount(0);
  await expect(rows(page).nth(1)).toBeFocused();
  expect(errors).toEqual([]);
});

test("matches: a game on Howling Abyss has no vision column", async ({ page, t }) => {
  const errors = trackErrors(page);
  // Wide enough for every column of a Summoner's Rift game.
  await openApp(page, { scenario: "howling-abyss", width: 1920, height: 1080 });
  const game = page.getByTestId("game");
  const vision = game.getByText(t.matchDetails.columns.vision, { exact: true });
  // ARAM: Mayhem, then ARAM: nobody has a vision score there.
  for (const at of [0, 1]) {
    await rows(page).nth(at).click();
    await expect(game.getByTestId("game-player")).toHaveCount(10);
    await expect(vision.first()).toBeHidden();
    await expect(vision.last()).toBeHidden();
  }
  // A ranked game keeps it.
  await rows(page).nth(2).click();
  await expect(game.getByTestId("game-player")).toHaveCount(10);
  await expect(vision.first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("matches: on a player's page, their line is marked in an opened game", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE" });
  await rows(page).first().click();
  await expect(page.getByTestId("game").locator("[data-marked]")).toContainText("Blade Dancer");
  expect(errors).toEqual([]);
});
