import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spring } from "../../src/design/motion";

// The spring easing in tokens.css is a sample of design/motion.ts: keep them the same curve.
const tokens = readFileSync(join(import.meta.dirname, "../../src/design/tokens.css"), "utf8");

const easing = (name: string) =>
  new RegExp(`--ease-${name}:\\s*(linear\\([^)]*\\))`).exec(tokens)?.[1]?.replace(/\s+/g, " ").replace("( ", "(").replace(" )", ")");
const duration = (name: string) => new RegExp(`--dur-${name}:\\s*(\\d+)ms`).exec(tokens)?.[1];

describe("spring tokens", () => {
  it("--ease-spring is design/motion.ts spring({ stiffness: 520, damping: 34, points: 24 })", () => {
    const expected = spring({ stiffness: 520, damping: 34, points: 24 });
    expect(easing("spring")).toBe(expected.easing);
    expect(duration("spring")).toBe(String(expected.duration));
  });

  it("--ease-glide is the same spring critically damped, and never overshoots", () => {
    const expected = spring({ stiffness: 520, damping: 46, points: 24 });
    expect(easing("glide")).toBe(expected.easing);
    expect(duration("glide")).toBe(String(expected.duration));
    const values = (easing("glide") ?? "").slice("linear(".length, -1).split(", ").map(Number);
    expect(Math.max(...values)).toBe(1);
  });
});
