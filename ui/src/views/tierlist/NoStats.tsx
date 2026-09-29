import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { ChampionInfo } from "../../data/generated/ChampionInfo";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { t } from "../../i18n";
import { className } from "../../lib/champions";
import { bestMatches } from "../../lib/fuzzy";
import { createProgressive } from "../../lib/progressive";
import styles from "./NoStats.module.css";

/** Data Dragon's classes, in the League client's order. */
const CLASSES = ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"];

interface Group {
  head: string | undefined;
  champions: ChampionInfo[];
}

/** Every champion, by class (or the filter's best matches first): each opens its page. */
export function groupsWithoutStats(champions: readonly ChampionInfo[], query: string): Group[] {
  const q = query.trim();
  if (q) return [{ head: undefined, champions: bestMatches(q, champions, (c) => c.name, champions.length) }];
  const sorted = [...champions].sort((a, b) => a.name.localeCompare(b.name));
  return [...CLASSES, ""]
    .map((head) => ({ head, champions: sorted.filter((c) => (CLASSES.find((k) => k === c.tags[0]) ?? "") === head) }))
    .filter((g) => g.champions.length > 0);
}

/**
 * Without stats (offline, nothing published) the tier list still leads to every champion's page:
 * grouped by class, filtered as you type. Built a slice at a time (~170 faces).
 */
export function NoStatsChampions(props: { query: string }): JSX.Element {
  const { gameData } = useData();
  const groups = createMemo(() => groupsWithoutStats([...(gameData()?.champions.values() ?? [])], props.query));
  const all = createMemo(() => groups().flatMap((g) => g.champions));
  const { shown, complete } = createProgressive(all, 48);
  const built = createMemo(() => new Set(shown()));
  return (
    <Show
      when={all().length > 0}
      fallback={
        <EmptyState
          icon="search"
          title={props.query.trim() ? t().tierList.noMatch : t().champions.noneYet}
          text={props.query.trim() ? t().champions.checkSpelling : t().champions.whenLoaded}
        />
      }
    >
      <div class={styles.groups} aria-busy={complete() ? undefined : "true"}>
        <For each={groups()}>
          {(group) => (
            <Show when={group.champions.some((c) => built().has(c))}>
              <section class={`${styles.group} glass-rim`}>
                <Show when={group.head !== undefined}>
                  <h2 class={styles.head}>
                    {className(group.head ?? "") || t().common.unknown}
                    <span class={`${styles.size} num`}>{group.champions.length}</span>
                  </h2>
                </Show>
                <ul class={styles.tiles}>
                  <For each={group.champions.filter((c) => built().has(c))}>
                    {(champion) => (
                      <li>
                        <a class={styles.tile} href={`#/champions?id=${champion.id}`} data-testid="champion-tile">
                          <ChampionIcon championId={champion.id} size={48} />
                          <span class={styles.name}>{champion.name}</span>
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}
