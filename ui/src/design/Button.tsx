import type { JSX } from "solid-js";
import styles from "./Button.module.css";

export function Button(props: {
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
  children: JSX.Element;
  type?: "button" | "submit";
}): JSX.Element {
  return (
    <button
      type={props.type ?? "button"}
      class={`${styles.button} ${styles[props.variant ?? "secondary"]}`}
      onClick={() => props.onClick?.()}
    >
      {props.children}
    </button>
  );
}
