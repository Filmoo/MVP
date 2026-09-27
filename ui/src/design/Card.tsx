import { type JSX, Show } from "solid-js";
import styles from "./Card.module.css";

export function Card(props: {
  title?: string;
  actions?: JSX.Element;
  /** Body without side padding, for full-bleed lists. */
  flush?: boolean;
  /** When the card is given a height (live screens), the body scrolls under a fixed header. */
  scroll?: boolean;
  class?: string | undefined;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class={`${styles.card} ${props.class ?? ""}`}>
      <Show when={props.title || props.actions}>
        <header class={styles.header}>
          <h2 class={styles.title}>{props.title}</h2>
          {props.actions}
        </header>
      </Show>
      <div class={`${props.flush ? styles.flush : styles.body} ${props.scroll ? styles.scroll : ""}`}>{props.children}</div>
    </div>
  );
}
