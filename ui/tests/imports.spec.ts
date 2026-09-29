import type { Page } from "@playwright/test";
import type { ImportRequest } from "../src/data/generated/ImportRequest";
import type { ImportResult } from "../src/data/generated/ImportResult";
import type { Settings } from "../src/data/generated/Settings";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { champSelectDraft } from "../src/data/mock/draft-fixtures";
import { lockInImport } from "../src/data/mock/import-fixtures";
import type { Messages } from "../src/i18n";
import { listOf } from "../src/lib/format";
import { expect, openApp, SIZES, settle, test, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

/** Import requests sent to the core so far, oldest first. */
const requests = (page: Page) =>
  page.evaluate(
    () =>
      window.__SCOUT_MOCK__?.log.filter((c) => c.command === "import_build").map((c) => (c.args as { request: ImportRequest }).request) ??
      [],
  );

const saved = (page: Page) =>
  page.evaluate(
    () =>
      window.__SCOUT_MOCK__?.log.filter((c) => c.command === "update_settings").map((c) => (c.args as { settings: Settings }).settings) ??
      [],
  );

const bar = (page: Page) => page.locator("[data-widget=draft-imports]");
const status = (page: Page) => page.getByTestId("import-status");
/** The import bar's subtitle: `Malphite · Top · hovering`. */
const who = (champion: string, role: string, state: string) => `${champion} · ${role} · ${state}`;
/** The spells line with the Flash note, as the fixtures set them (Teleport on D, Flash kept on F). */
const flashKeptText = (t: Messages) =>
  `${t.imports.spellsSet(t.imports.spellsOn("Teleport", "Flash"))} ${t.imports.flash.kept("Flash", "F")}`;

test("draft: one click imports a part and says how it went", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  await expect(bar(page)).toContainText(who("Malphite", t.roles.top, t.imports.hovering));
  await expect(status(page)).toHaveText(t.imports.idle("Flash"));

  const runes = page.getByRole("button", { name: t.imports.importPart("runes") });
  await runes.click();
  await expect(runes, "busy while the core imports").toHaveAttribute("aria-busy", "true");
  await expect(runes).toHaveAttribute("data-tone", "done");
  await expect(status(page)).toHaveText(t.imports.savedRunes("MVP · Malphite Top"));
  expect(await requests(page)).toEqual([{ championId: 54, role: "top", queue: null, bracket: null, parts: ["runes"] }]);

  await page.getByRole("button", { name: t.imports.importPart("spells") }).click();
  await expect(status(page)).toHaveText(t.imports.spellsSet(t.imports.spellsOn("Flash", "Teleport")));
  await page.getByRole("button", { name: t.imports.importPart("itemSet") }).click();
  await expect(status(page)).toHaveText(t.imports.savedItemSet("MVP · Malphite Top"));
  for (const part of ["runes", "itemSet", "spells"]) {
    await expect(page.getByTestId(`import-${part}`)).toHaveAttribute("data-tone", "done");
  }
  expect(errors).toEqual([]);
});

test("draft: by keyboard, the focus stays on the button; a second press while busy waits", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  const runes = page.getByRole("button", { name: t.imports.importPart("runes") });
  await runes.focus();
  await page.keyboard.press("Enter");
  await expect(runes).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("Enter");
  await expect(runes).toHaveAttribute("data-tone", "done");
  await expect(runes).toBeFocused();
  expect((await requests(page)).length, "one import").toBe(1);
});

test("draft: failed imports say why, in words", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-failures" });
  await page.getByRole("button", { name: t.imports.importPart("runes") }).click();
  await expect(status(page)).toHaveText(t.imports.fail.noFreePage);
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "failed");

  await page.getByRole("button", { name: t.imports.importPart("itemSet") }).click();
  // The League client's own words, in the bar's sentence.
  await expect(status(page)).toHaveText(t.imports.fail.client("Item sets are unavailable right now (HTTP 503)"));

  await page.getByRole("button", { name: t.imports.importPart("spells") }).click();
  await expect(status(page)).toHaveText(t.imports.skip.tooLate(3));
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "skipped");
  expect(errors).toEqual([]);
});

test("draft: the spells import says when Flash stays on your key", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "import-flash" });
  await page.getByRole("button", { name: t.imports.importPart("spells") }).click();
  await expect(status(page)).toHaveText(flashKeptText(t));
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "warn");
});

test("draft: an import on lock-in shows a toast and marks the buttons", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-lock-in" });
  await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
  const toast = page.getByTestId("toast");
  const parts = listOf([t.imports.nouns.runes, t.imports.nouns.itemSet, t.imports.nouns.spells]);
  await expect(toast).toHaveText(`${t.imports.importedFor(parts, "Malphite")} ${t.imports.flash.kept("Flash", "F")}`);
  await expect(toast).toHaveAttribute("data-tone", "success");
  await expect(bar(page)).toContainText(who("Malphite", t.roles.top, t.imports.lockedIn));
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "done");
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "warn");
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-hint", t.imports.auto);
  expect(await requests(page), "the core imported by itself").toEqual([]);
  expect(errors).toEqual([]);
});

