import { type JSX, Show } from "solid-js";
import type { DataSetInfo } from "../../data/generated/DataSetInfo";
import type { StatsIndex } from "../../data/generated/StatsIndex";
import { Glyph, type GlyphName, glyphPath } from "../../design/Glyph";
import { Icon, iconPath, LineIcon } from "../../design/Icon";
import { liquid } from "../../design/liquid/liquid";
import { PenguinArt } from "../../design/PenguinArt";
import { Radios } from "../../design/Radios";
import { t } from "../../i18n";
import { timeAgo } from "../../lib/format";
import { backendError } from "../../lib/players";
import { ROLE_ICON, ROLE_TONE, ROLES, roleLabel } from "../../lib/roles";
import { patchName, statsErrorWords } from "../../lib/stats";
import { filters, type RoleFilter, setFilter } from "../../lib/stats-filters";
import { setTierView, TIER_VIEWS, type TierView, tierView } from "../../lib/tier-view";
import styles from "./Toolbar.module.css";

/** `Tier list · Mid`: the page's title, then the lane shown, in its colour. */
export function TierTitle(props: { role: RoleFilter; lane: boolean }): JSX.Element {
  // Every lane in plain white: the accent is Mid's colour.
  const tone = () => (props.role === "all" ? "var(--text-1)" : ROLE_TONE[props.role]);
  return (
    <h1 class={styles.title}>
      {t().tierList.title}
      <Show when={props.lane}>
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
      // Its word goes on narrow pages: the name and the tooltip stay.
      optionLabel={(view) => t().tierList.views[view]}
      optionHint={(view) => t().tierList.views[view]}
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
 * Lanes as a row of icon buttons; the chosen one sits on a drop of glass in its colour. Each says
 * its name in the app's tooltip (design/tip), on hover or focus.
 */
export function LaneButtons(): JSX.Element {
  // Every lane on a neutral drop, in white: the accent is Mid's colour.
  const tone = (role: RoleFilter) => (role === "all" ? "var(--text-1)" : ROLE_TONE[role]);
  const soft = (role: RoleFilter) => (role === "all" ? "var(--bg-drop)" : `var(--role-${role}-soft)`);
  const label = (role: RoleFilter) => (role === "all" ? t().stats.allRoles : roleLabel(role));
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
      optionLabel={label}
      optionHint={label}
      testId="role-filter"
      before={<span class={`${styles.drop} glass-rim`} aria-hidden="true" ref={(el) => liquid(el, "lens")} />}
    >
      {(role) => (
        <span class={styles.laneIcon} style={{ "--tone": tone(role) }}>
          <LineIcon d={role === "all" ? glyphPath("roleAll") : iconPath(ROLE_ICON[role])} size={20} />
        </span>
      )}
    </Radios>
  );
}

/**
 * Why there are no stats, under the tools, where the lanes were: every champion shows by class
 * meanwhile. Nothing published is said with the penguin; a failure is an alert, with "Try again"
 * ending the sentence when asking again can help.
 */
export function NoStatsNotice(props: { error: unknown; onRetry: () => void }): JSX.Element {
  const words = () => statsErrorWords(backendError(props.error));
  return (
    <div class={styles.notice} role={words().empty ? "status" : "alert"} data-testid="no-stats">
      <Show
        when={words().empty}
        fallback={
          <span class={styles.noticeIcon}>
            <Icon name="alert" size={16} />
          </span>
        }
      >
        <PenguinArt size={32} />
      </Show>
      <p class={styles.noticeText}>
        {t().tierList.noStats(words().title)}
        <Show when={words().retry}>
          {" "}
          <button type="button" class={styles.retry} onClick={() => props.onRetry()}>
            {t().common.tryAgain}
          </button>
        </Show>
      </p>
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
