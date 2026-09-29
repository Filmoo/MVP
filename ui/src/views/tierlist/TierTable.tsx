import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from "solid-js";
import { useData } from "../../data/context";
import { ChampionIcon } from "../../design/GameIcon";
import { Glyph, type GlyphName } from "../../design/Glyph";
import { Icon, iconPath, LineIcon } from "../../design/Icon";
import { EmptyState } from "../../design/States";
import { TierMark } from "../../design/TierMark";
import { t } from "../../i18n";
import { games, percent } from "../../lib/format";
import { ROLE_ICON, roleLabel } from "../../lib/roles";
import { entryKey, type RankedEntry, sortEntries, type TierSortKey, type Trend, wrSide } from "../../lib/stats";
import { sortBy, tableSort } from "../../lib/tier-view";
import { championLink, TrendMark } from "./Shelves";
import styles from "./TierTable.module.css";

/** Rows rendered before "Show all": a lane fits, "all roles" asks (keeps the page light). */
export const INITIAL_ROWS = 50;

/**
 * The tier list as a table, like a spreadsheet: every header sorts (again: the other way). A
 * champion is a row per lane it is played in. Rows open the champion's build in that lane.
 */
export function TierTable(props: {
  /** Matching the filter: best match first while filtering (the sort waits). */
  rows: RankedEntry[];
  filtering: boolean;
  aram: boolean;
  trends: Map<string, Trend> | undefined;
}): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const [limit, setLimit] = createSignal(INITIAL_ROWS);
  // Another list starts short again (the sort stays).
  createEffect(
    on(
      () => props.rows,
      () => setLimit(INITIAL_ROWS),
      { defer: true },
    ),
  );
  const sorted = createMemo(() => (props.filtering ? props.rows : sortEntries(props.rows, tableSort().key, tableSort().dir, name)));
  const shown = createMemo(() => sorted().slice(0, limit()));
  const columns = () => t().tierList.columns;
  const titles = () => t().tierList.titles;
  const header = (key: TierSortKey, label: string, cls: string | undefined, glyph?: GlyphName, title?: string) => {
    const active = () => !props.filtering && tableSort().key === key;
    return (
      <th scope="col" class={cls} aria-sort={active() ? (tableSort().dir === "asc" ? "ascending" : "descending") : undefined} title={title}>
        <button type="button" class={`${styles.sort} ${active() ? styles.sorted : ""}`} onClick={() => sortBy(key)}>
          <Show when={glyph}>{(g) => <Glyph name={g()} size={14} class={styles.headGlyph} />}</Show>
          <span>{label}</span>
          <Icon name="chevronDown" size={14} class={`${styles.arrow} ${active() && tableSort().dir === "asc" ? styles.flip : ""}`} />
        </button>
      </th>
    );
  };

  return (
    <Show
      when={props.rows.length > 0}
      fallback={<EmptyState icon="search" title={t().tierList.noMatch} text={t().champions.checkSpelling} />}
    >
      <div class={`${styles.wrap} glass-rim ${props.aram ? styles.aram : ""} ${props.filtering ? styles.paused : ""}`}>
        <table class={`${styles.table} num`} data-testid="tier-table">
          <colgroup>
            <col class={styles.cRank} />
            <col />
            <col class={`${styles.cLane} ${styles.lane}`} />
            <col class={styles.cTier} />
            <col class={styles.cWr} />
            <col class={`${styles.cRate} ${styles.pick}`} />
            <col class={`${styles.cRate} ${styles.ban}`} />
            <col class={`${styles.cGames} ${styles.games}`} />
          </colgroup>
          <thead>
            <tr>
              {header("rank", columns().rank, styles.rank, undefined, titles().rank)}
              {header("name", columns().champion, styles.champion)}
              {header("role", columns().lane, styles.lane, undefined, titles().lane)}
              {header("tier", columns().tier, styles.tier, undefined, titles().tier)}
              {header("winRate", columns().winRate, styles.wr, "winRate", titles().winRate)}
              {header("pickRate", columns().pick, styles.pick, "pick", titles().pick)}
              {header("banRate", columns().ban, styles.ban, "ban", titles().ban)}
              {header("games", columns().games, styles.games, "games", titles().games)}
            </tr>
          </thead>
          <tbody>
            <For each={shown()}>
              {(e) => (
                <tr class={styles.row} data-testid="tier-row" data-champion={e.id} data-role={e.role} data-key={entryKey(e)}>
                  <td class={styles.rank}>{e.rank}</td>
                  <td class={styles.champion}>
                    {/* The link covers the whole row. */}
                    <a class={styles.link} href={championLink(e)}>
                      <ChampionIcon championId={e.id} size={32} />
                      {name(e.id)}
                    </a>
                  </td>
                  <td class={styles.lane} title={e.role ? roleLabel(e.role) : undefined}>
                    <Show when={e.role}>
                      {(role) => (
                        <>
                          <LineIcon d={iconPath(ROLE_ICON[role()])} size={16} class={styles.laneIcon} label={roleLabel(role())} />
                          <Show when={e.share !== undefined}>
                            <span class={styles.share}>{percent(e.share ?? 0, 1)}</span>
                          </Show>
                        </>
                      )}
                    </Show>
                  </td>
                  <td class={styles.tier}>
                    <TierMark grade={e.tier} size="sm" />
                  </td>
                  <td class={styles.wr} data-wr={wrSide(e.winRate)}>
                    {percent(e.winRate, 1)}
                    <Show when={props.trends?.get(entryKey(e))}>{(trend) => <TrendMark points={trend().winRate} tone />}</Show>
                  </td>
                  <td class={styles.pick}>{percent(e.pickRate, 1)}</td>
                  <td class={styles.ban}>{percent(e.banRate, 1)}</td>
                  <td class={styles.games}>{games(e.g)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={sorted().length > shown().length}>
          <div class={styles.more}>
            <button type="button" class={styles.moreButton} onClick={() => setLimit(Number.POSITIVE_INFINITY)} data-testid="tier-show-all">
              {t().tierList.showAll(sorted().length)}
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
