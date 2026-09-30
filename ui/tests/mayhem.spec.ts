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
    await expect(page.getByTestId("mayhem-sources")).toContainText(t.mayhem.shared(1_284));
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
    await expect(page.getByTestId("mayhem-no-shared")).toContainText(t.mayhem.noShared.title);
    await page.getByTestId("mayhem-no-shared").getByRole("link", { name: t.mayhem.noShared.link }).click();
    await expect(page).toHaveURL(/#\/settings$/);
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
