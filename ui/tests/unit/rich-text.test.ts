import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TextSpan } from "../../src/data/generated/TextSpan";
import { hasPlaceholder, richText, stressValue } from "../../src/data/mock/descriptions";

// The browser mock reads Riot's text like the core (crates/static-data/src/descriptions.rs):
// both are held to the same cases.
const cases = JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/rich-text-cases.json"), "utf8")) as Array<{
  name: string;
  markup: string;
  lines: TextSpan[][];
}>;

describe("the mock's reading of Riot's markup", () => {
  it("has the shared cases to follow", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of cases) {
    it(c.name, () => {
      expect(richText(c.markup)).toEqual(c.lines);
    });
  }

  it("never lets markup through", () => {
    const lines = richText("<img src=x onerror='y'>a<svg onload=z>b</svg>&lt;script&gt;");
    expect(lines).toEqual([[{ text: "ab<script>" }]]);
  });

  it("stresses a stat shard's leading value, like the core", () => {
    const stressed = (text: string) => stressValue([[{ text }]])[0];
    expect(stressed("+9 Adaptive Force")).toEqual([{ text: "+9", tone: "strong" }, { text: " Adaptive Force" }]);
    expect(stressed("+2.5% Move Speed")?.[0]).toEqual({ text: "+2.5%", tone: "strong" });
    expect(stressed("+10 - 180 PV (selon le niveau)")?.[0]).toEqual({ text: "+10 - 180", tone: "strong" });
    expect(stressed("Gain stacks.")).toEqual([{ text: "Gain stacks." }]);
    expect(stressed("+8")).toEqual([{ text: "+8" }]);
  });

  it("spots values the game fills in", () => {
    expect(hasPlaceholder("Deals @TotalDamage@ damage")).toBe(true);
    expect(hasPlaceholder("+@f1@ Health")).toBe(true);
    expect(hasPlaceholder("mail@example.com")).toBe(false);
    expect(hasPlaceholder("@ @")).toBe(false);
  });
});
