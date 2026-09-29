/**
 * Rune pages as the stats files publish them, and the stat shards, which Data Dragon doesn't
 * describe (ids 5001–5013): named here (in the catalogue), drawn as simple glyphs (no Riot art).
 */
import { t } from "../i18n";

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

/** The shards the client offers, with their glyph (names: `t().shards`). */
export const SHARDS: ReadonlyMap<number, ShardGlyph> = new Map([
  [5001, "healthScaling"],
  [5002, "armor"],
  [5003, "magicResist"],
  [5005, "attackSpeed"],
  [5007, "haste"],
  [5008, "adaptive"],
  [5010, "moveSpeed"],
  [5011, "health"],
  [5013, "tenacity"],
]);

/** A shard by id, named in the current language; unknown ids (a new shard) get a neutral name instead of failing. */
export function shard(id: number): Shard {
  const words = t().shards;
  const known: Partial<Record<number, { name: string; stat: string }>> = words.names;
  const named = known[id];
  const glyph = SHARDS.get(id);
  return named && glyph ? { id, ...named, glyph } : { id, name: words.unknown, stat: words.unknownN(id), glyph: "adaptive" };
}

export type ShardRow = "offense" | "flex" | "defense";

/** The three shard rows of the rune page (offense, flex, defense), as the client lays them out. */
export const SHARD_ROWS: ReadonlyArray<{ row: ShardRow; ids: readonly number[] }> = [
  { row: "offense", ids: [5008, 5005, 5007] },
  { row: "flex", ids: [5008, 5010, 5001] },
  { row: "defense", ids: [5011, 5013, 5001] },
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
