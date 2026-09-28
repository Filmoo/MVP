import { type Accessor, createResource, onCleanup } from "solid-js";
import type { ChampionInfo } from "./generated/ChampionInfo";
import type { GameData } from "./generated/GameData";
import type { ItemInfo } from "./generated/ItemInfo";
import type { RuneInfo } from "./generated/RuneInfo";
import type { RuneStyle } from "./generated/RuneStyle";
import type { SpellInfo } from "./generated/SpellInfo";
import type { Transport } from "./transport";

/** A rune with where it sits: its tree and row (0 = keystones). */
export interface RuneEntry {
  rune: RuneInfo;
  style: RuneStyle;
  row: number;
}

/** Game data indexed for lookups. */
export interface GameDataView {
  version: string;
  /** Base URL of this patch's assets (`…/cdn/<version>`). */
  assetBase: string;
  /** Base URL of version-less art (`…/cdn`): champion art, rune icons. */
  artBase: string;
  champions: ReadonlyMap<number, ChampionInfo>;
  items: ReadonlyMap<number, ItemInfo>;
  spells: ReadonlyMap<number, SpellInfo>;
  /** Rune trees by id (`8000` = Precision), in Data Dragon's order. */
  runeStyles: ReadonlyMap<number, RuneStyle>;
  /** Every rune (not the stat shards) by id. */
  runes: ReadonlyMap<number, RuneEntry>;
}

function index(data: GameData): GameDataView {
  const runes = new Map<number, RuneEntry>();
  for (const style of data.runes) {
    style.slots.forEach((row, i) => {
      for (const rune of row) runes.set(rune.id, { rune, style, row: i });
    });
  }
  return {
    version: data.version,
    assetBase: data.assetBase,
    artBase: data.artBase,
    champions: new Map(data.champions.map((c) => [c.id, c])),
    items: new Map(data.items.map((i) => [i.id, i])),
    spells: new Map(data.summonerSpells.map((s) => [s.id, s])),
    runeStyles: new Map(data.runes.map((s) => [s.id, s])),
    runes,
  };
}

/**
 * Names and asset ids of the current patch. Missing data never breaks a view: lookups fall
 * back to placeholders, so a failed download only degrades visuals.
 */
export function createGameData(transport: Transport): Accessor<GameDataView | undefined> {
  const [data, { mutate }] = createResource(async () => {
    try {
      const loaded = await transport.call("game_data");
      return loaded ? index(loaded) : undefined;
    } catch {
      return undefined;
    } finally {
      // Lets tests (and anything else) know names and art URLs are resolved, or never will be.
      document.documentElement.dataset.gameData = "settled";
    }
  });
  onCleanup(transport.listen("game-data", (loaded) => mutate(index(loaded))));
  return () => (data.state === "ready" ? data() : undefined);
}
