import { type JSX, Show } from "solid-js";
import type { Division } from "../data/generated/Division";
import type { Tier } from "../data/generated/Tier";
import { t } from "../i18n";
import styles from "./TierBadge.module.css";

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
