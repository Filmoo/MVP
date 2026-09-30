import type { Locator, Page } from "@playwright/test";
import type { TierGrade } from "../src/data/generated/TierGrade";
import { integer } from "../src/lib/format";
import { expect, openApp, test, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

// Tooltips (design/tip): the game's things (runes, stat shards, summoner spells, items) say what
// they are and what they do; everything else explains itself in a compact card. On hover and on
// keyboard focus, inside the window, never a native title.

const tip = (page: Page) => page.locator("#game-tip");
const hint = (page: Page) => page.locator("#hint");
const rows = (page: Page) => page.locator("[data-testid=match-row] > button");

/** Hovers `target` and waits for its tooltip (`game-tip` or `hint`), which describes it. */
async function hoverTip(page: Page, target: Locator, id: "game-tip" | "hint" = "game-tip"): Promise<Locator> {
  await target.hover();
  await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(target).toHaveAttribute("aria-describedby", id);
  return page.locator(`#${id}`);
}

/** Moves the keyboard focus with Tab until it reaches `target`. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached the target");
}

/** The tooltip shown is whole inside the window. */
async function expectInWindow(page: Page, what: string): Promise<void> {
  const box = await page.locator("[role=tooltip]").boundingBox();
  const size = page.viewportSize();
  const inside = !!box && !!size && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height;
  expect(inside, `${what}: ${JSON.stringify(box)} in ${JSON.stringify(size)}`).toBe(true);
}

test("tooltips: an item in a match row says what it costs and does, and goes with the pointer", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  // The first game's first item: Luden's Echo (the dev assets' patch, 16.19).
  const item = page.locator("[data-testid=match-row] [data-tip='item:6655']").first();
  const pane = await hoverTip(page, item);
  await expect(pane).toContainText(`${await item.getAttribute("alt")}`);
  await expect(pane).toContainText(t.tip.gold(integer(2750)));
  // Its stats and passive, from the core: the values stressed, the magic damage in its colour.
  await expect(pane.locator("[data-tone=strong]").first()).toHaveText("100");
  await expect(pane.locator("[data-tone=magic]")).toHaveCount(1);
  // Inside a match row (a button), an icon takes no focus of its own: the row keeps one tab stop.
  await expect(item).not.toHaveAttribute("tabindex", /./);

  await page.mouse.move(0, 0);
  await expect(tip(page)).toHaveCount(0);
  await expect(item).not.toHaveAttribute("aria-describedby", /./);
  expect(errors).toEqual([]);
});

test("tooltips: keyboard focus in an opened game shows them, Escape closes only the tooltip", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const row = rows(page).first();
  await row.focus();
  await page.keyboard.press("Enter");
  const game = page.locator("[data-testid=game-window][data-current]");
  await expect(game.getByTestId("game-player")).toHaveCount(10);

  // From its window: its close button, its tabs, then in the game the KDA column's explanation, the
  // grade column's, then the first player's spells, keystone and tree, then their items.
  const focused = page.locator(":focus");
  await expect(game).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(focused).toHaveAccessibleName(t.matchDetails.close);
  await page.keyboard.press("Tab");
  await expect(focused).toHaveAttribute("role", "radio");
  await expect(focused).toHaveAccessibleName(t.matchDetails.tabs.scoreboard);
  await page.keyboard.press("Tab");
  await expect(focused).toHaveAttribute("data-hint", t.matchDetails.columns.kdaHint);
  await page.keyboard.press("Tab");
  await expect(focused).toHaveAttribute("data-hint", t.matchDetails.note);
  // The column already says "Grade": the card starts with how a grade is made.
  await expect(hint(page)).toHaveText(t.matchDetails.note);
  await page.keyboard.press("Tab");
  await expect(focused).toHaveAttribute("data-tip", /^spell:/);
  await expect(focused).toHaveAttribute("aria-describedby", "game-tip");
  await expect(tip(page)).toContainText(t.tip.spell);
  const first = await tip(page).innerText();
  await page.keyboard.press("Tab");
  await expect(focused).toHaveAttribute("data-tip", /^spell:/);
  await expect(tip(page)).not.toHaveText(first);
  await page.keyboard.press("Tab");
  await expect(focused).toHaveAttribute("data-tip", /^rune:/);
  await expect(tip(page)).toContainText(t.champions.keystone);
  await page.keyboard.press("Tab");
  await expect(focused).toHaveAttribute("data-tip", /^tree:/);
  await expect(tip(page)).toContainText(t.tip.tree);

  // Escape: the tooltip goes, the game and the focus stay; again, the game closes.
  await page.keyboard.press("Escape");
  await expect(tip(page)).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(focused).toHaveAttribute("data-tip", /^tree:/);
  await page.keyboard.press("Escape");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(row).toBeFocused();
  expect(errors).toEqual([]);
});

