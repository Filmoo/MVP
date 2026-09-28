import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import {
  decimal,
  duration,
  games,
  integer,
  kdaRatio,
  listOf,
  percent,
  percentOf100,
  perMinute,
  queueName,
  signedPoints,
  timeAgo,
  winRate,
} from "./format";

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

  it("signs percentage points with a true minus", () => {
    expect(signedPoints(3.14)).toBe("+3.1");
    expect(signedPoints(-2.06)).toBe("−2.1");
    expect(signedPoints(0.04)).toBe("0.0");
    expect(signedPoints(-0.04)).toBe("0.0");
  });

  it("formats game counts", () => {
    expect(games(812)).toBe("812");
    expect(games(3244)).toBe("3,244");
    expect(games(11_020)).toBe("11K");
    expect(games(127_400)).toBe("127K");
    expect(games(999_400)).toBe("999K");
    expect(games(999_600)).toBe("1M");
    expect(games(1_912_400)).toBe("1.9M");
  });

  it("names queues", () => {
    expect(queueName(420)).toBe("Ranked Solo");
    expect(queueName(2400)).toBe("ARAM: Mayhem");
    expect(queueName(123_456)).toBe("Custom");
  });
});

describe("format in French", () => {
  beforeAll(() => setLanguage("fr"));
  afterAll(() => setLanguage("en"));

  it("uses decimal commas and French words for KDA", () => {
    expect(kdaRatio(9, 2, 11)).toBe("10,00");
    expect(kdaRatio(14, 0, 7)).toBe("Parfait");
    expect(perMinute(231, 1742)).toBe("8,0");
    expect(decimal(1.6)).toBe("1,6");
    expect(duration(1742)).toBe("29:02");
  });

  it("puts a no-break space before the percent sign", () => {
    expect(percent(0.5259)).toBe("53\u00A0%");
    expect(percent(0.546, 1)).toBe("54,6\u00A0%");
    expect(percentOf100(51.5)).toBe("51,5\u00A0%");
  });

  it("groups thousands with a narrow no-break space and abbreviates big counts", () => {
    expect(games(812)).toBe("812");
    expect(games(3244)).toBe("3\u202F244");
    expect(integer(1_234_567)).toBe("1\u202F234\u202F567");
    expect(games(127_400)).toBe("127\u00A0k");
    expect(games(1_912_400)).toBe("1,9\u00A0M");
  });

  it("signs points with a true minus and a decimal comma", () => {
    expect(signedPoints(3.14)).toBe("+3,1");
    expect(signedPoints(-2.06)).toBe("−2,1");
    expect(signedPoints(0.04)).toBe("0,0");
  });

  it("says how long ago like a French speaker", () => {
    const now = 1_000_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe("à\u00A0l’instant");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("il\u00A0y\u00A0a\u00A05\u00A0min");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("il\u00A0y\u00A0a\u00A03\u00A0h");
    expect(timeAgo(now - 30 * 3_600_000, now)).toBe("hier");
    expect(timeAgo(now - 50 * 3_600_000, now)).toBe("avant\u2011hier");
    expect(timeAgo(now - 4 * 86_400_000, now)).toBe("il\u00A0y\u00A0a\u00A04\u00A0j");
    expect(timeAgo(now - 14 * 86_400_000, now)).toBe("il\u00A0y\u00A0a\u00A02\u00A0sem.");
    expect(timeAgo(now - 100 * 86_400_000, now)).toBe("il\u00A0y\u00A0a\u00A03\u00A0mois");
    expect(timeAgo(now - 800 * 86_400_000, now)).toBe("il\u00A0y\u00A0a\u00A02\u00A0ans");
  });

  it("names queues and joins lists in French", () => {
    expect(queueName(420)).toBe("Classé solo/duo");
    expect(queueName(2400)).toBe("ARAM du chaos");
    expect(queueName(123_456)).toBe("Personnalisée");
    expect(listOf(["runes", "set d’objets", "sorts"])).toBe("runes, set d’objets et sorts");
  });
});
