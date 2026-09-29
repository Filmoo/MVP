import { describe, expect, it } from "vitest";
import { GESTURE_GAP_MS, rubber, TOUCH_CLOSE, touchPull, WHEEL_CLOSE, wheelPull } from "./pull";

const END = { atTop: false, atEnd: true };
const TOP = { atTop: true, atEnd: false };
const MIDDLE = { atTop: false, atEnd: false };

/** Feeds `deltas` one frame apart from `from` ms; answers the last pull. */
function feed(pull: ReturnType<typeof wheelPull>, from: number, deltas: number[], edges = END): number {
  let distance = 0;
  deltas.forEach((dy, i) => {
    distance = pull.wheel(from + i * 16, dy, edges);
  });
  return distance;
}

describe("scroll to close: the wheel", () => {
  it("pulls with every notch of a wheel begun at the end, and closes on the fourth", () => {
    const pull = wheelPull();
    expect(pull.wheel(0, 100, END)).toBe(100);
    expect(pull.wheel(90, 100, END)).toBe(200);
    expect(pull.wheel(180, 100, END)).toBe(300);
    expect(pull.wheel(270, 100, END)).toBeGreaterThanOrEqual(WHEEL_CLOSE);
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

  it("a spin that scrolled the content to the end stops there, whatever follows in the same gesture", () => {
    const pull = wheelPull();
    feed(pull, 0, [100, 100, 100], MIDDLE);
    expect(feed(pull, 48, [100, 100, 100, 100, 100, 100], END)).toBe(0);
    // A new gesture, after a pause, pulls.
    expect(pull.wheel(48 + 5 * 16 + GESTURE_GAP_MS + 1, 100, END)).toBe(100);
  });

  it("inertia never pulls: momentum carried to the edge, or following a small deliberate push", () => {
    const momentum = [60, 55, 50, 46, 42, 38, 35, 32, 29, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];
    // A flick that scrolled the content: its momentum hits the end and stops there.
    const flick = wheelPull();
    feed(flick, 0, [20, 40, 60], MIDDLE);
    expect(feed(flick, 48, momentum)).toBe(0);
    // A small push begun at the end: its growing deltas count, the momentum after it doesn't.
    const push = wheelPull();
    expect(feed(push, 0, [10, 30, 60])).toBe(100);
    expect(feed(push, 48, momentum.slice(1))).toBe(100);
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

  it("ignores events without a vertical part", () => {
    const pull = wheelPull();
    pull.wheel(0, 100, END);
    expect(pull.wheel(16, 0, MIDDLE)).toBe(100);
  });
});

describe("scroll to close: a finger", () => {
  it("drags the sheet past the top, and back", () => {
    const pull = touchPull();
    pull.start(300);
    expect(pull.move(280, TOP)).toBe(0); // scrolls the content down: nothing to pull
    pull.start(300);
    expect(pull.move(340, TOP)).toBe(-40);
    expect(pull.move(300 + TOUCH_CLOSE, TOP)).toBe(-TOUCH_CLOSE);
    expect(pull.move(330, TOP)).toBe(-30);
    // Dragged back past where the pull began: the content scrolls again.
    expect(pull.move(250, MIDDLE)).toBe(0);
  });

  it("drags past the end", () => {
    const pull = touchPull();
    pull.start(500);
    expect(pull.move(480, END)).toBe(20);
    expect(pull.move(380, END)).toBe(120);
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
