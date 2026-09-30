import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { signedPoints } from "../src/lib/format";
import { GESTURE_GAP_MS, RELEASE_MS, TOUCH_CLOSE, TOUCH_MOVE } from "../src/views/home/stack";
import { animationsDone, expect, openApp, settle, test, trackErrors } from "./app";
import { aim, current, gameOf, notches, openGame, pulling, recordPulls, rows, scrolled, showing, stack, tabs } from "./stack";

// Match rows: every game's grade (and its why), and the stack of opened games a row opens: one
// window of glass per game of the history, over the page receded behind it; its players' pages a
// click away, its end-of-game stats a tab away; the wheel moves from game to game.

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
  await expect(stack(page).locator("[data-liquid=sheet]")).toHaveCount(3);
  for (const place of ["newer", "older"]) {
    const neighbour = stack(page).locator(`[data-place=${place}]`);
    await expect(neighbour).toHaveAttribute("inert");
    await expect(neighbour).toHaveAttribute("aria-hidden", "true");
  }
  await expect(current(page)).not.toHaveAttribute("inert");
  // The current window floats over most of the page, a margin around it where the page shows.
  const box = await current(page).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(1000);
  expect(box?.height ?? 0).toBeGreaterThan(640);
  expect(box?.x ?? 0).toBeGreaterThan(64);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThan(1280 - 64);
  // Three games asked for: this one and its neighbours, nothing else.
  expect(await calls(page, "match_details")).toBe(3);
  // Both teams; yours is marked; a player in streamer mode stays hidden.
  await expect(current(page).getByTestId("game-player")).toHaveCount(10);
  await expect(current(page).locator("[data-widget=match-details]").getByRole("list")).toHaveCount(2);
  await expect(current(page).locator("[data-marked][data-testid=game-player]")).toContainText("Fillmo");
  // Its tabs: the scoreboard, then the end-of-game stats.
  const words = t.matchDetails.tabs;
  await expect(tabs(page)).toHaveText([words.scoreboard, words.damage, words.vision, words.combat]);
  await expect(tabs(page).first()).toHaveAttribute("aria-checked", "true");
  // The page behind is inert: its search can't be reached while the stack is open.
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("search-input")).not.toBeFocused();
  await expect(dialog).toBeVisible();
  expect(errors).toEqual([]);
});

