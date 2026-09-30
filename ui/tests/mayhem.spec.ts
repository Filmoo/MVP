import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { mayhemAugments, mayhemTiers } from "../src/data/mock/mayhem-fixtures";
import { expect, openApp, settle, test, trackErrors } from "./app";

/** A queue tab of the stats pages, by its whole name ("ARAM" isn't "ARAM: Mayhem"). */
const queueTab = (page: Page, name: string) => page.getByTestId("queue-switch").getByRole("radio", { name, exact: true });
const augments = (page: Page) => page.getByTestId("augment");
const nameOf = (id: number) => mayhemAugments.augments.find((a) => a.id === id)?.name ?? "";
const calls = (page: Page, command: string) =>
  page.evaluate((c) => window.__SCOUT_MOCK__?.calls.filter((call) => call === c).length ?? 0, command);

test.describe("ARAM: Mayhem page", () => {
  test("the tier list's queue tab opens it; Ranked or ARAM go back", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/tier-list" });
    await queueTab(page, t.queues[2400]).click();
    await expect(page).toHaveURL(/#\/mayhem$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t.mayhem.augments);
    await expect(queueTab(page, t.queues[2400])).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("bracket-switch"), "no ranks: shared games aren't ranked").toHaveCount(0);
    await queueTab(page, t.queues[450]).click();
    await expect(page).toHaveURL(/#\/tier-list$/);
    await expect(queueTab(page, t.queues[450])).toHaveAttribute("aria-checked", "true");
    expect(errors).toEqual([]);
  });

  test("augments by MVP's tiers, in rank order, with pick rates and no win rates", async ({ page, t }) => {
    await openApp(page, { view: "/mayhem" });
    const first = augments(page).first();
    await expect(first).toContainText(nameOf(mayhemTiers.tiers.S[0] ?? 0));
    // Inside its tier's section, an augment's rank alone.
    await expect(first).toContainText(t.tierList.rankN(1));
    await expect(augments(page).nth(1)).toContainText(t.tierList.rankN(2));
    await expect(page.getByTestId("mayhem-sources")).toContainText(t.common.games(1_284));
    // Pick rates on every augment, never a win rate (the page's note says why there is none).
    const cards = (await augments(page).allInnerTexts()).join("\n").toLowerCase();
    expect(cards).toContain(t.mayhem.picked("").trim().split(" ")[0]?.toLowerCase() ?? "");
    expect(cards, "never a win rate for augments").not.toContain(t.champions.winRate.toLowerCase());
    // Every augment shows once: the tiered ones, then the others.
    await expect(augments(page)).toHaveCount(mayhemAugments.augments.length);
    await expect(page.locator("main")).toContainText(t.mayhem.untiered);
  });

  test("the rarity filter keeps one rarity", async ({ page, t }) => {
    await openApp(page, { view: "/mayhem" });
    await page.getByTestId("rarity-filter").getByRole("radio", { name: t.mayhem.rarities.prismatic }).click();
    const metas = await augments(page).evaluateAll((els) => els.map((el) => el.textContent ?? ""));
    expect(metas.length).toBeGreaterThan(0);
    for (const meta of metas) expect(meta).toContain(t.mayhem.rarities.prismatic);
  });

  test("a champion: its augments per rarity with their reasons; clearing goes back", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/mayhem" });
    await page.getByTestId("mayhem-champion-search").fill("ahr");
    await page.getByRole("button", { name: "Ahri" }).click();
    await expect(page).toHaveURL(/champion=103/);
    const champion = page.getByTestId("mayhem-champion");
    await expect(champion.locator("[data-rarity]")).toHaveCount(3);
    await expect(champion).toContainText(t.mayhem.rarities.silver);
    await expect(champion).toContainText(t.mayhem.mostPicked);
    // Ahri has enough shared games: her pick rates come second, shown with each augment.
    await expect(champion).toContainText(t.mayhem.pickedBy("", "Ahri").split(" ").slice(-2).join(" "));
    await page.getByTestId("mayhem-champion-chip").getByRole("button", { name: t.mayhem.clear }).click();
    await expect(page).toHaveURL(/#\/mayhem$/);
    await expect(augments(page).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("nothing published yet: every augment listed, and how to help", async ({ page, t }) => {
    await openApp(page, { view: "/mayhem", scenario: "mayhem-empty" });
    await expect(page.getByTestId("mayhem-no-tiers")).toContainText(t.mayhem.noTiers.title);
    const gathering = page.getByTestId("mayhem-gathering");
    await expect(gathering).toContainText(t.mayhem.gathering.title);
    await expect(gathering.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await gathering.getByRole("link", { name: t.settings.stats.shareMayhem.title }).click();
    await expect(page).toHaveURL(/#\/settings$/);
  });

  test("too few shared games: how far it is instead of pick rates, on the page and for a champion", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/mayhem", scenario: "mayhem-gathering" });
    const gathering = page.getByTestId("mayhem-gathering");
    await expect(gathering).toContainText(t.mayhem.gathering.page(100));
    const bar = gathering.getByRole("progressbar");
    await expect(bar).toHaveAttribute("aria-valuenow", "37");
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
    await expect(gathering).toContainText(t.mayhem.gathering.count(37, 100));
    // No noisy numbers: 37 games show no pick rate, the tiers still order the augments.
    const cards = (await augments(page).allInnerTexts()).join("\n");
    expect(cards).not.toContain(t.mayhem.picked("").trim());
    await expect(augments(page).first()).toContainText(t.tierList.rankN(1));
    // A champion with a few games: its meter, no pick rates, no most picked augments or items.
    await openApp(page, { view: "/mayhem?champion=103", scenario: "mayhem-gathering" });
    const champion = page.getByTestId("mayhem-champion");
    await expect(champion.getByTestId("mayhem-meter")).toContainText(t.mayhem.gathering.champion("Ahri", 30));
    await expect(champion.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "30");
    await expect(champion).toContainText(t.mayhem.order.byTier);
    await expect(champion).not.toContainText(t.mayhem.mostPicked);
    await expect(champion).not.toContainText(t.mayhem.pickedBy("", "Ahri").split(" ").slice(-2).join(" "));
    // Enough games (the default): no meter, the numbers.
    await openApp(page, { view: "/mayhem?champion=103" });
    await expect(page.getByTestId("mayhem-champion")).toContainText(t.mayhem.mostPicked);
    await expect(page.getByTestId("mayhem-meter")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("not built yet, or offline: said so, with a retry when it can help", async ({ page, t }) => {
    await openApp(page, { view: "/mayhem", scenario: "mayhem-unbuilt" });
    await expect(page.locator("main")).toContainText(t.mayhem.unbuilt.title);
    await openApp(page, { view: "/mayhem", scenario: "mayhem-offline" });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(t.mayhem.failed);
    const asked = await calls(page, "mayhem_augments");
    await alert.getByRole("button", { name: t.common.tryAgain }).click();
    await expect.poll(() => calls(page, "mayhem_augments")).toBeGreaterThan(asked);
  });

  test("slow data: skeletons first, then the augments without layout jumps", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/?scenario=mayhem-slow#/mayhem");
    await expect(page.locator("main [aria-busy=true]").first()).toBeVisible();
    await settle(page);
    await expect(augments(page).first()).toBeVisible();
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, "cumulative layout shift").toBeLessThan(0.1);
  });
});

test.describe("ARAM: Mayhem elsewhere", () => {
  test("the champion page's Mayhem tab: its augments, then ARAM's builds", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/champions?id=103" });
    await queueTab(page, t.queues[2400]).click();
    await expect(page.getByTestId("mayhem-champion")).toBeVisible();
    await expect(page.locator("main")).toContainText(t.mayhem.aramBuilds);
    await expect(page.locator("main")).toContainText(t.mayhem.aramNote);
    // ARAM's builds and stats come with it.
    const lastQueue = () =>
      page.evaluate(
        () => (window.__SCOUT_MOCK__?.log.filter((l) => l.command === "champion_stats").at(-1)?.args as { queue?: number })?.queue,
      );
    await expect.poll(lastQueue).toBe(450);
    await queueTab(page, t.queues[420]).click();
    await expect(page.getByTestId("mayhem-champion")).toHaveCount(0);
    // A link opens it directly (Draft and Live link there in Mayhem).
    await openApp(page, { view: "/champions?id=103&mode=mayhem" });
    await expect(queueTab(page, t.queues[2400])).toHaveAttribute("aria-checked", "true");
    expect(errors).toEqual([]);
  });

  test("draft in Mayhem: most picked augments on each row, the panel opens on them", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/draft", scenario: "mayhem-champ-select", width: 1280, height: 800 });
    await expect(page.getByTestId("top-augments").first()).toBeVisible();
    const tabs = page.getByTestId("why-tabs");
    await expect(tabs.getByRole("radio", { name: t.mayhem.augments })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("[data-widget=draft-why] [data-testid=mayhem-champion]")).toBeVisible();
    // Another champion of the bench: its augments.
    await page.getByTestId("suggestion").filter({ hasText: "Sion" }).click();
    await expect(page.locator("[data-widget=draft-why] h2")).toHaveText("Sion");
    // The other tabs still work.
    await tabs.getByRole("radio", { name: t.why.tabs.pick }).click();
    await expect(page.locator("[data-widget=draft-why] [data-testid=mayhem-champion]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("draft in Mayhem with too few games: the panel says how far it is, no row shows picks", async ({ page, t }) => {
    await openApp(page, { view: "/draft", scenario: "mayhem-gathering", width: 1280, height: 800 });
    const panel = page.locator("[data-widget=draft-why] [data-testid=mayhem-champion]");
    await expect(panel.getByRole("progressbar")).toBeVisible();
    await expect(panel.getByRole("link", { name: t.settings.stats.shareMayhem.title }), "no way out of champion select").toHaveCount(0);
    await expect(page.getByTestId("top-augments")).toHaveCount(0);
  });

  test("plain ARAM has no augments", async ({ page, t }) => {
    await openApp(page, { view: "/draft", scenario: "aram-champ-select" });
    await expect(page.getByTestId("top-augments")).toHaveCount(0);
    await expect(page.getByTestId("why-tabs").getByRole("radio", { name: t.mayhem.augments })).toHaveCount(0);
  });

  test("live in a Mayhem game: your augments, then ARAM's build", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/live?tab=build", scenario: "mayhem-live" });
    await expect(page.getByTestId("my-build").getByTestId("mayhem-champion")).toBeVisible();
    await expect(page.getByTestId("my-build")).toContainText(t.mayhem.aramNote);
    await expect(page.getByTestId("my-build").getByRole("link", { name: t.live.build.page })).toHaveAttribute("href", /mode=mayhem/);
    expect(errors).toEqual([]);
  });

  test("settings: Help build Mayhem stats is off by default, saved when turned on, found by the search", async ({ page }) => {
    await openApp(page, { view: "/settings" });
    const toggle = page.getByTestId("setting-share-mayhem");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const saved = await page.evaluate(
      () =>
        (
          window.__SCOUT_MOCK__?.log.filter((l) => l.command === "update_settings").at(-1)?.args as {
            settings: { shareMayhemGames: boolean };
          }
        )?.settings,
    );
    expect(saved?.shareMayhemGames).toBe(true);
    // What players call it finds it (its keywords list "augments" in both languages).
    await page.getByTestId("settings-search").fill("augments");
    await expect(toggle).toBeVisible();
    await expect(page.locator("[data-widget=settings-app]")).toBeHidden();
  });
});

test.describe("The question about sharing Mayhem games", () => {
  /** The answer saved last (`undefined`: none). */
  const saved = (page: Page) =>
    page.evaluate(
      () =>
        (
          window.__SCOUT_MOCK__?.log.filter((l) => l.command === "update_settings").at(-1)?.args as
            | { settings: { shareMayhemGames: boolean | null } }
            | undefined
        )?.settings.shareMayhemGames,
    );
  const setPhase = (page: Page, phase: string) =>
    page.evaluate((p) => window.__SCOUT_MOCK__?.emit("client-status", { connection: "connected", phase: p as "idle" }), phase);

  test("asked on Home in plain words, with how far each feature is; yes shares, and it goes", async ({ page, t }) => {
    const errors = trackErrors(page);
    await openApp(page, { scenario: "first-start" });
    const question = page.getByTestId("share-question");
    await expect(question.getByRole("heading", { name: t.mayhem.question.title })).toBeVisible();
    await expect(question).toContainText(t.mayhem.question.data);
    const bars = question.getByRole("progressbar");
    await expect(bars).toHaveCount(2);
    await expect(bars.first()).toHaveAttribute("aria-valuenow", "37");
    await expect(question).toContainText(t.mayhem.gathering.count(37, 100));
    await expect(bars.nth(1)).toHaveAttribute("aria-valuenow", "4");
    // Two equal answers: the same kind of button, as wide.
    const yes = question.getByRole("button", { name: t.mayhem.question.yes });
    const no = question.getByRole("button", { name: t.mayhem.question.no });
    expect(await yes.getAttribute("class")).toBe(await no.getAttribute("class"));
    const [a, b] = [await yes.boundingBox(), await no.boundingBox()];
    expect(Math.abs((a?.width ?? 0) - (b?.width ?? 1))).toBeLessThan(1);
    // It doesn't block the app: Home is there under it.
    await expect(page.locator("[data-widget=profile-header]")).toBeVisible();
    // Never in champion select or a game.
    await setPhase(page, "champSelect");
    await expect(question).toHaveCount(0);
    await setPhase(page, "inGame");
    await expect(question).toHaveCount(0);
    await setPhase(page, "idle");
    await yes.click();
    await expect(question).toHaveCount(0);
    expect(await saved(page)).toBe(true);
    await expect(page.getByTestId("toast")).toContainText(t.mayhem.question.thanks);
    // Settings has the answer, to change it there.
    await page.getByRole("link", { name: t.nav.settings.label }).click();
    await expect(page.getByTestId("setting-share-mayhem")).toHaveAttribute("aria-checked", "true");
    expect(errors).toEqual([]);
  });

  test("not now keeps sharing off, and it isn't asked again", async ({ page, t }) => {
    await openApp(page, { scenario: "first-start" });
    await page.getByTestId("share-question").getByRole("button", { name: t.mayhem.question.no }).click();
    await expect(page.getByTestId("share-question")).toHaveCount(0);
    expect(await saved(page)).toBe(false);
    await page.getByRole("link", { name: t.nav.settings.label }).click();
    await expect(page.getByTestId("setting-share-mayhem")).toHaveAttribute("aria-checked", "false");
    await page.getByRole("link", { name: t.nav.home.label }).click();
    await expect(page.locator("[data-widget=profile-header]")).toBeVisible();
    await expect(page.getByTestId("share-question")).toHaveCount(0);
  });

  test("on Home only, and never once answered", async ({ page }) => {
    await openApp(page, { scenario: "first-start", view: "/tier-list" });
    await expect(page.getByTestId("share-question")).toHaveCount(0);
    await openApp(page);
    await expect(page.getByTestId("share-question")).toHaveCount(0);
  });
});
