import { describe, expect, it } from "vitest";
import { dominantColors, pastel } from "./palette";

function image(colors: Array<[number, number, number, number]>): number[] {
  return colors.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat());
}

describe("ambient palette", () => {
  it("finds the two vivid hue families, biggest first, then the average", () => {
    const colors = dominantColors(
      image([
        [220, 40, 60, 60], // red, most
        [40, 90, 220, 30], // blue
        [30, 30, 30, 10], // dark grey, ignored as a hue
      ]),
    );
    expect(colors).toHaveLength(3);
    const [first, second] = colors;
    expect(first?.[0]).toBeGreaterThan(first?.[2] ?? 0); // reddish
    expect(second?.[2]).toBeGreaterThan(second?.[0] ?? 0); // bluish
  });

  it("makes every color pastel: light and softly saturated", () => {
    for (const c of dominantColors(
      image([
        [255, 0, 0, 10],
        [0, 0, 255, 10],
      ]),
    )) {
      const light = (Math.max(...c) + Math.min(...c)) / 2 / 255;
      expect(light).toBeGreaterThan(0.6);
      expect(light).toBeLessThan(0.72);
    }
    expect(pastel([0, 0, 0])).toEqual([168, 168, 168]);
    expect(pastel([10, 10, 12])).toEqual([168, 168, 168]);
  });

  it("returns only the average for greyscale art and nothing for transparent pixels", () => {
    expect(dominantColors(image([[120, 120, 120, 20]]))).toHaveLength(1);
    expect(dominantColors([0, 0, 0, 0])).toEqual([]);
  });
});
