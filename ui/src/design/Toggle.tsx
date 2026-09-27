import type { JSX } from "solid-js";
import styles from "./Toggle.module.css";

/**
 * On/off switch. A real button with `role="switch"`: Space/Enter flip it, screen readers
 * announce its state. Label it with `labelledBy` (visible text) or `label`.
 */
export function Toggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      class={styles.toggle}
      aria-checked={props.checked}
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
      data-testid={props.testId}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class={styles.thumb} />
    </button>
  );
}
