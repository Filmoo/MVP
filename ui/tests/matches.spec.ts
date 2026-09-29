import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { signedPoints } from "../src/lib/format";
import { GESTURE_GAP_MS, RELEASE_MS, TOUCH_CLOSE, TOUCH_MOVE } from "../src/views/home/stack";
import { animationsDone, expect, openApp, test, trackErrors } from "./app";
import { body, current, gameOf, notches, openGame, pulling, recordPulls, rows, showing, stack, toEdge } from "./stack";

// Match rows: every game's grade (and its why), and the stack of opened games a row opens: one
// window of glass per game of the history, the page behind; its players' pages a click away, its
// end-of-game stats a tab away.

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

test("matches: a row opens the stack on its game, a modal window of glass; only it and its neighbours are built", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const game = await gameOf(page, 2);
  await openGame(page, 2);
  const dialog = page.getByRole("dialog", { name: `${t.matches.outcome.win} · ${t.queues[420]}` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-labelledby", `game-title-${game}`);
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  await expect(rows(page).nth(2)).toHaveAttribute("aria-expanded", "true");
  // Its window and its neighbours, each in liquid glass (the page behind bent and frosted); the
  // neighbours peek at the edges, inert, hidden from screen readers.
  const windows = stack(page).getByTestId("game-window");
  await expect(windows).toHaveCount(3);
  await expect(stack(page).locator("[data-liquid=panel]")).toHaveCount(3);
  for (const place of ["newer", "older"]) {
    const neighbour = stack(page).locator(`[data-place=${place}]`);
    await expect(neighbour).toHaveAttribute("inert");
    await expect(neighbour).toHaveAttribute("aria-hidden", "true");
  }
  await expect(current(page)).not.toHaveAttribute("inert");
  // The current window covers the page beside the rail, but for its neighbours' edges.
  const box = await current(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(640);
  expect(box?.width ?? 0).toBeGreaterThan(1100);
  // Three games asked for: this one and its neighbours, nothing else.
  expect(await calls(page, "match_details")).toBe(3);
  // Both teams; yours is marked; a player in streamer mode stays hidden.
  await expect(current(page).getByTestId("game-player")).toHaveCount(10);
  await expect(current(page).locator("[data-widget=match-details]").getByRole("list")).toHaveCount(2);
  await expect(current(page).locator("[data-marked][data-testid=game-player]")).toContainText("Fillmo");
  // The page behind is inert: its search can't be reached while the stack is open.
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("search-input")).not.toBeFocused();
  await expect(dialog).toBeVisible();
  expect(errors).toEqual([]);
});

test("matches: the newest game has no neighbour above it, the oldest none below", async ({ page }) => {
  await openApp(page);
  await openGame(page, 0);
  await expect(stack(page).getByTestId("game-window")).toHaveCount(2);
  await expect(stack(page).locator("[data-place=newer]")).toHaveCount(0);
  await expect(stack(page).locator("[data-peek=newer]")).toHaveCount(0);
  await expect(stack(page).locator("[data-peek=older]")).toHaveCount(1);
  await page.keyboard.press("End");
  await showing(page, await gameOf(page, 11));
  await expect(stack(page).locator("[data-place=older]")).toHaveCount(0);
  await expect(stack(page).locator("[data-peek=older]")).toHaveCount(0);
});

test("matches: a window's head says the game at once: its LP, your grade and what moved it", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page, 0);
  const head = current(page);
  // The fixture's last game: a ranked win worth +18 LP.
  await expect(head.getByTestId("game-lp")).toContainText(t.matches.lp(signedPoints(18, 0)));
  const grade = head.getByTestId("game-grade");
  await expect(grade.locator("[data-chip]")).toHaveAccessibleName(t.grade.label("S"));
  await expect(grade).toContainText(t.grade.mvp);
  await expect(grade).toContainText(t.matchDetails.outOf);
  expect(await grade.getByRole("listitem").count()).toBeGreaterThanOrEqual(2);
  // A loss: its LP lost.
  await page.keyboard.press("Escape");
  await openGame(page, 1);
  await expect(current(page).getByTestId("game-lp")).toContainText(t.matches.lp(signedPoints(-17, 0)));
  // The scoreboard: the kill participation under each K / D / A, the CS's pace under the CS.
  const mine = current(page).locator("[data-marked][data-testid=game-player]");
  await expect(mine).toContainText(t.matchDetails.kp("").trim());
  await expect(mine).toContainText(t.matches.perMinute("").trim());
  expect(errors).toEqual([]);
});

