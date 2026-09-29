import { describe, expect, it } from "vitest";
import type { Feature } from "../types";
import { fold, fromParams, isFiltered, matches, NO_FILTERS, toggle, toParams } from "./filters";

const feature: Feature = {
  id: 12,
  title: "Glass you see through",
  description: "Less *frost*, more bend.",
  versionId: 1,
  status: "done",
  area: "design",
  proposedBy: "owner",
  position: 0,
  links: [],
  comments: 0,
  createdAt: "2026-09-28T00:00:00Z",
  updatedAt: "2026-09-28T00:00:00Z",
  startedAt: null,
  doneAt: null,
  removedAt: null,
};
const areaName = (key: string) => (key === "design" ? "Design & glass" : key);

describe("matching", () => {
  it("shows everything but rejected and removed by default", () => {
    expect(matches(feature, NO_FILTERS, areaName)).toBe(true);
    expect(matches({ ...feature, status: "rejected" }, NO_FILTERS, areaName)).toBe(false);
    expect(matches({ ...feature, removedAt: "x" }, NO_FILTERS, areaName)).toBe(false);
    expect(matches({ ...feature, status: "rejected" }, { ...NO_FILTERS, statuses: ["rejected"] }, areaName)).toBe(true);
  });

  it("filters by area, status and who proposed", () => {
    expect(matches(feature, { ...NO_FILTERS, areas: ["draft"] }, areaName)).toBe(false);
    expect(matches(feature, { ...NO_FILTERS, areas: ["design", "draft"] }, areaName)).toBe(true);
    expect(matches(feature, { ...NO_FILTERS, statuses: ["in_progress"] }, areaName)).toBe(false);
    expect(matches(feature, { ...NO_FILTERS, proposers: ["claude"] }, areaName)).toBe(false);
  });

  it("searches every word in title, description, area and id", () => {
    for (const query of ["glass", "FROST bend", "design", "#12", "  see  "]) {
      expect(matches(feature, { ...NO_FILTERS, query }, areaName), query).toBe(true);
    }
    expect(matches(feature, { ...NO_FILTERS, query: "glass overlay" }, areaName)).toBe(false);
    expect(fold("Épée À")).toBe("epee a");
  });
});

describe("the URL", () => {
  it("round-trips and drops what it doesn't know", () => {
    const filters = { query: "live names", areas: ["live", "draft"], statuses: ["done" as const], proposers: ["claude" as const] };
    const params = toParams(filters);
    expect(params.toString()).toBe("area=live%2Cdraft&status=done&by=claude&q=live+names");
    expect(fromParams(params, ["live", "draft"])).toEqual(filters);
    expect(fromParams(new URLSearchParams("status=done,removed&by=root&area=x"), ["live"])).toEqual({
      query: "",
      areas: [],
      statuses: ["done"],
      proposers: [],
    });
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, query: " x " })).toBe(true);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
  });
});
