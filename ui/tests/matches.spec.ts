import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { GESTURE_GAP_MS, RELEASE_MS, TOUCH_CLOSE } from "../src/views/home/pull";
import { animationsDone, expect, openApp, test, trackErrors } from "./app";

// Match rows: every game's grade (and its why), and the whole game a row opens, in a sheet of
// glass over the page (its players' pages a click away, its end-of-game stats).

/** The match rows' buttons, newest first. */
const rows = (page: Page) => page.locator("[data-testid=match-row] > button");
const calls = (page: Page, command: string) =>
  page.evaluate((name) => window.__SCOUT_MOCK__?.calls.filter((c) => c === name).length ?? 0, command);
const sheet = (page: Page) => page.getByTestId("game-sheet");
const body = (page: Page) => page.getByTestId("game-body");

/** Opens row `at`'s game (newest first) and waits until it has landed. */
async function openGame(page: Page, at = 0): Promise<void> {
  await rows(page).nth(at).click();
  await expect(sheet(page).getByTestId("game-player")).toHaveCount(10);
  await animationsDone(page);
}

/** Scrolls the opened game to its top or end, waits for the next wheel gesture, points at it. */
async function toEdge(page: Page, edge: "top" | "end"): Promise<void> {
  await body(page).evaluate((el, end) => {
    el.scrollTop = end ? el.scrollHeight : 0;
  }, edge === "end");
  const box = await page.getByTestId("game").boundingBox();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.waitForTimeout(GESTURE_GAP_MS + 50);
}

/** The sheet's pull on screen: how far it moved (px, + down), and how it is pulled (`null`: it isn't). */
const pull = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("[data-testid=game]");
    const translate = panel ? getComputedStyle(panel).translate : "none";
    const moved = translate === "none" ? 0 : Number.parseFloat(translate.split(" ")[1] ?? "0");
    return { moved: Math.round(moved), pulling: document.querySelector("dialog")?.dataset.pulling ?? null };
  });

interface Pulls {
  /** The farthest the sheet was sent (px, + down). */
  most: number;
  /** How it was pulled, if it was. */
  how: string | null;
  /** The hint showed (it names the edge it points to). */
  edge: string | null;
}

/**
 * Records the sheet's pulls from now on, as they happen: on a busy machine a pull can spring back
 * before a test looks.
 */
async function recordPulls(page: Page): Promise<() => Promise<Pulls>> {
  await page.evaluate(() => {
    const dialog = document.querySelector("dialog");
    const panel = document.querySelector<HTMLElement>("[data-testid=game]");
    const cue = document.querySelector<HTMLElement>("[data-testid=scroll-cue]");
    const seen: Pulls = { most: 0, how: null, edge: null };
    (window as unknown as { __pulls: Pulls }).__pulls = seen;
    const look = () => {
      const y = Number.parseFloat(panel?.style.translate.split(" ")[1] ?? "0") || 0;
      if (Math.abs(y) > Math.abs(seen.most)) seen.most = Math.round(y);
      seen.how ??= dialog?.dataset.pulling ?? null;
      seen.edge ??= dialog?.dataset.pulling ? (cue?.dataset.edge ?? null) : null;
    };
    for (const el of [dialog, panel]) if (el) new MutationObserver(look).observe(el, { attributes: true });
  });
  return () => page.evaluate(() => (window as unknown as { __pulls: Pulls }).__pulls);
}

/** Wheel notches over the sheet, sent back to back (each awaited, a busy machine spaced them out). */
async function notches(page: Page, count: number, dy: number): Promise<void> {
  const box = await page.getByTestId("game").boundingBox();
  const at = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
  const cdp = await page.context().newCDPSession(page);
  await Promise.all(
    Array.from({ length: count }, () => cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...at, deltaX: 0, deltaY: dy })),
  );
  await cdp.detach();
}

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

test("matches: a row opens its whole game in a modal sheet of glass, labelled by its title", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  const dialog = page.getByRole("dialog", { name: `${t.matches.outcome.win} · ${t.queues[420]}` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  await expect(rows(page).first()).toHaveAttribute("aria-expanded", "true");
  // Liquid glass (the page behind it bent and frosted).
  await expect(dialog.locator("[data-liquid=panel]")).toHaveCount(1);
  // Both teams; yours is marked; a player in streamer mode stays hidden.
  await expect(dialog.getByTestId("game-player")).toHaveCount(10);
  await expect(dialog.getByTestId("game").getByRole("list")).toHaveCount(2);
  await expect(dialog.locator("[data-marked][data-testid=game-player]")).toContainText("Fillmo");
  await expect(dialog.getByText(t.live.hidden)).toHaveCount(1);
  // The page behind is inert: its search can't be reached while the game is open.
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("search-input")).not.toBeFocused();
  await expect(dialog).toBeVisible();
  expect(await calls(page, "match_details")).toBe(1);
  expect(errors).toEqual([]);
});

