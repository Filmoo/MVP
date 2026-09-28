import { type JSX, Show } from "solid-js";
import type { Division } from "../data/generated/Division";
import type { Tier } from "../data/generated/Tier";
import type { TierGrade } from "../data/generated/TierGrade";
import styles from "./TierBadge.module.css";

/**
 * A tier-list grade (S–D) as a small square in the tier's color. D is drawn as an outline: it
 * reads as the weakest and stays legible.
 */
export function GradeBadge(props: { grade: TierGrade; size?: "sm" | "md" | "lg"; class?: string | undefined }): JSX.Element {
  return (
    <span
      class={`${styles.grade} ${styles[`grade${props.grade}`]} ${styles[props.size ?? "md"]} ${props.class ?? ""}`}
      role="img"
      aria-label={`Tier ${props.grade}`}
      title={`Tier ${props.grade}`}
    >
      {props.grade}
    </span>
  );
}

export function tierLabel(tier: Tier, division: Division | null): string {
  const name = tier.charAt(0).toUpperCase() + tier.slice(1);
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
