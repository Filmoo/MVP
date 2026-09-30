import { describe, expect, it } from "vitest";
import {
  edgeAction,
  GESTURE_GAP_MS,
  keyStep,
  moves,
  RELEASE_MS,
  rubber,
  SETTLE_MS,
  TOUCH_CLOSE,
  TOUCH_MOVE,
  threshold,
  WHEEL_CLOSE,
  WHEEL_LOAD,
  WHEEL_MOVE,
  wheelPull,
} from "./stack";

/** Feeds `deltas` one frame apart from `from` ms; answers the last pull. */
function feed(pull: ReturnType<typeof wheelPull>, from: number, deltas: number[]): number | null {
  let distance: number | null = 0;
  deltas.forEach((dy, i) => {
    distance = pull.wheel(from + i * 16, dy);
  });
  return distance;
}

/** A touchpad flick's inertia: deltas shrinking steadily, a frame apart. */
const momentum = [60, 55, 50, 46, 42, 38, 35, 32, 29, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];

describe("the stack: a wheel gesture moves one game", () => {
  it("a notch of a mouse wheel moves at once, a touchpad's swipe once it is deliberate", () => {
    expect(wheelPull().wheel(0, 100)).toBeGreaterThanOrEqual(WHEEL_MOVE);
    expect(wheelPull().wheel(0, -100)).toBeLessThanOrEqual(-WHEEL_MOVE);
    const swipe = wheelPull();
    expect(feed(swipe, 0, [4, 10, 18])).toBeLessThan(WHEEL_MOVE);
    expect(swipe.wheel(48, 26)).toBeGreaterThanOrEqual(WHEEL_MOVE);
  });

  it("a nudge doesn't, nor does momentum on its own", () => {
    expect(Math.abs(feed(wheelPull(), 0, [3, 2, 4, 3]) ?? 0)).toBeLessThan(WHEEL_MOVE);
    // Deltas shrinking from the start: after two in a row, nothing more adds up.
    expect(feed(wheelPull(), 0, momentum.slice(6))).toBe(35 + 32);
    expect(35 + 32).toBeLessThan(WHEEL_LOAD);
  });

  it("the rest of a gesture that moved is swallowed: more notches, a flick's inertia, even turning back", () => {
    const pull = wheelPull();
    expect(feed(pull, 0, [8, 20, 34])).toBeGreaterThanOrEqual(WHEEL_MOVE);
    pull.spend();
    expect(feed(pull, 48, momentum)).toBeNull();
    expect(pull.wheel(48 + momentum.length * 16, -100)).toBeNull();
    expect(pull.wheel(48 + momentum.length * 16 + 16, 0)).toBeNull();
  });

  it("after a pause, once the stack has glided, the next gesture moves again", () => {
    const pull = wheelPull();
    pull.wheel(0, 100);
    pull.spend();
    // A notch 150 ms later belongs to the same spin.
    expect(pull.wheel(150, 100)).toBeNull();
    const later = 150 + Math.max(GESTURE_GAP_MS, SETTLE_MS) + 1;
    expect(pull.wheel(later, 100)).toBe(100);
  });

  it("while the stack glides the wheel rests, even across a pause (a busy page hands notches over late)", () => {
    const pull = wheelPull();
    feed(pull, 0, [100, 100]);
    pull.spend();
    // The same spin's last notches, handed over 280 ms later: still swallowed.
    expect(pull.wheel(16 + 280, 200)).toBeNull();
    expect(pull.wheel(16 + SETTLE_MS - 1, 100)).toBeNull();
  });

  it("ignores events without a vertical part", () => {
    const pull = wheelPull();
    pull.wheel(0, 30);
    expect(pull.wheel(16, 0)).toBe(30);
  });
});

