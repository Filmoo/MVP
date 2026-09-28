import { createUniqueId, For, type JSX } from "solid-js";
import { liquid } from "../../design/liquid/liquid";
import styles from "./Choice.module.css";

/**
 * A few mutually exclusive options in a row: native radio buttons (arrows move and pick, one
 * tab stop), shown as segments. The chosen one sits under a thumb that springs over; with the
 * Full visual effects it is a lens of clear glass that magnifies the label a little.
 */
export function Choice<T extends string>(props: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  labelledBy?: string;
  describedBy?: string;
  testId?: string;
}): JSX.Element {
  const name = createUniqueId();
  const index = () =>
    Math.max(
      0,
      props.options.findIndex((o) => o.value === props.value),
    );
  return (
    <fieldset
      class={styles.choice}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      data-testid={props.testId}
      style={{ "--count": props.options.length, "--at": index() }}
    >
      <span class={`${styles.thumb} glass-rim`} aria-hidden="true" ref={(el) => liquid(el, "lens")} />
      <For each={props.options}>
        {(option) => (
          <label class={styles.option}>
            <input
              class={styles.input}
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === props.value}
              onChange={() => props.onChange(option.value)}
            />
            <span class={styles.label}>{option.label}</span>
          </label>
        )}
      </For>
    </fieldset>
  );
}
