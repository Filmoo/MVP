import type { Page } from "@playwright/test";
import type { Settings } from "../src/data/generated/Settings";
import type { TierEntry } from "../src/data/generated/TierEntry";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { mockStatsIndex, mockTierList } from "../src/data/mock/stats-fixtures";
import { expect, openApp, SIZES, settle, test, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

/** Arguments of every call to a stats command, oldest first. */
const argsOf = (page: Page, command: "tier_list" | "previous_tier_list" | "champion_stats") =>
  page.evaluate((c) => window.__SCOUT_MOCK__?.log.filter((l) => l.command === c).map((l) => l.args) ?? [], command);

const segment = (page: Page, group: string, name: string | RegExp) => page.getByTestId(group).getByRole("radio", { name });
const rows = (page: Page) => page.getByTestId("tier-row");
const rankButton = (page: Page) => page.getByTestId("rank-button");
/** Picks a rank in the rank menu (it opens from its button, and closes on a choice). */
async function pickRank(page: Page, name: string): Promise<void> {
  await rankButton(page).click();
  await segment(page, "bracket-switch", name).click();
}

const list = mockTierList(420, "emeraldPlus");
/** A table row's entry, by its key (`id:role`). */
const byKey = new Map<string, TierEntry>(list.entries.map((e) => [`${e.id}:${e.role ?? ""}`, e]));
const rowEntries = (page: Page) =>
  rows(page)
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-key") ?? ""))
    .then((keys) => keys.map((k) => byKey.get(k)));

test.describe("tier list", () => {
  test("queue and rank ask again and are remembered", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list" });
    await expect(rows(page).first()).toBeVisible();
    expect((await argsOf(page, "tier_list")).at(-1)).toEqual({ queue: 420, bracket: "emeraldPlus" });
    expect((await argsOf(page, "previous_tier_list")).at(-1), "the previous patch, for trends").toEqual({
      queue: 420,
      bracket: "emeraldPlus",
    });

    await segment(page, "queue-switch", t.queues[450]).click();
    await expect.poll(async () => (await argsOf(page, "tier_list")).at(-1)).toEqual({ queue: 450, bracket: "emeraldPlus" });
    await expect(page.getByTestId("role-filter"), "ARAM has no lanes").toHaveCount(0);
    await pickRank(page, t.brackets.masterPlus);
    await expect.poll(async () => (await argsOf(page, "tier_list")).at(-1)).toEqual({ queue: 450, bracket: "masterPlus" });
    await expect(rankButton(page)).toContainText(t.brackets.masterPlus);
    await expect(page.getByTestId("bracket-switch").getByRole("radio"), "the menu closed on the choice").toHaveCount(0);

    await page.reload();
    await settle(page);
    await expect(segment(page, "queue-switch", t.queues[450])).toHaveAttribute("aria-checked", "true");
    await expect(rankButton(page)).toContainText(t.brackets.masterPlus);
    expect((await argsOf(page, "tier_list")).at(-1)).toEqual({ queue: 450, bracket: "masterPlus" });
    expect(errors).toEqual([]);
  });

  test("the rank menu: the brackets published, the one shown checked; Escape closes it", async ({ page, t }) => {
    await openApp(page, { view: "/tier-list" });
    await rankButton(page).click();
    const menu = page.getByTestId("bracket-switch").getByRole("radiogroup", { name: t.stats.rank });
    await expect(menu.getByRole("radio")).toHaveText([t.brackets.emeraldPlus, t.brackets.diamondPlus, t.brackets.masterPlus]);
    await expect(menu.getByRole("radio", { name: t.brackets.emeraldPlus })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("lanes: one shows its champions, ranked from 1, without asking again; one tab stop, arrows move", async ({ page, t }) => {
    await openApp(page, { view: "/tier-list?view=shelves" });
    // Count once the first answer is on screen (a slow machine may still be asking).
    await expect(rows(page).first()).toBeVisible();
    const asked = (await argsOf(page, "tier_list")).length;
    await segment(page, "role-filter", t.roles.middle).click();
    await expect(rows(page).first()).toHaveAttribute("data-role", "middle");
    const roles = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-role")));
    expect(new Set(roles)).toEqual(new Set(["middle"]));
    expect(await argsOf(page, "tier_list")).toHaveLength(asked);
    // The title says the lane, in words.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t.roles.middle);
    // A radio group: the chosen lane is the one tab stop, arrows move the choice.
    const mid = segment(page, "role-filter", t.roles.middle);
    await expect(mid).toHaveAttribute("tabindex", "0");
    await mid.focus();
    await page.keyboard.press("ArrowRight");
    await expect(segment(page, "role-filter", t.roles.bottom)).toBeFocused();
    await expect(segment(page, "role-filter", t.roles.bottom)).toHaveAttribute("aria-checked", "true");
    await expect(rows(page).first()).toHaveAttribute("data-role", "bottom");
  });

  test("shelves: the podium, a shelf per tier, the hover card with the numbers and their trend", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list?view=shelves&role=middle" });
    const middle = list.entries.filter((e) => e.role === "middle");
    await expect(rows(page)).toHaveCount(middle.length);
    // Best first: the podium's three, then the shelves from S down.
    const steps = page.getByTestId("podium-step");
    await expect(steps).toHaveCount(3);
    const best = middle[0];
    await expect(steps.first()).toHaveAttribute("href", `#/champions?id=${best?.id}&role=middle`);
    await expect(page.getByRole("region", { name: t.stats.tier("S") })).toBeVisible();
    // The card follows the pointer: the face's numbers and how they moved since the last patch.
    await rows(page).first().hover();
    await expect(page.getByText(t.tierList.sincePrevious)).toBeVisible();
    await expect(page.getByText(t.tierList.rankIn(1, "middle"))).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the meta map: a face lights its dot; it opens full screen, Escape closes it and the focus goes back", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list?view=shelves&role=middle" });
    const open = page.getByTestId("open-map");
    await rows(page).first().hover();
    await expect(open.locator("[data-lit]"), "its dot, lit").toHaveCount(1);
    await open.click();
    const dialog = page.getByRole("dialog", { name: t.tierList.map.title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("map-point")).toHaveCount(await rows(page).count());
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open, "back to what opened it").toBeFocused();
    // The close button too.
    await open.click();
    await dialog.getByRole("button", { name: t.tierList.map.close }).click();
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the table sorts by every column, both ways", async ({ page, t }) => {
    await openApp(page, { view: "/tier-list?view=table&role=all" });
    const header = (name: string) => page.getByRole("columnheader", { name, exact: true });
    const sortsBy = async (name: string, value: (e: TierEntry) => number, first: "descending" | "ascending") => {
      await header(name).getByRole("button").click();
      await expect(header(name)).toHaveAttribute("aria-sort", first);
      const values = (await rowEntries(page)).map((e) => (e ? value(e) : Number.NaN));
      const sign = first === "descending" ? -1 : 1;
      expect(values, name).toEqual([...values].sort((a, b) => (a - b) * sign));
      await header(name).getByRole("button").click();
      await expect(header(name)).toHaveAttribute("aria-sort", first === "descending" ? "ascending" : "descending");
    };
    const columns = t.tierList.columns;
    await sortsBy(columns.winRate, (e) => e.winRate, "descending");
    await sortsBy(columns.pick, (e) => e.pickRate, "descending");
    await sortsBy(columns.ban, (e) => e.banRate, "descending");
    await sortsBy(columns.games, (e) => e.g, "descending");
    await sortsBy(columns.tier, (e) => e.score, "descending");
    // Names A to Z, compared by the page (the app's collation).
    await header(columns.champion).getByRole("button").click();
    await expect(header(columns.champion)).toHaveAttribute("aria-sort", "ascending");
    const sorted = await rows(page).evaluateAll((els) => {
      const names = els.map((el) => el.querySelector("a")?.textContent ?? "");
      return names.every((n, i) => i === 0 || (names[i - 1] ?? "").localeCompare(n) <= 0);
    });
    expect(sorted).toBe(true);
    // Lanes in map order; back to the rank.
    await header(columns.lane).getByRole("button").click();
    await expect(rows(page).first()).toHaveAttribute("data-role", "top");
    await header(columns.rank).getByRole("button").click();
    await expect(rows(page).first().locator("td").first()).toHaveText("1");
  });

  test("every lane: a champion once per lane it's played in; the first rows, then all on request", async ({ page }) => {
    await openApp(page, { view: "/tier-list?view=table&role=all" });
    await expect(rows(page)).toHaveCount(50);
    const all = page.getByTestId("tier-show-all");
    const total = Number((await all.innerText()).match(/\d+/)?.[0]);
    expect(total).toBe(list.entries.length);
    await all.click();
    await expect(rows(page)).toHaveCount(total);
    await expect(all).toHaveCount(0);
    // Lux is played support and mid (the fixture's table): a row each.
    await expect(rows(page).and(page.locator("[data-champion='99']"))).toHaveCount(2);
  });

  test("trends: the change since the last patch under each win rate, none on the first patch", async ({ page }) => {
    await openApp(page, { view: "/tier-list?view=table&role=middle" });
    await expect(rows(page).first().locator("[data-trend]")).toHaveCount(1);
    await openApp(page, { view: "/tier-list?view=table&role=middle", scenario: "stats-first-patch" });
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator("main [data-trend]"), "nothing to compare with").toHaveCount(0);
  });

  test("the filter: best match first, the sort waits; Enter opens the first", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list?view=table&role=all" });
    const filter = page.getByTestId("champion-filter");
    await filter.fill("ahr");
    await expect(rows(page).first()).toHaveAttribute("data-champion", "103");
    await expect(page.getByRole("columnheader", { name: t.tierList.columns.rank, exact: true })).not.toHaveAttribute("aria-sort");
    await filter.fill("zzzz");
    await expect(page.locator("main")).toContainText(t.tierList.noMatch);
    await filter.fill("ahr");
    await filter.press("Enter");
    await expect(page).toHaveURL(/#\/champions\?id=103&role=middle$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ahri");
    expect(errors).toEqual([]);
  });

  test("the view is remembered, and a link can pick it", async ({ page, t }) => {
    await openApp(page, { view: "/tier-list?view=table" });
    await expect(page.getByTestId("tier-table")).toBeVisible();
    await page.goto("/?scenario=default#/tier-list");
    await settle(page);
    await expect(page.getByTestId("tier-table"), "remembered").toBeVisible();
    await segment(page, "view-switch", t.tierList.views.shelves).click();
    await expect(page.getByTestId("podium-step").first()).toBeVisible();
  });

  test("a row opens its champion's page in that lane", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list?view=table" });
    await segment(page, "role-filter", t.roles.support).click();
    const first = rows(page).first();
    const name = (await first.getByRole("link").innerText()).trim();
    await first.click();
    await expect(page).toHaveURL(/#\/champions\?id=\d+&role=support$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByTestId("champion-tier")).toContainText(t.roles.support);
    expect(errors).toEqual([]);
  });

  test("a link can pick the queue, rank and lane", async ({ page, t }) => {
    await openApp(page, { view: "/tier-list?queue=420&bracket=diamondPlus&role=jungle" });
    await expect(rankButton(page)).toContainText(t.brackets.diamondPlus);
    await expect(segment(page, "role-filter", t.roles.jungle)).toHaveAttribute("aria-checked", "true");
    await expect(rows(page).first()).toHaveAttribute("data-role", "jungle");
  });

  test("a new publication (stats-index event) refreshes the list", async ({ page }) => {
    await openApp(page, { view: "/tier-list" });
    // Count once the first answer is on screen (a slow machine may still be asking).
    await expect(rows(page).first()).toBeVisible();
    const before = (await argsOf(page, "tier_list")).length;
    await page.evaluate((index) => window.__SCOUT_MOCK__?.emit("stats-index", index), { ...mockStatsIndex(), updatedAt: Date.now() });
    await expect.poll(async () => (await argsOf(page, "tier_list")).length).toBe(before + 1);
    await expect(rows(page).first()).toBeVisible();
  });
});

