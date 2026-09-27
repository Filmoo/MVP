import { describe, expect, it } from "vitest";
import { profile } from "../../data/mock/fixtures";
import { summarize } from "./summary";

describe("summarize", () => {
  it("excludes remakes and aggregates the rest", () => {
    const s = summarize(profile.recentMatches);
    expect(profile.recentMatches).toHaveLength(12);
    expect(s.games).toBe(11); // one 3:31 remake
    expect(s.wins).toBe(7);
    expect(s.champions[0]).toMatchObject({
      championId: 103,
      games: 3,
      wins: 2,
    });
    expect(s.roles[0]).toEqual({ role: "middle", games: 9 });
    const counted = profile.recentMatches.filter((m) => m.durationSeconds > 300);
    const seconds = counted.reduce((sum, m) => sum + m.durationSeconds, 0);
    expect(s.averageSeconds).toBeCloseTo(seconds / 11, 6);
  });

  it("handles no games", () => {
    const s = summarize([]);
    expect(s).toMatchObject({
      games: 0,
      wins: 0,
      csPerMinute: 0,
      averageSeconds: 0,
      champions: [],
      roles: [],
    });
  });
});
