import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { TierGrade } from "../../data/generated/TierGrade";
import type { TierList } from "../../data/generated/TierList";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { GradeBadge } from "../../design/TierBadge";
import { t } from "../../i18n";
import { type GridSort, gridGroups, TIERS } from "../../lib/champion-grid";
import { className } from "../../lib/champions";
import { percent } from "../../lib/format";
import { createProgressive } from "../../lib/progressive";
import type { RoleFilter } from "../../lib/stats-filters";
import styles from "./ChampionGrid.module.css";

/** Tiles built with the view; the rest follow while the page is idle (a first screen holds 12 to 156). */
const FIRST_TILES = 36;

/**
 * Every champion as a tile (icon, name, tier and the number it's sorted by), filtered by role and
 * name, in groups (tiers, or classes without stats) with their heading beside them.
 */
export function ChampionGrid(props: { list: TierList | undefined; roleFilter: RoleFilter; sort: GridSort; query: string }): JSX.Element {
  const { gameData } = useData();
  const query = () => props.query.trim();
  const groups = createMemo(() =>
    gridGroups([...(gameData()?.champions.values() ?? [])], props.list?.entries, props.roleFilter, props.sort, query()),
  );
  // Built a slice at a time, in order: each group shows its part of what is built so far.
  const { shown, complete } = createProgressive(
    createMemo(() => groups().flatMap((g) => g.tiles)),
    FIRST_TILES,
  );
  const byPick = () => props.sort === "pickRate";
  // Class names never change: `/*@once*/` sets them once instead of tracking them on every tile.
  return (
    <Card>
      <Show
        when={shown().length > 0}
        fallback={
          <EmptyState
            icon={query() ? "search" : "champions"}
            title={query() ? t().champions.noMatch(query()) : t().champions.noneYet}
            text={query() ? t().champions.checkSpelling : t().champions.whenLoaded}
          />
        }
      >
        {/* Tiles are links straight in each group's grid; a group shows once some of its tiles are
            built. It says it's busy while the tiles below the first ones are still being built. */}
        <div class={/*@once*/ styles.groups} aria-busy={complete() ? undefined : "true"} data-state={complete() ? undefined : "loading"}>
          <For each={groups().filter((g) => shown().length > g.start)}>
            {(group) => (
              <section class={/*@once*/ styles.group}>
                <Show when={group.head !== undefined}>
                  <h2 class={/*@once*/ styles.head}>
                    {TIERS.includes(group.head ?? "") ? (
                      <GradeBadge grade={group.head as TierGrade} size="lg" />
                    ) : (
                      <span class={/*@once*/ styles.label}>
                        {props.list ? t().champions.fewGames : className(group.head ?? "") || t().common.unknown}
                      </span>
                    )}
                    <span class={/*@once*/ `${styles.size} num`}>{group.tiles.length}</span>
                  </h2>
                </Show>
                <div class={/*@once*/ styles.grid}>
                  <For each={shown().slice(group.start, group.start + group.tiles.length)}>
                    {(item) => (
                      <a
                        class={/*@once*/ styles.tile}
                        href={`#/champions?id=${item.champion.id}${props.roleFilter === "all" ? "" : `&role=${props.roleFilter}`}`}
                        data-testid="champion-tile"
                      >
                        <ChampionIcon championId={item.champion.id} size={56} />
                        {/* A tier's heading says the tier: its tiles leave their badge out. */}
                        <Show when={group.head === undefined && item.entry}>
                          {(e) => <GradeBadge grade={e().tier} size="sm" class={/*@once*/ styles.grade} />}
                        </Show>
                        <span class={/*@once*/ styles.name}>{item.champion.name}</span>
                        <Show when={props.list}>
                          <span class={/*@once*/ `${styles.stat} num`}>
                            {item.entry ? percent(byPick() ? item.pickRate : item.entry.winRate, 1) : "\u00A0"}
                          </span>
                        </Show>
                      </a>
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </div>
      </Show>
    </Card>
  );
}

/**
 * While the first stats answer is on its way: two rows of tiles' icons and names, drawn by CSS
 * (a repeating mask), pulsing like the other skeletons.
 */
export function GridSkeleton(): JSX.Element {
  return (
    <Card>
      <div class={/*@once*/ styles.ghosts} aria-busy="true" data-state="loading" />
    </Card>
  );
}
