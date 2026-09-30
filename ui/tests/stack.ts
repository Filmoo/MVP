import type { Page } from "@playwright/test";
import { GESTURE_GAP_MS, SETTLE_MS } from "../src/views/home/stack";
import { animationsDone, expect } from "./app";

// The stack of opened games (views/home/GameStack.tsx), for the suites: its windows, their tabs,
// the wheel.

/** The match rows' buttons, newest first. */
export const rows = (page: Page) => page.locator("[data-testid=match-row] > button");
/** The stack: a modal dialog. */
export const stack = (page: Page) => page.getByTestId("game-stack");
/** The current game's window. */
export const current = (page: Page) => page.locator("[data-testid=game-window][data-current]");
/** The current window's room for its tab (it never scrolls). */
export const body = (page: Page) => current(page).getByTestId("game-body");
/** The current window's tabs. */
export const tabs = (page: Page) => current(page).getByTestId("game-tabs").getByRole("radio");
/** The game of row `at` (newest first): its match id. */
export const gameOf = async (page: Page, at: number) => ((await rows(page).nth(at).getAttribute("id")) ?? "").replace(/^match-/, "");

/** Waits until the window of `matchId` is the current one, and still. */
export async function showing(page: Page, matchId: string): Promise<void> {
  await expect(current(page).locator("h2")).toHaveAttribute("id", `game-title-${matchId}`);
  await animationsDone(page);
}

/** Opens row `at`'s game (newest first) and waits until it has landed and the stack is still. */
export async function openGame(page: Page, at = 0): Promise<void> {
  await rows(page).nth(at).click();
  await expect(current(page).getByTestId("game-player")).toHaveCount(10);
  await animationsDone(page);
}

/** The middle of the current window: where the wheel turns. */
async function middle(page: Page): Promise<{ x: number; y: number }> {
  const box = await current(page).boundingBox();
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
}

/** Points at the current window and waits until the next wheel event starts a gesture of its own. */
export async function aim(page: Page): Promise<void> {
  const at = await middle(page);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(Math.max(GESTURE_GAP_MS, SETTLE_MS) + 50);
}

/** Wheel notches over the current window, sent back to back: one gesture (a busy machine spaced awaited ones out). */
export async function notches(page: Page, count: number, dy: number): Promise<void> {
  const at = await middle(page);
  const cdp = await page.context().newCDPSession(page);
  await Promise.all(
    Array.from({ length: count }, () => cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...at, deltaX: 0, deltaY: dy })),
  );
  await cdp.detach();
}

/** How the stack is pulled right now (`null`: it isn't), and what the hint says. */
export const pulling = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>("[data-testid=game-stack]");
    return dialog?.dataset.pulling ?? null;
  });

export interface Pulls {
  /** The farthest the track was sent past its place (px, + down). */
  most: number;
  /** How it was pulled, if it was. */
  how: string | null;
  /** The edge the hint pointed at, and what it said. */
  edge: string | null;
  said: string | null;
}

/**
 * Records the stack's pulls from now on, as they happen: on a busy machine a pull can spring back
 * before a test looks.
 */
export async function recordPulls(page: Page): Promise<() => Promise<Pulls>> {
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>("[data-testid=game-stack]");
    const track = dialog?.querySelector<HTMLElement>("[data-window]")?.parentElement;
    const cue = document.querySelector<HTMLElement>("[data-testid=scroll-cue]");
    const seen: Pulls = { most: 0, how: null, edge: null, said: null };
    (window as unknown as { __pulls: Pulls }).__pulls = seen;
    const look = () => {
      // The track's place: `calc(<the current game's place> + <pull>px)`.
      const pull = Number(/\+ (-?\d+)px\)$/.exec(track?.style.translate ?? "")?.[1] ?? 0);
      if (Math.abs(pull) > Math.abs(seen.most)) seen.most = pull;
      if (dialog?.dataset.pulling) {
        seen.how ??= dialog.dataset.pulling;
        seen.edge ??= cue?.dataset.edge ?? null;
        seen.said ??= cue?.textContent || null;
      }
    };
    for (const el of [dialog, track]) if (el) new MutationObserver(look).observe(el, { attributes: true });
    if (cue) new MutationObserver(look).observe(cue, { attributes: true, subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __pulls: Pulls }).__pulls);
}

/**
 * What scrolls, or would have to, in the current window: every box whose content outgrows it
 * (text cut short with an ellipsis aside). Nothing may: a window's tabs fit it.
 */
export const scrolled = (page: Page) =>
  current(page).evaluate((win) =>
    [win, ...win.querySelectorAll("*")].flatMap((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.textOverflow === "ellipsis" || el.closest("svg")) return [];
      const tall = el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== "visible";
      const wide = el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible";
      const scroller = /auto|scroll/.test(cs.overflowY + cs.overflowX);
      return tall || wide || scroller
        ? [
            `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight}`,
          ]
        : [];
    }),
  );
