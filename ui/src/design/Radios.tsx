import { For, type JSX } from "solid-js";
import { segmentFor } from "./segmented-keys";

/**
 * A radio group of buttons with roving focus (one tab stop, arrows, Home/End), drawn by its caller:
 * the stats pages' queue tabs, rank menu, lanes and views. `Segmented` is the same pattern with a
 * look of its own.
 */
export function Radios<T extends string | number>(props: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
  /** An option clicked, or pressed with Enter or Space, chosen already or not (arrows only choose). */
  onPick?: (value: T) => void;
  class: string | undefined;
  optionClass: (value: T) => string | undefined;
  optionLabel?: (value: T) => string;
  /** An option's tooltip (design/tip): an icon-only option names itself. */
  optionHint?: (value: T) => string;
  children: (value: T, checked: boolean) => JSX.Element;
  style?: JSX.CSSProperties;
  testId?: string;
  before?: JSX.Element;
}): JSX.Element {
  const buttons: HTMLButtonElement[] = [];
  const selected = () => Math.max(0, props.values.indexOf(props.value));
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class={props.class}
      style={props.style}
      data-testid={props.testId}
      onKeyDown={(event) => {
        const next = segmentFor(event.key, selected(), props.values.length);
        const value = next === undefined ? undefined : props.values[next];
        if (next === undefined || value === undefined) return;
        event.preventDefault();
        buttons[next]?.focus();
        if (value !== props.value) props.onChange(value);
      }}
    >
      {props.before}
      <For each={props.values}>
        {(value, i) => {
          const checked = () => value === props.value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA radio group of buttons (roving tabindex), like Segmented
            <button
              ref={(el) => {
                buttons[i()] = el;
              }}
              type="button"
              role="radio"
              class={props.optionClass(value)}
              aria-checked={checked()}
              aria-label={props.optionLabel?.(value)}
              data-hint={props.optionHint?.(value)}
              tabIndex={checked() ? 0 : -1}
              onClick={() => {
                if (!checked()) props.onChange(value);
                props.onPick?.(value);
              }}
            >
              {props.children(value, checked())}
            </button>
          );
        }}
      </For>
    </div>
  );
}