test("tooltips: a grade's why and an item's tooltip take turns", async ({ page, t }) => {
  await openApp(page);
  await expect(page.locator("[data-grade] [data-chip]").first()).toBeVisible();
  await page.locator("[data-grade]").first().hover();
  await expect(page.getByTestId("grade-why")).toContainText(t.gradeWhy.mvp);
  await hoverTip(page, page.locator("[data-testid=match-row] [data-tip^='item:']").first());
  await expect(page.getByTestId("grade-why")).toHaveCount(0);
  await expect(rows(page).first()).not.toHaveAttribute("aria-describedby", /./);
});

test("tooltips: the champion page's runes, shards, spells and items", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/champions?id=103" });
  const runes = page.getByTestId("rune-page-view");

  // The chosen keystone: its tree and its text, and in the keyboard's path.
  const keystone = runes.locator("[data-tip='rune:8112']");
  await expect(keystone).toHaveAttribute("tabindex", "0");
  let pane = await hoverTip(page, keystone);
  await expect(pane).toContainText(`${t.champions.keystone} · Domination`);
  await expect(pane.locator("[data-tone=subtle]")).toHaveCount(1);

  // A rune not taken (the secondary tree's last, a minor one): its tooltip on hover, but no stop
  // for the keyboard.
  const other = runes.locator("[data-tip^='rune:']:not([tabindex])").last();
  pane = await hoverTip(page, other);
  await expect(pane).toContainText(`${t.tip.rune} · `);

  // A stat shard: the client's name and effect, with its row of the page.
  pane = await hoverTip(page, runes.locator("[data-tip='shard:5008:offense']"));
  await expect(pane).toContainText(`${t.shards.unknown} · ${t.shards.rows.offense}`);
  await expect(pane).toContainText("+9");

  // Summoner spells with their cooldown; items with their cost.
  pane = await hoverTip(page, page.locator("[data-widget=champion-spells] [data-tip='spell:4']").first());
  await expect(pane).toContainText(`${t.tip.spell} · ${t.tip.cooldown(300)}`);
  pane = await hoverTip(page, page.locator("[data-widget=champion-items] [data-tip^='item:']").first());
  await expect(pane.locator("[class*=figure]")).toHaveText(new RegExp(t.tip.gold("\\d[\\d\\s,.]*")));

  // From the keyboard: the chosen shard shows its tooltip once focused.
  const shard = runes.locator("[data-tip='shard:5008:offense']");
  await tabTo(page, shard);
  await expect(shard).toHaveAttribute("aria-describedby", "game-tip");
  await expect(tip(page)).toContainText(t.shards.rows.offense);
  expect(errors).toEqual([]);
});

test("tooltips: Live cards' summoner spells, form and most played champions", async ({ page, t }) => {
  // Wide enough for the cards to show their most played champions.
  await openApp(page, { view: "/live", scenario: "live", width: 1920, height: 1080 });
  const card = page.getByTestId("live-card").first();
  const spell = card.locator("[data-tip^='spell:']").first();
  await expect(spell).toHaveAttribute("tabindex", "0");
  await expect(await hoverTip(page, spell)).toContainText(t.tip.spell);
  // Their most played champions: one card with each one's games and win rate.
  const pool = page.locator(`[aria-label="${t.live.mostPlayed}"]:visible`).first();
  const lines = (await pool.getAttribute("data-hint"))?.split("\n") ?? [];
  const pane = await hoverTip(page, pool, "hint");
  await expect(pane).toContainText(t.live.mostPlayed);
  await expect(pane.locator("p")).toHaveCount(1 + lines.length);
});

