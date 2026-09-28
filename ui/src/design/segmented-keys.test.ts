import { describe, expect, it } from "vitest";
import { segmentFor } from "./segmented-keys";

describe("segmented control keys", () => {
  it("move to the next and previous segment, wrapping around", () => {
    expect(segmentFor("ArrowRight", 0, 3)).toBe(1);
    expect(segmentFor("ArrowDown", 2, 3)).toBe(0);
    expect(segmentFor("ArrowLeft", 0, 3)).toBe(2);
    expect(segmentFor("ArrowUp", 1, 3)).toBe(0);
  });

  it("jump to the ends", () => {
    expect(segmentFor("Home", 2, 3)).toBe(0);
    expect(segmentFor("End", 0, 3)).toBe(2);
  });

  it("leave other keys (Tab, Enter, letters) to the browser", () => {
    for (const key of ["Tab", "Enter", " ", "a"]) expect(segmentFor(key, 1, 3)).toBeUndefined();
    expect(segmentFor("ArrowRight", 0, 0)).toBeUndefined();
  });
});
