import { createEffect, createMemo, createSignal, For, type JSX, Match, on, Show, Switch } from "solid-js";
import { useData } from "../../../data/context";
import type { Role } from "../../../data/generated/Role";
import { useAmbient, useTone } from "../../../design/ambient";
import { ChampionArt, ChampionIcon, championIconUrl } from "../../../design/GameIcon";
import { Glyph } from "../../../design/Glyph";
import { Icon } from "../../../design/Icon";
import { RoleRail } from "../../../design/RoleRail";
import { Skeleton } from "../../../design/States";
import { TierMark } from "../../../design/TierMark";
import { t } from "../../../i18n";
import { percent, signedPoints } from "../../../lib/format";
import { ROLE_ICON, roleLabel } from "../../../lib/roles";
import { defaultDir, type RankedEntry, type SortDir, sortEntries, type TierSortKey } from "../../../lib/stats";
import { ARAM, filters, setFilter } from "../../../lib/stats-filters";
import { Widget } from "../../../widgets/Widget";
import page from "../../page.module.css";
import { StatsProblem } from "../../stats/common";
import { INITIAL_ROWS } from "../TierTable";
import styles from "./Ledger.module.css";
import { groupByTier, NoneRanked, roleRailOptions, ScopeSentence, TierTitle, useTierData, wrSide } from "./shared";

/**
 * Direction B — Ledger. The numbers, set like a good sports page: the top three on a podium
 * (gold, silver, bronze, their art), then every champion in a ledger where each tier is a
 * section with its medallion in a header that stays while you scroll through it and a spine in
 * its colour. Win rate is a bar either side of 50 %, pick and ban rates are bars too: the
 * differences show before the digits are read. Sortable; any other order drops the sections.
 */
export function Ledger(): JSX.Element {
  const data = useTierData();
  const { gameData } = useData();
  useAmbient(() => championIconUrl(gameData(), data.ranked()[0]?.id));

  return (
    <div class={page.page}>
      <header class={styles.head}>
        <TierTitle role={data.role()} aram={data.queue() === ARAM} />
        <ScopeSentence info={data.list.data()?.info} index={data.index()} />
      </header>
      <div class={styles.body}>
        <Show when={data.queue() !== ARAM}>
          <RoleRail
            class={styles.rail}
            label={t().stats.role}
            options={roleRailOptions(data.counts)}
            value={filters().role}
            onChange={(role) => setFilter({ role })}
            testId="role-filter"
          />
        </Show>
        <div class={styles.main}>
          <Switch>
            <Match when={data.list.error() !== undefined && !data.list.loading()}>
              <StatsProblem error={data.list.error()} onRetry={data.list.refetch} />
            </Match>
            <Match when={data.list.data() && data.ranked().length === 0}>
              <NoneRanked />
            </Match>
            <Match when={data.list.data()}>
              <Widget name="tier-list" class={data.list.loading() ? styles.busy : undefined}>
                <Podium rows={data.ranked().slice(0, 3)} allRoles={data.role() === "all"} />
                <Book rows={data.ranked()} hasBans={data.queue() !== ARAM} allRoles={data.role() === "all"} />
              </Widget>
            </Match>
            <Match when={true}>
              <div class={styles.loading} aria-busy="true">
                <Skeleton height="148px" />
                <Skeleton height="480px" />
              </div>
            </Match>
          </Switch>
        </div>
      </div>
      <Show when={data.list.data() && data.ranked().length > 0}>
        <p class={styles.note}>{t().tierList.note}</p>
      </Show>
    </div>
  );
}

const MEDAL = ["var(--rank-gold)", "var(--rank-silver)", "var(--rank-bronze)"];

