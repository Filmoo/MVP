import { expect, test } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { openApp, settle, trackErrors } from "./app";

test("client not running: guidance instead of data", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "not-running" });
  await expect(page.getByRole("heading", { name: "Waiting for the League client" })).toBeVisible();
  await expect(page.getByTestId("client-status")).toContainText("Waiting for League client");
  expect(errors).toEqual([]);
});

test("profile failure: error state, retry calls the core again", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "profile-error" });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't load your profile");
  await expect(alert).toContainText("HTTP 503");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "current_profile").length)).toBe(2);
  expect(errors).toEqual([]);
});

test("slow core: skeletons first, then content without layout jumps", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/?scenario=slow-loading#/");
  await expect(page.locator("[data-state=loading]").first()).toBeVisible();
  await settle(page);
  await expect(page.locator("[data-widget=recent-matches]")).toBeVisible();
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls, "cumulative layout shift").toBeLessThan(0.1);
});

test("a crashing widget is contained: the rest of the page works", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "widget-crash" });
  await expect(page.locator("[data-widget=recent-matches] [role=alert]")).toContainText("This panel failed to load");
  await expect(page.locator("[data-widget=performance-summary]")).toContainText("Recent form");
  await expect(page.locator("[data-widget=profile-header]")).toContainText("Fillmo");
  await expect(page.getByTestId("toast")).toHaveCount(1);
  expect(errors.every((e) => e.includes("widget:recent-matches"))).toBe(true);
});

test("client connecting later: the profile loads without a restart", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page, { scenario: "not-running" });
  await expect(page.getByRole("heading", { name: "Waiting for the League client" })).toBeVisible();
  const calls = () => page.evaluate(() => window.__SCOUT_MOCK__?.calls.filter((c) => c === "current_profile").length);
  const before = await calls();
  await page.evaluate(() => window.__SCOUT_MOCK__?.emit("client-status", { connection: "connected", phase: "idle" }));
  await expect.poll(calls).toBe((before ?? 0) + 1);
  expect(errors).toEqual([]);
});

test("unknown route: not-found state, navigation still works", async ({ page }) => {
  await openApp(page, { view: "/does-not-exist" });
  await expect(page.getByText("Page not found")).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.locator("[data-widget=profile-header]")).toBeVisible();
});

test("game assets unreachable: placeholders, no crash", async ({ page }) => {
  const errors = trackErrors(page);
  await page.route("**/dd/**", (route) => route.abort());
  await openApp(page);
  await expect(page.locator("[data-widget=recent-matches]")).toBeVisible();
  await expect(page.getByRole("img", { name: "Champion 103" }).first()).toBeVisible();
  expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
});
