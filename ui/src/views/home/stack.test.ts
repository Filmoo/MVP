import { describe, expect, it } from "vitest";
import {
  edgeAction,
  GESTURE_GAP_MS,
  keyStep,
  rubber,
  SETTLE_MS,
  TOUCH_CLOSE,
  TOUCH_MOVE,
  threshold,
  touchPull,
  WHEEL_CLOSE,
  WHEEL_MOVE,
  wheelPull,
} from "./stack";

const END = { atTop: false, atEnd: true };
const TOP = { atTop: true, atEnd: false };
const MIDDLE = { atTop: false, atEnd: false };

/** Feeds `deltas` one frame apart from `from` ms; answers the last pull. */
function feed(pull: ReturnType<typeof wheelPull>, from: number, deltas: number[], edges = END): number | null {
  let distance: number | null = 0;
  deltas.forEach((dy, i) => {
    distance = pull.wheel(from + i * 16, dy, edges);
  });
  return distance;
}

describe("the stack: the wheel past a game's edge", () => {
  it("pulls with every notch of a wheel begun at the edge: two move on, four close", () => {
    const pull = wheelPull();
    expect(pull.wheel(0, 100, END)).toBe(100);
    expect(pull.wheel(90, 100, END)).toBeGreaterThanOrEqual(WHEEL_MOVE);
    expect(pull.wheel(180, 100, END)).toBe(300);
    expect(pull.wheel(270, 100, END)).toBeGreaterThanOrEqual(WHEEL_CLOSE);
  });

  it("notches the busy page merged (200, then 100) are no inertia", () => {
    const pull = wheelPull();
    expect(feed(pull, 0, [100, 200, 100])).toBeGreaterThanOrEqual(WHEEL_CLOSE);
    const again = wheelPull();
    expect(feed(again, 0, [300, 100])).toBeGreaterThanOrEqual(WHEEL_CLOSE);
  });

  it("slow notches still add up: each one is a gesture of its own, begun at the edge", () => {
    const pull = wheelPull();
    for (let i = 0; i < 3; i++) pull.wheel(i * (GESTURE_GAP_MS + 60), 100, END);
    expect(pull.wheel(3 * (GESTURE_GAP_MS + 60), 100, END)).toBe(400);
  });

  it("past the top, pulls the other way", () => {
    const pull = wheelPull();
    expect(feed(pull, 0, [-120, -120], TOP)).toBe(-240);
  });

  it("a spin that scrolled the game to its end stops there, whatever follows in the same gesture", () => {
    const pull = wheelPull();
    feed(pull, 0, [100, 100, 100], MIDDLE);
    expect(feed(pull, 48, [100, 100, 100, 100, 100, 100], END)).toBe(0);
    // A new gesture, after a pause, pulls.
    expect(pull.wheel(48 + 5 * 16 + GESTURE_GAP_MS + 1, 100, END)).toBe(100);
  });

  it("inertia never moves on: momentum carried to the edge, alone, or after a small deliberate push", () => {
    const momentum = [60, 55, 50, 46, 42, 38, 35, 32, 29, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];
    // A flick that scrolled the game: its momentum hits the end and stops there.
    const flick = wheelPull();
    feed(flick, 0, [20, 40, 60], MIDDLE);
    expect(feed(flick, 48, momentum)).toBe(0);
    // Momentum alone at the end: once it has shrunk twice in a row, it adds nothing.
    const alone = wheelPull();
    expect(feed(alone, 0, momentum)).toBe(60 + 55);
    expect(60 + 55).toBeLessThan(WHEEL_MOVE);
    // A small push begun at the end: its growing deltas count, the momentum after it only
    // until it shows as momentum.
    const push = wheelPull();
    expect(feed(push, 0, [10, 30, 60])).toBe(100);
    expect(feed(push, 48, momentum.slice(1))).toBe(100 + 55);
    expect(100 + 55).toBeLessThan(WHEEL_MOVE);
  });

  it("a touchpad's continued scroll at the edge counts, even when it slows down a little", () => {
    const pull = wheelPull();
    const deliberate = [12, 24, 30, 30, 28, 34, 36, 36, 40, 38, 40, 44, 44, 40, 42, 46];
    expect(feed(pull, 0, deliberate)).toBeGreaterThanOrEqual(WHEEL_CLOSE);
  });

  it("scrolling back springs the pull back, and the gesture can't pull again", () => {
    const pull = wheelPull();
    feed(pull, 0, [100, 100], END);
    expect(pull.wheel(40, -100, END)).toBe(0);
    expect(pull.wheel(60, 100, END)).toBe(0);
  });

  it("releases to nothing", () => {
    const pull = wheelPull();
    feed(pull, 0, [100, 100]);
    pull.release();
    expect(pull.wheel(GESTURE_GAP_MS + 100, 100, END)).toBe(100);
  });

  it("a gesture that moved the stack is spent: the rest of it is swallowed, the next one scrolls again", () => {
    const pull = wheelPull();
    feed(pull, 0, [100, 100]);
    pull.spend();
    // More notches and the inertia of the same gesture: nothing scrolls with them, at any edge.
    expect(pull.wheel(40, 100, TOP)).toBeNull();
    expect(feed(pull, 56, [80, 60, 40, 20], MIDDLE)).toBeNull();
    expect(pull.wheel(200, 0, MIDDLE)).toBeNull();
    // After a pause, once the stack has glided: a new gesture (the new game at its top scrolls;
    // at an edge, it pulls).
    const later = 16 + SETTLE_MS + 1;
    expect(pull.wheel(later, 100, MIDDLE)).toBe(0);
    expect(pull.wheel(later + GESTURE_GAP_MS + 1, 100, END)).toBe(100);
  });

  it("while the stack glides the wheel rests, even across a pause (a busy page hands notches over late)", () => {
    const pull = wheelPull();
    feed(pull, 0, [100, 100]);
    pull.spend();
    // The same spin's last notches, handed over 280 ms later: still swallowed.
    expect(pull.wheel(16 + 280, 200, MIDDLE)).toBeNull();
    expect(pull.wheel(16 + SETTLE_MS - 1, 100, END)).toBeNull();
  });

  it("ignores events without a vertical part", () => {
    const pull = wheelPull();
    pull.wheel(0, 100, END);
    expect(pull.wheel(16, 0, MIDDLE)).toBe(100);
  });
});

