import { type Accessor, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createProgressive, type Schedule } from "./progressive";

/** A scheduler the test runs by hand: `pending()` is what waits, `run()` lets it happen. */
function manual() {
  const waiting = new Set<() => void>();
  const schedule: Schedule = (run) => {
    waiting.add(run);
    return () => waiting.delete(run);
  };
  return {
    schedule,
    pending: () => waiting.size,
    run: () => {
      for (const run of [...waiting]) {
        waiting.delete(run);
        run();
      }
    },
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** The list under a root (its effects run once the root is set up, as in a view). */
function progressive<T>(list: Accessor<readonly T[]>, first: number, step: number, schedule: Schedule) {
  return createRoot((dispose) => ({ ...createProgressive(list, first, step, schedule), dispose }));
}

describe("createProgressive", () => {
  it("shows the first slice at once, then a step each time the page is idle", () => {
    const idle = manual();
    const { shown, complete, dispose } = progressive(() => range(10), 4, 3, idle.schedule);
    expect(shown()).toEqual([0, 1, 2, 3]);
    expect(complete()).toBe(false);
    idle.run();
    expect(shown()).toHaveLength(7);
    idle.run();
    expect(shown()).toEqual(range(10));
    expect(complete()).toBe(true);
    expect(idle.pending(), "nothing is scheduled once complete").toBe(0);
    dispose();
  });

  it("keeps the items it already built (the same references)", () => {
    const idle = manual();
    const items = range(5).map((i) => ({ i }));
    const { shown, dispose } = progressive(() => items, 2, 2, idle.schedule);
    const before = shown()[1];
    idle.run();
    expect(shown()).toHaveLength(4);
    expect(shown()[1]).toBe(before);
    dispose();
  });

  it("starts over from the first slice when the list changes", () => {
    const idle = manual();
    const [list, setList] = createSignal(range(10));
    const { shown, dispose } = progressive(list, 3, 3, idle.schedule);
    idle.run();
    expect(shown()).toHaveLength(6);
    setList(range(8).map((i) => i * 10));
    expect(shown()).toEqual([0, 10, 20]);
    expect(idle.pending()).toBe(1);
    dispose();
  });

  it("a short list is complete at once and schedules nothing", () => {
    const idle = manual();
    const { shown, complete, dispose } = progressive(() => range(3), 40, 40, idle.schedule);
    expect(shown()).toEqual([0, 1, 2]);
    expect(complete()).toBe(true);
    expect(idle.pending()).toBe(0);
    dispose();
  });

  it("cancels what is scheduled when its owner goes (a view left before the list is built)", () => {
    const idle = manual();
    const { dispose } = progressive(() => range(100), 10, 10, idle.schedule);
    expect(idle.pending()).toBe(1);
    dispose();
    expect(idle.pending()).toBe(0);
  });
});
