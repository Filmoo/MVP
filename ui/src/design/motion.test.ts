import { describe, expect, it } from "vitest";
import { spring, springAt } from "./motion";

describe("spring", () => {
  it("starts at rest and settles on its target", () => {
    expect(springAt(0, 400, 30)).toBeCloseTo(0, 9);
    expect(springAt(3, 400, 30)).toBeCloseTo(1, 6);
  });

  it("overshoots a hair when underdamped, never when critically damped", () => {
    const peak = (stiffness: number, damping: number) =>
      Math.max(...Array.from({ length: 300 }, (_, i) => springAt(i / 300, stiffness, damping)));
    expect(peak(520, 34)).toBeGreaterThan(1.01);
    expect(peak(520, 34)).toBeLessThan(1.06);
    expect(peak(400, 2 * Math.sqrt(400))).toBeLessThanOrEqual(1);
  });

  it("becomes a CSS linear() easing that ends exactly on 1", () => {
    const s = spring({ stiffness: 520, damping: 34, points: 24 });
    expect(s.easing.startsWith("linear(0, ")).toBe(true);
    expect(s.easing.endsWith(", 1)")).toBe(true);
    expect(s.easing.split(",")).toHaveLength(25);
    expect(s.duration).toBeGreaterThan(200);
    expect(s.duration).toBeLessThan(600);
  });
});
