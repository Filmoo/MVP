import { type Accessor, createEffect, createSignal, type JSX, on, onCleanup, Show } from "solid-js";
import { queryParam } from "../../app/router";
import { useData } from "../../data/context";
import type { DataSetInfo } from "../../data/generated/DataSetInfo";
import type { StatsIndex } from "../../data/generated/StatsIndex";
import { Card } from "../../design/Card";
import { Segmented } from "../../design/Segmented";
import { EmptyState, ErrorState } from "../../design/States";
import { games, timeAgo } from "../../lib/format";
import { backendError } from "../../lib/players";
import { BRACKET_LABEL, BRACKET_OPTIONS, patchName, QUEUE_LABEL, QUEUE_OPTIONS, statsErrorWords } from "../../lib/stats";
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

/** Queue and rank switches, remembered for every stats page. */
export function ScopeSwitches(props: { class?: string | undefined }): JSX.Element {
  return (
    <div class={`${styles.switches} ${props.class ?? ""}`}>
      <Segmented
        label="Queue"
        options={QUEUE_OPTIONS}
        value={filters().queue}
        onChange={(queue) => setFilter({ queue })}
        testId="queue-switch"
      />
      <Segmented
        label="Rank"
        options={BRACKET_OPTIONS}
        value={filters().bracket}
        onChange={(bracket) => setFilter({ bracket })}
        testId="bracket-switch"
      />
    </div>
  );
}

/** Where the numbers come from: patch, queue, rank, games counted, last update. */
export function DataBadge(props: { info: DataSetInfo; index: StatsIndex | null | undefined; class?: string | undefined }): JSX.Element {
  const queue = () => parseQueue(props.info.queue);
  return (
    <p class={`${styles.badge} num ${props.class ?? ""}`} data-testid="data-badge">
      <span class={styles.patch}>Patch {patchName(props.index, props.info.patch)}</span>
      <span class={styles.facts}>
        <span class={styles.fact}>
          {queue() === undefined ? `Queue ${props.info.queue}` : QUEUE_LABEL[queue() ?? 420]} · {BRACKET_LABEL[props.info.bracket]} ·
        </span>{" "}
        <span class={styles.fact}>{games(props.info.games)} games ·</span>{" "}
        <span class={styles.fact}>updated {timeAgo(props.info.updatedAt)}</span>
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