test("matches: Escape closes the game and gives the focus back; the focus stays inside meanwhile", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const row = rows(page).nth(1);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page).getByTestId("game-player")).toHaveCount(10);
  // The keyboard scrolls the game at once.
  await expect(body(page)).toBeFocused();
  // Tab goes round inside the sheet, never to the page behind.
  for (let i = 0; i < 26; i++) {
    await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog")), `tab ${i}`).toBe(true);
  }
  // On a player's link (not a grade: its why would take the first Escape).
  await sheet(page).getByTestId("game").getByRole("link").first().focus();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // Space opens it too; the close button closes it.
  await page.keyboard.press("Space");
  await sheet(page).getByRole("button", { name: t.matchDetails.close }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(errors).toEqual([]);
});

test("matches: a click outside the sheet closes it, a click inside doesn't", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page, 2);
  await sheet(page).locator("#game-title").click();
  await sheet(page)
    .getByTestId("game-player")
    .first()
    .click({ position: { x: 4, y: 4 } });
  await expect(sheet(page)).toBeVisible();
  // Beside it, over the dimmed page (the rail).
  await page.mouse.click(20, 400);
  await expect(sheet(page)).toHaveCount(0);
  await expect(rows(page).nth(2)).toBeFocused();
  expect(errors).toEqual([]);
});

test("matches: scrolling on past the end pulls the game, springs back, and a big enough scroll closes it", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  await toEdge(page, "end");
  const cue = page.getByTestId("scroll-cue");
  await expect(cue).toContainText(t.matchDetails.keepScrolling);
  // Two notches: the sheet follows (up), under the hint of what more would do…
  const pulls = await recordPulls(page);
  await notches(page, 2, 100);
  await expect.poll(pulls).toMatchObject({ how: "wheel", edge: "end" });
  expect((await pulls()).most).toBeLessThan(-40);
  // …and let go, it springs back.
  await page.waitForTimeout(RELEASE_MS);
  await expect.poll(async () => pull(page)).toEqual({ moved: 0, pulling: null });
  await expect(cue).toHaveCSS("opacity", "0");
  await expect(sheet(page)).toBeVisible();
  // A big enough scroll closes it; the focus goes back to its row.
  await page.waitForTimeout(GESTURE_GAP_MS);
  await notches(page, 4, 100);
  await expect(sheet(page)).toHaveCount(0);
  await expect(rows(page).first()).toBeFocused();
  expect(errors).toEqual([]);
});

test("matches: scrolling on past the top closes it too", async ({ page }) => {
  await openApp(page);
  await openGame(page, 1);
  await toEdge(page, "top");
  const pulls = await recordPulls(page);
  await notches(page, 1, -100);
  await expect.poll(pulls).toMatchObject({ how: "wheel", edge: "top" });
  expect((await pulls()).most).toBeGreaterThan(20);
  await expect.poll(async () => (await pull(page)).pulling).toBe(null);
  await page.waitForTimeout(GESTURE_GAP_MS);
  await notches(page, 4, -100);
  await expect(sheet(page)).toHaveCount(0);
});

