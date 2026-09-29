import { type JSX, Show, splitProps } from "solid-js";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./Icon";

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "good";

export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: "sm" | "md";
    icon?: IconName;
    /** A shortcut shown after the label. */
    kbd?: string;
    /** Icon only (the label goes to `aria-label`). */
    square?: boolean;
  },
): JSX.Element {
  const [own, rest] = splitProps(props, ["variant", "size", "icon", "kbd", "square", "class", "children"]);
  return (
    <button
      type="button"
      {...rest}
      class={`${styles.button} ${styles[own.variant ?? "secondary"]} ${own.size === "sm" ? styles.sm : ""} ${own.square ? styles.icon : ""} ${own.class ?? ""}`}
    >
      <Show when={own.icon}>{(name) => <Icon name={name()} size={own.size === "sm" ? 14 : 16} />}</Show>
      {own.children}
      <Show when={own.kbd}>
        <span class={styles.kbd}>{own.kbd}</span>
      </Show>
    </button>
  );
}