/** The first three, each on a card with its art. */
function Podium(props: { rows: RankedEntry[]; allRoles: boolean }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  return (
    <ol class={styles.podium} aria-label={t().tierList.proto.podium}>
      <For each={props.rows}>
        {(e, i) => (
          <li class={styles.step} style={{ "--medal": MEDAL[i()] ?? "var(--text-3)" }}>
            <a class={`${styles.stepCard} glass-rim`} href={`#/champions?id=${e.id}${e.role ? `&role=${e.role}` : ""}`}>
              <div class={styles.stepArt} aria-hidden="true" ref={(el) => useTone(el, () => championIconUrl(gameData(), e.id))}>
                <ChampionArt championId={e.id} class={styles.stepSplash} />
              </div>
              <div class={styles.stepText}>
                <div class={styles.stepTop}>
                  <span class={`${styles.medal} num`}>
                    <Show when={i() === 0}>
                      <Glyph name="crown" size={16} />
                    </Show>
                    {e.rank}
                  </span>
                  <TierMark grade={e.tier} size={24} />
                </div>
                <span class={styles.stepName}>{name(e.id)}</span>
                <Show when={props.allRoles && e.role}>
                  {(role) => (
                    <span class={styles.stepRole}>
                      <Icon name={ROLE_ICON[role()]} size={14} />
                      {roleLabel(role())}
                    </span>
                  )}
                </Show>
                <div class={`${styles.stepStats} num`}>
                  <span class={styles.stepWr} data-wr={wrSide(e.winRate)}>
                    {percent(e.winRate, 1)}
                  </span>
                  <span class={styles.stepFacts}>
                    <span>
                      <Glyph name="pick" size={14} />
                      {percent(e.pickRate, 1)}
                    </span>
                    <Show when={e.banRate > 0}>
                      <span>
                        <Glyph name="ban" size={14} />
                        {percent(e.banRate, 1)}
                      </span>
                    </Show>
                  </span>
                </div>
              </div>
            </a>
          </li>
        )}
      </For>
    </ol>
  );
}

interface Sort {
  key: TierSortKey;
  dir: SortDir;
}