test("matches: inertia never closes the game, only a deliberate scroll does", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  await toEdge(page, "top");
  // A fast spin or a flick that scrolls the game to its end, and its momentum hitting the end:
  // wheel events a frame apart, the browser scrolling after each (as it does).
  const pulled = await body(page).evaluate(async (el) => {
    const deltas = [...Array.from({ length: 30 }, () => 120), ...Array.from({ length: 40 }, (_, i) => 120 * 0.93 ** i)];
    let most = 0;
    for (const dy of deltas) {
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, bubbles: true }));
      el.scrollTop += dy;
      const dialog = el.closest("dialog");
      if (dialog?.dataset.pulling) most = Math.max(most, 1);
      await new Promise((r) => setTimeout(r, 16));
    }
    return most;
  });
  expect(pulled, "the gesture that scrolled to the end doesn't pull").toBe(0);
  // Momentum alone at the end, after a pause: it can't add up to a close.
  await page.waitForTimeout(GESTURE_GAP_MS + 50);
  await body(page).evaluate(async (el) => {
    for (let i = 0; i < 40; i++) {
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: 90 * 0.9 ** i, bubbles: true }));
      await new Promise((r) => setTimeout(r, 16));
    }
  });
  await expect.poll(async () => (await pull(page)).pulling).toBe(null);
  await expect(sheet(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("matches: with reduced motion the sheet stays put, the hint and the close still work", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await openGame(page);
  await toEdge(page, "end");
  const pulls = await recordPulls(page);
  await notches(page, 1, 100);
  await expect.poll(pulls).toEqual({ most: 0, how: "wheel", edge: "end" });
  // Let go, then a big enough scroll: it closes.
  await expect.poll(async () => (await pull(page)).pulling).toBe(null);
  await page.waitForTimeout(GESTURE_GAP_MS);
  await notches(page, 4, 100);
  await expect(sheet(page)).toHaveCount(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  /** A finger dragging from the sheet's middle by `dy` px (+ down), in steps, then lifted. */
  async function drag(page: Page, dy: number): Promise<void> {
    const box = await page.getByTestId("game").boundingBox();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 10; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * step) / 10 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  test("matches: a finger dragging past the top closes the game; a short drag springs back", async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page);
    await openGame(page);
    await toEdge(page, "top");
    await drag(page, TOUCH_CLOSE / 2);
    await expect.poll(async () => pull(page)).toEqual({ moved: 0, pulling: null });
    await expect(sheet(page)).toBeVisible();
    await drag(page, TOUCH_CLOSE + 60);
    await expect(sheet(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test("matches: named players open their page (the game closes); hidden players aren't links", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  const players = sheet(page).getByTestId("game-player");
  // Nine named players, each a link; the one in streamer mode isn't.
  await expect(sheet(page).getByTestId("game").getByRole("link")).toHaveCount(9);
  await expect(players.filter({ hasText: t.live.hidden }).getByRole("link")).toHaveCount(0);
  const link = players.filter({ hasNotText: "Fillmo" }).filter({ hasNotText: t.live.hidden }).first().getByRole("link");
  const name = (await link.textContent())?.split("#")[0]?.trim() ?? "";
  await expect(link).toHaveAttribute("href", new RegExp(`^#/player/euw1/${encodeURIComponent(name)}/`));
  await link.click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/player\/euw1\//);
  await expect(page.locator("main h1")).toContainText(name);
  expect(errors).toEqual([]);
});

test("matches: a grade in the game explains itself; Escape hides the why first, then closes", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  const why = page.getByTestId("grade-why");
  const grades = sheet(page).locator("[data-grade]");
  await grades.first().hover();
  await expect(why).toBeVisible();
  expect(await why.getByRole("listitem").count()).toBeGreaterThanOrEqual(2);
  await page.mouse.move(4, 4);
  await expect(why).toHaveCount(0);
  // From the keyboard: a grade takes the focus, its why shows; Escape hides it, then the game.
  await grades.nth(2).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(grades.nth(2)).toBeFocused();
  await expect(why).toBeVisible();
  await expect(grades.nth(2)).toHaveAttribute("aria-describedby", "grade-why");
  await page.keyboard.press("Escape");
  await expect(why).toHaveCount(0);
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
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

// ── The end-of-game stats ─────────────────────────────────────────────────────────────────

const stat = (page: Page, key: string) => sheet(page).locator(`[data-testid=game-stats] tr[data-stat=${key}]`);

test("matches: your game's end-of-game stats: what the League client counts, each row's top marked", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await openGame(page);
  const table = sheet(page).getByTestId("game-stats");
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
  expect(errors).toEqual([]);
});

test("matches: someone else's game (our backend) has every stat row", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE" });
  await openGame(page);
  await expect(stat(page, "healingOnTeammates")).toHaveCount(1);
  await expect(stat(page, "shieldingOnTeammates")).toHaveCount(1);
  await expect(sheet(page).locator("[data-marked][data-testid=game-player]")).toContainText("Blade Dancer");
  expect(errors).toEqual([]);
});

test("matches: a game on Howling Abyss has no vision column and no vision or monster stats", async ({ page, t }) => {
  const errors = trackErrors(page);
  // Wide enough for every column of a Summoner's Rift game.
  await openApp(page, { scenario: "howling-abyss", width: 1920, height: 1080 });
  const game = page.getByTestId("game");
  const vision = game.getByText(t.matchDetails.columns.vision, { exact: true });
  // ARAM: Mayhem, then ARAM: nobody has a vision score there.
  for (const at of [0, 1]) {
    await openGame(page, at);
    await expect(vision.first()).toBeHidden();
    await expect(vision.last()).toBeHidden();
    for (const key of ["visionScore", "wardsPlaced", "controlWards", "monsters"]) await expect(stat(page, key)).toHaveCount(0);
    await expect(stat(page, "toChampions")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
  }
  // A ranked game keeps them.
  await openGame(page, 2);
  await expect(vision.first()).toBeVisible();
  await expect(stat(page, "wardsPlaced")).toHaveCount(1);
  expect(errors).toEqual([]);
});
