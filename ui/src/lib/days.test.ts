import { describe, expect, it } from "vitest";
import { dayLabel, groupByDay } from "./days";

const NOW = new Date(2026, 8, 27, 20, 0).getTime(); // Sunday 27 Sep 2026, 20:00 local
const at = (d: number, h: number) => new Date(2026, 8, d, h, 0).getTime();

describe("days", () => {
  it("labels days like a person would", () => {
    expect(dayLabel(at(27, 1), NOW)).toBe("Today");
    expect(dayLabel(at(26, 23), NOW)).toBe("Yesterday");
    expect(dayLabel(at(23, 12), NOW)).toBe("Wednesday");
    expect(dayLabel(at(12, 12), NOW)).toBe("12 Sep");
  });

  it("groups consecutive games of the same day, keeping order", () => {
    const games = [at(27, 19), at(27, 9), at(26, 22), at(24, 10), at(24, 8)];
    const groups = groupByDay(games, (t) => t, NOW);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
      ["Thursday", 2],
    ]);
  });
});
