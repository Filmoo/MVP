import { describe, expect, it } from "vitest";
import { setSettingsBracket } from "./settings";
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

  it("start from the settings' bracket until one is picked on the pages", () => {
    setFilter(DEFAULT_FILTERS);
    setSettingsBracket("diamondPlus");
    expect(filters().bracket).toBe("diamondPlus");
    setFilter({ bracket: "masterPlus" });
    setFilter({ queue: 450 });
    expect(filters()).toEqual({ queue: 450, bracket: "masterPlus", role: "all" });
    // Another bracket in Settings: the pages go to it.
    setSettingsBracket("emeraldPlus");
    expect(filters().bracket).toBe("emeraldPlus");
    // Picking the settings' own bracket follows the settings again.
    setFilter({ bracket: "emeraldPlus" });
    setSettingsBracket("masterPlus");
    expect(filters().bracket).toBe("masterPlus");
    setSettingsBracket("emeraldPlus");
    setFilter(DEFAULT_FILTERS);
  });

  it("read older saved brackets as picked over Emerald+", () => {
    const old = JSON.stringify({ queue: 420, bracket: "diamondPlus", role: "all" });
    expect(parseFilters(old).bracket).toBe("diamondPlus");
    expect(parseFilters(old, "masterPlus").bracket).toBe("masterPlus");
    const picked = JSON.stringify({ queue: 420, bracket: "diamondPlus", over: "masterPlus", role: "all" });
    expect(parseFilters(picked, "masterPlus").bracket).toBe("diamondPlus");
    expect(parseFilters(picked).bracket).toBe("emeraldPlus");
  });
});
