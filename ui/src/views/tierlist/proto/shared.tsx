/**
 * Tier list design prototypes (dev server only, `#/tier-list?design=shelves|ledger|map`): what the
 * three directions share. Data as the page gets it, tiers grouped, and scope controls that aren't
 * segmented sliders (underline tabs, gem chips, menus in a sentence).
 */
import { type Accessor, createMemo, createUniqueId, For, type JSX, Show } from "solid-js";
import { useData } from "../../../data/context";
import type { Bracket } from "../../../data/generated/Bracket";
import type { DataSetInfo } from "../../../data/generated/DataSetInfo";
import type { StatsIndex } from "../../../data/generated/StatsIndex";
import type { TierGrade } from "../../../data/generated/TierGrade";
import type { TierList } from "../../../data/generated/TierList";
import { Card } from "../../../design/Card";
import { Glyph, type GlyphName, glyphPath } from "../../../design/Glyph";
import { Icon, iconPath, LineIcon } from "../../../design/Icon";
import { Penguin } from "../../../design/Penguin";
import type { RailOption } from "../../../design/RoleRail";
import { EmptyState } from "../../../design/States";
import { segmentFor } from "../../../design/segmented-keys";
import { t } from "../../../i18n";
import { integer, timeAgo } from "../../../lib/format";
import { createQuery, type Query } from "../../../lib/query";
import { ROLE_ICON, ROLE_TONE, ROLES, roleLabel } from "../../../lib/roles";
import { bracketLabel, bracketOptions, patchName, queueLabel, queueOptions, type RankedEntry, rankEntries } from "../../../lib/stats";
import { ARAM, filters, type Queue, type RoleFilter, setFilter } from "../../../lib/stats-filters";
import { useLinkFilters, useStatsIndex } from "../../stats/common";
import styles from "./shared.module.css";

export const TIERS: readonly TierGrade[] = ["S", "A", "B", "C", "D"];

export interface TierData {
  index: Accessor<StatsIndex | null | undefined>;
  list: Query<TierList>;
  queue: Accessor<Queue>;
  role: Accessor<RoleFilter>;
  /** The rows shown: one role (or all), ranked by score. */
  ranked: Accessor<RankedEntry[]>;
  /** Champions ranked in each role (the rail's counts). */
  counts: (role: RoleFilter) => number | undefined;
}

/** The tier list's data, as the page loads it (queue, bracket, role from the shared filters). */
export function useTierData(): TierData {
  const { transport } = useData();
  const { index, version } = useStatsIndex();
  useLinkFilters({ role: true });
  const queue = createMemo(() => filters().queue);
  const bracket = createMemo(() => filters().bracket);
  const list = createQuery(
    () => ({ queue: queue(), bracket: bracket(), version: version() }),
    (k) => transport.call("tier_list", { queue: k.queue, bracket: k.bracket }),
  );
  const role = () => (queue() === ARAM ? "all" : filters().role);
  const ranked = createMemo(() => {
    const data = list.data();
    return data ? rankEntries(data.entries, role()) : [];
  });
  const byRole = createMemo(() => {
    const counts = new Map<RoleFilter, number>();
    for (const e of list.data()?.entries ?? []) {
      counts.set("all", (counts.get("all") ?? 0) + 1);
      if (e.role) counts.set(e.role, (counts.get(e.role) ?? 0) + 1);
    }
    return counts;
  });
  return { index, list, queue, role, ranked, counts: (r) => (list.data() ? (byRole().get(r) ?? 0) : undefined) };
}

export interface TierGroup {
  tier: TierGrade;
  entries: RankedEntry[];
  /** Mean win rate of the tier (0–1). */
  winRate: number;
}

/** Rows by tier, best tier first (rows keep their order inside a tier). */
export function groupByTier(rows: readonly RankedEntry[]): TierGroup[] {
  return TIERS.map((tier) => {
    const entries = rows.filter((e) => e.tier === tier);
    const winRate = entries.length ? entries.reduce((sum, e) => sum + e.winRate, 0) / entries.length : 0;
    return { tier, entries, winRate };
  }).filter((g) => g.entries.length > 0);
}

/**
 * The page's title with the role shown, in its colour: `Tier list · Mid`. The rail says it with
 * an icon; this says it in words, for touch screens (no hover, no names) and screenshots.
 */
