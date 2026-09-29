import { type JSX, Show } from "solid-js";
import type { Division } from "../data/generated/Division";
import type { Tier } from "../data/generated/Tier";
import type { TierGrade } from "../data/generated/TierGrade";
import { t } from "../i18n";
import styles from "./TierBadge.module.css";

/**
 * A tier-list grade (S–D) as a small square in the tier's color. D is drawn as an outline: it
 * reads as the weakest and stays legible. What the tier means shows on hover (design/tip), and
 * on keyboard focus when it isn't inside another control (`focusable`).
 */
export function GradeBadge(props: {
  grade: TierGrade;
  size?: "sm" | "md" | "lg";
  focusable?: boolean;
  class?: string | undefined;
}): JSX.Element {
  return (
    <span
      class={`${styles.grade} ${styles[`grade${props.grade}`]} ${styles[props.size ?? "md"]} ${props.class ?? ""}`}
      role="img"
      aria-label={t().stats.tier(props.grade)}
      data-tip={`tier:${props.grade}`}
      data-mark
      tabIndex={props.focusable ? 0 : undefined}
    >
      {props.grade}
    </span>
  );
}

export function tierLabel(tier: Tier, division: Division | null): string {
  const name = t().tiers[tier];
  return division ? `${name} ${division}` : name;
}

/** Tier name in its color; `plain` drops the gem (when a crest stands next to it). */
export function TierBadge(props: { tier: Tier; division: Division | null; plain?: boolean; class?: string | undefined }): JSX.Element {
  return (
    <span class={`${styles.badge} ${styles[props.tier]} ${props.class ?? ""}`}>
      <Show when={!props.plain}>
        <span class={styles.gem} aria-hidden="true" />
      </Show>
      <span class={styles.label}>{tierLabel(props.tier, props.division)}</span>
    </span>
  );
}
