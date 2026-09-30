import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { champSelectDraft } from "../src/data/mock/draft-fixtures";
import { liveAsking, liveBots, liveFiltered, liveGame, liveHidden, liveScouting } from "../src/data/mock/live-fixtures";
import { expect, openApp, SIZES, settle, test, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

const cards = (page: Page) => page.getByTestId("live-card");

const cardBoxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-testid=live-card]")].map((el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }),
  );

// Live screens don't scroll: all ten players fit the window from 1280×720 (1080p at 150 %) up.
for (const [width, height] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`all ten cards fit ${width}×${height} without scrolling`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page, { view: "/live", scenario: "live", width, height });
    await expect(cards(page)).toHaveCount(10);
    const main = await page.locator("main").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(main.scroll, "main doesn't scroll").toBeLessThanOrEqual(main.client);
    for (const box of await cardBoxes(page)) expect((box[1] ?? 0) + (box[3] ?? 0), "card fully visible").toBeLessThanOrEqual(height);
    expect(errors).toEqual([]);
  });
}

test("cards: identity, rank, experience on the champion, form, positive tags; hidden players stay hidden", async ({ page, t }) => {
  await openApp(page, { view: "/live", scenario: "live" });
  const me = cards(page).filter({ hasText: "Fillmo" });
  await expect(me).toContainText(t.common.you);
  await expect(me).toContainText(`${t.tiers.emerald} II`);
  await expect(me).toContainText(t.common.lp(67));
  await expect(me).toContainText(t.common.games(6));
  const form = liveGame.allies.find((p) => p.isMe)?.card?.recentResults.slice(0, 10) ?? [];
  await expect(me.getByRole("list", { name: t.common.lastResults(form) })).toBeVisible();
  const quiet = cards(page).filter({ hasText: "Quiet Storm" });
  await expect(quiet).toContainText(t.live.otp("Ahri"));
  await expect(quiet).toContainText(t.live.veteran);
  const hidden = cards(page).and(page.locator("[data-card=hidden]"));
  await expect(hidden).toHaveCount(1);
  await expect(hidden).toContainText(t.live.hidden);
  await expect(cards(page).and(page.locator("[data-card=unavailable]"))).toContainText(t.live.noRankedData);
  // Spells for everyone, hidden players included (spells aren't identity).
  await expect(hidden.getByRole("img", { name: new RegExp(`Smite|${t.common.spellN(11)}`) })).toHaveCount(1);
  // Main roles have their own line: no duplicate chip.
  const hook = cards(page).filter({ hasText: "Hook City" });
  const main = t.live.mains(t.roles.support);
  await expect(hook).toContainText(main);
  await expect(hook.locator("li", { hasText: main })).toHaveCount(0);
  await expect(hook.locator("li", { hasText: t.live.streak(4) })).toHaveCount(1);
});

