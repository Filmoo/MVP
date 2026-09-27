import { createUniqueId, type JSX, Show } from "solid-js";
import styles from "./SettingRow.module.css";

export interface RowIds {
  /** Id of the visible title: pass it to the control as `labelledBy`. */
  label: string;
  /** Id of the description: pass it to the control as `describedBy`. */
  description: string;
}

/**
 * One setting: title and description on the left, its control on the right (under the text on
 * narrow cards). `nested` rows refine the row above them (e.g. a delay under its switch).
 */
export function SettingRow(props: {
  title: string;
  description?: string;
  nested?: boolean;
  /** Receives the ids that tie the control to this row's text. */
  children: (ids: RowIds) => JSX.Element;
}): JSX.Element {
  const ids: RowIds = { label: createUniqueId(), description: createUniqueId() };
  return (
    <div class={`${styles.row} ${props.nested ? styles.nested : ""}`}>
      <div class={styles.text}>
        <span class={styles.title} id={ids.label}>
          {props.title}
        </span>
        <Show when={props.description}>
          <p class={styles.description} id={ids.description}>
            {props.description}
          </p>
        </Show>
      </div>
      <div class={styles.control}>{props.children(ids)}</div>
    </div>
  );
}

/** Rows of one card, separated by hairlines. */
export function SettingList(props: { children: JSX.Element }): JSX.Element {
  return <div class={styles.list}>{props.children}</div>;
}