describe("the stack: pulled past its ends", () => {
  it("notch after notch adds up (each one a gesture of its own), until let go", () => {
    const pull = wheelPull();
    for (let i = 0; i < 3; i++) pull.wheel(i * (GESTURE_GAP_MS + 60), -100);
    expect(pull.wheel(3 * (GESTURE_GAP_MS + 60), -100)).toBe(-400);
    expect(-400).toBeLessThanOrEqual(-WHEEL_CLOSE);
    pull.release();
    expect(pull.wheel(4 * (GESTURE_GAP_MS + 60) + RELEASE_MS, -100)).toBe(-100);
  });

  it("notches the busy page merged (200, then 100) are no inertia", () => {
    expect(feed(wheelPull(), 0, [100, 200, 100])).toBeGreaterThanOrEqual(WHEEL_CLOSE);
    expect(feed(wheelPull(), 0, [300, 100])).toBeGreaterThanOrEqual(WHEEL_CLOSE);
  });

  it("a touchpad's steady scroll counts, even when it slows down a little", () => {
    const deliberate = [12, 24, 30, 30, 28, 34, 36, 36, 40, 38, 40, 44, 44, 40, 42, 46];
    expect(feed(wheelPull(), 0, deliberate)).toBeGreaterThanOrEqual(WHEEL_CLOSE);
  });

  it("inertia never closes: a flick's momentum adds only until it shows as momentum", () => {
    const flick = wheelPull();
    expect(feed(flick, 0, [-10, -30, -60, ...momentum.map((dy) => -dy)])).toBe(-(10 + 30 + 60 + 60 + 55));
    expect(10 + 30 + 60 + 60 + 55).toBeLessThan(WHEEL_CLOSE);
  });

  it("turning back springs the pull back and pulls the other way", () => {
    const pull = wheelPull();
    feed(pull, 0, [-100, -100]);
    expect(pull.wheel(40, 30)).toBe(30);
  });
});

describe("the stack: what a gesture does", () => {
  it("moves between games, newest on top", () => {
    expect(edgeAction(1, 0, 12, undefined)).toBe("older");
    expect(edgeAction(-1, 3, 12, undefined)).toBe("newer");
    expect(edgeAction(1, 10, 12, "idle")).toBe("older");
    expect(moves("older") && moves("newer")).toBe(true);
  });

  it("past the newest game, closes", () => {
    expect(edgeAction(-1, 0, 12, "idle")).toBe("close");
    expect(edgeAction(-1, 0, 1, undefined)).toBe("close");
    expect(moves("close")).toBe(false);
  });

  it("past the last game loaded, loads older ones (again after a failure), else only gives", () => {
    expect(edgeAction(1, 19, 20, "idle")).toBe("load");
    expect(edgeAction(1, 19, 20, "failed")).toBe("load");
    expect(edgeAction(1, 19, 20, "loading")).toBe("loading");
    expect(edgeAction(1, 46, 47, "end")).toBe("end");
    // A list that can't load more (a player's page).
    expect(edgeAction(1, 19, 20, undefined)).toBe("end");
    expect(moves("load") || moves("end")).toBe(false);
  });

  it("moves on the least, loads on more, closes on the most; nothing makes the end act", () => {
    expect(threshold("older", false)).toBe(WHEEL_MOVE);
    expect(threshold("newer", false)).toBe(WHEEL_MOVE);
    expect(threshold("load", false)).toBe(WHEEL_LOAD);
    expect(threshold("close", false)).toBe(WHEEL_CLOSE);
    expect(threshold("newer", true)).toBe(TOUCH_MOVE);
    expect(threshold("load", true)).toBe(TOUCH_MOVE);
    expect(threshold("close", true)).toBe(TOUCH_CLOSE);
    expect(threshold("end", false)).toBe(Number.POSITIVE_INFINITY);
    expect(threshold("loading", true)).toBe(Number.POSITIVE_INFINITY);
    expect(WHEEL_MOVE).toBeLessThan(WHEEL_LOAD);
    expect(WHEEL_LOAD).toBeLessThan(WHEEL_CLOSE);
    expect(TOUCH_MOVE).toBeLessThan(TOUCH_CLOSE);
  });
});

describe("the stack: the keyboard", () => {
  it("↓ and PageDown go to the older game, ↑ and PageUp to the newer one, Home and End to the ends", () => {
    expect(keyStep("ArrowDown")).toBe(1);
    expect(keyStep("PageDown")).toBe(1);
    expect(keyStep("ArrowUp")).toBe(-1);
    expect(keyStep("PageUp")).toBe(-1);
    expect(keyStep("Home")).toBe("first");
    expect(keyStep("End")).toBe("last");
    // ←/→ are the tabs', Space and Enter the controls'.
    for (const key of ["ArrowLeft", "ArrowRight", " ", "Enter"]) expect(keyStep(key)).toBeUndefined();
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
