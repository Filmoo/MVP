import { expect, type Page, test } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { mockStatsIndex } from "../src/data/mock/stats-fixtures";
import { openApp, SIZES, settle, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

/** Arguments of every call to a stats command, oldest first. */
const argsOf = (page: Page, command: "tier_list" | "champion_stats") =>
  page.evaluate((c) => window.__SCOUT_MOCK__?.log.filter((l) => l.command === c).map((l) => l.args) ?? [], command);

const segment = (page: Page, group: string, name: string | RegExp) => page.getByTestId(group).getByRole("radio", { name });
const rows = (page: Page) => page.getByTestId("tier-row");

test.describe("tier list", () => {
  test("queue and rank switches ask again and are remembered", async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list" });
    await expect(rows(page).first()).toBeVisible();
    expect((await argsOf(page, "tier_list")).at(-1)).toEqual({ queue: 420, bracket: "emeraldPlus" });

    await segment(page, "queue-switch", "ARAM").click();
    await expect.poll(async () => (await argsOf(page, "tier_list")).at(-1)).toEqual({ queue: 450, bracket: "emeraldPlus" });
    await expect(page.getByTestId("role-filter"), "ARAM has no roles").toHaveCount(0);
    await expect(page.getByTestId("data-badge")).toContainText("ARAM");
    await segment(page, "bracket-switch", "Master+").click();
    await expect.poll(async () => (await argsOf(page, "tier_list")).at(-1)).toEqual({ queue: 450, bracket: "masterPlus" });

    await page.reload();
    await settle(page);
    await expect(segment(page, "queue-switch", "ARAM")).toHaveAttribute("aria-checked", "true");
    await expect(segment(page, "bracket-switch", "Master+")).toHaveAttribute("aria-checked", "true");
    expect((await argsOf(page, "tier_list")).at(-1)).toEqual({ queue: 450, bracket: "masterPlus" });
    expect(errors).toEqual([]);
  });

  test("the role filter shows one role, ranked from 1, without asking again", async ({ page }) => {
    await openApp(page, { view: "/tier-list" });
    const asked = (await argsOf(page, "tier_list")).length;
    await segment(page, "role-filter", "Mid").click();
    await expect(rows(page).first()).toHaveAttribute("data-role", "middle");
    const roles = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-role")));
    expect(new Set(roles)).toEqual(new Set(["middle"]));
    await expect(rows(page).first().locator("td").first()).toHaveText("1");
    expect(await argsOf(page, "tier_list")).toHaveLength(asked);
  });

  test("columns sort both ways", async ({ page }) => {
    await openApp(page, { view: "/tier-list" });
    const winRates = () =>
      rows(page).evaluateAll((els) => els.map((el) => Number.parseFloat(el.querySelectorAll("td")[3]?.textContent ?? "")));
    await page.getByRole("button", { name: "Win rate" }).click();
    await expect(page.getByRole("columnheader", { name: "Win rate" })).toHaveAttribute("aria-sort", "descending");
    const down = await winRates();
    expect(down).toEqual([...down].sort((a, b) => b - a));
    await page.getByRole("button", { name: "Win rate" }).click();
    await expect(page.getByRole("columnheader", { name: "Win rate" })).toHaveAttribute("aria-sort", "ascending");
    const up = await winRates();
    expect(up).toEqual([...up].sort((a, b) => a - b));
    await page.getByRole("button", { name: "Champion", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "Champion", exact: true })).toHaveAttribute("aria-sort", "ascending");
    // Compared in the page: the same collation as the app's.
    const sorted = await rows(page).evaluateAll((els) => {
      const names = els.map((el) => el.querySelector("a span span")?.textContent ?? "");
      return names.every((n, i) => i === 0 || (names[i - 1] ?? "").localeCompare(n) <= 0);
    });
    expect(sorted).toBe(true);
  });

  test("a long list shows the first rows, then all on request", async ({ page }) => {
    await openApp(page, { view: "/tier-list" });
    await expect(rows(page)).toHaveCount(50);
    const all = page.getByTestId("tier-show-all");
    const total = Number((await all.innerText()).match(/\d+/)?.[0]);
    expect(total).toBeGreaterThan(150);
    await all.click();
    await expect(rows(page)).toHaveCount(total);
    await expect(all).toHaveCount(0);
  });

  test("a row opens its champion's page in that role", async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list" });
    await segment(page, "role-filter", "Support").click();
    const first = rows(page).first();
    const name = (await first.getByRole("link").innerText()).split("\n")[0] ?? "";
    await first.click();
    await expect(page).toHaveURL(/#\/champions\?id=\d+&role=support$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByTestId("champion-tier")).toContainText("Support");
    expect(errors).toEqual([]);
  });

  test("a link can pick the queue, rank and role", async ({ page }) => {
    await openApp(page, { view: "/tier-list?queue=420&bracket=diamondPlus&role=jungle" });
    await expect(segment(page, "bracket-switch", "Diamond+")).toHaveAttribute("aria-checked", "true");
    await expect(segment(page, "role-filter", "Jungle")).toHaveAttribute("aria-checked", "true");
    await expect(rows(page).first()).toHaveAttribute("data-role", "jungle");
  });

  test("a new publication (stats-index event) refreshes the list", async ({ page }) => {
    await openApp(page, { view: "/tier-list" });
    const before = (await argsOf(page, "tier_list")).length;
    await page.evaluate((index) => window.__SCOUT_MOCK__?.emit("stats-index", index), { ...mockStatsIndex(), updatedAt: Date.now() });
    await expect.poll(async () => (await argsOf(page, "tier_list")).length).toBe(before + 1);
    await expect(rows(page).first()).toBeVisible();
  });
});

