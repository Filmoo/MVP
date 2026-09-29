import { type Accessor, createEffect, createSignal, createUniqueId, type JSX, on, onCleanup, Show } from "solid-js";
import { queryParam } from "../../app/router";
import { useData } from "../../data/context";
import type { Bracket } from "../../data/generated/Bracket";
import type { StatsIndex } from "../../data/generated/StatsIndex";
import type { Tier } from "../../data/generated/Tier";
import { Card } from "../../design/Card";
import { Glyph, type GlyphName } from "../../design/Glyph";
import { Icon } from "../../design/Icon";
import { PenguinArt } from "../../design/PenguinArt";
import { Radios } from "../../design/Radios";
import { RankEmblem } from "../../design/RankEmblem";
import { EmptyState, ErrorState } from "../../design/States";
import { t } from "../../i18n";
import { backendError } from "../../lib/players";
import { bracketLabel, queueLabel, statsErrorWords } from "../../lib/stats";
import { ARAM, applyLinkFilters, filters, type Queue, RANKED, setFilter } from "../../lib/stats-filters";
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
 * A link can set the queue, bracket and (tier list) role filter:
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

const QUEUE_GLYPH: Record<Queue, GlyphName> = { 420: "ranked", 450: "aram" };

/**
 * The queue as the stats pages' own tabs: words, a line under the one shown (room for more tabs).
 * Remembered for every stats page, like the rank.
 */
export function QueueTabs(): JSX.Element {
  return (
    <Radios
      label={t().stats.queue}
      value={filters().queue}
      values={[RANKED, ARAM]}
      onChange={(queue) => setFilter({ queue })}
      class={styles.tabs}
      optionClass={() => styles.tab}
      testId="queue-switch"
    >
      {(queue) => (
        <>
          <Glyph name={QUEUE_GLYPH[queue]} size={16} class={styles.tabIcon} />
          <span>{queueLabel(queue)}</span>
        </>
      )}
    </Radios>
  );
}

/** The floor tier each bracket is named after: its emblem. */
const BRACKET_TIER: Record<Bracket, Tier> = { emeraldPlus: "emerald", diamondPlus: "diamond", masterPlus: "master" };
const BRACKETS: readonly Bracket[] = ["emeraldPlus", "diamondPlus", "masterPlus"];

/**
 * The rank as a button with its emblem; it opens a small glass grid of the brackets published for
 * this queue (the one shown included), each with Riot's emblem. The platform's popover: Escape or a
 * click outside closes it, choosing too.
 */
export function RankPicker(props: { index: StatsIndex | null | undefined }): JSX.Element {
  const id = `rank-${createUniqueId()}`;
  let menu: HTMLDivElement | undefined;
  const published = () => {
    const index = props.index;
    const patch = index?.patches.find((p) => p.patch === index.current);
    const sets = patch?.sets.filter((s) => s.queue === filters().queue).map((s) => s.bracket);
    return sets ? BRACKETS.filter((b) => sets.includes(b) || b === filters().bracket) : BRACKETS;
  };
  const bracket = () => filters().bracket;
  return (
    <div class={styles.rankWrap} data-testid="bracket-switch">
      <button
        type="button"
        class={styles.rank}
        popovertarget={id}
        style={{ "anchor-name": `--${id}` }}
        data-hint-title={t().stats.rank}
        data-hint={t().stats.rankHint}
        data-testid="rank-button"
      >
        <RankEmblem tier={BRACKET_TIER[bracket()]} size="xs" />
        <span class={styles.rankName}>{bracketLabel(bracket())}</span>
        <Icon name="chevronDown" size={14} class={styles.chevron} />
      </button>
      <div id={id} popover class={`${styles.menu} glass-rim`} style={{ "position-anchor": `--${id}` }} ref={menu}>
        <p class={styles.menuTitle}>{t().stats.rank}</p>
        <Radios
          label={t().stats.rank}
          value={bracket()}
          values={published()}
          onChange={(value) => {
            setFilter({ bracket: value });
            menu?.hidePopover();
          }}
          class={styles.rankGrid}
          optionClass={() => styles.rankOption}
        >
          {(value) => (
            <>
              <RankEmblem tier={BRACKET_TIER[value]} size="md" />
              <span>{bracketLabel(value)}</span>
            </>
          )}
        </Radios>
      </div>
    </div>
  );
}

/** A stats request that failed: "nothing published" is an empty state, the rest errors with a retry. */
export function StatsProblem(props: { error: unknown; onRetry: () => void }): JSX.Element {
  const words = () => statsErrorWords(backendError(props.error));
  return (
    <Card>
      <Show when={words().empty} fallback={<ErrorState title={words().title} message={words().text} onRetry={props.onRetry} />}>
        <EmptyState icon="tiers" art={<PenguinArt size={72} />} title={words().title} text={words().text} />
      </Show>
    </Card>
  );
}