// The page behind recedes in every effects level (a test each: the same URL again doesn't reload).
for (const [effects, drawn] of [
  ["full", "shader"],
  ["light", "css"],
  ["off", "flat"],
] as const) {
  test(`matches: the page behind recedes, smaller and dimmer, and comes back when the stack closes (${effects})`, async ({ page }) => {
    const errors = trackErrors(page);
    const shell = page.locator("[data-ambient-host]");
    const look = () => shell.evaluate((el) => ({ scale: getComputedStyle(el).scale, opacity: getComputedStyle(el).opacity }));
    await openApp(page, { effects });
    expect(await page.evaluate(() => document.documentElement.dataset.effects)).toBe(drawn);
    await openGame(page, 2);
    expect(await look()).toEqual({ scale: "0.94", opacity: "0.55" });
    // Around the window, the page; the window a layer over it: bent glass in Full, a solid surface
    // with a clear edge without it.
    const glass = current(page).locator("[data-liquid=sheet]");
    if (effects === "full") {
      await expect.poll(() => glass.evaluate((el) => el.style.getPropertyValue("--lg-filter"))).toMatch(/^url\(#lg-/);
    } else {
      await expect(glass).toHaveCSS("background-color", "rgba(19, 20, 30, 0.9)");
    }
    // Closed, the page comes back as it was.
    await page.keyboard.press("Escape");
    await expect(stack(page)).toHaveCount(0);
    await animationsDone(page);
    expect(await look()).toEqual({ scale: "none", opacity: "1" });
    expect(errors).toEqual([]);
  });
}

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

// ── The wheel, a finger and the keys: from game to game ──────────────────────────────────────

test("matches: one wheel gesture moves one game: down to the older one, up to the newer one; nothing pulls on the way", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openApp(page);
  const [second, third, fourth] = [await gameOf(page, 1), await gameOf(page, 2), await gameOf(page, 3)];
  await openGame(page, 1);
  await aim(page);
  const pulls = await recordPulls(page);
  // A notch: the older game, with the keyboard in it.
  await notches(page, 1, 100);
  await showing(page, third);
  await expect(current(page)).toBeFocused();
  await expect(rows(page).nth(1)).toHaveAttribute("aria-expanded", "true");
  // Its neighbours are built as it arrives: the next one down is asked for.
  await expect(stack(page).locator("[data-place=older]")).toHaveCount(1);
  // A spin of five notches is one gesture: one game.
  await aim(page);
  await notches(page, 5, 100);
  await showing(page, fourth);
  // Up: back to the newer games, one a gesture.
  await aim(page);
  await notches(page, 3, -100);
  await showing(page, third);
  await aim(page);
  await notches(page, 1, -100);
  await showing(page, second);
  // Between games the stack never follows the wheel, and nothing is said.
  expect(await pulls()).toEqual({ most: 0, how: null, edge: null, said: null });
  expect(errors).toEqual([]);
});

test("matches: a touchpad's flick and its inertia move one game, a nudge none", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const [second, third] = [await gameOf(page, 1), await gameOf(page, 2)];
  await openGame(page, 1);
  await aim(page);
  // A nudge of a few pixels: nothing.
  const wheel = (deltas: number[]) =>
    current(page).evaluate(async (el, list) => {
      for (const dy of list) {
        el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 16));
      }
    }, deltas);
  await wheel([3, 4, 3, 2]);
  await page.waitForTimeout(RELEASE_MS + 50);
  await showing(page, second);
  // A flick: its deltas grow, then its inertia shrinks them for a second and a half, no pause.
  await wheel([6, 14, 26, 40, ...Array.from({ length: 90 }, (_, i) => 60 * 0.95 ** i)]);
  await showing(page, third);
  expect(errors).toEqual([]);
});

test("matches: ↑/↓ and PageUp/PageDown move between games, Home and End go to the ends; ←/→ change the tab", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const games = await Promise.all([0, 1, 2, 3, 11].map((at) => gameOf(page, at)));
  await openGame(page, 1);
  await expect(current(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await showing(page, games[2] ?? "");
  await expect(current(page)).toBeFocused();
  await page.keyboard.press("PageDown");
  await showing(page, games[3] ?? "");
  await page.keyboard.press("PageUp");
  await showing(page, games[2] ?? "");
  await page.keyboard.press("ArrowUp");
  await showing(page, games[1] ?? "");
  // End and Home go to the ends of the stack.
  await page.keyboard.press("End");
  await showing(page, games[4] ?? "");
  await page.keyboard.press("Home");
  await showing(page, games[0] ?? "");
  // ↑ at the newest game: nothing (Escape closes).
  await page.keyboard.press("ArrowUp");
  await expect(stack(page)).toBeVisible();
  await showing(page, games[0] ?? "");
  // → and ← go through the tabs, round again past the last one.
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(current(page).getByTestId("game-stats")).toHaveAccessibleName(t.matchDetails.tabs.damage);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(tabs(page).nth(3)).toHaveAttribute("aria-checked", "true");
  await expect(current(page).getByTestId("game-stats")).toHaveAccessibleName(t.matchDetails.tabs.combat);
  await showing(page, games[0] ?? "");
  expect(errors).toEqual([]);
});

test("matches: the tabs keep ←/→, Home and End; ↑/↓ there still move between games", async ({ page, t }) => {
  await openApp(page);
  const [game, next] = [await gameOf(page, 2), await gameOf(page, 3)];
  await openGame(page, 2);
  await tabs(page).first().focus();
  await page.keyboard.press("End");
  await expect(tabs(page).last()).toHaveAttribute("aria-checked", "true");
  await expect(tabs(page).last()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).first()).toHaveAttribute("aria-checked", "true");
  await expect(current(page).locator("[data-widget=match-details]")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(current(page).getByTestId("game-stats")).toHaveAccessibleName(t.matchDetails.tabs.damage);
  await showing(page, game);
  await page.keyboard.press("ArrowDown");
  await showing(page, next);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-checked", "true");
});

test("matches: pulling past the newest game closes the stack, with a hint; a smaller pull springs back", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page, 0);
  await aim(page);
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
  await aim(page);
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
  // The keyboard is in the window at once.
  await expect(current(page)).toBeFocused();
  // Tab goes round inside the current window, never to its neighbours nor the page behind.
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[data-current]")), `tab ${i}`).toBe(true);
  }
  // From the window itself: no tooltip there (one showing, a link's or a grade's, takes the first
  // Escape: tooltips.spec.ts).
  await current(page).focus();
  await expect(page.locator("[role=tooltip]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(stack(page)).toHaveCount(0);
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // Space opens it too; moved on to the last game, closing gives the focus to that game's row.
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
  // Beside it, over the page receded behind it.
  await page.mouse.click(20, 400);
  await expect(stack(page)).toHaveCount(0);
  await expect(rows(page).nth(1)).toBeFocused();
  expect(errors).toEqual([]);
});