export function TierTitle(props: { role: RoleFilter; aram: boolean; class?: string | undefined }): JSX.Element {
  const tone = () => (props.role === "all" ? "var(--accent)" : ROLE_TONE[props.role]);
  return (
    <h1 class={`${styles.title} ${props.class ?? ""}`}>
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

/** The role filter as a vertical rail: each role in its colour, with how many champions it ranks. */
export const roleRailOptions = (counts?: (role: RoleFilter) => number | undefined): RailOption<RoleFilter>[] => {
  const detail = (role: RoleFilter) => {
    const n = counts?.(role);
    return n === undefined ? undefined : integer(n);
  };
  return [
    { value: "all", label: t().stats.allRoles, path: glyphPath("roleAll"), tone: "var(--accent)", detail: detail("all") },
    ...ROLES.map((role) => ({
      value: role,
      label: roleLabel(role),
      path: iconPath(ROLE_ICON[role]),
      tone: ROLE_TONE[role],
      detail: detail(role),
    })),
  ];
};

/** Nobody ranked in this role and rank yet: the penguin waits with you. */
export function NoneRanked(): JSX.Element {
  return (
    <Card>
      <EmptyState icon="tiers" art={<Penguin size={72} />} title={t().tierList.empty.title} text={t().tierList.empty.text} />
    </Card>
  );
}

/** A win rate's colour: blue over 50 %, rose under (League's convention, pastel). */
export const wrTone = (winRate: number): string => styles[wrSide(winRate)] ?? "";

/** Over, under or at 50 % as shown (to one decimal): `50.0%` is even, whichever side it is on. */
export const wrSide = (winRate: number): "win" | "loss" | "even" =>
  Math.abs(winRate - 0.5) < 0.0005 ? "even" : winRate > 0.5 ? "win" : "loss";

/** Patch, games counted, last update: the scope itself is said by the controls. */
export function DataLine(props: { info: DataSetInfo; index: StatsIndex | null | undefined; class?: string | undefined }): JSX.Element {
  return (
    <p class={`${styles.dataLine} num ${props.class ?? ""}`} data-testid="data-badge">
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

/** A small radio group with roving focus, drawn by its caller (tabs, gems). */
function RadioRow<T extends string | number>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  class: string | undefined;
  optionClass: string | undefined;
  render: (option: { value: T; label: string }, checked: boolean) => JSX.Element;
  testId?: string;
}): JSX.Element {
  const buttons: HTMLButtonElement[] = [];
  const selected = () =>
    Math.max(
      0,
      props.options.findIndex((o) => o.value === props.value),
    );
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class={props.class}
      data-testid={props.testId}
      onKeyDown={(event) => {
        const next = segmentFor(event.key, selected(), props.options.length);
        const option = next === undefined ? undefined : props.options[next];
        if (next === undefined || !option) return;
        event.preventDefault();
        buttons[next]?.focus();
        if (option.value !== props.value) props.onChange(option.value);
      }}
    >
      <For each={props.options}>
        {(option, i) => {
          const checked = () => option.value === props.value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA radio group of buttons (roving tabindex), like Segmented
            <button
              ref={(el) => {
                buttons[i()] = el;
              }}
              type="button"
              role="radio"
              class={props.optionClass}
              aria-checked={checked()}
              tabIndex={checked() ? 0 : -1}
              onClick={() => !checked() && props.onChange(option.value)}
            >
              {props.render(option, checked())}
            </button>
          );
        }}
      </For>
    </div>
  );
}

const QUEUE_ICON: Record<Queue, GlyphName> = { 420: "ranked", 450: "aram" };

/** The queue as the page's own tabs: big words, a line under the one shown. */
export function QueueTabs(): JSX.Element {
  return (
    <RadioRow
      label={t().stats.queue}
      value={filters().queue}
      options={queueOptions()}
      onChange={(queue) => setFilter({ queue })}
      class={styles.tabs}
      optionClass={styles.tab}
      testId="queue-switch"
      render={(o) => (
        <>
          <Glyph name={QUEUE_ICON[o.value]} size={16} class={styles.tabIcon} />
          <span>{o.label}</span>
        </>
      )}
    />
  );
}

const BRACKET_TONE: Record<Bracket, string> = {
  emeraldPlus: "var(--rank-emerald)",
  diamondPlus: "var(--rank-diamond)",
  masterPlus: "var(--rank-master)",
};

/** Rank brackets as gems in their rank's colour; the one shown sits on glass. */
export function BracketGems(props: { class?: string | undefined }): JSX.Element {
  return (
    <RadioRow
      label={t().stats.rank}
      value={filters().bracket}
      options={bracketOptions()}
      onChange={(bracket) => setFilter({ bracket })}
      class={`${styles.gems} ${props.class ?? ""}`}
      optionClass={styles.gem}
      testId="bracket-switch"
      render={(o) => (
        <>
          <span class={styles.gemIcon} style={{ "--gem": BRACKET_TONE[o.value] }}>
            <Glyph name="gem" size={16} />
          </span>
          <span>{o.label}</span>
        </>
      )}
    />
  );
}

/**
 * A choice inside a sentence: the current value, underlined, opens a small glass menu (the
 * platform's popover, anchored to it: no script to place or dismiss it). Escape or a click
 * outside closes it; choosing closes it too.
 */
interface MenuOption<T> {
  value: T;
  label: string;
  icon: GlyphName;
  tone?: string;
}

/** A menu's choices: a radio group of rows (icon, name, a check on the current one). */
function MenuChoices<T extends string | number>(props: {
  label: string;
  value: T;
  options: readonly MenuOption<T>[];
  onChoose: (value: T) => void;
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={props.label} class={styles.menuList}>
      <For each={props.options}>
        {(option) => (
          // biome-ignore lint/a11y/useSemanticElements: a menu of radio buttons, each one row
          <button
            type="button"
            role="radio"
            aria-checked={option.value === props.value}
            class={styles.menuItem}
            onClick={() => props.onChoose(option.value)}
          >
            <span class={styles.menuIcon} style={option.tone ? { "--gem": option.tone } : undefined}>
              <Glyph name={option.icon} size={16} />
            </span>
            <span>{option.label}</span>
            <Icon name="check" size={14} class={styles.menuCheck} />
          </button>
        )}
      </For>
    </div>
  );
}

