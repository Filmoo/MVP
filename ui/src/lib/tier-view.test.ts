import { describe, expect, it } from "vitest";
import { parseSaved, parseView } from "./tier-view";

describe("tier list view and sort", () => {
  it("start on the shelves, best rank first", () => {
    expect(parseSaved(null)).toEqual({ view: "shelves", sort: { key: "rank", dir: "asc" } });
  });

  it("keep what was saved, each field checked on its own", () => {
    expect(parseSaved(JSON.stringify({ view: "table", sort: { key: "games", dir: "asc" } }))).toEqual({
      view: "table",
      sort: { key: "games", dir: "asc" },
    });
    // A column without a direction takes its own first one.
    expect(parseSaved(JSON.stringify({ view: "table", sort: { key: "winRate" } })).sort).toEqual({ key: "winRate", dir: "desc" });
    expect(parseSaved(JSON.stringify({ view: "grid", sort: { key: "score" } }))).toEqual({
      view: "shelves",
      sort: { key: "rank", dir: "asc" },
    });
    expect(parseSaved("{not json")).toEqual({ view: "shelves", sort: { key: "rank", dir: "asc" } });
  });

  it("read a view from a link", () => {
    expect(parseView("table")).toBe("table");
    expect(parseView("map")).toBeUndefined();
  });
});