test("segmented controls: one tab stop, arrow keys move the choice", async ({ page }) => {
  await openApp(page, { view: "/tier-list" });
  const ranked = segment(page, "queue-switch", "Ranked Solo");
  const aram = segment(page, "queue-switch", "ARAM");
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
  await expect(page.getByRole("radiogroup", { name: "Queue" })).toBeVisible();
});

test.describe("champion page", () => {
  test("role tabs switch the build and tier without asking again", async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/champions?id=99" });
    const support = segment(page, "role-tabs", /^Support/);
    const mid = segment(page, "role-tabs", /^Mid/);
    await expect(support).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("champion-tier")).toContainText("Support");
    const items = page.locator("[data-widget=champion-items]");
    await expect(items, "a support's core build").not.toContainText("Shadowflame");
    const asked = (await argsOf(page, "champion_stats")).length;
    await mid.click();
    await expect(mid).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("champion-tier")).toContainText("Mid");
    await expect(items, "a mage's core build").toContainText("Shadowflame");
    expect(await argsOf(page, "champion_stats")).toHaveLength(asked);
    expect(errors).toEqual([]);
  });

  test("a link picks the role; one the champion doesn't play falls back to its main role", async ({ page }) => {
    await openApp(page, { view: "/champions?id=99&role=middle" });
    await expect(segment(page, "role-tabs", /^Mid/)).toHaveAttribute("aria-checked", "true");
    await openApp(page, { view: "/champions?id=99&role=jungle" });
    await expect(segment(page, "role-tabs", /^Support/)).toHaveAttribute("aria-checked", "true");
  });

  test("ARAM: builds without roles, and no matchups", async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/champions?id=103" });
    await segment(page, "queue-switch", "ARAM").click();
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
    await expect(page.getByTestId("champion-hero")).not.toContainText("Ban rate");
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

  test("matchups: lane, jungler and duos; a row opens the other champion", async ({ page }) => {
    await openApp(page, { view: "/champions?id=103" });
    await expect(page.getByTestId("matchups-best")).toContainText("Best against");
    await segment(page, "matchup-kind", "Duos").click();
    await expect(page.getByTestId("matchups-best")).toContainText("Best with");
    const other = page.getByTestId("matchups-best").getByRole("link").first();
    const name = (await other.innerText()).split("\n")[0] ?? "";
    await other.click();
    await expect(page).toHaveURL(/#\/champions\?id=\d+&role=\w+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  });

  test("a champion without games says so, under its hero", async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/champions?id=904" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Zaahen");
    await expect(page.locator("main")).toContainText("No games of Zaahen yet");
    expect(errors).toEqual([]);
  });

  test("the way back leads to every champion", async ({ page }) => {
    await openApp(page, { view: "/champions?id=103" });
    await page.getByRole("link", { name: "All champions" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Champions");
  });
});

test.describe("champion list", () => {
  test("search by name, filter by role, open a champion", async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/champions" });
    const tiles = page.getByTestId("champion-tile");
    expect(await tiles.count()).toBeGreaterThan(160);
    await page.getByTestId("champion-search").fill("ahr");
    await expect(tiles.first()).toContainText("Ahri");
    await page.getByTestId("champion-search").fill("zzzz");
    await expect(page.locator("main")).toContainText("No champion matches");
    await page.getByTestId("champion-search").fill("");
    await segment(page, "role-filter", "Support").click();
    const hrefs = await tiles.evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(20);
    expect(hrefs.every((h) => h.endsWith("&role=support"))).toBe(true);
    const name = await tiles.first().locator("span").last().innerText();
    await tiles.first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    expect(errors).toEqual([]);
  });
});

// Interactive states of the stats pages lay out at every size (one test per size: they're long).
for (const size of SIZES) {
  test(`stats pages: switched states lay out @ ${size.name} ${size.width}×${size.height}`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list", width: size.width, height: size.height });
    await page.getByTestId("tier-show-all").click();
    await settle(page);
    expect(await page.evaluate(auditLayout), "all rows").toEqual([]);
    await openApp(page, { view: "/champions?id=103", width: size.width, height: size.height });
    await segment(page, "matchup-kind", "Duos").click();
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
