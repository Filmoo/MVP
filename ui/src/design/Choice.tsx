import { createEffect, createUniqueId, For, type JSX, on, onCleanup, onMount } from "solid-js";
import styles from "./Choice.module.css";
import { liquid } from "./liquid/liquid";
import { reducedMotion } from "./motion";

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/**
 * One of a few options, side by side (a segmented control). Native radio buttons: arrow keys
 * move the choice, Tab enters and leaves the group. Label it with `labelledBy` (visible text).
 *
 * The chosen option sits under a thumb that springs over to the next one; with the Full visual
 * effects it is a lens of tinted glass that magnifies the label a little (design/liquid).
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
  let group: HTMLFieldSetElement | undefined;
  let thumb: HTMLSpanElement | undefined;
  let placed = false;

  /** Puts the thumb on the checked option (glides unless it's the first placement). */
  const place = () => {
    const label = group?.querySelector<HTMLElement>("input:checked + span");
    const option = label?.parentElement;
    if (!group || !thumb || !label || !option) return;
    // The option is positioned in the group; its label fills it.
    thumb.style.width = `${label.offsetWidth}px`;
    thumb.style.height = `${label.offsetHeight}px`;
    thumb.style.transform = `translate(${option.offsetLeft + label.offsetLeft}px, ${option.offsetTop + label.offsetTop}px)`;
    if (!placed || reducedMotion()) thumb.dataset.instant = "";
    else delete thumb.dataset.instant;
    placed = true;
    thumb.dataset.ready = "";
  };

  // The value can also change from outside (a save that failed flips it back).
  createEffect(
    on(
      () => props.value,
      () => queueMicrotask(place),
      { defer: true },
    ),
  );
  onMount(() => {
    place();
    // Options wrap on narrow cards and move with the layout: follow them, without gliding.
    const resizes = new ResizeObserver(() => {
      placed = false;
      place();
    });
    if (group) resizes.observe(group);
    onCleanup(() => resizes.disconnect());
  });

  return (
    <fieldset
      ref={group}
      class={styles.choice}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
      data-testid={props.testId}
    >
      <span
        class={`${styles.thumb} glass-rim`}
        aria-hidden="true"
        ref={(el) => {
          thumb = el;
          liquid(el, "lens");
        }}
      />
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
