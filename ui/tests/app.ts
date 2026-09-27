import { expect, type Page } from "@playwright/test";
import { FIXTURE_NOW } from "../src/data/mock/fixtures";
import type { ScenarioName } from "../src/data/mock/scenarios";

export const VIEWS = ["/", "/draft", "/live", "/champions", "/tier-list", "/settings"] as const;
export type View = (typeof VIEWS)[number];

/** Window sizes the app must support (CSS px; 1920×1080 at 150 % scaling = 1280×720). */
export const SIZES = [
  { name: "min", width: 400, height: 560 },
  { name: "narrow", width: 560, height: 720 },
  { name: "medium", width: 820, height: 760 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "desktop", width: 1600, height: 900 },
  { name: "fullhd", width: 1920, height: 1080 },
  { name: "qhd", width: 2560, height: 1440 },
  { name: "tall", width: 1100, height: 1300 },
] as const;

export interface OpenOptions {
  scenario?: ScenarioName;
  view?: View | string;
  width?: number;
  height?: number;
  /** Freeze Date at FIXTURE_NOW (default). Perf tests opt out: the fake clock also stubs `performance`. */
  freezeClock?: boolean;
}

/** Opens the app on a view with a frozen clock and waits until it is settled. */
export async function openApp(page: Page, opts: OpenOptions = {}): Promise<void> {
  await page.setViewportSize({ width: opts.width ?? 1280, height: opts.height ?? 800 });
  if (opts.freezeClock ?? true) await page.clock.setFixedTime(new Date(FIXTURE_NOW));
  await page.goto(`/?scenario=${opts.scenario ?? "default"}#${opts.view ?? "/"}`);
  await settle(page);
}

/** Waits for fonts, visible images and pending loading states. */
export async function settle(page: Page): Promise<void> {
  await expect(page.locator("[data-state=loading]")).toHaveCount(0, { timeout: 10_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Art and names depend on game data: wait until it has loaded (or failed).
    for (let i = 0; i < 60 && document.documentElement.dataset.gameData !== "settled"; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Screenshots and audits need every image now, not when it scrolls into view.
    for (const img of document.images) img.loading = "eager";
    const inView = (img: HTMLImageElement) => {
      const r = img.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    };
    const wait = (img: HTMLImageElement) =>
      new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
    // Images can appear late (art needs game data): wait until the set in view stops changing.
    const deadline = performance.now() + 3_000;
    let seen = -1;
    while (performance.now() < deadline) {
      const visible = [...document.images].filter(inView);
      const pending = visible.filter((img) => !img.complete);
      if (pending.length === 0 && visible.length === seen) break;
      seen = visible.length;
      await Promise.race([Promise.all(pending.map(wait)), new Promise((r) => setTimeout(r, 1_000))]);
      await new Promise((r) => setTimeout(r, 50));
    }
    // "complete" comes before an async-decoded image is painted: wait for decoding too.
    await Promise.race([
      Promise.all([...document.images].filter(inView).map((img) => img.decode().catch(() => undefined))),
      new Promise((r) => setTimeout(r, 2_000)),
    ]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/** Collects uncaught exceptions and console errors for the whole test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}
