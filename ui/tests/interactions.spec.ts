import type { Page } from "@playwright/test";
import type { Settings } from "../src/data/generated/Settings";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { outageBanner, patchBanner, requiredConfig } from "../src/data/mock/platform-fixtures";
import { defaultSettings } from "../src/data/mock/settings-fixtures";
import { en } from "../src/i18n/en";
import { enViews } from "../src/i18n/en-views";
import { fr } from "../src/i18n/fr";
import { frViews } from "../src/i18n/fr-views";
import { expect, isFrench, localizedFor, openApp, SIZES, settle, test, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

/** Settings sent to the core so far, oldest first. */
const saved = (page: Page) =>
  page.evaluate(
    () =>
      window.__SCOUT_MOCK__?.log.filter((c) => c.command === "update_settings").map((c) => (c.args as { settings: Settings }).settings) ??
      [],
  );

test("settings: toggling auto-accept saves it and enables the delay", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  const toggle = page.getByRole("switch", { name: t.settings.automation.autoAccept.title });
  const delay = page.getByRole("slider", { name: t.settings.automation.delay });
  await expect(toggle, "off by default").toHaveAttribute("aria-checked", "false");
  await expect(delay).toBeDisabled();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(delay).toBeEnabled();
  await expect.poll(async () => (await saved(page)).at(-1)?.autoAccept).toBe(true);
  expect((await saved(page)).at(-1)?.autoAcceptDelaySeconds).toBe(2);
  expect(errors).toEqual([]);
});

test("settings: keyboard only", async ({ page, t }) => {
  await openApp(page, { view: "/settings", scenario: "settings-custom" });
  const front = page.getByRole("switch", { name: t.settings.automation.bringToFront.title });
  await expect(front).toHaveAttribute("aria-checked", "false");
  await front.focus();
  await page.keyboard.press("Space");
  await expect(front).toHaveAttribute("aria-checked", "true");

  const delay = page.getByRole("slider", { name: t.settings.automation.delay });
  await delay.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("setting-auto-accept-delay")).toHaveValue("5");
  await expect(page.locator("[data-widget=settings-automation] output")).toHaveText(t.settings.seconds(5));
  await expect.poll(async () => (await saved(page)).at(-1)?.autoAcceptDelaySeconds).toBe(5);
  await page.keyboard.press("End");
  await expect.poll(async () => (await saved(page)).at(-1)?.autoAcceptDelaySeconds).toBe(8);
});

test("settings: a failed save flips back and says why, in its card", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings", scenario: "settings-save-error" });
  const toggle = page.getByRole("switch", { name: t.settings.app.closeToTray.title });
  await toggle.click();
  const alert = page.locator("[data-widget=settings-app] [role=alert]");
  await expect(alert).toContainText(t.settings.saveFailed("").trim());
  await expect(alert).toContainText("Access is denied");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-widget=settings-automation] [role=alert]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("settings: the save error lays out at every size", async ({ page, t }) => {
  for (const size of SIZES) {
    await openApp(page, { view: "/settings", scenario: "settings-save-error", width: size.width, height: size.height });
    await page.getByRole("switch", { name: t.settings.automation.autoAccept.title }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await settle(page);
    expect(await page.evaluate(auditLayout), size.name).toEqual([]);
  }
});

test("settings: unreadable settings show an error with retry", async ({ page, t }) => {
  await openApp(page, { view: "/settings", scenario: "settings-error" });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(t.settings.loadFailed);
  // The shell also reads the settings once at start (the visual effects level): count from here.
  const reads = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "get_settings").length ?? 0);
  const before = await reads();
  await alert.getByRole("button", { name: t.common.tryAgain }).click();
  await expect.poll(reads).toBe(before + 1);
});

test("the core moves the UI along with the game, and hears about every view", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("navigate", "/draft"));
  await expect(page.getByRole("heading", { level: 1, name: t.nav.draft.label })).toBeVisible();
  await expect(page.locator('nav [aria-current="page"]')).toHaveAttribute("aria-label", t.nav.draft.label);
  const views = () =>
    page.evaluate(() =>
      window.__SCOUT_MOCK__?.log.filter((c) => c.command === "view_changed").map((c) => (c.args as { path: string }).path),
    );
  await expect.poll(views).toEqual(["/", "/draft"]);
  await page.getByRole("link", { name: t.nav.settings.label }).click();
  await expect.poll(views).toEqual(["/", "/draft", "/settings"]);
  expect(errors).toEqual([]);
});

test("auto-accept: a confirmation toast that goes away on its own", async ({ page, t }) => {
  await openApp(page);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("auto-accept", { kind: "accepted" }));
  const toast = page.getByTestId("toast");
  await expect(toast).toHaveText(t.shell.matchAccepted);
  await expect(toast).toHaveAttribute("data-tone", "success");
  await expect(toast).toHaveCount(0, { timeout: 6_000 });
});