test("cards land in place: nothing moves when scouting finishes", async ({ page, t }) => {
  const errors = trackErrors(page);
  // The core pushes the game while players are looked up, then again with the cards (as in the
  // live-scouting scenario, without its timer: a loaded machine could miss the first state).
  await openApp(page, { view: "/live", width: 1280, height: 720 });
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveScouting);
  await expect(cards(page)).toHaveCount(10);
  await expect(page.getByTestId("scouting-status")).toHaveText(t.live.lookingUp);
  await expect(cards(page).and(page.locator("[data-card=pending]"))).toHaveCount(9);
  const before = await cardBoxes(page);
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveGame);
  await expect(cards(page).and(page.locator("[data-card=scouted]"))).toHaveCount(8);
  await expect(page.getByTestId("scouting-status")).toHaveCount(0);
  expect(await cardBoxes(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("names fill in as they arrive, then the cards, and nothing moves", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/live", width: 1280, height: 720 });
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  // The game started: only you are named, Riot's live game is asked for the others.
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveAsking);
  await expect(cards(page)).toHaveCount(10);
  await expect(page.getByTestId("scouting-status")).toHaveText(t.live.lookingUp);
  await expect(page.locator("[data-name=pending]")).toHaveCount(9);
  await expect(cards(page).and(page.locator("[data-card=pending]"))).toHaveCount(10);
  await expect(page.getByText(t.live.unknown)).toHaveCount(0);
  await expect(page.getByText(t.live.hidden)).toHaveCount(0);
  await expect(cards(page).filter({ hasText: "Fillmo" })).toContainText(t.common.you);
  const before = await cardBoxes(page);
  // The names land (the streamer-mode player stays hidden), then the cards.
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveScouting);
  await expect(page.locator("[data-name=pending]")).toHaveCount(0);
  await expect(cards(page).filter({ hasText: "Blade Dancer" })).toContainText("#IRE");
  await expect(cards(page).and(page.locator("[data-card=hidden]"))).toContainText(t.live.hidden);
  await expect(cards(page).and(page.locator("[data-card=pending]"))).toHaveCount(9);
  expect(await cardBoxes(page)).toEqual(before);
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveGame);
  await expect(cards(page).and(page.locator("[data-card=scouted]"))).toHaveCount(8);
  await expect(page.getByTestId("scouting-status")).toHaveCount(0);
  expect(await cardBoxes(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("a filtered queue says so plainly, then the game names the players", async ({ page, t }) => {
  // As the core pushes it (the live-filtered scenario, which waits for good).
  await openApp(page, { view: "/live" });
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveFiltered);
  const status = page.getByTestId("scouting-status");
  await expect(status).toHaveText(t.live.names.filtered(t.queues[440]));
  await expect(status).toHaveAttribute("data-state", "waiting");
  // Neutral, no alarm and nothing to retry: the names will come.
  await expect(status).not.toHaveAttribute("role", "alert");
  await expect(status.getByRole("button")).toHaveCount(0);
  await expect(page.locator("[data-name=pending]")).toHaveCount(9);
  await expect(page.getByText(t.live.unknown)).toHaveCount(0);
  // After the loading screen the game lists everyone: names, then the cards are looked up.
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), { ...liveScouting, queueId: liveFiltered.queueId });
  await expect(status).toHaveText(t.live.lookingUp);
  await expect(page.locator("[data-name=pending]")).toHaveCount(0);
  await expect(cards(page).filter({ hasText: "Quiet Storm" })).toHaveCount(1);
  // Other games Riot doesn't list wait the same way, without blaming the queue.
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), {
    ...liveFiltered,
    names: { state: "waiting" as const, filtered: false },
  });
  await expect(status).toHaveText(t.live.names.waiting);
});

