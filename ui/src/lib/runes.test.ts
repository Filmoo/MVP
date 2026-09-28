import { describe, expect, it } from "vitest";
import { plainText } from "../data/mock/game-data";
import { runePage, SHARD_ROWS, SHARDS, shard, styleTone } from "./runes";

describe("rune pages", () => {
  it("read the published ids layout", () => {
    expect(runePage([8100, 8200, 8112, 8139, 8140, 8106, 8226, 8210, 5008, 5008, 5001])).toEqual({
      primary: 8100,
      sub: 8200,
      perks: [8112, 8139, 8140, 8106],
      subPerks: [8226, 8210],
      shards: [5008, 5008, 5001],
    });
    expect(runePage([8100, 8200])).toBeUndefined();
  });

  it("name every shard the client offers, and survive a new one", () => {
    for (const row of SHARD_ROWS) for (const id of row.ids) expect(SHARDS.has(id), `shard ${id}`).toBe(true);
    expect(shard(5008).name).toBe("Adaptive Force");
    expect(shard(5099)).toMatchObject({ id: 5099, name: "Stat shard" });
  });

  it("color each tree, neutral for unknown ones", () => {
    expect(styleTone(8000)).toBe("precision");
    expect(styleTone(9999)).toBe("neutral");
  });

  it("dev descriptions drop markup like the core does", () => {
    expect(plainText("Deal <b>bonus</b> <lol-uikit-tooltipped-keyword key='x'>damage</lol-uikit-tooltipped-keyword>.")).toBe(
      "Deal bonus damage.",
    );
    expect(plainText("Gain stacks.<br>Heal.<br/>Done")).toBe("Gain stacks. Heal. Done");
  });
});