test("auto-accept: a failure is reported", async ({ page, t }) => {
  await openApp(page);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("auto-accept", { kind: "failed", message: "HTTP 500" }));
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText(t.shell.acceptFailed("HTTP 500"));
  await expect(toast).toHaveAttribute("data-tone", "error");
});

// ── Notices, updates and crash reports ──────────────────────────────────────────────────────

/** Commands sent to the core so far, with their arguments. */
const sent = (page: Page, command: string) =>
  page.evaluate((name) => window.__SCOUT_MOCK__?.log.filter((c) => c.command === name).map((c) => c.args) ?? [], command);

const phase = (page: Page, next: string) =>
  page.evaluate((p) => window.__SCOUT_MOCK__?.emit("client-status", { connection: "connected", phase: p as "idle" }), next);

test("banners: the server's notices show; a closed one stays closed", async ({ page, t, locale }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "banners" });
  const banners = page.getByTestId("banner");
  await expect(banners, "the ended one is never shown").toHaveCount(2);
  // The server's text in the player's language.
  const patch = banners.filter({ hasText: localizedFor(locale, patchBanner.text) });
  const outage = banners.filter({ hasText: localizedFor(locale, outageBanner.text) });
  await expect(outage).toHaveAttribute("data-severity", "warn");
  await expect(outage.getByRole("button", { name: t.common.dismiss }), "stays while it lasts").toHaveCount(0);

  await patch.getByRole("button", { name: t.notices.moreInfo }).click();
  await expect.poll(() => sent(page, "open_banner_link")).toEqual([{ id: "patch-26.20" }]);
  await patch.getByRole("button", { name: t.common.dismiss }).click();
  await expect(banners).toHaveCount(1);

  await page.reload();
  await settle(page);
  await expect(page.getByTestId("banner")).toHaveCount(1);
  await expect(page.getByTestId("banner")).toContainText(localizedFor(locale, outageBanner.text));
  expect(errors).toEqual([]);
});

test("update ready: restarts only when asked, never shown during a game", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "update-available" });
  const prompt = page.getByTestId("update-ready");
  await expect(prompt).toContainText(t.notices.ready(false));
  await expect(prompt).toContainText("MVP 0.2.0");
  expect(await sent(page, "install_update"), "nothing installs by itself").toEqual([]);

  await phase(page, "champSelect");
  await expect(prompt, "no distraction in champion select").toHaveCount(0);
  await phase(page, "postGame");
  await page.getByTestId("update-restart").click();
  await expect.poll(async () => (await sent(page, "install_update")).length).toBe(1);

  await page.getByRole("button", { name: t.notices.later }).click();
  await expect(prompt).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("update required: the app waits behind a polite card", async ({ page, t, locale }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "update-required" });
  const dialog = page.getByRole("dialog", { name: t.updates.required.title });
  const message = requiredConfig.minVersion?.message;
  await expect(dialog).toContainText(message ? localizedFor(locale, message) : "");
  const restart = page.getByTestId("update-required-restart");
  await expect(restart, "keyboard users land on the way out").toBeFocused();
  await expect(page.getByTestId("update-ready"), "one message at a time").toHaveCount(0);

  // It covers the whole window under the title bar (rail included); the title bar stays usable.
  const blocker = await page.locator("[data-widget=update-required]").boundingBox();
  const bar = await page.getByTestId("client-status").boundingBox();
  expect(blocker).toMatchObject({ x: 0, width: 1280 });
  expect((blocker?.y ?? 0) + (blocker?.height ?? 0)).toBe(800);
  expect(blocker?.y ?? 0).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0));

  await phase(page, "inGame");
  await expect(page.getByTestId("update-required-status")).toHaveText(t.updates.required.inGame);
  await expect(restart).toHaveCount(0);
  await phase(page, "postGame");
  await page.getByTestId("update-required-restart").click();
  await expect.poll(async () => (await sent(page, "install_update")).length).toBe(1);
  expect(errors).toEqual([]);
});

test("settings: About checks for updates on request", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  const status = page.getByTestId("update-status");
  await expect(status).toHaveText(t.updates.upToDate);
  const check = page.getByTestId("update-check");
  await check.click();
  await expect(status).toHaveText(t.updates.checking);
  await expect(check).toBeDisabled();
  await expect(status).toHaveText(t.updates.upToDate);
  await expect(check).toBeEnabled();
  expect((await sent(page, "check_for_updates")).length).toBe(1);
  expect(errors).toEqual([]);
});