test("bots show as bots: no card, never an unknown player", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/live", scenario: "live-bots" });
  const bots = cards(page).and(page.locator("[data-card=bot]"));
  await expect(bots).toHaveCount(liveBots.enemies.length);
  for (const bot of await bots.all()) {
    await expect(bot).toContainText(t.live.bot);
    await expect(bot).not.toContainText(t.live.noRankedData);
    await expect(bot.locator("[data-state=loading]")).toHaveCount(0);
  }
  await expect(page.getByText(t.live.unknown)).toHaveCount(0);
  await expect(cards(page).and(page.locator("[data-card=scouted]"))).toHaveCount(5);
  await settle(page);
  expect(await page.evaluate(auditLayout)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a visible player's Riot ID opens their player page; hidden players and bots have no link", async ({ page }) => {
  await openApp(page, { view: "/live", scenario: "live-bots" });
  // Five named allies (you too), five bots without a link.
  await expect(page.getByTestId("live-player-link")).toHaveCount(5);
  await expect(cards(page).and(page.locator("[data-card=bot]")).getByRole("link")).toHaveCount(0);
  const quiet = page.getByRole("link", { name: "Quiet Storm#0412" });
  await expect(quiet).toHaveAttribute("href", "#/player/euw1/Quiet%20Storm/0412");
  await quiet.click();
  await expect(page).toHaveURL(/#\/player\/euw1\/Quiet%20Storm\/0412$/);
  await expect(page.getByRole("heading", { level: 1, name: "Quiet Storm" })).toBeVisible();

  await openApp(page, { view: "/live", scenario: "live-hidden" });
  await expect(cards(page).and(page.locator("[data-card=hidden]")).getByRole("link")).toHaveCount(0);
  await expect(page.getByTestId("live-player-link")).toHaveCount(6);
  // Keyboard: the link takes the focus like any other.
  await page.getByTestId("live-player-link").first().focus();
  await expect(page.getByTestId("live-player-link").first()).toBeFocused();
});

test("waiting for the game to name players: placeholders hold still, and nothing moves when names land", async ({ page, t }) => {
  // 960 px: half a 1080p screen, where a long head line used to wrap.
  await openApp(page, { view: "/live", width: 960, height: 1000 });
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveFiltered);
  await expect(page.locator("[data-name=pending]")).toHaveCount(9);
  // A minute or two until the loading screen ends: nothing pulses meanwhile.
  await expect(page.locator("[data-state=loading]")).toHaveCount(0);
  await expect(page.locator("[data-card=pending] [data-state=waiting]").first()).toBeVisible();
  const before = await cardBoxes(page);
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), { ...liveScouting, queueId: liveFiltered.queueId });
  await expect(page.locator("[data-name=pending]")).toHaveCount(0);
  // The cards are asked for now: their placeholders pulse.
  await expect(page.locator("[data-card=pending] [data-state=loading]").first()).toBeVisible();
  expect(await cardBoxes(page)).toEqual(before);
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), { ...liveGame, queueId: liveFiltered.queueId });
  await expect(cards(page).and(page.locator("[data-card=scouted]"))).toHaveCount(8);
  expect(await cardBoxes(page)).toEqual(before);
});

test("streamer-mode players stay hidden: no name, no card", async ({ page, t }) => {
  await openApp(page, { view: "/live", scenario: "live-hidden" });
  const hidden = cards(page).and(page.locator("[data-card=hidden]"));
  await expect(hidden).toHaveCount(liveHidden.allies.filter((p) => p.hidden).length + liveHidden.enemies.filter((p) => p.hidden).length);
  for (const card of await hidden.all()) {
    await expect(card).toContainText(t.live.hidden);
    await expect(card).toContainText(t.live.streamer);
    await expect(card.locator("[data-state=loading]")).toHaveCount(0);
  }
  // Their names were on the fixture before they were hidden: none shows.
  for (const name of ["Lane Kingdom", "Blade Dancer", "Hook City"]) await expect(page.getByText(name)).toHaveCount(0);
});

test("waiting cards lay out at every window size", async ({ page, t }) => {
  // The core says the game is loading and the cards never come: the waiting state holds still.
  await openApp(page, { view: "/live" });
  // The view listens once it shows its empty state (lazily loaded, with its words).
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveScouting);
  await expect(cards(page).and(page.locator("[data-card=pending]"))).toHaveCount(9);
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(auditLayout), size.name).toEqual([]);
  }
});

test("names on their way lay out at every window size, the longest note too", async ({ page, t }) => {
  await openApp(page, { view: "/live" });
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  // Ranked Flex: the pending names and the longest status line (Riot doesn't share the queue).
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveFiltered);
  await expect(page.locator("[data-name=pending]")).toHaveCount(9);
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(auditLayout), size.name).toEqual([]);
  }
});

test("scouting failure: the game still shows, Try again asks the core", async ({ page, t }) => {
  await openApp(page, { view: "/live", scenario: "live-failed" });
  const status = page.getByTestId("scouting-status");
  await expect(status).toContainText(t.live.scouting.network);
  await expect(cards(page)).toHaveCount(10);
  await expect(cards(page).and(page.locator("[data-card=unavailable]")).first()).toContainText(t.live.cardUnavailable);
  await status.getByRole("button", { name: t.common.tryAgain }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "retry_scouting").length)).toBe(1);
});

