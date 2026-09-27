import type { JSX } from "solid-js";
import type { Division } from "../data/generated/Division";
import type { Tier } from "../data/generated/Tier";
import styles from "./TierBadge.module.css";

export function tierLabel(tier: Tier, division: Division | null): string {
  const name = tier.charAt(0).toUpperCase() + tier.slice(1);
  return division ? `${name} ${division}` : name;
}

export function TierBadge(props: { tier: Tier; division: Division | null; class?: string | undefined }): JSX.Element {
  return (
    <span class={`${styles.badge} ${styles[props.tier]} ${props.class ?? ""}`}>
      <span class={styles.gem} aria-hidden="true" />
      <span class={styles.label}>{tierLabel(props.tier, props.division)}</span>
    </span>
  );
}
