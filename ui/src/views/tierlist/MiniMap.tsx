import { createEffect, createMemo, For, type JSX } from "solid-js";
import { Glyph } from "../../design/Glyph";
import { Icon } from "../../design/Icon";
import { t } from "../../i18n";
import { dotTone, mapDomain, tierBands, xOf, yOf } from "../../lib/meta-map";
import { entryKey, type RankedEntry } from "../../lib/stats";
import styles from "./MiniMap.module.css";

/**
 * Marks the champion lit (`data-lit` on its `data-key` element inside `root`): one effect for a
 * whole list, rather than a binding on each of its ~220 faces or dots.
 */
export function markLit(root: () => HTMLElement | undefined, lit: () => string | undefined): void {
  createEffect<string | undefined>((prev) => {
    const key = lit();
    const el = root();
    const find = (k: string) => el?.querySelector(`[data-key="${CSS.escape(k)}"]`);
    if (prev && prev !== key) find(prev)?.removeAttribute("data-lit");
    if (key) find(key)?.setAttribute("data-lit", "");
    return key;
  });
}

/**
 * A small live meta map next to the podium: the tier bands (their letters down the left edge) and
 * a dot per champion, lit with its face under the pointer. A click opens the full map; on narrow
 * pages it is just a button.
 */
export function MiniMap(props: {
  rows: RankedEntry[];
  lit: string | undefined;
  onLight: (key: string | undefined) => void;
  onOpen: () => void;
}): JSX.Element {
  const d = createMemo(() => mapDomain(props.rows));
  let plot: HTMLSpanElement | undefined;
  markLit(
    () => plot,
    () => props.lit,
  );
  // The dot under the pointer, found from the plot (no listener on each dot).
  const light = (event: Event) => props.onLight((event.target as HTMLElement).dataset.key);
  return (
    <button
      type="button"
      class={`${styles.mini} glass-rim`}
      onClick={() => props.onOpen()}
      aria-label={t().tierList.map.open}
      aria-haspopup="dialog"
      data-testid="open-map"
    >
      <span class={styles.head}>
        <Glyph name="map" size={16} class={styles.headIcon} />
        <span class={styles.headTitle}>{t().tierList.map.title}</span>
        <Icon name="chevronDown" size={14} class={styles.expand} />
      </span>
      <span
        class={styles.plot}
        ref={plot}
        aria-hidden="true"
        data-dim={props.lit ? "" : undefined}
        onPointerOver={light}
        onPointerLeave={() => props.onLight(undefined)}
      >
        <For each={tierBands(d())}>
          {(b) => (
            <span class={`${styles.band} ${styles[`band${b.tier}`]}`} style={{ top: `${b.top * 100}%`, height: `${b.height * 100}%` }}>
              <span class={styles.letter}>{b.tier}</span>
            </span>
          )}
        </For>
        <span class={styles.even} style={{ top: `${yOf(d(), 0) * 100}%` }} />
        <For each={props.rows}>
          {(e) => (
            <span
              class={styles.dot}
              data-key={entryKey(e)}
              style={{
                "--x": String(xOf(d(), e.pickRate)),
                top: `${yOf(d(), e.score) * 100}%`,
                "--dot": dotTone(e),
              }}
            />
          )}
        </For>
      </span>
    </button>
  );
}
