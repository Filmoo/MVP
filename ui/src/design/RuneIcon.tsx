import { createSignal, type JSX, Show } from "solid-js";
import { useData } from "../data/context";
import { t } from "../i18n";
import { type ShardGlyph, type ShardRow, shard } from "../lib/runes";
import styles from "./RuneIcon.module.css";

type Size = 16 | 20 | 24 | 28 | 32 | 36 | 40 | 44 | 48;

/**
 * A rune or a tree, what it is on hover (design/tip: `tip`), and on keyboard focus unless it is
 * decorative.
 */
function Picture(props: {
  src: string | undefined;
  name: string;
  tip: string;
  size: Size;
  /** Not chosen: shown for context, silent for screen readers (its tooltip still shows on hover). */
  decorative: boolean;
  class: string;
}): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  const box = () => ({ width: `${props.size}px`, height: `${props.size}px` });
  const tabIndex = () => (props.decorative ? undefined : 0);
  return (
    <Show
      when={props.src && !failed()}
      fallback={
        <span
          class={`${props.class} ${styles.fallback}`}
          style={box()}
          role="img"
          aria-label={props.name}
          aria-hidden={props.decorative ? "true" : undefined}
          data-tip={props.tip}
          tabIndex={tabIndex()}
          data-free-style
        >
          {props.size >= 28 ? props.name.slice(0, 2) : ""}
        </span>
      }
    >
      <img
        class={props.class}
        src={props.src}
        alt={props.decorative ? "" : props.name}
        data-tip={props.tip}
        tabIndex={tabIndex()}
        width={props.size}
        height={props.size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
    </Show>
  );
}

/** A rune (keystone or minor) from game data, what it does in a tooltip. */
export function RuneIcon(props: { runeId: number; size: Size; decorative?: boolean; class?: string | undefined }): JSX.Element {
  const { gameData } = useData();
  const entry = () => gameData()?.runes.get(props.runeId);
  return (
    <Picture
      src={entry() ? `${gameData()?.artBase}/img/${entry()?.rune.icon}` : undefined}
      name={entry()?.rune.name ?? t().common.runeN(props.runeId)}
      tip={`rune:${props.runeId}`}
      size={props.size}
      decorative={props.decorative ?? false}
      class={`${styles.rune} ${props.class ?? ""}`}
    />
  );
}

/** A rune tree's emblem (Precision, Domination…). */
export function RuneStyleIcon(props: { styleId: number; size: Size; decorative?: boolean; class?: string | undefined }): JSX.Element {
  const { gameData } = useData();
  const style = () => gameData()?.runeStyles.get(props.styleId);
  return (
    <Picture
      src={style() ? `${gameData()?.artBase}/img/${style()?.icon}` : undefined}
      name={style()?.name ?? t().common.runeTreeN(props.styleId)}
      tip={`tree:${props.styleId}`}
      size={props.size}
      decorative={props.decorative ?? false}
      class={`${styles.style} ${props.class ?? ""}`}
    />
  );
}

const GLYPHS: Record<ShardGlyph, string> = {
  adaptive: "M12 4 19 12 12 20 5 12zM12 9l3 3-3 3-3-3z",
  attackSpeed: "M6 7l5 5-5 5M13 7l5 5-5 5",
  haste: "M7 4h10M7 20h10M8 4c0 4 4 5 4 8s-4 4-4 8M16 4c0 4-4 5-4 8s4 4 4 8",
  moveSpeed: "M3 8h7M2 12h8M3 16h7M12 6l6 6-6 6",
  health: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  healthScaling: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10zM12 15v-5M10 12l2-2 2 2",
  tenacity: "M12 3 5 6v5c0 4.4 3 8.2 7 10 4-1.8 7-5.6 7-10V6zM13 8l-3 5h4l-3 5",
  armor: "M12 3 5 6v5c0 4.4 3 8.2 7 10 4-1.8 7-5.6 7-10V6z",
  magicResist: "M12 3 5 6v5c0 4.4 3 8.2 7 10 4-1.8 7-5.6 7-10V6zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
};

/**
 * A stat shard as a round glyph in its stat's color (Data Dragon has no shard art); what it gives
 * in a tooltip (with its `row` of the page), on keyboard focus too when it is the chosen one.
 */
export function ShardIcon(props: {
  shardId: number;
  size: 20 | 24 | 28;
  chosen?: boolean;
  row?: ShardRow;
  class?: string | undefined;
}): JSX.Element {
  const s = () => shard(props.shardId);
  return (
    <span
      class={`${styles.shard} ${styles[s().glyph]} ${props.chosen ? styles.chosen : ""} ${props.class ?? ""}`}
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      role="img"
      aria-label={`${s().name} (${s().stat})`}
      aria-hidden={props.chosen ? undefined : "true"}
      data-tip={`shard:${props.shardId}${props.row ? `:${props.row}` : ""}`}
      tabIndex={props.chosen ? 0 : undefined}
    >
      <svg
        width={Math.round(props.size * 0.62)}
        height={Math.round(props.size * 0.62)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={GLYPHS[s().glyph]} />
      </svg>
    </span>
  );
}
