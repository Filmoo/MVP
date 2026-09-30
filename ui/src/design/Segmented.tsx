import { For, type JSX, Show } from "solid-js";
import styles from "./Segmented.module.css";
import { segmentFor } from "./segmented-keys";

export interface SegmentedOption<T> {
  value: T;
  label: string;
  /**
   * A 16 px icon (`Icon`, `Glyph`, `RoleIcon`), made where it shows (options are read again on
   * every change): alone on narrow pages, the label its name.
   */
  icon?: () => JSX.Element;
  /** Quiet text after the label, e.g. a role's share of games. Part of the accessible name. */
  detail?: string;
}

/**
 * One choice among a few, as a radio group: one tab stop (the selected segment), arrow keys
 * move the selection, Home/End jump to the ends. Segments share the width equally and the
 * selection is a thumb that slides under them (a separate element, restyled freely).
 * Options with an icon show only it on narrow pages; their label stays their name.
 */
export function Segmented<T extends string | number>(props: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group ("Queue", "Role"…). */
  label: string;
  /** 24, 28 or 30 px segments (`lg`: a 40 px pill, like the stats pages' tools). */
  size?: "sm" | "md" | "lg";
  class?: string | undefined;
  testId?: string;
}): JSX.Element {
  const selected = () =>
    Math.max(
      0,
      props.options.findIndex((o) => o.value === props.value),
    );
  const buttons: HTMLButtonElement[] = [];
  const onKeyDown = (event: KeyboardEvent) => {
    const next = segmentFor(event.key, selected(), props.options.length);
    const option = next === undefined ? undefined : props.options[next];
    if (next === undefined || !option) return;
    event.preventDefault();
    buttons[next]?.focus();
    if (option.value !== props.value) props.onChange(option.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class={`${styles.group} ${styles[props.size ?? "md"]} ${props.class ?? ""}`}
      style={{ "--count": String(props.options.length), "--index": String(selected()) }}
      onKeyDown={onKeyDown}
      data-testid={props.testId}
    >
      <span class={`${styles.thumb} glass-drop`} aria-hidden="true" />
      <For each={props.options}>
        {(option, i) => {
          const checked = () => i() === selected();
          return (
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA radio group of buttons (roving tabindex): each segment one plain element, restyled freely
            <button
              ref={(el) => {
                buttons[i()] = el;
              }}
              type="button"
              role="radio"
              class={`${styles.segment} ${option.icon ? styles.withIcon : ""}`}
              aria-checked={checked()}
              aria-label={option.detail ? `${option.label} ${option.detail}` : option.label}
              data-hint={option.icon ? option.label : undefined}
              tabIndex={checked() ? 0 : -1}
              onClick={() => {
                if (!checked()) props.onChange(option.value);
              }}
            >
              <Show when={option.icon}>{(icon) => <span class={styles.icon}>{icon()()}</span>}</Show>
              <span class={styles.label}>{option.label}</span>
              <Show when={option.detail}>
                <span class={`${styles.detail} num`}>{option.detail}</span>
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
}
