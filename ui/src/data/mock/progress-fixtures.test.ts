import { describe, expect, it } from "vitest";
import { queueGroup } from "../../views/home/history";
import { profile } from "./fixtures";
import { demotionLp, demotionPostGame, ladder, longHistory, lpFor, olderFrom, winLp, winPostGame } from "./progress-fixtures";

describe("the LP fixtures follow the core's ladder", () => {
  it("counts 100 LP per division and plain LP from Master", () => {
    expect(ladder({ tier: "iron", division: "IV", leaguePoints: 0, wins: 0, losses: 0 })).toBe(0);
    expect(ladder({ tier: "emerald", division: "II", leaguePoints: 67, wins: 0, losses: 0 })).toBe(2267);
    expect(ladder({ tier: "master", division: null, leaguePoints: 0, wins: 0, losses: 0 })).toBe(2800);
  });

  it("ends on the profile's standing, each game's difference its delta", () => {
    const games = lpFor(profile);
    expect(games[0]?.after).toEqual(profile.soloQueue);
    for (const g of games) {
      expect(ladder(g.after) - ladder(g.before)).toBe(g.delta);
      expect(ladder(g.after)).toBe(g.ladder);
    }
    // One after the other: each game ends where the next one (newer) starts.
    games.slice(1).forEach((g, i) => {
      expect(g.ladder).toBe(ladder(games[i]?.before ?? g.after));
    });
  });

  it("sums up a win worth +21 and a loss that demotes", () => {
    expect(winPostGame.lp?.delta).toBe(21);
    expect(winPostGame.win && winPostGame.opponent?.role === winPostGame.me.role).toBe(true);
    expect(winLp[0]?.gameId).toBe(Number(winPostGame.matchId.split("_")[1]));
    const demoted = demotionLp[0];
    expect([demoted?.before.tier, demoted?.before.division, demoted?.after.tier, demoted?.after.division, demoted?.delta]).toEqual([
      "emerald",
      "IV",
      "platinum",
      "I",
      -35,
    ]);
    expect(demotionPostGame.win).toBe(false);
  });

  it("pages the long history like the client: 20 at a time, both ends included", () => {
    expect(olderFrom({ begIndex: 20 })).toHaveLength(20);
    expect(olderFrom({ begIndex: 40 })).toHaveLength(longHistory.length - 40);
    expect(olderFrom({ begIndex: 60 })).toEqual([]);
  });
});

describe("queue filters", () => {
  it("put every Howling Abyss queue with ARAM and everything unranked in Other", () => {
    expect([420, 440, 450, 720, 2400, 920, 400, 1700, 3130].map(queueGroup)).toEqual([
      "solo",
      "flex",
      "aram",
      "aram",
      "aram",
      "aram",
      "other",
      "other",
      "other",
    ]);
  });
});
