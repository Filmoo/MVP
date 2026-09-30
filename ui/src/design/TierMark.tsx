import { type JSX, Show } from "solid-js";
import type { TierGrade } from "../data/generated/TierGrade";
import { t } from "../i18n";
import styles from "./TierMark.module.css";

/**
 * A tier-list grade as a medallion: its letter on a shape that says the same thing as the colour,
 * so tiers still read apart without it (colour blindness, a grey screenshot): angular and cut for
 * the strong ones, round then hollow for the weak. S a cut gem, A a shield, B a tile, C a coin,
 * D an empty ring. One element, drawn by CSS: long lists stay light. What the tier means shows on
 * hover (design/tip); every medallion lends its picture to a tooltip around it (`data-mark`).
 */
export function TierMark(props: {
  grade: TierGrade;
  /** 20, 24 or 40 px. */
  size?: "sm" | "md" | "lg";
  /** Next to its written name: not read twice. */
  decorative?: boolean;
  /** Its tooltip even when decorative (a shelf's medallion; a named one always has it). */
  tip?: boolean;
  class?: string | undefined;
}): JSX.Element {
  const cls = () => `${styles.mark} ${styles[props.size ?? "md"]} ${styles[props.grade]} ${props.class ?? ""}`;
  return (
    <Show
      when={!props.decorative}
      fallback={
        <span class={cls()} aria-hidden="true" data-tip={props.tip ? `tier:${props.grade}` : undefined} data-mark>
          {props.grade}
        </span>
      }
    >
      <span class={cls()} role="img" aria-label={t().stats.tier(props.grade)} data-tip={`tier:${props.grade}`} data-mark>
        {props.grade}
      </span>
    </Show>
  );
}