test("my build: the build of my champion and role, for this game's mode", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/live", scenario: "live" });
  await expect(cards(page)).toHaveCount(10);
  await page.getByTestId("live-tabs").getByRole("radio", { name: t.live.tabs.build }).click();
  const build = page.getByTestId("my-build");
  const me = liveGame.allies.find((p) => p.isMe);
  await expect(build).toContainText(t.imports.mostPlayedIn(420, t.brackets.emeraldPlus));
  await expect(page.locator("[data-widget=champion-runes]")).toBeVisible();
  await expect(page.locator("[data-widget=champion-matchups]")).toBeVisible();
  const asked = await page.evaluate(() => window.__SCOUT_MOCK__?.log.filter((c) => c.command === "champion_stats").map((c) => c.args));
  expect(asked).toEqual([{ championId: me?.championId, queue: 420, bracket: "emeraldPlus" }]);
  await settle(page);
  expect(await page.evaluate(auditLayout)).toEqual([]);
  // Back to the players, as they were.
  await page.getByTestId("live-tabs").getByRole("radio", { name: t.live.tabs.players }).click();
  await expect(cards(page)).toHaveCount(10);
  expect(errors).toEqual([]);
});

test("my build: a link opens it; modes without builds say so", async ({ page, t }) => {
  await openApp(page, { view: "/live?tab=build", scenario: "live" });
  await expect(page.locator("[data-widget=champion-runes]")).toBeVisible();
  // A custom game on the Rift (the client's queue 3100): the core says Rift builds fit.
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", { ...game, queueId: 3100, statsQueue: 420 }), liveGame);
  await expect(page.getByTestId("my-build")).toContainText(t.imports.mostPlayedIn(420, t.brackets.emeraldPlus));
  await expect(page.locator("[data-widget=champion-runes]")).toBeVisible();
  // Arena: no builds.
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", { ...game, queueId: 1700, statsQueue: null }), liveGame);
  await expect(page.getByTestId("my-build")).toContainText(t.live.build.noMode.title);
});

test("a banner never makes the live screens scroll: their panels take what's left", async ({ page, t }) => {
  const errors = trackErrors(page);
  const scrolls = () => page.locator("main").evaluate((el) => el.scrollHeight - el.clientHeight);
  await openApp(page, { view: "/live", scenario: "banners", width: 1280, height: 800 });
  // The view listens once it shows its empty state.
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveGame);
  await expect(cards(page)).toHaveCount(10);
  await expect(page.getByTestId("banner").first()).toBeVisible();
  await settle(page);
  expect(await scrolls(), "live").toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: t.nav.draft.label }).click();
  // Draft's own heading: right after the click, Live (and its heading) is still up until the
  // hash change lands, and the draft pushed then would reach nobody.
  await expect(page.getByRole("heading", { level: 1, name: t.nav.draft.label })).toBeVisible();
  await page.evaluate((draft) => window.__SCOUT_MOCK__?.emit("draft", draft), champSelectDraft);
  await expect(page.locator("[data-widget=draft-suggestions]")).toBeVisible();
  await settle(page);
  expect(await scrolls(), "draft").toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the core pushes the game in and out", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/live" });
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  await page.evaluate((game) => window.__SCOUT_MOCK__?.emit("live", game), liveGame);
  await expect(cards(page)).toHaveCount(10);
  await settle(page);
  expect(await page.evaluate(auditLayout)).toEqual([]);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("live", null));
  await expect(page.getByText(t.live.idle.title)).toBeVisible();
  expect(errors).toEqual([]);
});

test("the core can't read the game: error with retry", async ({ page, t }) => {
  await openApp(page, { view: "/live", scenario: "live-error" });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(t.live.readFailed);
  await alert.getByRole("button", { name: t.common.tryAgain }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "live_game").length)).toBe(2);
});
