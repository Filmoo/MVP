import { describe, expect, it } from "vitest";
import type { ChampionInfo } from "../../data/generated/ChampionInfo";
import { bestMatches, fold, matchScore } from "../../lib/fuzzy";
import { formatRiotId, parsePlayerPath, parseRiotId, playerPath } from "../../lib/riot-id";
import { buildSections, defaultIndex, MAX_CHAMPIONS } from "./options";

const champ = (id: number, name: string): ChampionInfo => ({ id, key: name.replace(/\W/g, ""), name, tags: [] });
const CHAMPIONS = [
  champ(103, "Ahri"),
  champ(166, "Akshan"),
  champ(84, "Akali"),
  champ(21, "Miss Fortune"),
  champ(145, "Kai'Sa"),
  champ(36, "Dr. Mundo"),
  champ(20, "Nunu & Willump"),
  champ(62, "Wukong"),
  champ(11, "Master Yi"),
];

describe("fuzzy champion matching", () => {
  it("folds accents, case and punctuation", () => {
    expect(fold("Kai'Sa")).toBe("kaisa");
    expect(fold("Nunu & Willump")).toBe("nunuwillump");
  });

  it("ranks exact, prefix, word, initials, substring, then loose matches", () => {
    const names = (q: string) => bestMatches(q, CHAMPIONS, (c) => c.name, 5).map((c) => c.name);
    expect(names("ahri")[0]).toBe("Ahri");
    expect(names("ak")).toEqual(["Akali", "Akshan"]);
    expect(names("fortune")).toEqual(["Miss Fortune"]);
    expect(names("mf")).toEqual(["Miss Fortune"]);
    expect(names("kaisa")).toEqual(["Kai'Sa"]);
    expect(names("mundo")).toEqual(["Dr. Mundo"]);
    expect(names("wkong")).toEqual(["Wukong"]);
    expect(names("zzz")).toEqual([]);
    expect(matchScore("", "Ahri")).toBeNull();
  });
});

describe("Riot IDs", () => {
  it("parses Name#TAG and nothing else", () => {
    expect(parseRiotId("Fillmo#7272")).toEqual({ gameName: "Fillmo", tagLine: "7272" });
    expect(parseRiotId("  Hide  on bush #KR1 ")).toEqual({ gameName: "Hide on bush", tagLine: "KR1" });
    expect(parseRiotId("Fillmo")).toBeNull();
    expect(parseRiotId("Fillmo#")).toBeNull();
    expect(parseRiotId("#EUW")).toBeNull();
    expect(parseRiotId("Name#TOOLONG")).toBeNull();
    expect(parseRiotId("Déjà Vu#ÉÜW")).toEqual({ gameName: "Déjà Vu", tagLine: "ÉÜW" });
  });

  it("round-trips player routes, spaces and non-ASCII included", () => {
    const id = { gameName: "Déjà Vu/x", tagLine: "1v9" };
    const path = playerPath("euw1", id);
    expect(path).toBe("/player/euw1/D%C3%A9j%C3%A0%20Vu%2Fx/1v9");
    expect(parsePlayerPath(path)).toEqual({ platform: "euw1", riotId: id });
    expect(parsePlayerPath("/player/euw1/%E0%A4%A/x")).toBeNull();
    expect(parsePlayerPath("/player/euw1/only")).toBeNull();
    expect(formatRiotId(id)).toBe("Déjà Vu/x#1v9");
  });
});

describe("search sections", () => {
  it("are champions then players, whatever is typed", () => {
    const ids = (q: string) => buildSections(q, "euw1", CHAMPIONS, []).map((s) => s.id);
    expect(ids("ahri")).toEqual(["champions", "players"]);
    expect(ids("Fillmo#7272")).toEqual(["champions", "players"]);
    expect(ids("zzz")).toEqual(["champions", "players"]);
  });

  it("offer a player row only for a full Riot ID, and find champions by its name", () => {
    const [champions, players] = buildSections("Ahri#EUW", "euw1", CHAMPIONS, []);
    expect(champions?.options.map((o) => o.kind === "champion" && o.championId)).toEqual([103]);
    expect(players?.options).toEqual([
      { kind: "player", key: "p:euw1", platform: "euw1", riotId: { gameName: "Ahri", tagLine: "EUW" }, recent: false },
    ]);
    const [, hint] = buildSections("Ahri", "euw1", CHAMPIONS, []);
    expect(hint?.options).toEqual([]);
    expect(hint?.note).toBe("typeRiotId");
  });

  it("cap champions and say when none match", () => {
    expect(buildSections("a", "euw1", CHAMPIONS, [])[0]?.options.length).toBeLessThanOrEqual(MAX_CHAMPIONS);
    expect(buildSections("zzz", "euw1", CHAMPIONS, [])[0]?.note).toBe("noChampion");
  });

  it("list recent searches for an empty query", () => {
    expect(buildSections("", "euw1", CHAMPIONS, [])).toEqual([]);
    const sections = buildSections("  ", "euw1", CHAMPIONS, [
      { kind: "player", platform: "kr", riotId: { gameName: "Faker", tagLine: "KR1" } },
      { kind: "champion", championId: 103 },
    ]);
    expect(sections.map((s) => s.id)).toEqual(["recent"]);
    expect(sections[0]?.options.map((o) => o.kind)).toEqual(["player", "champion"]);
  });

  it("highlight the player for a Riot ID, else the best champion", () => {
    const options = (q: string) => buildSections(q, "euw1", CHAMPIONS, []).flatMap((s) => s.options);
    expect(defaultIndex("Ahri#EUW", options("Ahri#EUW"))).toBe(1);
    expect(defaultIndex("ahri", options("ahri"))).toBe(0);
    expect(defaultIndex("Zed#1", options("Zed#1"))).toBe(0);
    expect(defaultIndex("zzz", options("zzz"))).toBe(-1);
  });
});
