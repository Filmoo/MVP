import type { Page } from "@playwright/test";
import type { ImportRequest } from "../src/data/generated/ImportRequest";
import type { ImportResult } from "../src/data/generated/ImportResult";
import type { Settings } from "../src/data/generated/Settings";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { champSelectDraft, champSelectLocked } from "../src/data/mock/draft-fixtures";
import { lockInImport, tradedWarning } from "../src/data/mock/import-fixtures";
import { autoImportSettings, defaultSettings } from "../src/data/mock/settings-fixtures";
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
/** The warning of the `import-warning` scenario: Shen's build, you're now on Malphite. */
const tradedText = (t: Messages) => t.imports.warning.text(`Shen ${t.roles.top}`, "Malphite");
/** Every part, as a sentence ("runes, item set and spells"). */
const allParts = (t: Messages) => listOf([t.imports.nouns.runes, t.imports.nouns.itemSet, t.imports.nouns.spells]);
/** A switch of Settings → Imports: "Auto import" and the part ("Auto import Rune page"). */
const autoSwitch = (page: Page, t: Messages, part: "runes" | "itemSet" | "spells") =>
  page.getByRole("switch", { name: `${t.settings.imports.auto} ${t.settings.imports[part].title}`, exact: true });

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
  // For this champion select: the core tries nothing once it has ended.
  expect(await requests(page)).toEqual([{ championId: 54, role: "top", queue: null, bracket: null, parts: ["runes"], champSelect: true }]);

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

test("draft: the automatic import shows a toast and marks the buttons", async ({ page, t }) => {
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

test("draft: every button is there whatever the switches; the automatic ones say so", async ({ page, t }) => {
  // Every switch off (the default): the three buttons, none marked.
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  for (const part of ["runes", "itemSet", "spells"] as const) {
    const button = page.getByRole("button", { name: t.imports.importPart(part) });
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveAttribute("data-hint", /./);
  }
  // Runes and spells switched on: still the same three buttons, those two marked.
  const some: Settings = { ...defaultSettings, autoImportRunes: true, autoImportSpells: true };
  await page.evaluate((next) => window.__SCOUT_MOCK__?.emit("settings", next), some);
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-hint", t.imports.auto);
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-hint", t.imports.auto);
  await expect(page.getByTestId("import-itemSet")).not.toHaveAttribute("data-hint", /./);
  await expect(bar(page).getByRole("button")).toHaveCount(3);
});

test("draft: after a trade, the warning says so and imports for the new champion in one click", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-warning" });
  const warning = page.getByTestId("import-warning");
  await expect(warning).toHaveText(`${tradedText(t)}${t.imports.warning.importFor("Malphite")}`);
  await expect(warning).toHaveAttribute("role", "alert");
  // The warning says what matters: no hint under the buttons meanwhile.
  await expect(status(page)).toHaveText("");
  expect(await requests(page), "never imported by itself").toEqual([]);

  const action = page.getByTestId("import-warning-action");
  await expect(action).toHaveText(t.imports.warning.importFor("Malphite"));
  await action.click();
  await expect(action, "busy while the core imports").toHaveAttribute("aria-busy", "true");
  await expect(warning, "gone once imported").toHaveCount(0);
  await expect(status(page)).toHaveText(t.imports.imported(allParts(t)));
  for (const part of ["runes", "itemSet", "spells"]) {
    await expect(page.getByTestId(`import-${part}`)).toHaveAttribute("data-tone", "done");
  }
  expect(await requests(page)).toEqual([
    { championId: 54, role: "top", queue: null, bracket: null, parts: ["runes", "itemSet", "spells"], champSelect: true },
  ]);
  await expect(page.getByTestId("toast"), "Draft shows it, no toast").toHaveCount(0);
  expect(errors).toEqual([]);
});

test("draft: the warning's one click works by keyboard", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "import-warning" });
  const action = page.getByRole("button", { name: t.imports.warning.importFor("Malphite") });
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("import-warning")).toHaveCount(0);
  expect((await requests(page)).length, "one import").toBe(1);
});

test("draft: a part imported by hand for the new champion leaves the others in the warning", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "import-warning" });
  await page.getByRole("button", { name: t.imports.importPart("runes") }).click();
  await expect(status(page)).toHaveText(t.imports.savedRunes("MVP · Malphite Top"));
  // The core took runes off the warning: its one click imports the item set and spells now.
  await expect(page.getByTestId("import-warning")).toBeVisible();
  await page.getByTestId("import-warning-action").click();
  await expect(page.getByTestId("import-warning")).toHaveCount(0);
  expect((await requests(page)).map((r) => r.parts)).toEqual([["runes"], ["itemSet", "spells"]]);
});

