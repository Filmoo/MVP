import { type JSX, Show } from "solid-js";
import { Glyph, type GlyphName } from "../../design/Glyph";
import { Icon } from "../../design/Icon";
import { liquid } from "../../design/liquid/liquid";
import { PenguinArt } from "../../design/PenguinArt";
import { Radios } from "../../design/Radios";
import { RoleIcon } from "../../design/RoleIcon";
import { Segmented } from "../../design/Segmented";
import { t } from "../../i18n";
import { backendError } from "../../lib/players";
import { ROLES, roleLabel } from "../../lib/roles";
import { statsErrorWords } from "../../lib/stats";
import { filters, type RoleFilter, setFilter } from "../../lib/stats-filters";
import { setTierView, TIER_VIEWS, type TierView, tierView } from "../../lib/tier-view";
import { TitleScope } from "../stats/common";
import styles from "./Toolbar.module.css";

/** A lane's icon: League's for a role, every champion's grid for every lane. */
function LaneIcon(props: { role: RoleFilter; size: 16 | 20 }): JSX.Element {
  return (
    <Show when={props.role !== "all" && props.role} fallback={<Icon name="champions" size={props.size} />}>
      {(role) => <RoleIcon role={role()} size={props.size} />}
    </Show>
  );
}

const laneLabel = (role: RoleFilter) => (role === "all" ? t().stats.allRoles : roleLabel(role));

/** `· Mid`: the lane shown, after a title (the tier list's, the map's). */
export function LaneScope(props: { role: RoleFilter }): JSX.Element {
  return <TitleScope icon={<LaneIcon role={props.role} size={20} />} label={laneLabel(props.role)} />;
}

const VIEW_GLYPH: Record<TierView, GlyphName> = { shelves: "shelves", table: "table" };

/** Shelves or table, remembered; the words go on narrow pages (the names and tooltips stay). */
export function ViewSwitch(): JSX.Element {
  return (
    <Segmented
      label={t().tierList.views.label}
      size="lg"
      class={styles.views}
      options={TIER_VIEWS.map((view) => ({
        value: view,
        label: t().tierList.views[view],
        icon: () => <Glyph name={VIEW_GLYPH[view]} size={16} />,
      }))}
      value={tierView()}
      onChange={setTierView}
      testId="view-switch"
    />
  );
}

const LANES: readonly RoleFilter[] = ["all", ...ROLES];

/**
 * Lanes as a row of icon buttons; the chosen one sits on a neutral drop of glass, in white (colours
 * on this page are the tiers' and win rates'). Each says its name in the app's tooltip
 * (design/tip), on hover or focus.
 */
export function LaneButtons(): JSX.Element {
  const index = () => Math.max(0, LANES.indexOf(filters().role));
  return (
    <Radios
      label={t().stats.role}
      value={filters().role}
      values={LANES}
      onChange={(role) => setFilter({ role })}
      class={styles.lanes}
      style={{ "--index": String(index()) }}
      optionClass={() => styles.lane}
      optionLabel={laneLabel}
      optionHint={laneLabel}
      testId="role-filter"
      before={<span class={`${styles.drop} glass-rim`} aria-hidden="true" ref={(el) => liquid(el, "lens")} />}
    >
      {(role) => (
        <span class={styles.laneIcon}>
          <LaneIcon role={role} size={20} />
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
