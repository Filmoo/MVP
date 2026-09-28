import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spring } from "../../src/design/motion";

// The spring easing in tokens.css is a sample of design/motion.ts: keep them the same curve.
const tokens = readFileSync(join(import.meta.dirname, "../../src/design/tokens.css"), "utf8");

describe("--ease-spring", () => {
  it("is design/motion.ts spring({ stiffness: 520, damping: 34, points: 24 })", () => {
    const declared = /--ease-spring:\s*(linear\([^)]*\))/.exec(tokens)?.[1]?.replace(/\s+/g, " ").replace("( ", "(").replace(" )", ")");
    const { easing, duration } = spring({ stiffness: 520, damping: 34, points: 24 });
    expect(declared).toBe(easing);
    expect(/--dur-spring:\s*(\d+)ms/.exec(tokens)?.[1]).toBe(String(duration));
  });
});