/** The ledger: tier sections in tier order, one flat list in any other. */
function Book(props: { rows: RankedEntry[]; hasBans: boolean; allRoles: boolean }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const [sort, setSort] = createSignal<Sort>({ key: "rank", dir: "asc" });
  const [limit, setLimit] = createSignal(INITIAL_ROWS);
  createEffect(
    on(
      () => props.rows,
      () => setLimit(INITIAL_ROWS),
      { defer: true },
    ),
  );
  const sorted = createMemo(() => sortEntries(props.rows, sort().key, sort().dir, name));
  const shown = createMemo(() => sorted().slice(0, limit()));
  const inTierOrder = () => (sort().key === "rank" && sort().dir === "asc") || (sort().key === "score" && sort().dir === "desc");
  const sections = createMemo(() => groupByTier(shown()));
  const sizes = createMemo(() => new Map(groupByTier(props.rows).map((g) => [g.tier, g] as const)));
  // Bars share one scale per column: the largest shown.
  const maxPick = createMemo(() => Math.max(0.0001, ...props.rows.map((e) => e.pickRate)));
  const maxBan = createMemo(() => Math.max(0.0001, ...props.rows.map((e) => e.banRate)));
  const onSort = (key: TierSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) }));
  const columns = () => t().tierList.columns;
  const header = (label: string, key: TierSortKey, cls: string | undefined) => {
    const active = () => sort().key === key;
    return (
      <th scope="col" class={cls} aria-sort={active() ? (sort().dir === "asc" ? "ascending" : "descending") : undefined}>
        <button type="button" class={`${styles.sort} ${active() ? styles.sorted : ""}`} onClick={() => onSort(key)}>
          {label}
          <Icon name="chevronDown" size={14} class={`${styles.arrow} ${active() && sort().dir === "asc" ? styles.flip : ""}`} />
        </button>
      </th>
    );
  };
  const row = (e: RankedEntry, withTier: boolean) => (
    <tr class={styles.row} data-testid="tier-row" data-champion={e.id}>
      <td class={`${styles.rank} num`}>{e.rank}</td>
      <td class={styles.champion}>
        <div class={styles.championCell}>
          {/* The link covers the whole row. */}
          <a class={styles.link} href={`#/champions?id=${e.id}${e.role ? `&role=${e.role}` : ""}`}>
            <ChampionIcon championId={e.id} size={32} />
            <span class={styles.names}>
              <span class={styles.name}>{name(e.id)}</span>
              <Show when={props.allRoles && e.role}>{(r) => <RoleLine role={r()} />}</Show>
            </span>
          </a>
          <Show when={withTier}>
            <TierMark grade={e.tier} size={20} class={styles.rowMark} />
          </Show>
        </div>
      </td>
      <td class={`${styles.wr} num`}>
        <div class={styles.wrCell}>
          <span class={styles.wrBar} aria-hidden="true">
            <span
              class={styles.wrFill}
              data-wr={e.winRate >= 0.5 ? "win" : "loss"}
              style={{
                "--from": `${Math.min(0.5, Math.max(0.45, e.winRate)) * 1000 - 450}%`,
                "--size": `${Math.min(0.05, Math.abs(e.winRate - 0.5)) * 1000}%`,
              }}
            />
          </span>
          <span class={styles.wrValue} data-wr={wrSide(e.winRate)}>
            {percent(e.winRate, 1)}
          </span>
          <span class={styles.games}>{t().common.games(e.g)}</span>
        </div>
      </td>
      <td class={`${styles.pick} num`}>
        <div class={styles.rate}>
          <span class={styles.rateValue}>{percent(e.pickRate, 1)}</span>
          <span class={styles.rateBar} aria-hidden="true">
            <span class={styles.rateFill} style={{ width: `${(e.pickRate / maxPick()) * 100}%` }} />
          </span>
        </div>
      </td>
      <Show when={props.hasBans}>
        <td class={`${styles.ban} num`}>
          <div class={styles.rate}>
            <span class={styles.rateValue}>{percent(e.banRate, 1)}</span>
            <span class={styles.rateBar} aria-hidden="true">
              <span class={styles.rateFill} style={{ width: `${(e.banRate / maxBan()) * 100}%` }} />
            </span>
          </div>
        </td>
      </Show>
      <td class={`${styles.score} num`} data-wr={e.score >= 0 ? "win" : "loss"}>
        {signedPoints(e.score)}
      </td>
    </tr>
  );
  const tone = (tier: string) => ({ "--tone": `var(--tier-${tier.toLowerCase()})`, "--soft": `var(--tier-${tier.toLowerCase()}-soft)` });

  return (
    <div class={`${styles.book} glass-rim`}>
      <table class={styles.table} data-testid="tier-table">
        <colgroup>
          <col class={styles.cRank} />
          <col />
          <col class={styles.cWr} />
          <col class={`${styles.cRate} ${styles.pick}`} />
          <Show when={props.hasBans}>
            <col class={`${styles.cRate} ${styles.ban}`} />
          </Show>
          <col class={`${styles.cScore} ${styles.score}`} />
        </colgroup>
        <thead>
          <tr>
            {header(columns().rank, "rank", styles.rank)}
            {header(columns().champion, "name", styles.champion)}
            {header(columns().winRate, "winRate", styles.wr)}
            {header(columns().pick, "pickRate", styles.pick)}
            <Show when={props.hasBans}>{header(columns().ban, "banRate", styles.ban)}</Show>
            {header(columns().score, "score", styles.score)}
          </tr>
        </thead>
        <Show
          when={inTierOrder()}
          fallback={
            <tbody>
              <For each={shown()}>{(e) => row(e, true)}</For>
            </tbody>
          }
        >
          <For each={sections()}>
            {(section) => (
              <tbody class={styles.section} style={tone(section.tier)}>
                {/* The tier's header: it stays under the title bar while its rows scroll by. */}
                {/* A cell per column, not one wide cell: columns the width hides stay hidden here too. */}
                <tr class={styles.sectionHead}>
                  <th scope="rowgroup" colSpan={2} class={styles.sectionCell}>
                    <span class={styles.sectionTitle}>
                      <TierMark grade={section.tier} size={24} decorative />
                      <span class={styles.sectionName}>{t().stats.tier(section.tier)}</span>
                      <span class={`${styles.sectionFacts} num`}>
                        {t().tierList.proto.champions(sizes().get(section.tier)?.entries.length ?? 0)} ·{" "}
                        {t().tierList.proto.average(percent(sizes().get(section.tier)?.winRate ?? 0, 1))}
                      </span>
                    </span>
                  </th>
                  <td class={styles.wr} />
                  <td class={styles.pick} />
                  <Show when={props.hasBans}>
                    <td class={styles.ban} />
                  </Show>
                  <td class={styles.score} />
                </tr>
                <For each={section.entries}>{(e) => row(e, false)}</For>
              </tbody>
            )}
          </For>
        </Show>
      </table>
      <Show when={sorted().length > shown().length}>
        <div class={styles.more}>
          <button type="button" class={styles.moreButton} onClick={() => setLimit(Number.POSITIVE_INFINITY)} data-testid="tier-show-all">
            {t().tierList.showAll(sorted().length)}
          </button>
        </div>
      </Show>
    </div>
  );
}

function RoleLine(props: { role: Role }): JSX.Element {
  return (
    <span class={styles.sub}>
      <Icon name={ROLE_ICON[props.role]} size={14} />
      {roleLabel(props.role)}
    </span>
  );
}
