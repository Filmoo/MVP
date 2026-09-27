import { describe, expect, it } from "vitest";
import { duration, kdaRatio, percent, perMinute, queueName, timeAgo, winRate } from "./format";

describe("format", () => {
  it("formats KDA ratios including perfect games", () => {
    expect(kdaRatio(9, 2, 11)).toBe("10.00");
    expect(kdaRatio(14, 0, 7)).toBe("Perfect");
    expect(kdaRatio(0, 0, 0)).toBe("0.00");
  });

  it("formats durations and per-minute rates", () => {
    expect(duration(1742)).toBe("29:02");
    expect(duration(59)).toBe("0:59");
    expect(perMinute(231, 1742)).toBe("8.0");
    expect(perMinute(10, 0)).toBe("0.0");
  });

  it("formats relative times", () => {
    const now = 1_000_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(timeAgo(now + 60_000, now)).toBe("just now");
  });

  it("computes win rates safely", () => {
    expect(winRate(0, 0)).toBeNull();
    expect(winRate(142, 128)).toBeCloseTo(0.5259, 3);
    expect(percent(0.5259)).toBe("53%");
  });

  it("names queues", () => {
    expect(queueName(420)).toBe("Ranked Solo");
    expect(queueName(123_456)).toBe("Custom");
  });
});
