import { createUniqueId, For, type JSX, Show } from "solid-js";
import type { Bracket } from "../../data/generated/Bracket";
import type { DataSetInfo } from "../../data/generated/DataSetInfo";
import type { StatsIndex } from "../../data/generated/StatsIndex";
import type { Tier } from "../../data/generated/Tier";
import { Glyph, type GlyphName, glyphPath } from "../../design/Glyph";
import { Icon, iconPath, LineIcon } from "../../design/Icon";
import { liquid } from "../../design/liquid/liquid";
import { RankEmblem } from "../../design/RankEmblem";
import { segmentFor } from "../../design/segmented-keys";
import { t } from "../../i18n";
import { timeAgo } from "../../lib/format";
import { ROLE_ICON, ROLE_TONE, ROLES, roleLabel } from "../../lib/roles";
import { bracketLabel, patchName, queueLabel } from "../../lib/stats";
import { ARAM, filters, type Queue, RANKED, type RoleFilter, setFilter } from "../../lib/stats-filters";
import { setTierView, TIER_VIEWS, type TierView, tierView } from "../../lib/tier-view";
import styles from "./Toolbar.module.css";

/** A radio group of buttons with roving focus (one tab stop, arrows, Home/End), drawn by its caller. */
function Radios<T extends string | number>(props: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
  class: string | undefined;
  optionClass: (value: T) => string | undefined;
  optionLabel?: (value: T) => string;
  children: (value: T, checked: boolean) => JSX.Element;
  style?: JSX.CSSProperties;
  testId?: string;
  before?: JSX.Element;
}): JSX.Element {
  const buttons: HTMLButtonElement[] = [];
  const selected = () => Math.max(0, props.values.indexOf(props.value));
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class={props.class}
      style={props.style}
      data-testid={props.testId}
      onKeyDown={(event) => {
        const next = segmentFor(event.key, selected(), props.values.length);
        const value = next === undefined ? undefined : props.values[next];
        if (next === undefined || value === undefined) return;
        event.preventDefault();
        buttons[next]?.focus();
        if (value !== props.value) props.onChange(value);
      }}
    >
      {props.before}
      <For each={props.values}>
        {(value, i) => {
          const checked = () => value === props.value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA radio group of buttons (roving tabindex), like Segmented
            <button
              ref={(el) => {
                buttons[i()] = el;
              }}
              type="button"
              role="radio"
              class={props.optionClass(value)}
              aria-checked={checked()}
              aria-label={props.optionLabel?.(value)}
              tabIndex={checked() ? 0 : -1}
              onClick={() => !checked() && props.onChange(value)}
            >
              {props.children(value, checked())}
            </button>
          );
        }}
      </For>
    </div>
  );
}

/** `Tier list · Mid`: the page's title, then the lane shown, in its colour. */
export function TierTitle(props: { role: RoleFilter; aram: boolean }): JSX.Element {
  const tone = () => (props.role === "all" ? "var(--accent)" : ROLE_TONE[props.role]);
  return (
    <h1 class={styles.title}>
      {t().tierList.title}
      <Show when={!props.aram}>
        <span class={styles.titleRole} style={{ "--tone": tone() }}>
          <span class={styles.titleDot} aria-hidden="true">
            ·
          </span>
          <LineIcon d={props.role === "all" ? glyphPath("roleAll") : iconPath(ROLE_ICON[props.role])} size={20} class={styles.titleIcon} />
          {props.role === "all" ? t().stats.allRoles : roleLabel(props.role)}
        </span>
      </Show>
    </h1>
  );
}

