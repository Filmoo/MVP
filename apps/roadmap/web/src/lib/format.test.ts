import { describe, expect, it } from "vitest";
import { ago, count, day } from "./format";

describe("format", () => {
  it("writes days", () => {
    expect(day("2026-09-28", 2026)).toBe("28 Sep");
    expect(day("2025-12-01T10:00:00Z", 2026)).toBe("1 Dec 2025");
    expect(day("soon")).toBe("soon");
  });

  it("says how long ago", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    expect(ago("2026-09-29T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-09-29T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-09-29T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-09-28T10:00:00Z", now)).toBe("yesterday");
    expect(ago("2026-09-25T12:00:00Z", now)).toBe("4 days ago");
    expect(ago("2026-08-01T12:00:00Z", now)).toBe("1 Aug");
  });

  it("counts", () => {
    expect(count(1, "feature")).toBe("1 feature");
    expect(count(0, "proposal")).toBe("0 proposals");
  });
});