test("matches: scrolling on past a game's end moves to the older one; past its top back to the newer one", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const [second, third] = [await gameOf(page, 1), await gameOf(page, 2)];
  await openGame(page, 1);
  // Past the end: the stack follows with resistance under a hint, then moves on.
  await toEdge(page, "end");
  const pulls = await recordPulls(page);
  await notches(page, 1, 100);
  await expect.poll(pulls).toMatchObject({ how: "wheel", edge: "end", said: t.matchDetails.stack.older });
  expect((await pulls()).most).toBeLessThan(-20);
  // Let go, it springs back.
  await page.waitForTimeout(RELEASE_MS);
  await expect.poll(() => pulling(page)).toBe(null);
  await showing(page, second);
  // Two notches, begun at the edge: the older game, at its top, with the keyboard in it.
  await page.waitForTimeout(GESTURE_GAP_MS);
  await notches(page, 2, 100);
  await showing(page, third);
  await expect(body(page)).toBeFocused();
  expect(await body(page).evaluate((el) => el.scrollTop)).toBe(0);
  await expect(rows(page).nth(1)).toHaveAttribute("aria-expanded", "true");
  // Its neighbours are built as it arrives: the next one down is asked for.
  await expect(stack(page).locator("[data-place=older]")).toHaveCount(1);
  // Past its top, back to the newer game.
  await toEdge(page, "top");
  await notches(page, 2, -100);
  await showing(page, second);
  expect(errors).toEqual([]);
});

test("matches: the rest of a scroll that moved the stack doesn't scroll the game it brought", async ({ page }) => {
  await openApp(page, { width: 1280, height: 640 });
  const next = await gameOf(page, 3);
  await openGame(page, 2);
  // On the Details tab the game scrolls: the next game's too.
  await current(page).getByTestId("game-tabs").getByRole("radio").nth(1).click();
  await toEdge(page, "end");
  // Five notches in one spin: two move on, the three left are swallowed.
  await notches(page, 5, 100);
  await showing(page, next);
  expect(await body(page).evaluate((el) => el.scrollTop)).toBe(0);
});

test("matches: inertia never moves on, only a deliberate scroll does", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { width: 1280, height: 640 });
  const game = await gameOf(page, 2);
  await openGame(page, 2);
  await current(page).getByTestId("game-tabs").getByRole("radio").nth(1).click();
  await toEdge(page, "top");
  // A fast spin or a flick that scrolls the game to its end, and its momentum hitting the end:
  // wheel events a frame apart, the browser scrolling after each (as it does).
  const pulled = await body(page).evaluate(async (el) => {
    const deltas = [...Array.from({ length: 40 }, () => 120), ...Array.from({ length: 40 }, (_, i) => 120 * 0.93 ** i)];
    let most = 0;
    for (const dy of deltas) {
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, bubbles: true, cancelable: true }));
      el.scrollTop += dy;
      if (el.closest("dialog")?.dataset.pulling) most = Math.max(most, 1);
      await new Promise((r) => setTimeout(r, 16));
    }
    return most;
  });
  expect(pulled, "the gesture that scrolled to the end doesn't pull").toBe(0);
  // Momentum alone at the end, after a pause: it can't add up to a move.
  await page.waitForTimeout(GESTURE_GAP_MS + 50);
  await body(page).evaluate(async (el) => {
    for (let i = 0; i < 40; i++) {
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: 90 * 0.9 ** i, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 16));
    }
  });
  await expect.poll(() => pulling(page)).toBe(null);
  await showing(page, game);
  expect(errors).toEqual([]);
});

