import { expect, test } from "@playwright/test";
import { scenarioNames } from "../src/data/mock/scenarios";
import { openApp, VIEWS } from "./app";
import { auditTokens } from "./coherence-rules";

for (const view of VIEWS) {
  test(`${view} only uses design tokens`, async ({ page }) => {
    await openApp(page, { view });
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

for (const scenario of scenarioNames) {
  test(`home/${scenario} only uses design tokens`, async ({ page }) => {
    await openApp(page, { scenario });
    expect(await page.evaluate(auditTokens)).toEqual([]);
  });
}

test("/draft in champion select only uses design tokens", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select" });
  expect(await page.evaluate(auditTokens)).toEqual([]);
});

test("every view has exactly one page heading", async ({ page }) => {
  for (const view of VIEWS) {
    await openApp(page, { view });
    await expect(page.locator("main h1"), view).toHaveCount(1);
  }
});

test("every view shares the same content frame", async ({ page }) => {
  const frames = new Map<string, { left: number; top: number }>();
  for (const view of VIEWS) {
    await openApp(page, { view, width: 1600, height: 900 });
    const box = await page.locator("main > * > *").first().boundingBox();
    expect(box, view).not.toBeNull();
    frames.set(view, { left: Math.round(box?.x ?? 0), top: Math.round(box?.y ?? 0) });
  }
  const [first] = frames.values();
  for (const [view, frame] of frames) expect(frame, view).toEqual(first);
});

test("navigation marks exactly one active item", async ({ page }) => {
  for (const view of VIEWS) {
    await openApp(page, { view });
    await expect(page.locator('nav [aria-current="page"]'), view).toHaveCount(1);
  }
});
