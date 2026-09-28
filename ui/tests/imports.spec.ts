import { expect, type Page, test } from "@playwright/test";
import type { ImportRequest } from "../src/data/generated/ImportRequest";
import type { ImportResult } from "../src/data/generated/ImportResult";
import type { Settings } from "../src/data/generated/Settings";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { champSelectDraft } from "../src/data/mock/draft-fixtures";
import { lockInImport } from "../src/data/mock/import-fixtures";
import { openApp, SIZES, settle, trackErrors } from "./app";
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

test("draft: one click imports a part and says how it went", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  await expect(bar(page)).toContainText("Malphite · Top · hovering");
  await expect(status(page)).toHaveText("Your own rune pages and item sets are never changed, and Flash stays on your key.");

  const runes = page.getByRole("button", { name: "Import runes" });
  await runes.click();
  await expect(runes, "busy while the core imports").toHaveAttribute("aria-busy", "true");
  await expect(runes).toHaveAttribute("data-tone", "done");
  await expect(status(page)).toHaveText("“MVP · Malphite Top” is your current rune page.");
  expect(await requests(page)).toEqual([{ championId: 54, role: "top", queue: null, bracket: null, parts: ["runes"] }]);

  await page.getByRole("button", { name: "Import spells" }).click();
  await expect(status(page)).toHaveText("Spells set: Flash on D, Teleport on F.");
  await page.getByRole("button", { name: "Import item set" }).click();
  await expect(status(page)).toHaveText("Item set “MVP · Malphite Top” is in the shop.");
  for (const part of ["runes", "itemSet", "spells"]) {
    await expect(page.getByTestId(`import-${part}`)).toHaveAttribute("data-tone", "done");
  }
  expect(errors).toEqual([]);
});

test("draft: by keyboard, the focus stays on the button; a second press while busy waits", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  const runes = page.getByRole("button", { name: "Import runes" });
  await runes.focus();
  await page.keyboard.press("Enter");
  await expect(runes).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("Enter");
  await expect(runes).toHaveAttribute("data-tone", "done");
  await expect(runes).toBeFocused();
  expect((await requests(page)).length, "one import").toBe(1);
});

test("draft: failed imports say why, in words", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-failures" });
  await page.getByRole("button", { name: "Import runes" }).click();
  await expect(status(page)).toHaveText("No free rune page: delete one, or rename one to “MVP” to let MVP use it.");
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "failed");

  await page.getByRole("button", { name: "Import item set" }).click();
  await expect(status(page)).toHaveText("The League client refused: Item sets are unavailable right now (HTTP 503)");

  await page.getByRole("button", { name: "Import spells" }).click();
  await expect(status(page)).toHaveText("Spells not changed: only 3 s left in champion select.");
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "skipped");
  expect(errors).toEqual([]);
});

test("draft: the spells import says when Flash stays on your key", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "import-flash" });
  await page.getByRole("button", { name: "Import spells" }).click();
  await expect(status(page)).toHaveText("Spells set: Teleport on D, Flash on F. Flash stays on F, your usual key.");
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "warn");
});

test("draft: an import on lock-in shows a toast and marks the buttons", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/draft", scenario: "import-lock-in" });
  await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
  const toast = page.getByTestId("toast");
  await expect(toast).toHaveText("Imported runes, item set and spells for Malphite. Flash stays on F, your usual key.");
  await expect(toast).toHaveAttribute("data-tone", "success");
  await expect(bar(page)).toContainText("Malphite · Top · locked in");
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "done");
  await expect(page.getByTestId("import-spells")).toHaveAttribute("data-tone", "warn");
  await expect(page.getByTestId("import-runes")).toHaveAttribute("title", "Also imported by itself when you lock in");
  expect(await requests(page), "the core imported by itself").toEqual([]);
  expect(errors).toEqual([]);
});