test("lock-in: Draft opened after the import still shows it, until champion select ends", async ({ page, t }) => {
  await openApp(page, { scenario: "import-lock-in" });
  await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
  await expect(page.getByTestId("toast")).toBeVisible();
  await page.getByRole("link", { name: t.nav.draft.label }).click();
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "done");
  await expect(status(page)).toHaveText(flashKeptText(t));
  // Champion select ends: the next one starts afresh.
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("client-status", { connection: "connected", phase: "inGame" }));
  await page.getByRole("link", { name: t.nav.home.label }).click();
  await page.getByRole("link", { name: t.nav.draft.label }).click();
  await expect(bar(page)).toContainText(who("Malphite", t.roles.top, t.imports.lockedIn));
  await expect(page.getByTestId("import-runes")).not.toHaveAttribute("data-tone", /./);
});

test("lock-in: a failed automatic import is reported, anywhere in the app", async ({ page, t }) => {
  await openApp(page);
  const failed: ImportResult = {
    championId: 103,
    role: "middle",
    queue: 420,
    automatic: true,
    parts: [
      { part: "runes", outcome: { kind: "failed", reason: { kind: "noFreePage" } } },
      { part: "itemSet", outcome: { kind: "saved", name: "MVP · Ahri Mid" } },
    ],
  };
  await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), failed);
  const toasts = page.getByTestId("toast");
  await expect(toasts).toHaveCount(2);
  await expect(toasts.filter({ hasText: t.imports.importedFor(t.imports.nouns.itemSet, "Ahri") })).toHaveAttribute("data-tone", "success");
  await expect(toasts.filter({ hasText: t.imports.failedFor("runes", "Ahri", t.imports.fail.noFreePage) })).toHaveAttribute(
    "data-tone",
    "error",
  );
});

test("draft: without stats the buttons wait and say why", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "draft-no-stats" });
  for (const part of ["runes", "itemSet", "spells"] as const) {
    await expect(page.getByRole("button", { name: t.imports.importPart(part) })).toBeDisabled();
  }
  await expect(status(page)).toHaveText(t.imports.notYetStatus);
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-hint", t.imports.notYet);
});

test("draft: no champion yet, nothing to import", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  const none = {
    ...champSelectDraft,
    allies: champSelectDraft.allies.map((s) => (s.isMe ? { ...s, championId: null, hovering: false } : s)),
  };
  await page.evaluate((draft) => window.__SCOUT_MOCK__?.emit("draft", draft), none);
  await expect(bar(page)).toContainText(t.imports.pick);
  await expect(page.getByRole("button", { name: t.imports.importPart("runes") })).toBeDisabled();
});

test("draft: imports turned off leave no bar", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "imports-off" });
  await expect(page.locator("[data-widget=draft-teams]")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("draft: a part turned off has no button", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  await expect(page.getByRole("button", { name: t.imports.importPart("spells") })).toBeVisible();
  const settings: Settings = {
    autoAccept: false,
    autoAcceptDelaySeconds: 2,
    bringToFrontOnChampSelect: true,
    autoSwitchView: true,
    launchAtStartup: false,
    closeToTray: true,
    effects: "auto",
    language: "auto",
    importRunes: "oneClick",
    importItemSet: "oneClick",
    importSpells: "off",
    flashKey: "auto",
    statsBracket: "emeraldPlus",
    crashReports: false,
  };
  await page.evaluate((next) => window.__SCOUT_MOCK__?.emit("settings", next), settings);
  await expect(page.getByRole("button", { name: t.imports.importPart("spells") })).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.imports.importPart("runes") })).toBeVisible();
});

test("draft: another champion starts afresh", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  await page.getByRole("button", { name: t.imports.importPart("runes") }).click();
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "done");
  const shen = { ...champSelectDraft, allies: champSelectDraft.allies.map((s) => (s.isMe ? { ...s, championId: 98 } : s)) };
  await page.evaluate((draft) => window.__SCOUT_MOCK__?.emit("draft", draft), shen);
  await expect(bar(page)).toContainText(who("Shen", t.roles.top, t.imports.hovering));
  await expect(page.getByTestId("import-runes")).not.toHaveAttribute("data-tone", /./);
  await expect(status(page)).toHaveText(t.imports.idle("Flash"));
});

