import { createUniqueId, type JSX, Show } from "solid-js";
import { Icon } from "./Icon";
import { Marked, type Marks } from "./Marked";
import styles from "./SettingRow.module.css";

export interface RowIds {
  /** Id of the visible title: pass it to the control as `labelledBy`. */
  label: string;
  /** Ids of the description (and the note, while there is one): pass them as `describedBy`. */
  description: string;
}

/** What a search found in a row: `undefined` while there's no search, `null` hides the row. */
export type RowMatch = { title: Marks; text: Marks } | null | undefined;

/**
 * One setting: title and description on the left, its control on the right (under the text on
 * narrow cards). `nested` rows refine the row above them (e.g. a delay under its switch). A
 * `note` says why the setting does less than chosen right now; the control is described by it.
 * `match`: what the page's search found in it (hidden when it found nothing there).
 */
export function SettingRow(props: {
  title: string;
  description?: string;
  note?: JSX.Element;
  nested?: boolean;
  match?: RowMatch;
  /** Receives the ids that tie the control to this row's text. */
  children: (ids: RowIds) => JSX.Element;
}): JSX.Element {
  const label = createUniqueId();
  const description = createUniqueId();
  const note = createUniqueId();
  const ids: RowIds = {
    label,
    get description() {
      return props.note ? `${description} ${note}` : description;
    },
  };
  return (
    <div class={`${styles.row} ${props.nested ? styles.nested : ""}`} hidden={props.match === null}>
      <div class={styles.text}>
        <span class={styles.title} id={label}>
          <Marked text={props.title} marks={props.match?.title} />
        </span>
        <Show when={props.description}>
          <p class={styles.description} id={description}>
            <Marked text={props.description ?? ""} marks={props.match?.text} />
          </p>
        </Show>
        <Show when={props.note}>
          <p class={styles.note} id={note}>
            <Icon name="info" size={14} class={styles.noteIcon} />
            <span>{props.note}</span>
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
