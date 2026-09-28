import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from "solid-js";
import { useData } from "../../data/context";
import type { TierGrade } from "../../data/generated/TierGrade";
import type { TierList } from "../../data/generated/TierList";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { EmptyState } from "../../design/States";
import { GradeBadge } from "../../design/TierBadge";
import { games, percent, signedPoints } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/roles";
import { defaultDir, rankEntries, type SortDir, sortEntries, type TierSortKey } from "../../lib/stats";
import type { RoleFilter } from "../../lib/stats-filters";
import styles from "./TierTable.module.css";

/** Rows rendered before "Show all": a role fits, "all roles" asks (keeps the DOM small). */
export const INITIAL_ROWS = 50;

interface Sort {
  key: TierSortKey;
  dir: SortDir;
}

function SortHeader(props: {
  label: string;
  key: TierSortKey;
  sort: Sort;
  onSort: (key: TierSortKey) => void;
  class?: string | undefined;
  title?: string;
}): JSX.Element {
  const active = () => props.sort.key === props.key;
  return (
    <th
      scope="col"
      class={props.class}
      aria-sort={active() ? (props.sort.dir === "asc" ? "ascending" : "descending") : undefined}
      title={props.title}
    >
      <button type="button" class={`${styles.sort} ${active() ? styles.sorted : ""}`} onClick={() => props.onSort(props.key)}>
        <span>{props.label}</span>
        <Icon name="chevronDown" size={14} class={`${styles.arrow} ${active() && props.sort.dir === "asc" ? styles.flip : ""}`} />
      </button>
    </th>
  );
}

/** The tier list of one queue × bracket: sortable, one role or all, rows link to champion pages. */
export function TierTable(props: { list: TierList; roleFilter: RoleFilter }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? `Champion ${id}`;
  const [sort, setSort] = createSignal<Sort>({ key: "rank", dir: "asc" });
  const [limit, setLimit] = createSignal(INITIAL_ROWS);
  // Another list or role starts short again (the sort stays).
  createEffect(on([() => props.list, () => props.roleFilter], () => setLimit(INITIAL_ROWS), { defer: true }));

  const ranked = createMemo(() => rankEntries(props.list.entries, props.roleFilter));
  const rows = createMemo(() => sortEntries(ranked(), sort().key, sort().dir, name));
  const shown = createMemo(() => rows().slice(0, limit()));
  const hasBans = createMemo(() => props.list.entries.some((e) => e.banRate > 0));
  // In tier order, each tier opens with a small divider (its size counts every row, shown or not).
  const inTierOrder = () => (sort().key === "rank" && sort().dir === "asc") || (sort().key === "score" && sort().dir === "desc");
  const tierSizes = createMemo(() => {
    const sizes = new Map<TierGrade, number>();
    for (const e of rows()) sizes.set(e.tier, (sizes.get(e.tier) ?? 0) + 1);
    return sizes;
  });
  const opensTier = (i: number) => inTierOrder() && (i === 0 || shown()[i - 1]?.tier !== shown()[i]?.tier);
  const onSort = (key: TierSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) }));
  const header = (label: string, key: TierSortKey, cls: string | undefined, title?: string) => (
    <SortHeader label={label} key={key} sort={sort()} onSort={onSort} class={cls} {...(title ? { title } : {})} />
  );

  return (
    <Card flush class={styles.card}>
      <Show
        when={rows().length > 0}
        fallback={
          <EmptyState
            icon="tiers"
            title="No champion ranked here yet"
            text="Champions need enough games in a role to be ranked. Try another role or rank."
          />
        }
      >
        <div class={`${styles.wrap} ${hasBans() ? "" : styles.noBans}`}>
          <table class={`${styles.table} num`} data-testid="tier-table">
            <colgroup>
              <col class={styles.cRank} />
              <col class={styles.cChampion} />
              <col class={styles.cTier} />
              <col class={styles.cWr} />
              <col class={styles.cPick} />
              <col class={`${styles.cBan} ${styles.ban}`} />
              <col class={`${styles.cScore} ${styles.score}`} />
            </colgroup>
            <thead>
              <tr>
                {header("#", "rank", styles.rank, "Rank by score")}
                {header("Champion", "name", styles.champion)}
                <th scope="col" class={styles.tier} title="S ≥ +2 · A ≥ +0.75 · B ≥ −0.75 · C ≥ −2 · D below (score, points)">
                  Tier
                </th>
                {header("Win rate", "winRate", styles.wr, "Win rate shrunk toward 50 %: small samples count less")}
                {header("Pick", "pickRate", styles.pick, "Share of games with this champion in this role")}
                {header("Ban", "banRate", styles.ban, "Share of games where it was banned")}
                {header("Score", "score", styles.score, "Shrunk win rate minus 50 %, in points: what the tier is based on")}
              </tr>
            </thead>
            <tbody>
              <For each={shown()}>
                {(e, i) => (
                  <>
                    <Show when={opensTier(i())}>
                      {/* A cell per column (not one wide cell): columns the width hides stay hidden here too. */}
                      <tr class={styles.group}>
                        <td colSpan={2}>
                          <span class={styles.groupLine}>
                            <span class={styles[`tone${e.tier}`]}>Tier {e.tier}</span>
                            <span class={styles.groupSize}>{tierSizes().get(e.tier) ?? 0}</span>
                          </span>
                        </td>
                        <td class={styles.tier} />
                        <td class={styles.wr} />
                        <td class={styles.pick} />
                        <td class={styles.ban} />
                        <td class={styles.score} />
                      </tr>
                    </Show>
                    <tr class={styles.row} data-testid="tier-row" data-champion={e.id} data-role={e.role}>
                      <td class={styles.rank}>{e.rank}</td>
                      <td class={styles.champion}>
                        <a class={styles.link} href={`#/champions?id=${e.id}${e.role ? `&role=${e.role}` : ""}`}>
                          <ChampionIcon championId={e.id} size={32} />
                          <span class={styles.names}>
                            <span class={styles.name}>{name(e.id)}</span>
                            <Show when={e.role}>{(r) => <span class={styles.sub}>{ROLE_LABEL[r()]}</span>}</Show>
                          </span>
                        </a>
                      </td>
                      <td class={styles.tier}>
                        <GradeBadge grade={e.tier} />
                      </td>
                      <td class={styles.wr}>
                        <span class={styles.value}>{percent(e.winRate, 1)}</span>
                        <span class={styles.sub}>{games(e.g)} games</span>
                      </td>
                      <td class={styles.pick}>{percent(e.pickRate, 1)}</td>
                      <td class={styles.ban}>{percent(e.banRate, 1)}</td>
                      <td class={`${styles.score} ${e.score >= 0 ? styles.up : styles.down}`}>{signedPoints(e.score)}</td>
                    </tr>
                  </>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={rows().length > shown().length}>
          <div class={styles.more}>
            <button type="button" class={styles.moreButton} onClick={() => setLimit(Number.POSITIVE_INFINITY)} data-testid="tier-show-all">
              Show all {rows().length}
            </button>
          </div>
        </Show>
      </Show>
    </Card>
  );
}
