import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from "solid-js";
import { useData } from "../../data/context";
import { Button } from "../../design/Button";
import { ChampionIcon } from "../../design/GameIcon";
import { Glyph, type GlyphName } from "../../design/Glyph";
import { Icon } from "../../design/Icon";
import { RoleIcon } from "../../design/RoleIcon";
import { EmptyState } from "../../design/States";
import { TierMark } from "../../design/TierMark";
import { t } from "../../i18n";
import { integer, percent } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import { entryKey, type RankedEntry, sortEntries, type TierSortKey, type Trend, wrSide } from "../../lib/stats";
import { sortBy, tableSort } from "../../lib/tier-view";
import { championLink, TrendMark } from "./Shelves";
import styles from "./TierTable.module.css";

/** Rows rendered before "Show all": a lane fits, "all roles" asks (keeps the page light). */
export const INITIAL_ROWS = 50;

/**
 * The tier list as a table, like a spreadsheet: every header sorts (again: the other way), the
 * filter too. With every lane, a champion is a row per lane it is played in; with one, the lane
 * column says how much of the champion's games it has. Rows open the champion's build in that lane.
 */
export function TierTable(props: {
  rows: RankedEntry[];
  aram: boolean;
  allRoles: boolean;
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
  const sorted = createMemo(() => sortEntries(props.rows, tableSort().key, tableSort().dir, name));
  const shown = createMemo(() => sorted().slice(0, limit()));
  const columns = () => t().tierList.columns;
  const titles = () => t().tierList.titles;
  const header = (key: TierSortKey, label: string, cls: string | undefined, glyph?: GlyphName, title?: string) => {
    const active = () => tableSort().key === key;
    // The lane's word gives way to a glyph in a narrow table: the button keeps its name.
    const lane = key === "role";
    return (
      // What the column counts, on hover or when its sort button has the focus (design/tip).
      <th
        scope="col"
        class={cls}
        aria-sort={active() ? (tableSort().dir === "asc" ? "ascending" : "descending") : undefined}
        data-hint-title={title ? label : undefined}
        data-hint={title}
      >
        <button
          type="button"
          class={`${styles.sort} ${active() ? styles.sorted : ""}`}
          aria-label={lane ? label : undefined}
          onClick={() => sortBy(key)}
        >
          <Show when={glyph}>{(g) => <Glyph name={g()} size={14} class={styles.headGlyph} />}</Show>
          <Show when={lane}>
            <Icon name="champions" size={14} class={styles.laneGlyph} />
          </Show>
          <span class={lane ? styles.laneWord : undefined}>{label}</span>
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
      <div class={`${styles.wrap} glass-rim ${props.aram ? styles.aram : props.allRoles ? "" : styles.oneLane}`}>
        <table class={`${styles.table} num`} data-testid="tier-table">
          <colgroup>
            <col class={styles.cRank} />
            <col class={styles.cChampion} />
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
              {props.allRoles
                ? header("role", columns().lane, styles.lane, undefined, titles().lane)
                : header("role", columns().share, styles.lane, undefined, titles().share)}
              {header("tier", columns().tier, styles.tier, undefined, titles().tier)}
              {header("winRate", columns().winRate, styles.wr, "winRate", titles().winRate)}
              {header("pickRate", columns().pick, styles.pick, "pick", titles().pick)}
              {header("banRate", columns().ban, styles.ban, "ban", titles().ban)}
              {header("games", columns().games, styles.games, "games", titles().games)}
            </tr>
          </thead>
          {/* A click on a tooltip's anchor over the row's link (medallion, lane) opens the row's champion too. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer only: the keyboard opens a row with its own link */}
          <tbody onClick={(e) => (e.target as Element).closest("[data-tip], [data-hint]")?.closest("tr")?.querySelector("a")?.click()}>
            <For each={shown()}>
              {(e) => {
                // A row's own parts never change: made once, not watched. One lane shown: its share alone.
                const key = entryKey(e);
                const lane = e.role && props.allRoles ? roleLabel(e.role) : undefined;
                return (
                  <tr class={styles.row} data-testid="tier-row" data-champion={e.id} data-role={e.role} data-key={key}>
                    <td class={styles.rank}>{e.rank}</td>
                    <td class={styles.champion}>
                      {/* The link covers the whole row. */}
                      <a class={styles.link} href={championLink(e)}>
                        <ChampionIcon championId={e.id} size={32} />
                        {name(e.id)}
                      </a>
                    </td>
                    {/* The lane's name on hover (design/tip): the cell sits over the row's link. */}
                    <td class={styles.lane} data-hint={lane}>
                      {e.role && lane ? <RoleIcon role={e.role} size={16} class={styles.laneIcon} label={lane} /> : null}
                      {e.share === undefined ? null : <span class={styles.share}>{percent(e.share, 0)}</span>}
                    </td>
                    <td class={styles.tier}>
                      <TierMark grade={e.tier} size="sm" />
                    </td>
                    <td class={styles.wr} data-wr={wrSide(e.winRate)}>
                      {percent(e.winRate, 1)}
                      <Show when={props.trends?.get(key)}>{(trend) => <TrendMark points={trend().winRate} tone />}</Show>
                    </td>
                    <td class={styles.pick}>{percent(e.pickRate, 1)}</td>
                    <td class={styles.ban}>{percent(e.banRate, 1)}</td>
                    <td class={styles.games}>{integer(e.g)}</td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
        <Show when={sorted().length > shown().length}>
          <div class={styles.more}>
            <Button variant="ghost" onClick={() => setLimit(Number.POSITIVE_INFINITY)} testId="tier-show-all">
              {t().tierList.showAll(sorted().length)}
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