test("matches: the keyboard scrolls the game, then moves on; Home and End go to the newest and oldest", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { width: 1280, height: 640 });
  const games = await Promise.all([0, 1, 2, 3, 11].map((at) => gameOf(page, at)));
  await openGame(page, 1);
  await current(page).getByTestId("game-tabs").getByRole("radio").nth(1).click();
  await body(page).focus();
  // PageDown scrolls the game first…
  await page.keyboard.press("PageDown");
  await expect.poll(() => body(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  await showing(page, games[1] ?? "");
  // …at its end, a key held down stops there; pressed again, it moves on.
  await body(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", repeat: true, bubbles: true, cancelable: true }));
  });
  await showing(page, games[1] ?? "");
  await page.keyboard.press("ArrowDown");
  await showing(page, games[2] ?? "");
  await expect(body(page)).toBeFocused();
  // ↑ at the top goes back up, arriving at that game's end (the stack reads like one long page).
  await page.keyboard.press("ArrowUp");
  await showing(page, games[1] ?? "");
  expect(await body(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
  // End and Home go to the ends of the stack.
  await page.keyboard.press("End");
  await showing(page, games[4] ?? "");
  await page.keyboard.press("Home");
  await showing(page, games[0] ?? "");
  // ↑ at the newest game's top: nothing (Escape closes).
  await body(page).evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.keyboard.press("PageUp");
  await expect(stack(page)).toBeVisible();
  await showing(page, games[0] ?? "");
  expect(errors).toEqual([]);
});

test("matches: the tabs keep their keys; a tab changes the view, not the game", async ({ page, t }) => {
  await openApp(page);
  const game = await gameOf(page, 2);
  await openGame(page, 2);
  const tabs = current(page).getByTestId("game-tabs");
  await tabs.getByRole("radio", { name: t.matchDetails.tabs.scoreboard }).focus();
  await page.keyboard.press("End");
  await expect(tabs.getByRole("radio", { name: t.matchDetails.tabs.details })).toHaveAttribute("aria-checked", "true");
  await expect(current(page).getByTestId("game-stats")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(current(page).locator("[data-widget=match-details]")).toBeVisible();
  await showing(page, game);
});

test("matches: pulling past the newest game closes the stack, with a hint; a smaller pull springs back", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page, 0);
  await toEdge(page, "top");
  const pulls = await recordPulls(page);
  await notches(page, 2, -100);
  await expect.poll(pulls).toMatchObject({ how: "wheel", edge: "top", said: t.matchDetails.stack.close });
  expect((await pulls()).most).toBeGreaterThan(40);
  // Let go, it springs back and stays open.
  await expect.poll(() => pulling(page)).toBe(null);
  await expect(stack(page)).toBeVisible();
  // A big enough pull (four notches) closes it; the focus goes back to its row.
  await page.waitForTimeout(GESTURE_GAP_MS);
  await notches(page, 4, -100);
  await expect(stack(page)).toHaveCount(0);
  await expect(rows(page).first()).toBeFocused();
  expect(errors).toEqual([]);
});

test("matches: past the last game of the history, the stack only gives, and says so", async ({ page, t }) => {
  const errors = trackErrors(page);
  // The fixture's 12 games are the whole history.
  await openApp(page);
  const last = await gameOf(page, 11);
  await openGame(page, 0);
  await page.keyboard.press("End");
  await showing(page, last);
  await toEdge(page, "end");
  const pulls = await recordPulls(page);
  await notches(page, 6, 100);
  await expect.poll(pulls).toMatchObject({ how: "wheel", edge: "end", said: t.matches.more.end });
  expect((await pulls()).most).toBeLessThan(-20);
  await expect.poll(() => pulling(page)).toBe(null);
  await showing(page, last);
  // Asks for nothing further back from here: the history said it was all.
  expect(await calls(page, "older_matches")).toBe(0);
  expect(errors).toEqual([]);
});

test("matches: Escape closes the stack and gives the focus to the game's row; the focus stays inside meanwhile", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const row = rows(page).nth(1);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(current(page).getByTestId("game-player")).toHaveCount(10);
  // The keyboard scrolls the game at once.
  await expect(body(page)).toBeFocused();
  // Tab goes round inside the current window, never to its neighbours nor the page behind.
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[data-current]")), `tab ${i}`).toBe(true);
  }
  // From the game's body: no tooltip there (one showing, a link's or a grade's, takes the first
  // Escape: tooltips.spec.ts).
  await body(page).focus();
  await expect(page.locator("[role=tooltip]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(stack(page)).toHaveCount(0);
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // Space opens it too; moved on to the next game, closing gives the focus to that game's row.
  await page.keyboard.press("Space");
  await expect(current(page).getByTestId("game-player")).toHaveCount(10);
  await page.keyboard.press("End");
  await showing(page, await gameOf(page, 11));
  await current(page).getByRole("button", { name: t.matchDetails.close }).click();
  await expect(stack(page)).toHaveCount(0);
  await expect(rows(page).nth(11)).toBeFocused();
  expect(errors).toEqual([]);
});

