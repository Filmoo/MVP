import { type Accessor, createComputed, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";

/** Runs `run` later; returns a cancel function. */
export type Schedule = (run: () => void) => () => void;

/** When the page is idle, after the frame being built is painted (the timeout: on a busy page too). */
const whenIdle: Schedule = (run) => {
  const handle = requestIdleCallback(run, { timeout: 250 });
  return () => cancelIdleCallback(handle);
};

/**
 * A long list built a slice at a time: `first` items at once, then `step` more each time the page
 * is idle, so the frame that shows a view doesn't also build what is below the fold (the champion
 * grid: a first screen holds 12 to 156 of its ~170 tiles). A new list starts over from its first
 * slice; once every item is built, nothing is scheduled.
 */
export function createProgressive<T>(
  list: Accessor<readonly T[]>,
  first: number,
  step: number = first,
  schedule: Schedule = whenIdle,
): { shown: Accessor<readonly T[]>; complete: Accessor<boolean> } {
  const [count, setCount] = createSignal(first);
  createComputed(on(list, () => setCount(first), { defer: true }));
  createEffect(() => {
    if (count() >= list().length) return;
    onCleanup(schedule(() => setCount((n) => n + step)));
  });
  const shown = createMemo(() => {
    const all = list();
    const n = count();
    return n >= all.length ? all : all.slice(0, n);
  });
  return { shown, complete: () => count() >= list().length };
}
