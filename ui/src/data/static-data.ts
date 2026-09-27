import { createResource, type Resource } from "solid-js";
import type { Transport } from "./transport";

export interface ChampionInfo {
  id: number;
  /** Data Dragon id, used in asset paths (e.g. `Kaisa`). */
  key: string;
  name: string;
}

export interface StaticData {
  champions: ReadonlyMap<number, ChampionInfo>;
}

const EMPTY: StaticData = { champions: new Map() };

interface DdChampionFile {
  data: Record<string, { id: string; key: string; name: string }>;
}

/**
 * Game data (names, asset ids). Missing data never breaks a view: lookups fall
 * back to placeholders, so a failed download only degrades visuals.
 */
export function createStaticData(transport: Transport): Resource<StaticData> {
  const [data] = createResource(async () => {
    try {
      const res = await fetch(`${transport.assetBase}/data/en_US/champion.json`);
      if (!res.ok) return EMPTY;
      const file = (await res.json()) as DdChampionFile;
      const champions = new Map<number, ChampionInfo>();
      for (const c of Object.values(file.data)) {
        champions.set(Number(c.key), {
          id: Number(c.key),
          key: c.id,
          name: c.name,
        });
      }
      return { champions };
    } catch {
      return EMPTY;
    }
  });
  return data;
}