test("tooltips without the core's texts: what each thing is, shards in the UI's own words", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/champions?id=103", scenario: "descriptions-missing" });
  const runes = page.getByTestId("rune-page-view");
  let pane = await hoverTip(page, runes.locator("[data-tip='shard:5008:offense']"));
  await expect(pane).toContainText(t.shards.names[5008].name);
  await expect(pane).toContainText(t.shards.names[5008].stat);
  pane = await hoverTip(page, runes.locator("[data-tip='rune:8112']"));
  await expect(pane).toContainText(`${t.champions.keystone} · Domination`);
  // Its name and what it is (the head), and no text under them.
  await expect(pane.locator(":scope > div")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("tooltips: a slow text fills in, and the grown card finds room in the window", async ({ page }) => {
  await openApp(page, { scenario: "descriptions-slow" });
  // An item low in the window: its card fits below it without its text, not with it.
  const item = page.locator("[data-testid=match-row]").nth(5).locator("[data-tip^='item:']").first();
  await item.evaluate((el) => el.closest("main")?.scrollBy(0, el.getBoundingClientRect().bottom - (window.innerHeight - 90)));
  const pane = await hoverTip(page, item);
  await expect(pane).toContainText(`${await item.getAttribute("alt")}`);
  await expect(pane.locator("[class*=text_] p").first()).toBeVisible({ timeout: 5_000 });
  await expectInWindow(page, "the card once its text came");
});

test("hints: the client's status and the rail's pages say what they are, on hover and focus", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const status = page.getByTestId("client-status");
  let pane = await hoverTip(page, status, "hint");
  await expect(pane).toContainText(t.shell.connection.connected);
  await expect(pane).toContainText(t.tip.status.connected);
  await page.mouse.move(640, 700);
  await expect(hint(page)).toHaveCount(0);

  const champions = page.locator("nav a[href='#/champions']");
  pane = await hoverTip(page, champions, "hint");
  await expect(pane).toContainText(t.nav.champions.label);
  await expect(pane).toContainText(t.tip.nav.champions);

  // From the keyboard, the next page of the rail explains itself as the focus lands on it.
  await page.mouse.move(640, 700);
  const tierList = page.locator("nav a[href='#/tier-list']");
  await tabTo(page, tierList);
  await expect(hint(page)).toContainText(t.tip.nav.tierList);
  await expect(tierList).toHaveAttribute("aria-describedby", "hint");
  expect(errors).toEqual([]);
});

test("hints: a tier says what it means, the numbers what they count", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/champions?id=103" });
  // The hero's tier, on hover and from the keyboard.
  const tier = page.getByTestId("champion-tier");
  const grade = ((await tier.getAttribute("data-tip")) ?? "").split(":")[1] as TierGrade;
  let pane = await hoverTip(page, tier, "hint");
  await expect(pane).toContainText(t.stats.tier(grade));
  await expect(pane).toContainText(t.tip.tiers[grade]);
  await page.mouse.move(0, 0);
  await tabTo(page, tier);
  await expect(hint(page)).toContainText(t.tip.tiers[grade]);

  // A build option's win rate and pick rate, in one card: what each counts.
  const option = page.locator("[data-widget=champion-spells] [data-hint]").first();
  pane = await hoverTip(page, option, "hint");
  await expect(pane.locator("p")).toHaveCount(2);
  // A matchup: its record, what its effect means; the other champion's name is already on the
  // row, so the card starts with its numbers.
  const matchup = page.getByTestId("matchups-best").locator("li").first();
  const delta = (await matchup.locator("[class*=delta]").innerText()).trim();
  pane = await hoverTip(page, matchup, "hint");
  await expect(pane).toContainText(t.champions.effectOf(delta));
  await expect(pane.locator("[class*=hintTitle]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("hints: an import button that can't be used says why", async ({ page, t }) => {
  await openApp(page, { view: "/champions?id=103" });
  // Out of champion select, spells can't be set: the button is disabled and says so.
  const spells = page.getByTestId("import-spells");
  await expect(spells).toBeDisabled();
  await spells.hover();
  await expect(hint(page)).toHaveText(t.imports.spellsInChampSelect);
});

test("hints: the tier list's columns and icon-only choices explain themselves", async ({ page, t }) => {
  await openApp(page, { view: "/tier-list" });
  // A column: its name and what it counts, also when its sort button has the focus.
  const winRate = page.locator("th", { hasText: t.tierList.columns.winRate });
  const pane = await hoverTip(page, winRate, "hint");
  await expect(pane).toContainText(t.tierList.titles.winRate);
  await page.mouse.move(0, 0);
  await tabTo(page, winRate.getByRole("button"));
  await expect(hint(page)).toContainText(t.tierList.titles.winRate);
  // An icon-only choice names itself; its name is already what screen readers read (no echo).
  const role = page.getByTestId("role-filter").getByRole("radio", { name: t.roles.top });
  await page.mouse.move(0, 0);
  await role.hover();
  await expect(hint(page)).toHaveText(t.roles.top);
  await expect(role).not.toHaveAttribute("aria-describedby", /./);
});

// No native tooltip (the operating system's plain box) anywhere: every hover is designed.
test("no view uses a native title tooltip", async ({ page }) => {
  for (const [view, scenario] of [
    ["/", "default"],
    ["/draft", "champ-select"],
    ["/live", "live"],
    ["/champions?id=103", "default"],
    ["/champions", "default"],
    ["/tier-list", "default"],
    ["/settings", "default"],
    ["/player/euw1/Blade%20Dancer/IRE", "default"],
    ["/mayhem", "default"],
    ["/mayhem?champion=103", "default"],
    ["/draft", "mayhem-champ-select"],
  ] as const) {
    await openApp(page, { view, scenario });
    if (view.startsWith("/player") || view === "/") {
      // The stack of opened games: the game's window and its neighbour below, both built.
      await rows(page).first().click();
      await expect(page.getByTestId("game-player")).toHaveCount(20);
    }
    const titled = await page.evaluate(() => [...document.querySelectorAll("#root [title]")].map((el) => el.outerHTML.slice(0, 120)));
    expect(titled, view).toEqual([]);
  }
});

// The window's extremes: the smallest supported width (tall enough to scroll to things) and QHD.
for (const size of [
  { width: 420, height: 800 },
  { width: 2560, height: 1440 },
]) {
  test(`tooltips stay inside the window at ${size.width}×${size.height}`, async ({ page }) => {
    test.slow(); // three pages, each thing settled, hovered and measured
    const errors = trackErrors(page);
    const hoverInWindow = async (thing: Locator, what: string) => {
      await thing.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await thing.hover();
      await expect(page.locator("[role=tooltip]")).toBeVisible();
      const where = `${what}: ${await thing.evaluate((el) => el.outerHTML.slice(0, 80))}`;
      await expectInWindow(page, where);
      // The open card leaves the page's layout sound (nothing of it out of the window, spilling…).
      expect(await page.evaluate(auditLayout), where).toEqual([]);
    };
    // Every page with tooltips, near both of its ends and in its middle. (Match rows and opened
    // games show no items under 560 px: Home has fewer at 420.)
    for (const [view, scenario] of [
      ["/champions?id=103", "default"],
      ["/", "default"],
      ["/live", "live"],
      ["/tier-list", "default"],
    ] as const) {
      await openApp(page, { view, scenario, ...size });
      const things = page.locator("main :is([data-tip], [data-hint]):visible");
      const count = await things.count();
      for (const at of new Set([0, Math.floor(count / 2), count - 1].filter((i) => i >= 0))) {
        await hoverInWindow(things.nth(at), `${view} #${at}`);
      }
    }
    // The window's corners: the client's status (top right), the rail (left), the champion page's
    // shards (the right edge on a wide window) and its last item (low down).
    await openApp(page, { view: "/champions?id=103", ...size });
    await hoverInWindow(page.getByTestId("client-status"), "the status");
    await hoverInWindow(page.locator("nav a").first(), "the rail");
    await hoverInWindow(page.locator("[data-tip^='shard:5008']").last(), "a shard");
    await hoverInWindow(page.locator("[data-widget=champion-items] [data-tip^='item:']").last(), "the last item");
    expect(errors).toEqual([]);
  });
}
