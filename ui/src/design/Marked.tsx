import type { JSX } from "solid-js";
import styles from "./Marked.module.css";

/** Where a search found its words in a text: [start, end) ranges, in order, apart. */
export type Marks = ReadonlyArray<readonly [number, number]>;

/** `text`, with the parts a search found marked (plain text while there's nothing to mark). */
export function Marked(props: { text: string; marks?: Marks | undefined }): JSX.Element {
  const parts = (): JSX.Element => {
    let at = 0;
    const out: JSX.Element[] = [];
    for (const [from, to] of props.marks ?? []) {
      const found = props.text.slice(from, to);
      out.push(props.text.slice(at, from), <mark class={styles.mark}>{found}</mark>);
      at = to;
    }
    return at ? [...out, props.text.slice(at)] : props.text;
  };
  return <>{parts()}</>;
}