test("settings: a downloaded update restarts from About", async ({ page, t }) => {
  await openApp(page, { view: "/settings", scenario: "update-available" });
  await expect(page.getByTestId("update-status")).toHaveText(t.updates.ready("0.2.0"));
  await page.getByTestId("update-restart-settings").click();
  await expect.poll(async () => (await sent(page, "install_update")).length).toBe(1);
});

test("settings: crash reports are off by default and say what is sent", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  const toggle = page.getByRole("switch", { name: t.settings.app.crashReports.title });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const description = page.locator(`[id="${await toggle.getAttribute("aria-describedby")}"]`);
  await expect(description).toHaveText(t.settings.app.crashReports.text);
  await expect(description).toContainText("30");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await saved(page)).at(-1)?.crashReports).toBe(true);
  expect(errors).toEqual([]);
});

test("settings: with crash reports on, the report ID shows", async ({ page, t }) => {
  await openApp(page, { view: "/settings", scenario: "crash-reports-on" });
  await expect(page.getByRole("switch", { name: t.settings.app.crashReports.title })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("install-id")).toHaveText("3f9c2a7be41d4c0a9d6e8b1f2a4c6e80");
});

test("settings: an automation the server paused says so, the choice is kept", async ({ page, t }) => {
  await openApp(page, { view: "/settings", scenario: "auto-accept-paused" });
  await expect(page.getByTestId("auto-accept-paused")).toHaveText(t.settings.automation.paused);
  await expect(page.getByRole("switch", { name: t.settings.automation.autoAccept.title })).toHaveAttribute("aria-checked", "true");
});

/** A bug nobody caught: what the window's error handler sees. */
const crash = (page: Page, message: string) =>
  page.evaluate((m) => window.dispatchEvent(new ErrorEvent("error", { error: new Error(m), message: m })), message);

test("crash reports: nothing goes to the core while they're off", async ({ page }) => {
  await openApp(page);
  await crash(page, "boom");
  await expect(page.getByTestId("toast")).toContainText("boom");
  await page.waitForTimeout(300);
  expect(await sent(page, "report_error")).toEqual([]);
});

test("crash reports: opted in, a UI crash goes to the core once", async ({ page }) => {
  await openApp(page, { scenario: "crash-reports-on" });
  await crash(page, "boom");
  await expect.poll(() => sent(page, "report_error")).toEqual([{ message: "uncaught: boom", stack: expect.stringContaining("boom") }]);
  await crash(page, "boom");
  // Expected failures (a refused accept, a failed lookup) aren't crashes.
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("auto-accept", { kind: "failed", message: "HTTP 500" }));
  await page.waitForTimeout(300);
  expect((await sent(page, "report_error")).length).toBe(1);
});

// ── Language ────────────────────────────────────────────────────────────────────────────────

test("settings: the language changes the whole UI at once, and is kept", async ({ page, t, locale }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  const system = isFrench(locale) ? "fr" : "en";
  const other = system === "fr" ? "en" : "fr";
  const words = { en: { ...en, ...enViews }, fr: { ...fr, ...frViews } };
  const group = page.getByRole("group", { name: t.settings.app.language.title });
  await expect(group.getByRole("radio", { name: "Auto" }), "auto by default").toBeChecked();

  // Each language is named in its own words, whatever the UI's language.
  await group.getByText(other === "fr" ? "Français" : "English").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(words[other].settings.title);
  await expect(page.locator("html")).toHaveAttribute("lang", other);
  await expect(page.getByRole("link", { name: words[other].nav.home.label })).toBeVisible();
  await expect.poll(async () => (await saved(page)).at(-1)?.language).toBe(other);
  // Game names follow: the core is asked for game data in that language.
  await expect
    .poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.log.filter((c) => c.command === "game_data").map((c) => c.args)))
    .toContainEqual({ language: other });

  // Kept for the next launch's first frame.
  await page.reload();
  await settle(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(words[other].settings.title);

  // Auto follows the system (the webview's language) again.
  await page.getByRole("group", { name: words[other].settings.app.language.title }).getByText("Auto").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(words[system].settings.title);
  await expect.poll(async () => (await saved(page)).at(-1)?.language).toBe("auto");
  expect(errors).toEqual([]);
});

test("the language follows the core's settings event (another window, the tray…)", async ({ page, locale }) => {
  await openApp(page);
  const other = isFrench(locale) ? "en" : "fr";
  const words = { en: { ...en, ...enViews }, fr: { ...fr, ...frViews } };
  const settings: Settings = { ...defaultSettings, language: other };
  await page.evaluate((next) => window.__SCOUT_MOCK__?.emit("settings", next), settings);
  await expect(page.getByRole("link", { name: words[other].nav.home.label })).toBeVisible();
  await expect(page.getByTestId("client-status")).toHaveText(words[other].shell.connection.connected);
});