test("draft: the import bar lays out in every state at every size", async ({ page, t }) => {
  const errors = trackErrors(page);
  const [first] = SIZES;
  await openApp(page, { view: "/draft", scenario: "import-failures", width: first.width, height: first.height });
  // Failed, failed and skipped buttons, then the longest message of all.
  for (const part of ["itemSet", "spells", "runes"] as const) {
    const name = t.imports.importPart(part);
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("button", { name })).not.toHaveAttribute("aria-busy", "true");
  }
  await expect(status(page)).toHaveText(t.imports.fail.noFreePage);
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await settle(page);
    expect(await page.evaluate(auditLayout), size.name).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("champion page: imports the build shown, spells wait for champion select", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/champions?id=99&role=middle" });
  const champion = page.locator("[data-widget=champion-import]");
  await expect(champion).toContainText(who("Lux", t.roles.middle, t.imports.mostPlayedIn(420, t.brackets.emeraldPlus)));
  const spells = champion.getByRole("button", { name: t.imports.importPart("spells") });
  await expect(spells, "outside champion select").toBeDisabled();
  await expect(spells).toHaveAttribute("data-hint", t.imports.spellsInChampSelect);
  // Another bracket on the page: that's the build imported.
  await page.getByTestId("bracket-switch").getByRole("radio", { name: t.brackets.diamondPlus }).click();
  await expect(champion).toContainText(t.imports.mostPlayedIn(420, t.brackets.diamondPlus));
  await champion.getByRole("button", { name: t.imports.importPart("runes") }).click();
  // MVP's page is named by the core (in the client), whatever the UI's language.
  await expect(status(page)).toHaveText(t.imports.savedRunes("MVP · Lux Mid"));
  expect(await requests(page)).toEqual([{ championId: 99, role: "middle", queue: 420, bracket: "diamondPlus", parts: ["runes"] }]);
  expect(errors).toEqual([]);
});

test("champion page: ARAM imports without a role; in champion select spells can go too", async ({ page, t }) => {
  await openApp(page, { view: "/champions?id=99&queue=450", scenario: "champ-select" });
  const champion = page.locator("[data-widget=champion-import]");
  await expect(champion).toContainText(`Lux · ${t.imports.mostPlayedIn(450, t.brackets.emeraldPlus)}`);
  await champion.getByRole("button", { name: t.imports.importPart("spells") }).click();
  await expect(champion.getByTestId("import-spells")).toHaveAttribute("data-tone", /done|warn/);
  expect(await requests(page)).toEqual([{ championId: 99, role: null, queue: 450, bracket: "emeraldPlus", parts: ["spells"] }]);
});

test("champion page: imports turned off leave no bar", async ({ page }) => {
  await openApp(page, { view: "/champions?id=103", scenario: "imports-off" });
  await expect(page.locator("[data-widget=champion-runes]")).toBeVisible();
  await expect(page.locator("[data-widget=champion-import]")).toHaveCount(0);
});

test("settings: import modes save, the Flash key follows the spells", async ({ page, t }) => {
  const errors = trackErrors(page);
  const modes = t.settings.imports.modes;
  await openApp(page, { view: "/settings" });
  const runes = page.getByRole("group", { name: t.settings.imports.runes.title });
  await expect(runes.getByRole("radio", { name: modes.oneClick }), "one click by default").toBeChecked();
  await runes.getByText(modes.onLockIn).click();
  await expect(runes.getByRole("radio", { name: modes.onLockIn })).toBeChecked();
  await expect.poll(async () => (await saved(page)).at(-1)?.importRunes).toBe("onLockIn");

  // Flash as the game data names it (the dev data is English).
  const flash = page.getByRole("group", { name: t.settings.imports.flashKey.title("Flash") });
  await expect(flash.getByRole("radio", { name: t.settings.imports.fromGames })).toBeChecked();
  await flash.getByText("F", { exact: true }).click();
  await expect.poll(async () => (await saved(page)).at(-1)?.flashKey).toBe("f");

  // Spells off: the Flash key has nothing to do.
  await page.getByRole("group", { name: t.settings.imports.spells.title }).getByText(modes.off).click();
  await expect.poll(async () => (await saved(page)).at(-1)?.importSpells).toBe("off");
  // Exactly "D": French « D’après vos parties » starts with it too.
  await expect(flash.getByRole("radio", { name: "D", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("settings: import modes by keyboard", async ({ page, t }) => {
  const modes = t.settings.imports.modes;
  await openApp(page, { view: "/settings" });
  const items = page.getByRole("group", { name: t.settings.imports.itemSet.title });
  await items.getByRole("radio", { name: modes.oneClick }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(items.getByRole("radio", { name: modes.onLockIn })).toBeChecked();
  await expect.poll(async () => (await saved(page)).at(-1)?.importItemSet).toBe("onLockIn");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(items.getByRole("radio", { name: modes.off })).toBeChecked();
  await expect.poll(async () => (await saved(page)).at(-1)?.importItemSet).toBe("off");
});

test("settings: a failed import setting flips back and says why", async ({ page, t }) => {
  await openApp(page, { view: "/settings", scenario: "settings-save-error" });
  const runes = page.getByRole("group", { name: t.settings.imports.runes.title });
  await runes.getByText(t.settings.imports.modes.off).click();
  const alert = page.locator("[data-widget=settings-imports] [role=alert]");
  await expect(alert).toContainText(t.settings.saveFailed("").trim());
  await expect(runes.getByRole("radio", { name: t.settings.imports.modes.oneClick })).toBeChecked();
});