test.describe("one hub for tiers and builds", () => {
  test("the nav has no champion list: /champions without an id is the tier list, a link's filters kept", async ({ page, t }) => {
    await openApp(page, { view: "/champions?role=support&queue=420" });
    await expect(page).toHaveURL(/#\/tier-list\?role=support&queue=420$/);
    await expect(segment(page, "role-filter", t.roles.support)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("navigation", { name: t.nav.main }).getByRole("link")).toHaveCount(5);
  });

  test("a champion's page keeps Tiers lit; its way back returns to the same scope", async ({ page, t }) => {
    await openApp(page, { view: "/tier-list?view=table&role=jungle" });
    await pickRank(page, t.brackets.diamondPlus);
    await rows(page).first().click();
    await expect(page).toHaveURL(/#\/champions\?id=\d+&role=jungle$/);
    const nav = page.getByRole("navigation", { name: t.nav.main });
    await expect(nav.getByRole("link", { name: t.nav.tierList.label })).toHaveAttribute("aria-current", "page");
    await page.locator("main").getByRole("link", { name: t.tierList.title, exact: true }).click();
    await expect(page).toHaveURL(/#\/tier-list$/);
    await expect(page.getByTestId("tier-table")).toBeVisible();
    await expect(segment(page, "role-filter", t.roles.jungle)).toHaveAttribute("aria-checked", "true");
    await expect(rankButton(page)).toContainText(t.brackets.diamondPlus);
  });
});

test("queue tabs: one tab stop, arrow keys move the choice", async ({ page, t }) => {
  await openApp(page, { view: "/tier-list" });
  const ranked = segment(page, "queue-switch", t.queues[420]);
  const aram = segment(page, "queue-switch", t.queues[450]);
  await expect(ranked).toHaveAttribute("tabindex", "0");
  await expect(aram).toHaveAttribute("tabindex", "-1");
  await ranked.focus();
  await page.keyboard.press("ArrowRight");
  await expect(aram).toBeFocused();
  await expect(aram).toHaveAttribute("aria-checked", "true");
  await expect(aram).toHaveAttribute("tabindex", "0");
  await expect(ranked).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expect(ranked, "wraps around").toBeFocused();
  await expect(ranked).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("End");
  await expect(aram).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Home");
  await expect(ranked).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radiogroup", { name: t.stats.queue })).toBeVisible();
});

test.describe("champion page", () => {
  test("role tabs switch the build and tier without asking again", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/champions?id=99" });
    const support = segment(page, "role-tabs", new RegExp(`^${t.roles.support}`));
    const mid = segment(page, "role-tabs", new RegExp(`^${t.roles.middle}`));
    await expect(support).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("champion-tier")).toContainText(t.roles.support);
    const items = page.locator("[data-widget=champion-items]");
    await expect(items, "a support's core build").not.toContainText("Shadowflame");
    const asked = (await argsOf(page, "champion_stats")).length;
    await mid.click();
    await expect(mid).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("champion-tier")).toContainText(t.roles.middle);
    await expect(items, "a mage's core build").toContainText("Shadowflame");
    expect(await argsOf(page, "champion_stats")).toHaveLength(asked);
    expect(errors).toEqual([]);
  });

  test("a link picks the role; one the champion doesn't play falls back to its main role", async ({ page, t }) => {
    await openApp(page, { view: "/champions?id=99&role=middle" });
    await expect(segment(page, "role-tabs", new RegExp(`^${t.roles.middle}`))).toHaveAttribute("aria-checked", "true");
    await openApp(page, { view: "/champions?id=99&role=jungle" });
    await expect(segment(page, "role-tabs", new RegExp(`^${t.roles.support}`))).toHaveAttribute("aria-checked", "true");
  });

  test("ARAM: builds without roles, and no matchups", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/champions?id=103" });
    await segment(page, "queue-switch", t.queues[450]).click();
    await expect
      .poll(async () => (await argsOf(page, "champion_stats")).at(-1))
      .toEqual({
        championId: 103,
        queue: 450,
        bracket: "emeraldPlus",
      });
    await expect(page.getByTestId("matchups-aram")).toBeVisible();
    await expect(page.getByTestId("only-role")).toHaveCount(0);
    await expect(page.locator("[data-widget=champion-spells]")).toContainText("Mark");
    await expect(page.getByTestId("champion-hero")).not.toContainText(t.champions.banRate);
    expect(errors).toEqual([]);
  });

  test("rune pages: the next most played page shows in full on click", async ({ page }) => {
    await openApp(page, { view: "/champions?id=103" });
    const pages = page.getByTestId("rune-page");
    await expect(pages.first()).toHaveAttribute("aria-pressed", "true");
    const view = page.getByTestId("rune-page-view");
    await expect(view).toContainText("Electrocute");
    await pages.nth(1).click();
    await expect(pages.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(pages.first()).toHaveAttribute("aria-pressed", "false");
    await expect(view).toContainText("Arcane Comet");
  });

  test("matchups: lane, jungler and duos; a row opens the other champion", async ({ page, t }) => {
    await openApp(page, { view: "/champions?id=103" });
    await expect(page.getByTestId("matchups-best")).toContainText(t.champions.bestAgainst);
    await segment(page, "matchup-kind", t.champions.duos).click();
    await expect(page.getByTestId("matchups-best")).toContainText(t.champions.bestWith);
    const other = page.getByTestId("matchups-best").getByRole("link").first();
    const name = (await other.innerText()).split("\n")[0] ?? "";
    await other.click();
    await expect(page).toHaveURL(/#\/champions\?id=\d+&role=\w+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  });

  test("a champion without games says so, under its hero", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/champions?id=904" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Zaahen");
    await expect(page.locator("main")).toContainText(t.stats.noGamesOf("Zaahen"));
    expect(errors).toEqual([]);
  });

  test("the way back leads to the tier list", async ({ page, t }) => {
    await openApp(page, { view: "/champions?id=103" });
    await page.locator("main").getByRole("link", { name: t.tierList.title, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t.tierList.title);
  });
});

// Interactive states of the stats pages lay out at every size (one test per size: they're long).
for (const size of SIZES) {
  test(`stats pages: switched states lay out @ ${size.name} ${size.width}×${size.height}`, async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list?view=table&role=all", width: size.width, height: size.height });
    await page.getByTestId("tier-show-all").click();
    await settle(page);
    expect(await page.evaluate(auditLayout), "every row").toEqual([]);
    await page.getByTestId("champion-filter").fill("a");
    await settle(page);
    expect(await page.evaluate(auditLayout), "filtered").toEqual([]);
    // The filter outlives a link to the same page: clear it for the podium and the map.
    await page.getByTestId("champion-filter").fill("");
    await openApp(page, { view: "/tier-list?view=shelves&role=all", width: size.width, height: size.height });
    expect(await page.evaluate(auditLayout), "shelves, every lane").toEqual([]);
    await rankButton(page).click();
    await settle(page);
    expect(await page.evaluate(auditLayout), "rank menu").toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByTestId("open-map").click();
    await page.getByTestId("map-point").first().waitFor();
    await settle(page);
    expect(await page.evaluate(auditLayout), "meta map").toEqual([]);
    await openApp(page, { view: "/tier-list", scenario: "stats-offline", width: size.width, height: size.height });
    expect(await page.evaluate(auditLayout), "offline: by class").toEqual([]);
    await openApp(page, { view: "/champions?id=103", width: size.width, height: size.height });
    await segment(page, "matchup-kind", t.champions.duos).click();
    await page.getByTestId("rune-page").nth(1).click();
    await settle(page);
    expect(await page.evaluate(auditLayout), "duos, second rune page").toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("build summary (for the live view) lays out at every size", async ({ page }) => {
  const errors = trackErrors(page);
  for (const size of SIZES) {
    await openApp(page, { view: "/__harness?show=build-summary", width: size.width, height: size.height });
    await expect(page.getByTestId("build-summary")).toBeVisible();
    expect(await page.evaluate(auditLayout), size.name).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("the rank of Settings: saved, where the stats pages start; a rank picked there holds until it changes", async ({ page, t }) => {
  const errors = trackErrors(page);
  const saved = () =>
    page.evaluate(
      () =>
        window.__SCOUT_MOCK__?.log
          .filter((c) => c.command === "update_settings")
          .map((c) => (c.args as { settings: Settings }).settings.statsBracket) ?? [],
    );
  const setting = page.getByTestId("setting-stats-bracket");
  const tierList = page.getByRole("link", { name: t.nav.tierList.label });
  const settings = page.getByRole("link", { name: t.nav.settings.label });
  const lastTierList = async () => (await argsOf(page, "tier_list")).at(-1);

  await openApp(page, { view: "/settings" });
  await expect(setting.getByRole("radio", { name: t.brackets.emeraldPlus }), "Emerald+ by default").toBeChecked();
  await setting.getByText(t.brackets.diamondPlus).click();
  await expect.poll(async () => (await saved()).at(-1)).toBe("diamondPlus");

  // The pages start from it.
  await tierList.click();
  await expect.poll(lastTierList).toEqual({ queue: 420, bracket: "diamondPlus" });
  await expect(rankButton(page)).toContainText(t.brackets.diamondPlus);

  // Picked on a page, it holds there and on the champion pages.
  await pickRank(page, t.brackets.masterPlus);
  await expect.poll(lastTierList).toEqual({ queue: 420, bracket: "masterPlus" });
  await rows(page).first().click();
  await expect.poll(async () => (await argsOf(page, "champion_stats")).at(-1)).toMatchObject({ bracket: "masterPlus" });
  await settings.click();
  await expect(setting.getByRole("radio", { name: t.brackets.diamondPlus }), "the setting is its own").toBeChecked();
  await tierList.click();
  await expect(rankButton(page)).toContainText(t.brackets.masterPlus);

  // A new rank in Settings brings the pages to it.
  await settings.click();
  await setting.getByText(t.brackets.emeraldPlus).click();
  await expect.poll(async () => (await saved()).at(-1)).toBe("emeraldPlus");
  await tierList.click();
  await expect(rankButton(page)).toContainText(t.brackets.emeraldPlus);
  await expect.poll(lastTierList).toEqual({ queue: 420, bracket: "emeraldPlus" });
  expect(errors).toEqual([]);
});