test("matches: with reduced motion the page behind recedes at once and pulls don't move the stack; the hint and the moves still work", async ({
  page,
  t,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  const shell = page.locator("[data-ambient-host]");
  const next = await gameOf(page, 1);
  await rows(page).first().click();
  // No zoom to watch: the page is already there, nothing animates it.
  await expect(shell).toHaveCSS("scale", "0.94");
  expect(await shell.evaluate((el) => el.getAnimations().length)).toBe(0);
  await expect(current(page).getByTestId("game-player")).toHaveCount(10);
  await aim(page);
  const pulls = await recordPulls(page);
  await notches(page, 1, -100);
  await expect.poll(pulls).toEqual({ most: 0, how: "wheel", edge: "top", said: t.matchDetails.stack.close });
  await expect.poll(() => pulling(page)).toBe(null);
  await aim(page);
  await notches(page, 1, 100);
  await showing(page, next);
  // Up past the newest game: four notches close it.
  await page.keyboard.press("Home");
  await animationsDone(page);
  await aim(page);
  await notches(page, 4, -100);
  await expect(stack(page)).toHaveCount(0);
  await expect(shell).toHaveCSS("scale", "none");
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
    // A short drag springs back.
    await drag(page, -TOUCH_MOVE / 2);
    await expect.poll(() => pulling(page)).toBe(null);
    await showing(page, first);
    await drag(page, -(TOUCH_MOVE + 60));
    await showing(page, second);
    await drag(page, TOUCH_MOVE + 60);
    await showing(page, first);
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

// ── The end-of-game stats, a few groups a tab; nothing scrolls ───────────────────────────────

/** The current window's stats tab `at` (1: damage, 2: vision and gold, 3: combat). */
async function statsTab(page: Page, at: 1 | 2 | 3): Promise<void> {
  await tabs(page).nth(at).click();
  await expect(current(page).getByTestId("game-stats")).toBeVisible();
}
const stat = (page: Page, key: string) => current(page).locator(`[data-testid=game-stats] tr[data-stat=${key}]`);

test("matches: your game's end-of-game stats, a few groups a tab: what the League client counts, each row's top marked", async ({
  page,
  t,
}) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  const table = current(page).getByTestId("game-stats");
  const groups = t.matchDetails.stats.groups;
  // Damage: ten players as columns, their champions as heads; the damage dealt, then taken.
  await statsTab(page, 1);
  await expect(table).toHaveAccessibleName(t.matchDetails.tabs.damage);
  await expect(table.locator("thead th")).toHaveCount(10);
  await expect(table.locator("th[scope=rowgroup]")).toHaveText([groups.damageDealt, groups.damageTaken]);
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
  // Vision and gold: what the scoreboard leaves to them.
  await statsTab(page, 2);
  await expect(table.locator("th[scope=rowgroup]")).toHaveText([groups.vision, groups.income]);
  await expect(stat(page, "goldEarned").locator("td").first()).toHaveText(/\d/);
  await expect(stat(page, "visionScore")).toHaveCount(1);
  // Combat: exactly one first blood, marked; then the objectives.
  await statsTab(page, 3);
  await expect(table.locator("th[scope=rowgroup]")).toHaveText([groups.combat, groups.objectives]);
  await expect(stat(page, "firstBlood").getByRole("img", { name: t.matchDetails.stats.yes })).toHaveCount(1);
  await expect(stat(page, "crowdControl").locator("th")).toHaveText(t.matchDetails.stats.rows.crowdControl);
  expect(await scrolled(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("matches: the tab chosen stays from game to game", async ({ page, t }) => {
  await openApp(page);
  await openGame(page, 1);
  await statsTab(page, 2);
  await current(page).focus();
  await page.keyboard.press("End");
  await showing(page, await gameOf(page, 11));
  await expect(tabs(page).nth(2)).toHaveText(t.matchDetails.tabs.vision);
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-checked", "true");
  await expect(current(page).getByTestId("game-stats")).toBeVisible();
  await expect(current(page).locator("[data-widget=match-details]")).toHaveCount(0);
});

test("matches: nothing scrolls in a window, at any size and in any tab: its lines share its height", async ({ page }) => {
  test.slow();
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page, 2);
  for (const [width, height] of [
    [400, 560],
    [420, 800],
    [820, 760],
    [1280, 720],
    [1600, 900],
    [2560, 1440],
  ] as const) {
    await page.setViewportSize({ width, height });
    await settle(page);
    await animationsDone(page);
    for (let at = 0; at < 4; at++) {
      await tabs(page).nth(at).click();
      await expect(current(page).locator("[data-testid=game-player], [data-testid=game-stats]").first()).toBeVisible();
      expect(await scrolled(page), `${width}×${height}, tab ${at}`).toEqual([]);
    }
    // A short window keeps a line of text a player; a taller one their second line too.
    await tabs(page).first().click();
    const second = current(page).getByTestId("game-player").first().getByText(/KP/);
    if (height <= 560) await expect(second, `${width}×${height}`).toBeHidden();
    else await expect(second, `${width}×${height}`).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("matches: on a narrow window the stats turn around: the players as rows, the tab's leading stats as columns", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { width: 420, height: 800 });
  await openGame(page);
  await statsTab(page, 1);
  const table = current(page).getByTestId("game-stats");
  // A row per player, their champion as its head; yours marked.
  await expect(table.locator("tbody tr")).toHaveCount(10);
  await expect(table.locator("tbody th[scope=row]").nth(2)).toHaveAccessibleName(/Fillmo/);
  await expect(table.locator("tbody tr").nth(2)).toHaveClass(/marked/);
  // Each group's first stat, then the next ones, as many as fit (never the damage by type).
  const heads = table.locator("thead th:visible");
  await expect(heads.first()).toHaveText(t.matchDetails.stats.rows.toChampions);
  await expect(heads.nth(1)).toHaveText(t.matchDetails.stats.rows.taken);
  expect(await heads.count()).toBeGreaterThanOrEqual(3);
  await expect(table.locator("thead th[data-stat=physical]")).toHaveCount(0);
  expect(await scrolled(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("matches: someone else's game (our backend) has every stat row", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE" });
  await openGame(page);
  await expect(current(page).locator("[data-marked][data-testid=game-player]")).toContainText("Blade Dancer");
  // No LP on someone else's games (MVP only follows yours).
  await expect(current(page).getByTestId("game-lp")).toHaveCount(0);
  await statsTab(page, 1);
  await expect(stat(page, "healingOnTeammates")).toHaveCount(1);
  await expect(stat(page, "shieldingOnTeammates")).toHaveCount(1);
  expect(await scrolled(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("matches: a game on Howling Abyss has no vision or monster stats", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "howling-abyss", width: 1920, height: 1080 });
  // ARAM: Mayhem, then ARAM: nobody has a vision score there.
  for (const at of [0, 1]) {
    await openGame(page, at);
    await statsTab(page, 2);
    for (const key of ["visionScore", "wardsPlaced", "controlWards", "monsters"]) await expect(stat(page, key)).toHaveCount(0);
    await expect(stat(page, "goldEarned")).toHaveCount(1);
    await statsTab(page, 1);
    await expect(stat(page, "toChampions")).toHaveCount(1);
    // Away from the game's tooltips (one showing would take the Escape).
    await page.mouse.move(0, 0);
    await expect(page.locator("[role=tooltip]")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(stack(page)).toHaveCount(0);
  }
  // A ranked game keeps them.
  await openGame(page, 2);
  await statsTab(page, 2);
  await expect(stat(page, "wardsPlaced")).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const effects of ["full", "light", "off"] as const) {
  test(`matches: the window's text keeps its contrast on the ground under it (${effects})`, async ({ page }) => {
    test.slow();
    await openApp(page, { effects });
    await openGame(page, 0);
    for (const [width, height, at] of [
      [1280, 800, 0],
      [1280, 800, 1],
      [420, 560, 1],
    ] as const) {
      await page.setViewportSize({ width, height });
      await settle(page);
      await tabs(page).nth(at).click();
      await animationsDone(page);
      await page.mouse.move(0, 0);
      expect(await contrasts(page), `${width}×${height}, tab ${at}`).toEqual([]);
    }
  });
}

/**
 * The current window's texts whose contrast with the ground under them (the window's glass and
 * the page behind as drawn, or their own fill) is under 4.5:1: each text's line boxes, measured on
 * a screenshot with the window's words and pictures hidden, at its ground's 95th percentile.
 */
async function contrasts(page: Page): Promise<string[]> {
  const texts = await current(page).evaluate((win) =>
    [...win.querySelectorAll("*")].flatMap((el) => {
      const nodes = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      const first = nodes[0];
      const last = nodes.at(-1);
      const cs = getComputedStyle(el);
      if (!first || !last || cs.visibility === "hidden" || el.closest("[inert]")) return [];
      const range = document.createRange();
      range.setStartBefore(first);
      range.setEndAfter(last);
      const r = range.getBoundingClientRect();
      return r.width < 1 || r.height < 1
        ? []
        : [{ x: r.x, y: r.y, w: r.width, h: r.height, color: cs.color, text: el.textContent?.trim() ?? "" }];
    }),
  );
  const hide = await page.addStyleTag({
    content: "[data-current] * { color: transparent !important } [data-current] :is(img, svg) { visibility: hidden !important }",
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const png = (await page.screenshot()).toString("base64");
  await hide.evaluate((el) => el.parentNode?.removeChild(el));
  return page.evaluate(
    async ({ png, texts }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d");
      if (!ctx) return ["no canvas"];
      ctx.drawImage(img, 0, 0);
      const channel = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      return texts.flatMap((t) => {
        const d = ctx.getImageData(Math.round(t.x), Math.round(t.y), Math.max(1, Math.round(t.w)), Math.max(1, Math.round(t.h))).data;
        const ground: number[] = [];
        for (let i = 0; i < d.length; i += 4) ground.push(luminance(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0));
        ground.sort((a, b) => a - b);
        const under = ground[Math.floor(ground.length * 0.95)] ?? 0;
        const [r = 0, g = 0, b = 0] = (t.color.match(/[\d.]+/g) ?? []).map(Number);
        const text = luminance(r, g, b);
        const ratio = (Math.max(text, under) + 0.05) / (Math.min(text, under) + 0.05);
        return ratio < 4.5 ? [`"${t.text.slice(0, 30)}" ${t.color} on ${under.toFixed(3)}: ${ratio.toFixed(2)}`] : [];
      });
    },
    { png, texts },
  );
}
