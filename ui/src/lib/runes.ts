/**
 * Rune pages as the stats files publish them, and the stat shards, which Data Dragon doesn't
 * describe (ids 5001–5013): named here, drawn as simple glyphs (no Riot art).
 */

/** A published rune page: `[primaryStyle, subStyle, 4 primary perks, 2 secondary perks, 3 shards]`. */
export interface RunePage {
  primary: number;
  sub: number;
  /** Keystone first. */
  perks: number[];
  subPerks: number[];
  /** Offense, flex, defense. */
  shards: number[];
}

/** Reads a page from its published `ids`; `undefined` when the layout doesn't match. */
export function runePage(ids: readonly number[]): RunePage | undefined {
  if (ids.length !== 11) return undefined;
  const [primary = 0, sub = 0] = ids;
  return { primary, sub, perks: ids.slice(2, 6), subPerks: ids.slice(6, 8), shards: ids.slice(8, 11) };
}

export type ShardGlyph =
  | "adaptive"
  | "attackSpeed"
  | "haste"
  | "moveSpeed"
  | "health"
  | "healthScaling"
  | "tenacity"
  | "armor"
  | "magicResist";

export interface Shard {
  id: number;
  name: string;
  /** What it gives, e.g. `+9 Adaptive Force`. */
  stat: string;
  glyph: ShardGlyph;
}

const SHARD_LIST: Shard[] = [
  { id: 5001, name: "Health Scaling", stat: "+10–180 Health (based on level)", glyph: "healthScaling" },
  { id: 5002, name: "Armor", stat: "+6 Armor", glyph: "armor" },
  { id: 5003, name: "Magic Resist", stat: "+8 Magic Resist", glyph: "magicResist" },
  { id: 5005, name: "Attack Speed", stat: "+10% Attack Speed", glyph: "attackSpeed" },
  { id: 5007, name: "Ability Haste", stat: "+8 Ability Haste", glyph: "haste" },
  { id: 5008, name: "Adaptive Force", stat: "+9 Adaptive Force", glyph: "adaptive" },
  { id: 5010, name: "Move Speed", stat: "+2% Move Speed", glyph: "moveSpeed" },
  { id: 5011, name: "Health", stat: "+65 Health", glyph: "health" },
  { id: 5013, name: "Tenacity and Slow Resist", stat: "+10% Tenacity and Slow Resist", glyph: "tenacity" },
];

export const SHARDS: ReadonlyMap<number, Shard> = new Map(SHARD_LIST.map((s) => [s.id, s]));

/** A shard by id; unknown ids (a new shard) get a neutral name instead of failing. */
export function shard(id: number): Shard {
  return SHARDS.get(id) ?? { id, name: "Stat shard", stat: `Stat shard ${id}`, glyph: "adaptive" };
}

/** The three shard rows of the rune page (offense, flex, defense), as the client lays them out. */
export const SHARD_ROWS: ReadonlyArray<{ label: string; ids: readonly number[] }> = [
  { label: "Offense", ids: [5008, 5005, 5007] },
  { label: "Flex", ids: [5008, 5010, 5001] },
  { label: "Defense", ids: [5011, 5013, 5001] },
];

/** Each tree's color, as a design token name (tree ids from Data Dragon). */
const STYLE_TONES: Record<number, "precision" | "domination" | "sorcery" | "resolve" | "inspiration"> = {
  8000: "precision",
  8100: "domination",
  8200: "sorcery",
  8300: "inspiration",
  8400: "resolve",
};

export type StyleTone = (typeof STYLE_TONES)[number] | "neutral";

export function styleTone(styleId: number): StyleTone {
  return STYLE_TONES[styleId] ?? "neutral";
}