test("lock-in: elsewhere in MVP, the warning is a toast with its one click", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "import-warning" });
  await page.evaluate((warning) => window.__SCOUT_MOCK__?.emit("import-warning", warning), tradedWarning);
  const toast = page.getByTestId("toast").filter({ hasText: tradedText(t) });
  await expect(toast).toHaveAttribute("data-tone", "warn");
  await toast.getByTestId("toast-action").click();
  // How it went, like the automatic import; the warning's toast is gone.
  await expect(page.getByTestId("toast").filter({ hasText: t.imports.importedFor(allParts(t), "Malphite") })).toHaveAttribute(
    "data-tone",
    "success",
  );
  await expect(page.getByTestId("toast").filter({ hasText: tradedText(t) })).toHaveCount(0);
  expect(await requests(page)).toEqual([
    { championId: 54, role: "top", queue: null, bracket: null, parts: ["runes", "itemSet", "spells"], champSelect: true },
  ]);
  // Draft shows what was imported, and no warning.
  await page.getByRole("link", { name: t.nav.draft.label }).click();
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "done");
  await expect(page.getByTestId("import-warning")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("lock-in: the warning's toast goes when the warning does, and never shows on Draft", async ({ page, t }) => {
  await openApp(page, { scenario: "import-warning" });
  const warningToast = page.getByTestId("toast").filter({ hasText: tradedText(t) });
  await page.evaluate((warning) => window.__SCOUT_MOCK__?.emit("import-warning", warning), tradedWarning);
  await expect(warningToast).toBeVisible();
  // Imported from Draft, or champion select ended: the core says there's nothing to warn about.
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("import-warning", null));
  await expect(page.getByTestId("toast")).toHaveCount(0);

  // Up again, then Draft opens: its bar says it, not twice.
  await page.evaluate((warning) => window.__SCOUT_MOCK__?.emit("import-warning", warning), tradedWarning);
  await expect(warningToast).toBeVisible();
  await page.getByRole("link", { name: t.nav.draft.label }).click();
  await expect(page.getByTestId("import-warning")).toBeVisible();
  await expect(warningToast).toHaveCount(0);
  // A warning that comes while on Draft is the bar's only.
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("import-warning", null));
  await expect(page.getByTestId("import-warning")).toHaveCount(0);
  await page.evaluate((warning) => window.__SCOUT_MOCK__?.emit("import-warning", warning), tradedWarning);
  await expect(page.getByTestId("import-warning")).toBeVisible();
  await expect(page.getByTestId("toast")).toHaveCount(0);
});

// Seen on a real client: after a spells import that changed them, the client sent its session
// again and the bar went back to its idle hint.
test("draft: a session sent again after an import keeps its result", async ({ page, t }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  const spells = page.getByTestId("import-spells");
  await page.getByRole("button", { name: t.imports.importPart("spells") }).click();
  const set = t.imports.spellsSet(t.imports.spellsOn("Flash", "Teleport"));
  await expect(status(page)).toHaveText(set);
  // The same session again; then briefly without your champion and position; then without the
  // session at all (Draft's view closes and opens again).
  const blank = {
    ...champSelectDraft,
    myRole: null,
    allies: champSelectDraft.allies.map((s) => (s.isMe ? { ...s, championId: null, role: null } : s)),
  };
  for (const draft of [champSelectDraft, blank, champSelectDraft, null, champSelectDraft]) {
    await page.evaluate((next) => window.__SCOUT_MOCK__?.emit("draft", next), draft);
  }
  await expect(bar(page)).toContainText(who("Malphite", t.roles.top, t.imports.hovering));
  await expect(spells).toHaveAttribute("data-tone", "done");
  await expect(status(page)).toHaveText(set);
  // A real change (locked in: another champion) starts afresh.
  const shen = { ...champSelectLocked, allies: champSelectLocked.allies.map((s) => (s.isMe ? { ...s, championId: 98 } : s)) };
  await page.evaluate((next) => window.__SCOUT_MOCK__?.emit("draft", next), shen);
  await expect(spells).not.toHaveAttribute("data-tone", /./);
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
  // Another bracket on the page (its rank menu): that's the build imported.
  await page.getByTestId("rank-button").click();
  await page.getByTestId("bracket-switch").getByRole("radio", { name: t.brackets.diamondPlus }).click();
  await expect(champion).toContainText(t.imports.mostPlayedIn(420, t.brackets.diamondPlus));
  await champion.getByRole("button", { name: t.imports.importPart("runes") }).click();
  // MVP's page is named by the core (in the client), whatever the UI's language.
  await expect(status(page)).toHaveText(t.imports.savedRunes("MVP · Lux Mid"));
  // For any game, not tied to a champion select.
  expect(await requests(page)).toEqual([
    { championId: 99, role: "middle", queue: 420, bracket: "diamondPlus", parts: ["runes"], champSelect: false },
  ]);
  expect(errors).toEqual([]);
});