test("matches: a click around the window closes the stack, inside it doesn't, on a neighbour goes there", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const [newer, older] = [await gameOf(page, 1), await gameOf(page, 3)];
  await openGame(page, 2);
  await current(page).locator("h2").click();
  await current(page)
    .getByTestId("game-player")
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(stack(page)).toBeVisible();
  // The older game's edge, peeking at the bottom; then the newer one's, at the top.
  await stack(page).locator("[data-peek=older]").click();
  await showing(page, older);
  await stack(page).locator("[data-peek=newer]").click();
  await showing(page, await gameOf(page, 2));
  await stack(page).locator("[data-peek=newer]").click();
  await showing(page, newer);
  // Beside it, over the dimmed page (the rail).
  await page.mouse.click(20, 400);
  await expect(stack(page)).toHaveCount(0);
  await expect(rows(page).nth(1)).toBeFocused();
  expect(errors).toEqual([]);
});

test("matches: with reduced motion the stack stays put while pulled; the hint and the moves still work", async ({ page, t }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  const next = await gameOf(page, 1);
  await openGame(page, 0);
  await toEdge(page, "end");
  const pulls = await recordPulls(page);
  await notches(page, 1, 100);
  await expect.poll(pulls).toEqual({ most: 0, how: "wheel", edge: "end", said: t.matchDetails.stack.older });
  await expect.poll(() => pulling(page)).toBe(null);
  await page.waitForTimeout(GESTURE_GAP_MS);
  await notches(page, 2, 100);
  await showing(page, next);
  // Up past the newest game's top: four notches close it.
  await page.keyboard.press("Home");
  await animationsDone(page);
  await toEdge(page, "top");
  await notches(page, 4, -100);
  await expect(stack(page)).toHaveCount(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  /**
   * A finger dragging from the current window's middle by `dy` px (+ down), in steps, then lifted.
   * Few steps: each one moves three windows of glass, slow in a browser without a GPU.
   */
  async function drag(page: Page, dy: number): Promise<void> {
    const box = await current(page).boundingBox();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 4; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * step) / 4 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }

  test("matches: a finger drags on to the next game, back to the newer one, and past the newest to close", async ({ page }) => {
    test.slow();
    const errors = trackErrors(page);
    await openApp(page);
    const [first, second] = [await gameOf(page, 0), await gameOf(page, 1)];
    await openGame(page, 0);
    await toEdge(page, "end");
    // A short drag springs back.
    await drag(page, -TOUCH_MOVE / 2);
    await expect.poll(() => pulling(page)).toBe(null);
    await showing(page, first);
    await drag(page, -(TOUCH_MOVE + 60));
    await showing(page, second);
    await toEdge(page, "top");
    await drag(page, TOUCH_MOVE + 60);
    await showing(page, first);
    await toEdge(page, "top");
    await drag(page, TOUCH_CLOSE + 60);
    await expect(stack(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test("matches: named players open their page (the stack closes); hidden players aren't links", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  const players = current(page).getByTestId("game-player");
  // Nine named players, each a link; the one in streamer mode isn't.
  await expect(current(page).locator("[data-widget=match-details]").getByRole("link")).toHaveCount(9);
  await expect(players.filter({ hasText: t.live.hidden }).getByRole("link")).toHaveCount(0);
  const link = players.filter({ hasNotText: "Fillmo" }).filter({ hasNotText: t.live.hidden }).first().getByRole("link");
  const name = (await link.textContent())?.split("#")[0]?.trim() ?? "";
  await expect(link).toHaveAttribute("href", new RegExp(`^#/player/euw1/${encodeURIComponent(name)}/`));
  await link.click();
  await expect(stack(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/player\/euw1\//);
  await expect(page.locator("main h1")).toContainText(name);
  expect(errors).toEqual([]);
});

test("matches: a grade in the game explains itself; Escape hides the why first, then closes", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  const why = page.getByTestId("grade-why");
  const grades = current(page).locator("[data-grade]");
  await grades.first().hover();
  await expect(why).toBeVisible();
  expect(await why.getByRole("listitem").count()).toBeGreaterThanOrEqual(2);
  await page.mouse.move(4, 4);
  await expect(why).toHaveCount(0);
  // From the keyboard: a grade takes the focus, its why shows; Escape hides it, then the stack.
  await grades.nth(2).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(grades.nth(2)).toBeFocused();
  await expect(why).toBeVisible();
  await expect(grades.nth(2)).toHaveAttribute("aria-describedby", "grade-why");
  await page.keyboard.press("Escape");
  await expect(why).toHaveCount(0);
  await expect(stack(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(stack(page)).toHaveCount(0);
  expect(errors).toEqual([]);
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

// ── The end-of-game stats, a tab away ────────────────────────────────────────────────────────

/** The current window's end-of-game stats (its Details tab). */
async function details(page: Page): Promise<void> {
  await current(page).getByTestId("game-tabs").getByRole("radio").nth(1).click();
  await expect(current(page).getByTestId("game-stats")).toBeVisible();
}
const stat = (page: Page, key: string) => current(page).locator(`[data-testid=game-stats] tr[data-stat=${key}]`);

test("matches: your game's end-of-game stats: what the League client counts, each row's top marked", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  await details(page);
  const table = current(page).getByTestId("game-stats");
  await expect(table).toHaveAccessibleName(t.matchDetails.stats.title);
  // Ten players as columns, their champions as heads; the groups in order.
  await expect(table.locator("thead th")).toHaveCount(10);
  const groups = t.matchDetails.stats.groups;
  await expect(table.locator("th[scope=rowgroup]")).toHaveText([
    groups.combat,
    groups.damageDealt,
    groups.damageTaken,
    groups.vision,
    groups.income,
    groups.objectives,
  ]);
  await expect(stat(page, "crowdControl").locator("th")).toHaveText(t.matchDetails.stats.rows.crowdControl);
  // The League client's match history doesn't count the healing and shielding done to
  // teammates: those rows are left out, never shown as zeros.
  await expect(stat(page, "healing")).toHaveCount(1);
  await expect(stat(page, "healingOnTeammates")).toHaveCount(0);
  await expect(stat(page, "shieldingOnTeammates")).toHaveCount(0);
  // The top value of a row is marked, and only it.
  const cells = stat(page, "toChampions").locator("td");
  const values = (await cells.allTextContents()).map((v) => Number(v.replace(/\D/g, "")));
  const top = values.indexOf(Math.max(...values));
  await expect(cells.nth(top)).toHaveAttribute("data-top", "");
  await expect(stat(page, "toChampions").locator("td[data-top]")).toHaveCount(values.filter((v) => v === values[top]).length);
  // Exactly one first blood, marked.
  await expect(stat(page, "firstBlood").getByRole("img", { name: t.matchDetails.stats.yes })).toHaveCount(1);
  // Gold and vision are there (the scoreboard leaves them to this tab).
  await expect(stat(page, "goldEarned").locator("td").first()).toHaveText(/\d/);
  await expect(stat(page, "visionScore")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("matches: on a narrow window the stats scroll sideways to your column, beside the labels", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { width: 420, height: 800 });
  await openGame(page);
  await details(page);
  // Your column (the mid's, third) first after the labels, which stay put (sticky).
  const place = () =>
    current(page)
      .getByTestId("game-stats")
      .evaluate((region) => {
        const labels = region.querySelector("thead td")?.getBoundingClientRect();
        const mine = region.querySelector("thead th[class*=marked]")?.getBoundingClientRect();
        return { scrolled: region.scrollLeft > 0, beside: !!labels && !!mine && Math.abs(mine.left - labels.right) <= 1 };
      });
  await expect.poll(place).toEqual({ scrolled: true, beside: true });
  expect(errors).toEqual([]);
});

test("matches: someone else's game (our backend) has every stat row", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE" });
  await openGame(page);
  await expect(current(page).locator("[data-marked][data-testid=game-player]")).toContainText("Blade Dancer");
  // No LP on someone else's games (MVP only follows yours).
  await expect(current(page).getByTestId("game-lp")).toHaveCount(0);
  await details(page);
  await expect(stat(page, "healingOnTeammates")).toHaveCount(1);
  await expect(stat(page, "shieldingOnTeammates")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("matches: a game on Howling Abyss has no vision or monster stats", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "howling-abyss", width: 1920, height: 1080 });
  // ARAM: Mayhem, then ARAM: nobody has a vision score there.
  for (const at of [0, 1]) {
    await openGame(page, at);
    await details(page);
    for (const key of ["visionScore", "wardsPlaced", "controlWards", "monsters"]) await expect(stat(page, key)).toHaveCount(0);
    await expect(stat(page, "toChampions")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(stack(page)).toHaveCount(0);
  }
  // A ranked game keeps them.
  await openGame(page, 2);
  await details(page);
  await expect(stat(page, "wardsPlaced")).toHaveCount(1);
  expect(errors).toEqual([]);
});
