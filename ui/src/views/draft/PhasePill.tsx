import { type JSX, Show } from "solid-js";
import type { DraftView } from "../../data/generated/DraftView";
import { duration } from "../../lib/format";
import styles from "./PhasePill.module.css";

const PHASE_LABEL: Record<DraftView["phase"], string> = {
  planning: "Planning",
  banning: "Banning",
  picking: "Picking",
  finalizing: "Finalizing",
};
/** The timer turns red from here on. */
const URGENT_SECONDS = 10;

/** Phase and time left: the screen's only urgency cue (red from 10 s). */
export function PhasePill(props: { draft: DraftView }): JSX.Element {
  const urgent = () => props.draft.secondsLeft !== null && props.draft.secondsLeft <= URGENT_SECONDS;
  return (
    <span class={`${styles.pill} ${urgent() ? styles.urgent : ""} num`}>
      {PHASE_LABEL[props.draft.phase]}
      <Show when={props.draft.secondsLeft !== null}> · {duration(props.draft.secondsLeft ?? 0)}</Show>
    </span>
  );
}
