import { describe, expect, it } from "vitest";
import { applyLinkFilters, DEFAULT_FILTERS, filters, parseFilters, parseQueue, setFilter } from "./stats-filters";

describe("stats filters", () => {
  it("read saved choices field by field, falling back per field", () => {
    expect(parseFilters(JSON.stringify({ queue: 450, bracket: "masterPlus", role: "support" }))).toEqual({
      queue: 450,
      bracket: "masterPlus",
      role: "support",
    });
    expect(parseFilters(JSON.stringify({ queue: 440, bracket: "masterPlus", role: "adc" }))).toEqual({
      ...DEFAULT_FILTERS,
      bracket: "masterPlus",
    });
    expect(parseFilters("not json")).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters("null")).toEqual(DEFAULT_FILTERS);
  });

  it("parse queues from links and saved values", () => {
    expect(parseQueue("450")).toBe(450);
    expect(parseQueue(420)).toBe(420);
    expect(parseQueue("440")).toBeUndefined();
    expect(parseQueue(undefined)).toBeUndefined();
  });

  it("apply the valid parts of a link, like a click", () => {
    setFilter(DEFAULT_FILTERS);
    applyLinkFilters({ queue: "450", bracket: "nope", role: "jungle" });
    expect(filters()).toEqual({ queue: 450, bracket: "emeraldPlus", role: "jungle" });
    applyLinkFilters({ queue: null, bracket: null, role: null });
    expect(filters()).toEqual({ queue: 450, bracket: "emeraldPlus", role: "jungle" });
    setFilter(DEFAULT_FILTERS);
  });
});
