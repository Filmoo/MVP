import { type JSX, Show } from "solid-js";
import type { DraftView } from "../../data/generated/DraftView";
import { t } from "../../i18n";
import { createCountdown } from "../../lib/countdown";
import { duration } from "../../lib/format";
import styles from "./PhasePill.module.css";

/** The timer turns red from here on. */
const URGENT_SECONDS = 10;

/** Phase and time left: the screen's only urgency cue (red from 10 s). */
export function PhasePill(props: { draft: DraftView }): JSX.Element {
  // The client sends its timer only when the session changes: count down to its deadline.
  const counted = createCountdown(() => props.draft.phaseEndsAt);
  const left = () => counted() ?? props.draft.secondsLeft;
  const urgent = () => {
    const s = left();
    return s !== null && s <= URGENT_SECONDS;
  };
  return (
    <span class={`${styles.pill} ${urgent() ? styles.urgent : ""} num`}>
      {t().draft.phases[props.draft.phase]}
      <Show when={left() !== null}> · {duration(left() ?? 0)}</Show>
    </span>
  );
}
