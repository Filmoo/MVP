import { type Accessor, createResource, onCleanup } from "solid-js";
import type { ChampionInfo } from "./generated/ChampionInfo";
import type { GameData } from "./generated/GameData";
import type { ItemInfo } from "./generated/ItemInfo";
import type { SpellInfo } from "./generated/SpellInfo";
import type { Transport } from "./transport";

/** Game data indexed for lookups. */
export interface GameDataView {
  version: string;
  /** Base URL of this patch's assets (`…/cdn/<version>`). */
  assetBase: string;
  /** Base URL of version-less art (`…/cdn`). */
  artBase: string;
  champions: ReadonlyMap<number, ChampionInfo>;
  items: ReadonlyMap<number, ItemInfo>;
  spells: ReadonlyMap<number, SpellInfo>;
}

function index(data: GameData): GameDataView {
  return {
    version: data.version,
    assetBase: data.assetBase,
    artBase: data.artBase,
    champions: new Map(data.champions.map((c) => [c.id, c])),
    items: new Map(data.items.map((i) => [i.id, i])),
    spells: new Map(data.summonerSpells.map((s) => [s.id, s])),
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
