import { createSignal, For, type JSX, Show } from "solid-js";
import { LineIcon } from "./Icon";
import { liquid } from "./liquid/liquid";
import styles from "./RoleRail.module.css";
import { segmentFor } from "./segmented-keys";

export interface RailOption<T> {
  value: T;
  label: string;
  /** The icon's path (`iconPath`, `glyphPath`): roles from one set, "all" from the other. */
  path: string;
  /** Colour of the icon when chosen: a token, e.g. `var(--role-top)`. */
  tone: string;
  /** Quiet number after the label (champions ranked there). Part of the accessible name. */
  detail?: string | undefined;
}

/**
 * A vertical radio group of icons (roles) that opens into labels. Closed, a slim column: the
 * choice sits on a drop of glass in its colour. Hovered (or reached with the keyboard) it opens
 * a glass panel beside the icons with each option's name and count; a soft highlight glides to
 * the row under the pointer. Nothing moves the layout: the panel floats over what is next to
 * the rail, and every motion is a transform or an opacity (reduced motion: instant).
 *
 * Keyboard: one tab stop (the choice), arrows move it, Home/End jump to the ends, like
 * `Segmented`. Touch: a tap chooses; there is no hover, so the panel stays closed.
 */
export function RoleRail<T extends string>(props: {
  options: readonly RailOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group ("Role"). */
  label: string;
  class?: string | undefined;
  testId?: string;
}): JSX.Element {
  const selected = () =>
    Math.max(
      0,
      props.options.findIndex((o) => o.value === props.value),
    );
  // The row under the pointer (or the keyboard's focus), for the gliding highlight.
  const [hover, setHover] = createSignal<number | undefined>();
  const buttons: HTMLButtonElement[] = [];
  const onKeyDown = (event: KeyboardEvent) => {
    const next = segmentFor(event.key, selected(), props.options.length);
    const option = next === undefined ? undefined : props.options[next];
    if (next === undefined || !option) return;
    event.preventDefault();
    buttons[next]?.focus();
    setHover(next);
    if (option.value !== props.value) props.onChange(option.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class={`${styles.rail} ${props.class ?? ""}`}
      style={{
        "--count": String(props.options.length),
        "--index": String(selected()),
        "--hover": String(hover() ?? selected()),
      }}
      data-hovering={hover() === undefined ? undefined : ""}
      onKeyDown={onKeyDown}
      onPointerLeave={() => setHover(undefined)}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(undefined);
      }}
      data-testid={props.testId}
    >
      {/* The open panel: its shadow here, its glass a layer inside (a lens can't carry a shadow). */}
      <div class={styles.panel} aria-hidden="true">
        <div class={`${styles.panelGlass} glass-rim`} ref={(el) => liquid(el, "panel")} />
      </div>
      <span class={styles.ghost} aria-hidden="true" />
      <span class={`${styles.lens} glass-rim`} aria-hidden="true" ref={(el) => liquid(el, "lens")} />
      <For each={props.options}>
        {(option, i) => {
          const checked = () => i() === selected();
          return (
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA radio group of buttons (roving tabindex), like Segmented
            <button
              ref={(el) => {
                buttons[i()] = el;
              }}
              type="button"
              role="radio"
              class={styles.option}
              style={{ "--tone": option.tone, "--i": String(i()) }}
              aria-checked={checked()}
              aria-label={option.detail ? `${option.label}, ${option.detail}` : option.label}
              tabIndex={checked() ? 0 : -1}
              onPointerEnter={() => setHover(i())}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) setHover(i());
              }}
              onClick={() => {
                if (!checked()) props.onChange(option.value);
              }}
            >
              <LineIcon d={option.path} size={20} class={styles.icon} />
              <span class={styles.label} aria-hidden="true">
                <span class={styles.name}>{option.label}</span>
                <Show when={option.detail}>
                  <span class={`${styles.detail} num`}>{option.detail}</span>
                </Show>
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
