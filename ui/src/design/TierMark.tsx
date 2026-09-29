import { type JSX, Show } from "solid-js";
import type { TierGrade } from "../data/generated/TierGrade";
import { t } from "../i18n";
import styles from "./TierMark.module.css";

/**
 * A tier-list grade as a medallion: its letter on a shape that says the same thing as the colour,
 * so tiers still read apart without it (colour blindness, a grey screenshot): angular and cut for
 * the strong ones, round then hollow for the weak. S a cut gem, A a shield, B a tile, C a coin,
 * D an empty ring. One element, drawn by CSS: long lists stay light.
 */
export function TierMark(props: {
  grade: TierGrade;
  /** 20, 24, 40 or 64 px. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Next to its written name: not read twice. */
  decorative?: boolean;
  class?: string | undefined;
}): JSX.Element {
  const cls = () => `${styles.mark} ${styles[props.size ?? "md"]} ${styles[props.grade]} ${props.class ?? ""}`;
  return (
    <Show
      when={!props.decorative}
      fallback={
        <span class={cls()} aria-hidden="true">
          {props.grade}
        </span>
      }
    >
      <span class={cls()} role="img" aria-label={t().stats.tier(props.grade)} title={t().stats.tier(props.grade)}>
        {props.grade}
      </span>
    </Show>
  );
}
