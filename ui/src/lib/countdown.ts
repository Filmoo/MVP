import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

/** Runs `run` after `ms`; returns a cancel function. */
export type Timer = (run: () => void, ms: number) => () => void;

const afterMs: Timer = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

/**
 * Whole seconds left until `deadline` (Unix epoch milliseconds), `null` without one. It changes
 * as each second passes (a timer set for the next change, none once it reaches 0), so it only
 * wakes the page while a countdown is running.
 */
export function createCountdown(
  deadline: Accessor<number | null>,
  now: () => number = Date.now,
  timer: Timer = afterMs,
): Accessor<number | null> {
  const [tick, setTick] = createSignal(0);
  const left = () => {
    tick();
    const end = deadline();
    return end === null ? null : Math.max(0, Math.ceil((end - now()) / 1000));
  };
  createEffect(() => {
    tick();
    const end = deadline();
    if (end === null) return;
    const ms = end - now();
    if (ms <= 0) return;
    // Wake just past the next whole second, when the number changes.
    onCleanup(timer(() => setTick((n) => n + 1), (ms % 1000 || 1000) + 5));
  });
  return left;
}
