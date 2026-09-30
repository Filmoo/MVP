import { describe, expect, it } from "vitest";
import type { GradedMatch } from "../../data/generated/GradedMatch";
import { profile } from "../../data/mock/fixtures";
import { summarize, withLateRoles } from "./summary";

describe("withLateRoles", () => {
  const [first, second, third] = profile.recentMatches;
  if (!first || !second || !third) throw new Error("the fixture has games");
  const answer = (matchId: string, role: GradedMatch["role"]): [string, GradedMatch] => [matchId, { matchId, grade: null, role }];

  it("follows the roles of the games the core read, keeps the others", () => {
    // The list called the first game mid; the whole game says top. The second wasn't read.
    const late = new Map([answer(first.matchId, "top"), answer(third.matchId, null)]);
    const rows = withLateRoles(profile.recentMatches, late);
    expect(rows[0]?.role).toBe("top");
    expect(rows[1]).toBe(second);
    expect(rows[2]).toBe(third);
    expect(summarize(rows).roles[0]).toEqual({ role: "middle", games: 8 });
    expect(summarize(rows).roles).toContainEqual({ role: "top", games: 1 });
  });

  it("leaves the list alone until the answers are in", () => {
    expect(withLateRoles(profile.recentMatches, undefined)).toBe(profile.recentMatches);
    const same = new Map([answer(first.matchId, first.role)]);
    expect(withLateRoles(profile.recentMatches, same)[0]).toBe(first);
  });
});

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
