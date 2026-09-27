import { createEffect, createSignal, type JSX } from "solid-js";
import styles from "./Slider.module.css";

/**
 * Whole-number slider with its value beside it. A native range input: arrows, Page Up/Down,
 * Home/End and dragging all work. `onChange` fires once per committed value (release or key),
 * so the core isn't asked to save every pixel of a drag.
 */
export function Slider(props: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** Visible value, e.g. `2 s`. */
  format: (value: number) => string;
  /** Spoken value, e.g. `2 seconds`. */
  valueText?: (value: number) => string;
  disabled?: boolean;
  labelledBy?: string;
  describedBy?: string;
  testId?: string;
}): JSX.Element {
  // Follows the drag; snaps back to the saved value whenever that changes.
  const [live, setLive] = createSignal(props.value);
  createEffect(() => setLive(props.value));
  const fill = () => `${((live() - props.min) / (props.max - props.min)) * 100}%`;
  const read = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

  return (
    <div class={styles.slider} data-disabled={props.disabled ? "" : undefined}>
      <input
        class={styles.input}
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={live()}
        disabled={props.disabled}
        aria-labelledby={props.labelledBy}
        aria-describedby={props.describedBy}
        aria-valuetext={props.valueText?.(live())}
        data-testid={props.testId}
        style={{ "--fill": fill() }}
        onInput={(e) => setLive(read(e))}
        onChange={(e) => {
          const next = read(e);
          if (next !== props.value) props.onChange(next);
        }}
      />
      <output class={`${styles.value} num`} aria-hidden="true">
        {props.format(live())}
      </output>
    </div>
  );
}
