import { expect, type Page, test } from "@playwright/test";
import type { Settings } from "../src/data/generated/Settings";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { openApp, SIZES, settle, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

/** Settings sent to the core so far, oldest first. */
const saved = (page: Page) =>
  page.evaluate(
    () =>
      window.__SCOUT_MOCK__?.log.filter((c) => c.command === "update_settings").map((c) => (c.args as { settings: Settings }).settings) ??
      [],
  );

test("settings: toggling auto-accept saves it and enables the delay", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  const toggle = page.getByRole("switch", { name: "Auto-accept matches" });
  const delay = page.getByRole("slider", { name: "Delay before accepting" });
  await expect(toggle, "off by default").toHaveAttribute("aria-checked", "false");
  await expect(delay).toBeDisabled();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(delay).toBeEnabled();
  await expect.poll(async () => (await saved(page)).at(-1)?.autoAccept).toBe(true);
  expect((await saved(page)).at(-1)?.autoAcceptDelaySeconds).toBe(2);
  expect(errors).toEqual([]);
});

test("settings: keyboard only", async ({ page }) => {
  await openApp(page, { view: "/settings", scenario: "settings-custom" });
  const front = page.getByRole("switch", { name: "Bring MVP to the front" });
  await expect(front).toHaveAttribute("aria-checked", "false");
  await front.focus();
  await page.keyboard.press("Space");
  await expect(front).toHaveAttribute("aria-checked", "true");

  const delay = page.getByRole("slider", { name: "Delay before accepting" });
  await delay.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("setting-auto-accept-delay")).toHaveValue("5");
  await expect(page.locator("[data-widget=settings-automation] output")).toHaveText("5 s");
  await expect.poll(async () => (await saved(page)).at(-1)?.autoAcceptDelaySeconds).toBe(5);
  await page.keyboard.press("End");
  await expect.poll(async () => (await saved(page)).at(-1)?.autoAcceptDelaySeconds).toBe(8);
});

test("settings: a failed save flips back and says why, in its card", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings", scenario: "settings-save-error" });
  const toggle = page.getByRole("switch", { name: "Close to tray" });
  await toggle.click();
  const alert = page.locator("[data-widget=settings-app] [role=alert]");
  await expect(alert).toContainText("Couldn't save this change");
  await expect(alert).toContainText("Access is denied");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-widget=settings-automation] [role=alert]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("settings: the save error lays out at every size", async ({ page }) => {
  for (const size of SIZES) {
    await openApp(page, { view: "/settings", scenario: "settings-save-error", width: size.width, height: size.height });
    await page.getByRole("switch", { name: "Auto-accept matches" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await settle(page);
    expect(await page.evaluate(auditLayout), size.name).toEqual([]);
  }
});

test("settings: unreadable settings show an error with retry", async ({ page }) => {
  await openApp(page, { view: "/settings", scenario: "settings-error" });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't load your settings");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "get_settings").length)).toBe(2);
});

test("the core moves the UI along with the game, and hears about every view", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("navigate", "/draft"));
  await expect(page.getByRole("heading", { level: 1, name: "Draft" })).toBeVisible();
  await expect(page.locator('nav [aria-current="page"]')).toHaveAttribute("aria-label", "Draft");
  const views = () =>
    page.evaluate(() =>
      window.__SCOUT_MOCK__?.log.filter((c) => c.command === "view_changed").map((c) => (c.args as { path: string }).path),
    );
  await expect.poll(views).toEqual(["/", "/draft"]);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect.poll(views).toEqual(["/", "/draft", "/settings"]);
  expect(errors).toEqual([]);
});

test("auto-accept: a confirmation toast that goes away on its own", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("auto-accept", { kind: "accepted" }));
  const toast = page.getByTestId("toast");
  await expect(toast).toHaveText("Match accepted");
  await expect(toast).toHaveAttribute("data-tone", "success");
  await expect(toast).toHaveCount(0, { timeout: 6_000 });
});

test("auto-accept: a failure is reported", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("auto-accept", { kind: "failed", message: "HTTP 500" }));
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("Couldn't accept the match: HTTP 500");
  await expect(toast).toHaveAttribute("data-tone", "error");
});
