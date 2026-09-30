import { type Accessor, createEffect, createSignal, createUniqueId, For, type JSX, on, onCleanup, Show } from "solid-js";
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

/** A fact of the data line: `Patch 26.19`, `412K games`. */
export interface Fact {
  glyph?: GlyphName;
  text: string;
}

/**
 * The hub's head: `Tier list · Mid` (what the page shows, `TitleScope`), then where the numbers
 * come from as text, no picker (under the title when narrow). The facts' line is kept while they
 * load, so nothing moves when they land; none without `facts`.
 */
export function StatsHead(props: { scope: JSX.Element; facts: readonly Fact[] | undefined; testId: string }): JSX.Element {
  return (
    <header class={styles.head}>
      <h1 class={styles.title}>
        {t().tierList.title}
        {props.scope}
      </h1>
      <Show when={props.facts}>
        {(facts) => (
          <p class={`${styles.dataLine} num`} data-testid={props.testId}>
            <For each={facts()}>
              {(fact) => (
                <span class={styles.fact}>
                  <Show when={fact.glyph}>{(glyph) => <Glyph name={glyph()} size={14} class={styles.factIcon} />}</Show>
                  {fact.text}
                </span>
              )}
            </For>
          </p>
        )}
      </Show>
    </header>
  );
}

/** `· Mid`: what a title shows, its icon and its name. */
export function TitleScope(props: { icon: JSX.Element; label: string }): JSX.Element {
  return (
    <span class={styles.scope}>
      <span class={styles.scopeDot} aria-hidden="true">
        ·
      </span>
      {props.icon}
      {props.label}
    </span>
  );
}

/** A champion filter, as a 40 px pill: Enter does what the page says (opens the best match). */
export function SearchField(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  onEnter: () => void;
  class: string | undefined;
  testId: string;
}): JSX.Element {
  return (
    <label class={`${styles.search} ${props.class ?? ""}`}>
      <Icon name="search" size={16} class={styles.searchIcon} />
      <input
        type="search"
        class={styles.searchInput}
        placeholder={props.label}
        aria-label={props.label}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") props.onEnter();
        }}
        data-testid={props.testId}
      />
    </label>
  );
}

/** ARAM: Mayhem as the last queue tab: its own page from the tier list, a champion's Mayhem tab. */
export interface MayhemTab {
  selected: boolean;
  onSelect: () => void;
  /** Ranked or ARAM chosen while Mayhem is shown. */
  onLeave?: () => void;
}

const MAYHEM = 2400;
type QueueTab = Queue | typeof MAYHEM;
const QUEUE_GLYPH: Record<QueueTab, GlyphName> = { 420: "ranked", 450: "aram", [MAYHEM]: "mayhem" };

/**
 * The queue as the stats pages' own tabs, on a hairline: words, a line under the one shown (`end`
 * at the row's other end). Remembered for every stats page, like the rank. With `mayhem`, ARAM:
 * Mayhem ends the tabs (its augments have a page and a champion tab of their own: nothing is
 * published for it).
 */
export function QueueTabs(props: { mayhem?: MayhemTab; end?: JSX.Element }): JSX.Element {
  const values = (): QueueTab[] => (props.mayhem ? [RANKED, ARAM, MAYHEM] : [RANKED, ARAM]);
  return (
    <div class={styles.tabsRow}>
      <Radios<QueueTab>
        label={t().stats.queue}
        value={props.mayhem?.selected ? MAYHEM : filters().queue}
        values={values()}
        onChange={(queue) => {
          if (queue === MAYHEM) return props.mayhem?.onSelect();
          setFilter({ queue });
          props.mayhem?.onLeave?.();
        }}
        class={styles.tabs}
        optionClass={() => styles.tab}
        testId="queue-switch"
      >
        {(queue) => (
          <>
            <Glyph name={QUEUE_GLYPH[queue]} size={16} class={styles.tabIcon} />
            <span>{queue === MAYHEM ? t().queues[MAYHEM] : queueLabel(queue)}</span>
          </>
        )}
      </Radios>
      {props.end}
    </div>
  );
}

/** The floor tier each bracket is named after: its emblem. */
const BRACKET_TIER: Record<Bracket, Tier> = { emeraldPlus: "emerald", diamondPlus: "diamond", masterPlus: "master" };
const BRACKETS: readonly Bracket[] = ["emeraldPlus", "diamondPlus", "masterPlus"];

/**
 * The rank as a button with its emblem; it opens a small glass grid of the brackets published for
 * this queue (the one shown included), each with Riot's emblem. The platform's popover: Escape or a
 * click outside closes it, and so does a click (or Enter) on a rank. It opens with the rank shown
 * focused: arrows choose without closing it.
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
      <div
        id={id}
        popover
        class={`${styles.menu} glass-rim`}
        style={{ "position-anchor": `--${id}` }}
        ref={menu}
        onToggle={(e) => e.newState === "open" && menu?.querySelector<HTMLElement>("[aria-checked=true]")?.focus()}
      >
        <p class={styles.menuTitle}>{t().stats.rank}</p>
        <Radios
          label={t().stats.rank}
          value={bracket()}
          values={published()}
          onChange={(value) => setFilter({ bracket: value })}
          onPick={() => menu?.hidePopover()}
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