test("champion page: ARAM imports without a role; in champion select spells can go too", async ({ page, t }) => {
  await openApp(page, { view: "/champions?id=99&queue=450", scenario: "champ-select" });
  const champion = page.locator("[data-widget=champion-import]");
  await expect(champion).toContainText(`Lux · ${t.imports.mostPlayedIn(450, t.brackets.emeraldPlus)}`);
  await champion.getByRole("button", { name: t.imports.importPart("spells") }).click();
  await expect(champion.getByTestId("import-spells")).toHaveAttribute("data-tone", /done|warn/);
  expect(await requests(page)).toEqual([
    { championId: 99, role: null, queue: 450, bracket: "emeraldPlus", parts: ["spells"], champSelect: false },
  ]);
});

test("champion page: without the League client, every button says why and nothing is asked", async ({ page, t }) => {
  await openApp(page, { view: "/champions?id=99&role=middle", scenario: "not-running" });
  const champion = page.locator("[data-widget=champion-import]");
  for (const part of ["runes", "itemSet", "spells"] as const) {
    const button = champion.getByRole("button", { name: t.imports.importPart(part) });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("data-hint", t.imports.needsClient);
  }
  // The same reason for every button: said once without a hover.
  await expect(status(page)).toHaveText(`${t.imports.needsClient}.`);
  expect(await requests(page)).toEqual([]);
});

test("settings: one Auto import switch per part, off by default; the Flash key always applies", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  for (const part of ["runes", "itemSet", "spells"] as const) {
    await expect(autoSwitch(page, t, part), `${part} off by default`).toHaveAttribute("aria-checked", "false");
  }
  await autoSwitch(page, t, "runes").click();
  await expect(autoSwitch(page, t, "runes")).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await saved(page)).at(-1)?.autoImportRunes).toBe(true);
  // Only that part.
  const last = (await saved(page)).at(-1);
  expect([last?.autoImportRunes, last?.autoImportItemSet, last?.autoImportSpells]).toEqual([true, false, false]);

  // Flash as the game data names it (the dev data is English). Its key applies to the Spells
  // button whatever the switch: never greyed out.
  const flash = page.getByRole("group", { name: t.settings.imports.flashKey.title("Flash") });
  await expect(flash.getByRole("radio", { name: t.settings.imports.fromGames })).toBeChecked();
  // Exactly "D": French « D’après vos parties » starts with it too.
  await expect(flash.getByRole("radio", { name: "D", exact: true })).toBeEnabled();
  await flash.getByText("F", { exact: true }).click();
  await expect.poll(async () => (await saved(page)).at(-1)?.flashKey).toBe("f");
  expect(errors).toEqual([]);
});

test("settings: the Auto import switches by keyboard, and by their words", async ({ page, t }) => {
  await openApp(page, { view: "/settings" });
  const items = autoSwitch(page, t, "itemSet");
  await items.focus();
  await page.keyboard.press("Space");
  await expect(items).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await saved(page)).at(-1)?.autoImportItemSet).toBe(true);
  await page.keyboard.press("Enter");
  await expect(items).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await saved(page)).at(-1)?.autoImportItemSet).toBe(false);
  // "Auto import" next to the spells' switch flips it too.
  const card = page.locator("[data-widget=settings-imports]");
  await card.getByText(t.settings.imports.auto, { exact: true }).nth(2).click();
  await expect(autoSwitch(page, t, "spells")).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await saved(page)).at(-1)?.autoImportSpells).toBe(true);
});

test("settings: the switches show what was saved", async ({ page, t }) => {
  // Every part's switch on.
  await openApp(page, { view: "/settings", scenario: "import-lock-in" });
  expect([autoImportSettings.autoImportRunes, autoImportSettings.autoImportItemSet, autoImportSettings.autoImportSpells]).toEqual([
    true,
    true,
    true,
  ]);
  for (const part of ["runes", "itemSet", "spells"] as const) {
    await expect(autoSwitch(page, t, part)).toHaveAttribute("aria-checked", "true");
  }
  // The card says what the switch does and that the buttons always work.
  await expect(page.locator("[data-widget=settings-imports]")).toContainText(t.settings.imports.footnote);
});

test("settings: a failed import setting flips back and says why", async ({ page, t }) => {
  await openApp(page, { view: "/settings", scenario: "settings-save-error" });
  const runes = autoSwitch(page, t, "runes");
  await runes.click();
  const alert = page.locator("[data-widget=settings-imports] [role=alert]");
  await expect(alert).toContainText(t.settings.saveFailed("").trim());
  await expect(runes).toHaveAttribute("aria-checked", "false");
});
