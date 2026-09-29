import { describe, expect, it } from "vitest";
import { fuzzy, rank } from "./fuzzy";

describe("fuzzy", () => {
  it("finds letters in order and nothing else", () => {
    expect(fuzzy("stsr", "Settings search")).not.toBeNull();
    expect(fuzzy("xyz", "Settings search")).toBeNull();
    expect(fuzzy("", "anything")?.score).toBe(0);
  });

  it("prefers substrings, then word starts", () => {
    const titles = ["Tier list trends", "Settings search", "Live names from Spectator-V5", "The website on mvpgg.com"];
    expect(rank(titles, "live", (t) => t)[0]?.item).toBe("Live names from Spectator-V5");
    expect(rank(titles, "web", (t) => t)[0]?.item).toBe("The website on mvpgg.com");
    expect(rank(titles, "tlt", (t) => t)[0]?.item).toBe("Tier list trends");
    expect(rank(titles, "", (t) => t, 2).map((r) => r.item)).toEqual(titles.slice(0, 2));
  });

  it("marks what matched", () => {
    expect(fuzzy("sea", "Settings search")?.hits).toEqual([9, 10, 11]);
    expect(fuzzy("écl", "Eclat")?.hits).toEqual([0, 1, 2]);
  });
});