function InlineMenu<T extends string | number>(props: {
  label: string;
  value: T;
  options: readonly MenuOption<T>[];
  onChange: (value: T) => void;
  testId?: string;
}): JSX.Element {
  const id = `menu-${createUniqueId()}`;
  let menu: HTMLDivElement | undefined;
  const current = () => props.options.find((o) => o.value === props.value);
  return (
    <>
      <button
        type="button"
        class={styles.inlineButton}
        popovertarget={id}
        aria-label={`${props.label}: ${current()?.label ?? ""}`}
        style={{ "anchor-name": `--${id}` }}
        data-testid={props.testId}
      >
        <span>{current()?.label}</span>
        <Icon name="chevronDown" size={14} class={styles.inlineChevron} />
      </button>
      <div id={id} popover class={`${styles.menu} glass-rim`} style={{ "position-anchor": `--${id}` }} ref={menu}>
        <MenuChoices
          label={props.label}
          value={props.value}
          options={props.options}
          onChoose={(value) => {
            props.onChange(value);
            menu?.hidePopover();
          }}
        />
      </div>
    </>
  );
}

const queueChoices = (): MenuOption<Queue>[] => queueOptions().map((o) => ({ ...o, icon: QUEUE_ICON[o.value] }));
const bracketChoices = (): MenuOption<Bracket>[] =>
  bracketOptions().map((o) => ({ ...o, icon: "gem" as const, tone: BRACKET_TONE[o.value] }));

/**
 * Queue and rank behind one quiet button (`Ranked Solo · Emerald+`): both choices in one small
 * glass pane, which stays open while you pick (Escape or a click outside closes it).
 */
export function ScopeButton(): JSX.Element {
  const id = `scope-${createUniqueId()}`;
  return (
    <>
      <button
        type="button"
        class={styles.scopeButton}
        popovertarget={id}
        style={{ "anchor-name": `--${id}` }}
        aria-label={`${t().stats.queue}, ${t().stats.rank}: ${scopeWords()}`}
        data-testid="scope-button"
      >
        <Glyph name={QUEUE_ICON[filters().queue]} size={16} class={styles.scopeIcon} />
        <span>{queueLabel(filters().queue)}</span>
        <span class={styles.dot}>·</span>
        <span class={styles.menuIcon} style={{ "--gem": BRACKET_TONE[filters().bracket] }}>
          <Glyph name="gem" size={16} />
        </span>
        <span>{bracketLabel(filters().bracket)}</span>
        <Icon name="chevronDown" size={14} class={styles.inlineChevron} />
      </button>
      <div id={id} popover class={`${styles.menu} ${styles.menuEnd} glass-rim`} style={{ "position-anchor": `--${id}` }}>
        <p class={styles.menuTitle}>{t().stats.queue}</p>
        <MenuChoices label={t().stats.queue} value={filters().queue} options={queueChoices()} onChoose={(queue) => setFilter({ queue })} />
        <p class={styles.menuTitle}>{t().stats.rank}</p>
        <MenuChoices
          label={t().stats.rank}
          value={filters().bracket}
          options={bracketChoices()}
          onChoose={(bracket) => setFilter({ bracket })}
        />
      </div>
    </>
  );
}

/** `Ranked Solo ▾ · Emerald+ ▾ · Patch 26.19 · 412K games`: the data line is the control. */
export function ScopeSentence(props: { info: DataSetInfo | undefined; index: StatsIndex | null | undefined }): JSX.Element {
  return (
    <p class={`${styles.sentence} num`}>
      <InlineMenu
        label={t().stats.queue}
        value={filters().queue}
        options={queueChoices()}
        onChange={(queue) => setFilter({ queue })}
        testId="queue-switch"
      />
      <span class={styles.dot}>·</span>
      <InlineMenu
        label={t().stats.rank}
        value={filters().bracket}
        options={bracketChoices()}
        onChange={(bracket) => setFilter({ bracket })}
        testId="bracket-switch"
      />
      {props.info && (
        <>
          <span class={styles.dot}>·</span>
          <span class={styles.fact}>{t().common.patch(patchName(props.index, props.info.patch))}</span>
          <span class={styles.dot}>·</span>
          <span class={styles.fact}>{t().common.games(props.info.games)}</span>
          <span class={`${styles.dot} ${styles.wide}`}>·</span>
          <span class={`${styles.fact} ${styles.wide}`}>{t().common.updated(timeAgo(props.info.updatedAt))}</span>
        </>
      )}
    </p>
  );
}

/** The scope in words, for a heading: `Ranked Solo · Emerald+`. */
export const scopeWords = (): string => `${queueLabel(filters().queue)} · ${bracketLabel(filters().bracket)}`;
