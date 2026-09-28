import { createUniqueId, For, type JSX } from "solid-js";
import styles from "./Choice.module.css";

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/**
 * One of a few options, side by side (a segmented control). Native radio buttons: arrow keys
 * move the choice, Tab enters and leaves the group. Label it with `labelledBy` (visible text).
 */
export function Choice<T extends string>(props: {
  value: T;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (next: T) => void;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  testId?: string;
}): JSX.Element {
  const name = createUniqueId();
  return (
    <fieldset
      class={styles.choice}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
      data-testid={props.testId}
    >
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
