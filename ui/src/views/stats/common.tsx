import { type Accessor, createEffect, createSignal, type JSX, on, onCleanup, Show } from "solid-js";
import { queryParam } from "../../app/router";
import { useData } from "../../data/context";
import type { DataSetInfo } from "../../data/generated/DataSetInfo";
import type { StatsIndex } from "../../data/generated/StatsIndex";
import { Card } from "../../design/Card";
import { Segmented } from "../../design/Segmented";
import { EmptyState, ErrorState } from "../../design/States";
import { t } from "../../i18n";
import { timeAgo } from "../../lib/format";
import { backendError } from "../../lib/players";
import { bracketLabel, bracketOptions, patchName, queueLabel, queueOptions, statsErrorWords } from "../../lib/stats";
import { applyLinkFilters, filters, parseQueue, setFilter } from "../../lib/stats-filters";
import styles from "./common.module.css";

/**
 * What the backend has published, kept fresh by the core's `stats-index` event. `version`
 * counts those events: pages add it to their request keys to refetch on a new publication.
 */
export function useStatsIndex(): { index: Accessor<StatsIndex | null | undefined>; version: Accessor<number> } {
  const { transport } = useData();
  const [index, setIndex] = createSignal<StatsIndex | null>();
  const [version, setVersion] = createSignal(0);
  transport.call("stats_index").then(
    (answer) => setIndex(answer),
    () => setIndex(null),
  );
  onCleanup(
    transport.listen("stats-index", (next) => {
      setIndex(next);
      setVersion((v) => v + 1);
    }),
  );
  return { index, version };
}

/**
 * A link can set the queue, bracket and (tier list, champion grid) role filter:
 * `#/tier-list?queue=450&role=middle`. On a champion page `role` picks its role tab instead.
 */
export function useLinkFilters(options: { role: boolean }): void {
  createEffect(
    on(
      () => [queryParam("queue"), queryParam("bracket"), options.role ? queryParam("role") : null] as const,
      ([queue, bracket, role]) => applyLinkFilters({ queue, bracket, role }),
    ),
  );
}

/** ARAM: Mayhem as a third queue tab: its own page from the tier list, a champion's Mayhem tab. */
export interface MayhemTab {
  selected: boolean;
  onSelect: () => void;
  /** Ranked or ARAM chosen while Mayhem is shown. */
  onLeave?: () => void;
}

const MAYHEM = 2400;

/** Queue and rank switches, remembered for every stats page; `rank: false` leaves the rank out. */
export function ScopeSwitches(props: { class?: string | undefined; mayhem?: MayhemTab; rank?: boolean }): JSX.Element {
  const queues = () => (props.mayhem ? [...queueOptions(), { value: MAYHEM, label: t().queues[MAYHEM] }] : queueOptions());
  return (
    <div class={`${styles.switches} ${props.class ?? ""}`}>
      <Segmented<number>
        label={t().stats.queue}
        options={queues()}
        value={props.mayhem?.selected ? MAYHEM : filters().queue}
        onChange={(queue) => {
          const published = parseQueue(queue);
          if (!published) return props.mayhem?.onSelect();
          setFilter({ queue: published });
          props.mayhem?.onLeave?.();
        }}
        testId="queue-switch"
      />
      <Show when={props.rank !== false}>
        <Segmented
          label={t().stats.rank}
          options={bracketOptions()}
          value={filters().bracket}
          onChange={(bracket) => setFilter({ bracket })}
          testId="bracket-switch"
        />
      </Show>
    </div>
  );
}

/** Where the numbers come from: patch, queue, rank, games counted, last update. */
export function DataBadge(props: { info: DataSetInfo; index: StatsIndex | null | undefined; class?: string | undefined }): JSX.Element {
  const queueText = () => {
    const queue = parseQueue(props.info.queue);
    return queue === undefined ? t().stats.queueN(props.info.queue) : queueLabel(queue);
  };
  return (
    <p class={`${styles.badge} num ${props.class ?? ""}`} data-testid="data-badge">
      <span class={styles.patch}>{t().common.patch(patchName(props.index, props.info.patch))}</span>
      <span class={styles.facts}>
        <span class={styles.fact}>
          {queueText()} · {bracketLabel(props.info.bracket)} ·
        </span>{" "}
        <span class={styles.fact}>{t().common.games(props.info.games)} ·</span>{" "}
        <span class={styles.fact}>{t().common.updated(timeAgo(props.info.updatedAt))}</span>
      </span>
    </p>
  );
}

/** A stats request that failed: "nothing published" is an empty state, the rest errors with a retry. */
export function StatsProblem(props: { error: unknown; onRetry: () => void }): JSX.Element {
  const words = () => statsErrorWords(backendError(props.error));
  return (
    <Card>
      <Show when={words().empty} fallback={<ErrorState title={words().title} message={words().text} onRetry={props.onRetry} />}>
        <EmptyState icon="tiers" title={words().title} text={words().text} />
      </Show>
    </Card>
  );
}
