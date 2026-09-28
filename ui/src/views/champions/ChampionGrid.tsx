import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { ChampionInfo } from "../../data/generated/ChampionInfo";
import type { TierEntry } from "../../data/generated/TierEntry";
import type { TierList } from "../../data/generated/TierList";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { GradeBadge } from "../../design/TierBadge";
import { t } from "../../i18n";
import { bestMatches } from "../../lib/fuzzy";
import { createProgressive } from "../../lib/progressive";
import type { RoleFilter } from "../../lib/stats-filters";
import styles from "./ChampionGrid.module.css";

/** Tiles built with the view; the rest follow while the page is idle (a first screen holds 12 to 156). */
const FIRST_TILES = 40;

interface Tile {
  champion: ChampionInfo;
  /** Its tier-list row in the role shown (its most played one for "all"). */
  entry: TierEntry | undefined;
}

/** Every champion as a tile (icon, name, tier in the role shown), filtered by name and role. */
export function ChampionGrid(props: { list: TierList | undefined; roleFilter: RoleFilter; query: string }): JSX.Element {
  const { gameData } = useData();
  const byChampion = createMemo(() => {
    const map = new Map<number, TierEntry[]>();
    for (const e of props.list?.entries ?? []) map.set(e.id, [...(map.get(e.id) ?? []), e]);
    return map;
  });
  const tiles = createMemo<Tile[]>(() => {
    const champions = [...(gameData()?.champions.values() ?? [])];
    const query = props.query.trim();
    const matched = query ? bestMatches(query, champions, (c) => c.name, champions.length) : champions;
    const tiles = matched.map((champion) => {
      const entries = byChampion().get(champion.id) ?? [];
      const entry =
        props.roleFilter === "all" ? [...entries].sort((a, b) => b.g - a.g)[0] : entries.find((e) => e.role === props.roleFilter);
      return { champion, entry };
    });
    return props.roleFilter === "all" ? tiles : tiles.filter((t) => t.entry !== undefined);
  });
  const { shown, complete } = createProgressive(tiles, FIRST_TILES);
  return (
    <Card>
      <Show
        when={tiles().length > 0}
        fallback={
          <EmptyState
            icon="search"
            title={props.query.trim() ? t().champions.noMatch(props.query.trim()) : t().champions.noneYet}
            text={props.query.trim() ? t().champions.checkSpelling : t().champions.whenLoaded}
          />
        }
      >
        {/* Links straight in the grid (no list items): about 170 tiles, four nodes each. It says it's
            busy while the tiles below the first ones are still being built. */}
        <div class={styles.grid} aria-busy={complete() ? undefined : "true"} data-state={complete() ? undefined : "loading"}>
          <For each={shown()}>
            {(t) => (
              <a
                class={styles.tile}
                href={`#/champions?id=${t.champion.id}${props.roleFilter !== "all" && t.entry?.role ? `&role=${t.entry.role}` : ""}`}
                data-testid="champion-tile"
              >
                <ChampionIcon championId={t.champion.id} size={56} />
                <Show when={t.entry}>{(e) => <GradeBadge grade={e().tier} size="sm" class={styles.grade} />}</Show>
                <span class={styles.name}>{t.champion.name}</span>
              </a>
            )}
          </For>
        </div>
      </Show>
    </Card>
  );
}
