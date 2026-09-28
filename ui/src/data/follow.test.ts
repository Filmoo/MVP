import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createFollowed } from "./follow";

/** A core answer the test resolves or rejects by hand, and an event it pushes by hand. */
function core<T>() {
  let settle!: { resolve: (v: T) => void; reject: (e: unknown) => void };
  const listeners = new Set<(v: T) => void>();
  return {
    ask: () =>
      new Promise<T>((resolve, reject) => {
        settle = { resolve, reject };
      }),
    subscribe: (set: (v: T) => void) => {
      listeners.add(set);
      return () => listeners.delete(set);
    },
    answer: (v: T) => settle.resolve(v),
    fail: (e: unknown) => settle.reject(e),
    push: (v: T) => {
      for (const set of listeners) set(v);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createFollowed", () => {
  it("takes the first answer, then every event", async () => {
    const c = core<string | null>();
    const [value, dispose] = createRoot((d) => [createFollowed(c.ask, c.subscribe)[0], d] as const);
    c.answer(null);
    await tick();
    expect(value.state).toBe("ready");
    expect(value()).toBeNull();
    c.push("draft");
    expect(value()).toBe("draft");
    dispose();
  });

  it("keeps an event that arrives while the first answer is on its way (the answer is older)", async () => {
    const c = core<string | null>();
    const [value, dispose] = createRoot((d) => [createFollowed(c.ask, c.subscribe)[0], d] as const);
    c.push("champ select");
    c.answer(null);
    await tick();
    expect(value.state).toBe("ready");
    expect(value()).toBe("champ select");
    dispose();
  });

  it("keeps a pushed null too (the thing ended while the first answer was on its way)", async () => {
    const c = core<string | null>();
    const [value, dispose] = createRoot((d) => [createFollowed(c.ask, c.subscribe)[0], d] as const);
    c.push(null);
    c.answer("champ select");
    await tick();
    expect(value()).toBeNull();
    dispose();
  });

  it("errs only when nothing was heard", async () => {
    const quiet = core<string>();
    const [failed, stopQuiet] = createRoot((d) => [createFollowed(quiet.ask, quiet.subscribe)[0], d] as const);
    quiet.fail(new Error("no core"));
    await tick();
    expect(failed.state).toBe("errored");
    stopQuiet();

    const heard = core<string>();
    const [value, stopHeard] = createRoot((d) => [createFollowed(heard.ask, heard.subscribe)[0], d] as const);
    heard.push("game");
    heard.fail(new Error("no core"));
    await tick();
    expect(value.state).toBe("ready");
    expect(value()).toBe("game");
    stopHeard();
  });
});
