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

/** Pastel crest in the tier's color: a shield with a gem, drawn (Riot emblems stay out of the repo). */
export function TierCrest(props: { tier: Tier; size: 40 | 48 | 56; class?: string | undefined }): JSX.Element {
  return (
    <svg
      class={`${styles.crest} ${styles[props.tier]} ${props.class ?? ""}`}
      width={props.size}
      height={props.size}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <path d="M24 3 42 13v22L24 45 6 35V13z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="2" />
      <path d="M24 9.5 36.5 16.5v15L24 38.5 11.5 31.5v-15z" fill="none" stroke="currentColor" stroke-opacity="0.35" />
      <path d="M24 13 33 24 24 35 15 24z" fill="currentColor" />
      <path d="M24 13 33 24H15z" fill="white" fill-opacity="0.3" />
    </svg>
  );
}
