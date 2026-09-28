import { type JSX, Show } from "solid-js";
import type { TierGrade } from "../data/generated/TierGrade";
import { t } from "../i18n";
import styles from "./TierMark.module.css";

/**
 * A tier-list grade as a medallion: its letter on a shape that says the same thing as the colour,
 * so tiers still read apart without it (colour blindness, a grey screenshot): angular and cut for
 * the strong ones, round then hollow for the weak. S a cut gem, A a shield, B a tile, C a coin,
 * D an empty ring.
 */
const SHAPES: Record<TierGrade, string> = {
  S: "M16 1.8 28.3 8.9v14.2L16 30.2 3.7 23.1V8.9z",
  A: "M16 2.4 27.6 6.6v8.2c0 7-4.7 12.6-11.6 15.2C9.1 27.4 4.4 21.8 4.4 14.8V6.6z",
  B: "M10 3.5h12a6.5 6.5 0 0 1 6.5 6.5v12a6.5 6.5 0 0 1-6.5 6.5H10A6.5 6.5 0 0 1 3.5 22V10A6.5 6.5 0 0 1 10 3.5z",
  C: "M16 3a13 13 0 1 1 0 26 13 13 0 0 1 0-26z",
  D: "M16 4a12 12 0 1 1 0 24 12 12 0 0 1 0-24z",
};

/** Where the letter sits: the shield's middle is higher than its box's. */
const LETTER_Y: Record<TierGrade, number> = { S: 16.6, A: 15.6, B: 16.6, C: 16.6, D: 16.6 };

export function TierMark(props: {
  grade: TierGrade;
  /** Pixels: 16 to 64. */
  size: number;
  /** Next to its written name: decorative. */
  decorative?: boolean;
  class?: string | undefined;
}): JSX.Element {
  return (
    <svg
      class={`${styles.mark} ${styles[props.grade]} ${props.class ?? ""}`}
      width={props.size}
      height={props.size}
      viewBox="0 0 32 32"
      role={props.decorative ? undefined : "img"}
      aria-label={props.decorative ? undefined : t().stats.tier(props.grade)}
      aria-hidden={props.decorative ? "true" : undefined}
      data-free-style
    >
      <path class={styles.shape} d={SHAPES[props.grade]} />
      {/* The gem's cut: a lit facet on the S. */}
      <Show when={props.grade === "S"}>
        <path class={styles.facet} d="M16 1.8 28.3 8.9 16 12.5 3.7 8.9z" />
      </Show>
      <text class={styles.letter} x="16" y={LETTER_Y[props.grade]} text-anchor="middle" dominant-baseline="central">
        {props.grade}
      </text>
    </svg>
  );
}