/** Patch, games counted, last update: the page's data, as text (no picker: the current patch). */
export function DataLine(props: { info: DataSetInfo; index: StatsIndex | null | undefined }): JSX.Element {
  return (
    <p class={`${styles.dataLine} num`} data-testid="data-badge">
      <span class={styles.fact}>
        <Glyph name="patch" size={14} class={styles.factIcon} />
        {t().common.patch(patchName(props.index, props.info.patch))}
      </span>
      <span class={styles.fact}>
        <Glyph name="games" size={14} class={styles.factIcon} />
        {t().common.games(props.info.games)}
      </span>
      <span class={styles.fact}>{t().common.updated(timeAgo(props.info.updatedAt))}</span>
    </p>
  );
}

const QUEUE_GLYPH: Record<Queue, GlyphName> = { 420: "ranked", 450: "aram" };

/** The queue as the page's own tabs: words, a line under the one shown (room for more tabs). */
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

const VIEW_GLYPH: Record<TierView, GlyphName> = { shelves: "shelves", table: "table" };

/** Shelves or table, remembered. */
export function ViewSwitch(): JSX.Element {
  return (
    <Radios
      label={t().tierList.views.label}
      value={tierView()}
      values={TIER_VIEWS}
      onChange={setTierView}
      class={styles.views}
      optionClass={() => styles.view}
      testId="view-switch"
    >
      {(view) => (
        <>
          <Glyph name={VIEW_GLYPH[view]} size={16} />
          <span class={styles.viewLabel}>{t().tierList.views[view]}</span>
        </>
      )}
    </Radios>
  );
}

const LANES: readonly RoleFilter[] = ["all", ...ROLES];

/**
 * Lanes as a row of icon buttons; the chosen one sits on a drop of glass in its colour. Each
 * says its name (and how many champions it ranks) in a tooltip under it, on hover or focus.
 */
export function LaneButtons(props: { counts: (role: RoleFilter) => number | undefined }): JSX.Element {
  const tone = (role: RoleFilter) => (role === "all" ? "var(--accent)" : ROLE_TONE[role]);
  const soft = (role: RoleFilter) => (role === "all" ? "var(--bg-lens-accent)" : `var(--role-${role}-soft)`);
  const label = (role: RoleFilter) => (role === "all" ? t().stats.allRoles : roleLabel(role));
  const count = (role: RoleFilter) => {
    const n = props.counts(role);
    return n === undefined ? undefined : t().tierList.champions(n);
  };
  const index = () => Math.max(0, LANES.indexOf(filters().role));
  return (
    <Radios
      label={t().stats.role}
      value={filters().role}
      values={LANES}
      onChange={(role) => setFilter({ role })}
      class={styles.lanes}
      style={{ "--index": String(index()), "--drop": soft(filters().role) }}
      optionClass={() => styles.lane}
      optionLabel={(role) => (count(role) ? `${label(role)}, ${count(role)}` : label(role))}
      testId="role-filter"
      before={<span class={`${styles.drop} glass-rim`} aria-hidden="true" ref={(el) => liquid(el, "lens")} />}
    >
      {(role) => (
        <>
          <span class={styles.laneIcon} style={{ "--tone": tone(role) }}>
            <LineIcon d={role === "all" ? glyphPath("roleAll") : iconPath(ROLE_ICON[role])} size={20} />
          </span>
          <span class={`${styles.tip} glass-rim`} aria-hidden="true">
            {label(role)}
            <Show when={count(role)}>{(n) => <span class={`${styles.tipCount} num`}>{n()}</span>}</Show>
          </span>
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
        aria-label={t().common.colon(t().stats.rank, bracketLabel(bracket()))}
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

/** Filters the champions as you type (best match first); Enter opens the best one. */
export function ChampionFilter(props: { value: string; onInput: (value: string) => void; onEnter: () => void }): JSX.Element {
  return (
    <label class={styles.filter}>
      <Icon name="search" size={16} class={styles.filterIcon} />
      <input
        type="search"
        class={styles.filterInput}
        placeholder={t().tierList.filter}
        aria-label={t().tierList.filter}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && props.value.trim()) props.onEnter();
        }}
        data-testid="champion-filter"
      />
    </label>
  );
}