test("lock-in: Draft opened after the import still shows it, until champion select ends", async ({ page }) => {
  await openApp(page, { scenario: "import-lock-in" });
  await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
  await expect(page.getByTestId("toast")).toBeVisible();
  await page.getByRole("link", { name: "Draft" }).click();
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "done");
  await expect(status(page)).toHaveText("Spells set: Teleport on D, Flash on F. Flash stays on F, your usual key.");
  // Champion select ends: the next one starts afresh.
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("client-status", { connection: "connected", phase: "inGame" }));
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "Draft" }).click();
  await expect(bar(page)).toContainText("Malphite · Top · locked in");
  await expect(page.getByTestId("import-runes")).not.toHaveAttribute("data-tone", /./);
});

test("lock-in: a failed automatic import is reported, anywhere in the app", async ({ page }) => {
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
  await expect(toasts.filter({ hasText: "Imported item set for Ahri." })).toHaveAttribute("data-tone", "success");
  await expect(toasts.filter({ hasText: "Couldn't import runes for Ahri: No free rune page" })).toHaveAttribute("data-tone", "error");
});

test("draft: without stats the buttons wait and say why", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "draft-no-stats" });
  for (const name of ["Import runes", "Import item set", "Import spells"]) {
    await expect(page.getByRole("button", { name })).toBeDisabled();
  }
  await expect(status(page)).toHaveText("Builds come with the champion stats, which aren't available yet.");
  await expect(page.getByTestId("import-runes")).toHaveAttribute("title", "Builds come with the champion stats, not available yet");
});

test("draft: no champion yet, nothing to import", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  const none = {
    ...champSelectDraft,
    allies: champSelectDraft.allies.map((s) => (s.isMe ? { ...s, championId: null, hovering: false } : s)),
  };
  await page.evaluate((draft) => window.__SCOUT_MOCK__?.emit("draft", draft), none);
  await expect(bar(page)).toContainText("Hover or lock in a champion");
  await expect(page.getByRole("button", { name: "Import runes" })).toBeDisabled();
});

