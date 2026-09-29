import type { GameData } from "../generated/GameData";
import type { RuneStyle } from "../generated/RuneStyle";

/** Where the dev server serves Data Dragon files fetched by scripts/fetch-dev-assets.mjs. */
export const DEV_ASSET_BASE = "/dd/16.19.1";

interface DdFile<T> {
  data: Record<string, T>;
}

async function json<T>(name: string): Promise<T> {
  const res = await fetch(`${DEV_ASSET_BASE}/data/en_US/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const file = <T>(name: string) => json<DdFile<T>>(name);

interface DdRune {
  id: number;
  key: string;
  name: string;
  icon: string;
}

function runeStyles(
  styles: Array<{ id: number; key: string; name: string; icon: string; slots: Array<{ runes: DdRune[] }> }>,
): RuneStyle[] {
  return styles.map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    icon: s.icon,
    slots: s.slots.map((slot) => slot.runes.map((r) => ({ id: r.id, key: r.key, name: r.name, icon: r.icon }))),
  }));
}

/**
 * Same mapping as the Rust core (`crates/static-data`), from the local dev cache.
 * `null` when the cache is missing: the UI then shows placeholders, like the app offline.
 */
export async function loadDevGameData(): Promise<GameData | null> {
  try {
    const [champions, items, spells, runes] = await Promise.all([
      file<{ id: string; key: string; name: string; tags?: string[] }>("champion.json"),
      file<{ name: string; gold?: { total?: number } }>("item.json"),
      file<{ id: string; key: string; name: string }>("summoner.json"),
      json<Parameters<typeof runeStyles>[0]>("runesReforged.json"),
    ]);
    return {
      version: "16.19.1",
      assetBase: DEV_ASSET_BASE,
      artBase: DEV_ASSET_BASE,
      champions: Object.values(champions.data)
        .map((c) => ({ id: Number(c.key), key: c.id, name: c.name, tags: c.tags ?? [] }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      items: Object.entries(items.data).map(([id, i]) => ({ id: Number(id), name: i.name, gold: i.gold?.total ?? 0 })),
      summonerSpells: Object.values(spells.data).map((s) => ({ id: Number(s.key), key: s.id, name: s.name })),
      runes: runeStyles(runes),
    };
  } catch {
    return null;
  }
}
