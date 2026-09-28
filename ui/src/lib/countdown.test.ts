import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createCountdown, type Timer } from "./countdown";

/** A clock and a timer the test moves by hand. */
function manual(start: number) {
  let time = start;
  const waiting = new Map<() => void, number>();
  const timer: Timer = (run, ms) => {
    waiting.set(run, time + ms);
    return () => waiting.delete(run);
  };
  return {
    now: () => time,
    timer,
    pending: () => waiting.size,
    /** Moves the clock, running what falls due on the way. */
    advance(ms: number) {
      const until = time + ms;
      for (;;) {
        const next = [...waiting].sort((a, b) => a[1] - b[1])[0];
        if (!next || next[1] > until) break;
        waiting.delete(next[0]);
        time = next[1];
        next[0]();
      }
      time = until;
    },
  };
}

describe("createCountdown", () => {
  it("counts down to the deadline between the client's timer snapshots", () => {
    const clock = manual(1_000_000);
    const [deadline, setDeadline] = createSignal<number | null>(1_000_000 + 77_697);
    const { left, dispose } = createRoot((dispose) => ({
      left: createCountdown(deadline, clock.now, clock.timer),
      dispose,
    }));
    expect(left()).toBe(78);
    clock.advance(700);
    expect(left()).toBe(77);
    clock.advance(60_000);
    expect(left()).toBe(17);

    // A new snapshot (a hover, a lock-in) moves the deadline.
    setDeadline(clock.now() + 10_000);
    expect(left()).toBe(10);
    clock.advance(10_010);
    expect(left()).toBe(0);
    expect(clock.pending()).toBe(0);
    dispose();
  });

  it("stays still without a deadline, and stops when disposed", () => {
    const clock = manual(0);
    const [deadline, setDeadline] = createSignal<number | null>(null);
    const { left, dispose } = createRoot((dispose) => ({
      left: createCountdown(deadline, clock.now, clock.timer),
      dispose,
    }));
    expect(left()).toBeNull();
    expect(clock.pending()).toBe(0);
    setDeadline(30_000);
    expect(clock.pending()).toBe(1);
    dispose();
    expect(clock.pending()).toBe(0);
  });
});