describe("the stack: a finger", () => {
  it("drags the stack past the top, and back", () => {
    const pull = touchPull();
    pull.start(300);
    expect(pull.move(280, TOP)).toBe(0); // scrolls the game down: nothing to pull
    pull.start(300);
    expect(pull.move(340, TOP)).toBe(-40);
    expect(pull.move(300 + TOUCH_CLOSE, TOP)).toBe(-TOUCH_CLOSE);
    expect(pull.move(330, TOP)).toBe(-30);
    // Dragged back past where the pull began: the game scrolls again.
    expect(pull.move(250, MIDDLE)).toBe(0);
  });

  it("drags past the end", () => {
    const pull = touchPull();
    pull.start(500);
    expect(pull.move(480, END)).toBe(20);
    expect(pull.move(380, END)).toBe(120);
  });
});

describe("the stack: what going on past an edge does", () => {
  it("moves between games, newest on top", () => {
    expect(edgeAction(1, 0, 12, undefined)).toBe("older");
    expect(edgeAction(-1, 3, 12, undefined)).toBe("newer");
    expect(edgeAction(1, 10, 12, "idle")).toBe("older");
  });

  it("past the newest game's top, closes", () => {
    expect(edgeAction(-1, 0, 12, "idle")).toBe("close");
    expect(edgeAction(-1, 0, 1, undefined)).toBe("close");
  });

  it("past the last game loaded, loads older ones (again after a failure), else only gives", () => {
    expect(edgeAction(1, 19, 20, "idle")).toBe("load");
    expect(edgeAction(1, 19, 20, "failed")).toBe("load");
    expect(edgeAction(1, 19, 20, "loading")).toBe("loading");
    expect(edgeAction(1, 46, 47, "end")).toBe("end");
    // A list that can't load more (a player's page).
    expect(edgeAction(1, 19, 20, undefined)).toBe("end");
  });

  it("needs a longer pull to close than to move on, and nothing makes the end act", () => {
    expect(threshold("older", false)).toBe(WHEEL_MOVE);
    expect(threshold("load", false)).toBe(WHEEL_MOVE);
    expect(threshold("close", false)).toBe(WHEEL_CLOSE);
    expect(threshold("newer", true)).toBe(TOUCH_MOVE);
    expect(threshold("close", true)).toBe(TOUCH_CLOSE);
    expect(threshold("end", false)).toBe(Number.POSITIVE_INFINITY);
    expect(threshold("loading", true)).toBe(Number.POSITIVE_INFINITY);
    expect(WHEEL_MOVE).toBeLessThan(WHEEL_CLOSE);
    expect(TOUCH_MOVE).toBeLessThan(TOUCH_CLOSE);
  });
});

describe("the stack: the keyboard", () => {
  it("scrolls by a line or a page, down or up, and jumps to the ends", () => {
    expect(keyStep("ArrowDown", false)).toEqual({ by: "line", direction: 1 });
    expect(keyStep("ArrowUp", false)).toEqual({ by: "line", direction: -1 });
    expect(keyStep("PageDown", false)).toEqual({ by: "page", direction: 1 });
    expect(keyStep("PageUp", false)).toEqual({ by: "page", direction: -1 });
    expect(keyStep(" ", false)).toEqual({ by: "page", direction: 1 });
    expect(keyStep(" ", true)).toEqual({ by: "page", direction: -1 });
    expect(keyStep("Home", false)).toBe("first");
    expect(keyStep("End", false)).toBe("last");
    expect(keyStep("ArrowLeft", false)).toBeUndefined();
    expect(keyStep("Enter", false)).toBeUndefined();
  });
});

describe("the rubber band", () => {
  it("follows less and less, never past its reach, the same both ways", () => {
    expect(rubber(0)).toBe(0);
    expect(rubber(100)).toBeGreaterThan(30);
    expect(rubber(100)).toBeLessThan(100);
    expect(rubber(WHEEL_CLOSE) - rubber(WHEEL_CLOSE - 100)).toBeLessThan(rubber(100));
    expect(rubber(-200)).toBe(-rubber(200));
    expect(rubber(100_000)).toBeLessThan(280);
  });
});
