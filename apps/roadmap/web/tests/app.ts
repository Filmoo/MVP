import { test as base, expect, type Locator, type Page } from "@playwright/test";

declare global {
  interface Window {
    __csp?: string[];
  }
}

/** Console messages a test expects (a 500 it provoked, say). */
const allowed = new WeakMap<Page, RegExp[]>();

export function allowConsole(page: Page, pattern: RegExp): void {
  allowed.set(page, [...(allowed.get(page) ?? []), pattern]);
}

/**
 * Every test: a page that fails on console errors and CSP violations. Signed out, the page asks
 * `/api/me` and gets a 401, which Chromium logs: that one is expected.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__csp = [...(window.__csp ?? []), `${event.violatedDirective} ${event.blockedURI}`];
      });
    });
    await use(page);
    const csp = await page.evaluate(() => window.__csp ?? []).catch(() => []);
    expect(csp, "CSP violations").toEqual([]);
    const expected = [/status of 401/, ...(allowed.get(page) ?? [])];
    expect(
      errors.filter((e) => !expected.some((p) => p.test(e))),
      "console errors",
    ).toEqual([]);
  },
});

export { expect };

/** The roadmap back to the test seed (or the committed one, for screenshots). */
export async function reset(page: Page, seed?: "builtin"): Promise<void> {
  const response = await page.request.post(`/api/dev/reset${seed ? `?seed=${seed}` : ""}`);
  expect(response.status()).toBe(204);
}

/** Signs in (dev login) and waits for the board. */
export async function open(page: Page, hash = "#/board"): Promise<void> {
  await page.goto("/auth/login");
  await page.goto(`/${hash}`);
  await expect(page.locator("[data-view]")).toBeVisible();
  await settle(page);
}

/** Two frames: whatever the last change started has been painted. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Waits for motion to end (sheets sliding in, dialogs popping up) before measuring. */
export async function still(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}

export function column(page: Page, version: string): Locator {
  return page.locator(`section[aria-label="Version ${version}"]`);
}

export function card(page: Page, title: string): Locator {
  return page.getByTestId("board").locator("[data-feature]", { hasText: title });
}

/** Drags with the mouse, the way a person does: press, move in steps, release. */
export async function drag(page: Page, from: Locator, to: Locator, where: "top" | "bottom" = "bottom"): Promise<void> {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error("nothing to drag or nowhere to drop");
  await page.mouse.move(start.x + 24, start.y + 14);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 30, { steps: 4 });
  const y = where === "top" ? end.y + 40 : end.y + end.height - 6;
  await page.mouse.move(end.x + end.width / 2, y, { steps: 16 });
  await page.mouse.up();
}

/** A toast's text, and clicks its Undo. */
export async function undoFromToast(page: Page, text: string | RegExp): Promise<void> {
  const toast = page.getByRole("status").locator("div", { hasText: text }).first();
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
}