test("draft: imports turned off leave no bar", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "imports-off" });
  await expect(page.locator("[data-widget=draft-teams]")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("draft: a part turned off has no button", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  await expect(page.getByRole("button", { name: "Import spells" })).toBeVisible();
  const settings: Settings = {
    autoAccept: false,
    autoAcceptDelaySeconds: 2,
    bringToFrontOnChampSelect: true,
    autoSwitchView: true,
    launchAtStartup: false,
    closeToTray: true,
    effects: "auto",
    importRunes: "oneClick",
    importItemSet: "oneClick",
    importSpells: "off",
    flashKey: "auto",
    crashReports: false,
  };
  await page.evaluate((next) => window.__SCOUT_MOCK__?.emit("settings", next), settings);
  await expect(page.getByRole("button", { name: "Import spells" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import runes" })).toBeVisible();
});

test("draft: another champion starts afresh", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  await page.getByRole("button", { name: "Import runes" }).click();
  await expect(page.getByTestId("import-runes")).toHaveAttribute("data-tone", "done");
  const shen = { ...champSelectDraft, allies: champSelectDraft.allies.map((s) => (s.isMe ? { ...s, championId: 98 } : s)) };
  await page.evaluate((draft) => window.__SCOUT_MOCK__?.emit("draft", draft), shen);
  await expect(bar(page)).toContainText("Shen · Top · hovering");
  await expect(page.getByTestId("import-runes")).not.toHaveAttribute("data-tone", /./);
  await expect(status(page)).toHaveText("Your own rune pages and item sets are never changed, and Flash stays on your key.");
});

test("draft: the import bar lays out in every state at every size", async ({ page }) => {
  const errors = trackErrors(page);
  const [first] = SIZES;
  await openApp(page, { view: "/draft", scenario: "import-failures", width: first.width, height: first.height });
  // Failed, failed and skipped buttons, then the longest message of all.
  for (const name of ["Import item set", "Import spells", "Import runes"]) {
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("button", { name })).not.toHaveAttribute("aria-busy", "true");
  }
  await expect(status(page)).toContainText("No free rune page");
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await settle(page);
    expect(await page.evaluate(auditLayout), size.name).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("champion page: imports the build shown, spells wait for champion select", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/champions?id=99&role=middle" });
  const champion = page.locator("[data-widget=champion-import]");
  await expect(champion).toContainText("Lux · Mid · most played in Ranked Solo · Emerald+");
  const spells = champion.getByRole("button", { name: "Import spells" });
  await expect(spells, "outside champion select").toBeDisabled();
  await expect(spells).toHaveAttribute("title", "Spells can only change during champion select");
  // Another bracket on the page: that's the build imported.
  await page.getByTestId("bracket-switch").getByRole("radio", { name: "Diamond+" }).click();
  await expect(champion).toContainText("most played in Ranked Solo · Diamond+");
  await champion.getByRole("button", { name: "Import runes" }).click();
  await expect(status(page)).toHaveText("“MVP · Lux Mid” is your current rune page.");
  expect(await requests(page)).toEqual([{ championId: 99, role: "middle", queue: 420, bracket: "diamondPlus", parts: ["runes"] }]);
  expect(errors).toEqual([]);
});

test("champion page: ARAM imports without a role; in champion select spells can go too", async ({ page }) => {
  await openApp(page, { view: "/champions?id=99&queue=450", scenario: "champ-select" });
  const champion = page.locator("[data-widget=champion-import]");
  await expect(champion).toContainText("Lux · most played in ARAM · Emerald+");
  await champion.getByRole("button", { name: "Import spells" }).click();
  await expect(champion.getByTestId("import-spells")).toHaveAttribute("data-tone", /done|warn/);
  expect(await requests(page)).toEqual([{ championId: 99, role: null, queue: 450, bracket: "emeraldPlus", parts: ["spells"] }]);
});

test("champion page: imports turned off leave no bar", async ({ page }) => {
  await openApp(page, { view: "/champions?id=103", scenario: "imports-off" });
  await expect(page.locator("[data-widget=champion-runes]")).toBeVisible();
  await expect(page.locator("[data-widget=champion-import]")).toHaveCount(0);
});

test("settings: import modes save, the Flash key follows the spells", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  const runes = page.getByRole("group", { name: "Rune page" });
  await expect(runes.getByRole("radio", { name: "One click" }), "one click by default").toBeChecked();
  await runes.getByText("On lock-in").click();
  await expect(runes.getByRole("radio", { name: "On lock-in" })).toBeChecked();
  await expect.poll(async () => (await saved(page)).at(-1)?.importRunes).toBe("onLockIn");

  const flash = page.getByRole("group", { name: "Flash key" });
  await expect(flash.getByRole("radio", { name: "From your games" })).toBeChecked();
  await flash.getByText("F", { exact: true }).click();
  await expect.poll(async () => (await saved(page)).at(-1)?.flashKey).toBe("f");

  // Spells off: the Flash key has nothing to do.
  await page.getByRole("group", { name: "Summoner spells" }).getByText("Off").click();
  await expect.poll(async () => (await saved(page)).at(-1)?.importSpells).toBe("off");
  await expect(flash.getByRole("radio", { name: "D" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("settings: import modes by keyboard", async ({ page }) => {
  await openApp(page, { view: "/settings" });
  const items = page.getByRole("group", { name: "Item set" });
  await items.getByRole("radio", { name: "One click" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(items.getByRole("radio", { name: "On lock-in" })).toBeChecked();
  await expect.poll(async () => (await saved(page)).at(-1)?.importItemSet).toBe("onLockIn");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(items.getByRole("radio", { name: "Off" })).toBeChecked();
  await expect.poll(async () => (await saved(page)).at(-1)?.importItemSet).toBe("off");
});

test("settings: a failed import setting flips back and says why", async ({ page }) => {
  await openApp(page, { view: "/settings", scenario: "settings-save-error" });
  const runes = page.getByRole("group", { name: "Rune page" });
  await runes.getByText("Off").click();
  const alert = page.locator("[data-widget=settings-imports] [role=alert]");
  await expect(alert).toContainText("Couldn't save this change");
  await expect(runes.getByRole("radio", { name: "One click" })).toBeChecked();
});
