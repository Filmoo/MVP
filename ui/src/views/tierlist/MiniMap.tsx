import { createMemo, For, type JSX } from "solid-js";
import type { TierGrade } from "../../data/generated/TierGrade";
import { Glyph } from "../../design/Glyph";
import { Icon } from "../../design/Icon";
import { t } from "../../i18n";
import { ROLE_TONE } from "../../lib/roles";
import { entryKey, type RankedEntry } from "../../lib/stats";
import styles from "./MiniMap.module.css";

// ——— The meta map's plane: strength (the score) up, popularity (pick rate, log) across ———

export interface MapDomain {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

export function mapDomain(rows: readonly RankedEntry[]): MapDomain {
  let low = -3;
  let high = 3;
  let few = 0.004;
  let many = 0.12;
  for (const e of rows) {
    low = Math.min(low, e.score);
    high = Math.max(high, e.score);
    if (e.pickRate > 0) {
      few = Math.min(few, e.pickRate);
      many = Math.max(many, e.pickRate);
    }
  }
  return { y0: low - 0.5, y1: high + 0.5, x0: Math.log(few * 0.9), x1: Math.log(many * 1.25) };
}

/** Across, 0 (rarely picked) to 1 (most picked). */
export const xOf = (d: MapDomain, pickRate: number): number => (Math.log(Math.max(pickRate, 1e-4)) - d.x0) / (d.x1 - d.x0);
/** Down, 0 (strongest, at the top) to 1. */
export const yOf = (d: MapDomain, score: number): number => 1 - (score - d.y0) / (d.y1 - d.y0);

/** Score cut-offs (crates/aggregate): each tier is a band of the strength axis. */
const CUTS: Record<TierGrade, [number, number]> = { S: [2, 99], A: [0.75, 2], B: [-0.75, 0.75], C: [-2, -0.75], D: [-99, -2] };

/** Each tier's band, top and height as shares of the plot (empty bands left out). */
export function tierBands(d: MapDomain): Array<{ tier: TierGrade; top: number; height: number }> {
  return (Object.keys(CUTS) as TierGrade[]).flatMap((tier) => {
    const [lo, hi] = CUTS[tier];
    const top = Math.max(0, yOf(d, Math.min(hi, d.y1)));
    const bottom = Math.min(1, yOf(d, Math.max(lo, d.y0)));
    return bottom > top ? [{ tier, top, height: bottom - top }] : [];
  });
}

/** A dot's colour: its tier's, or its lane's when every lane shows. */
export const dotTone = (e: RankedEntry, allRoles: boolean): string =>
  allRoles && e.role ? ROLE_TONE[e.role] : `var(--tier-${e.tier.toLowerCase()})`;

/**
 * A small live meta map next to the podium: the tier bands and a dot per champion, lit with its
 * face under the pointer. A click opens the full map; on narrow pages it is just a button.
 */
export function MiniMap(props: {
  rows: RankedEntry[];
  allRoles: boolean;
  lit: string | undefined;
  onLight: (key: string | undefined) => void;
  onOpen: () => void;
}): JSX.Element {
  const d = createMemo(() => mapDomain(props.rows));
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
      <span class={styles.plot} aria-hidden="true" data-dim={props.lit ? "" : undefined}>
        <For each={tierBands(d())}>
          {(b) => (
            <span class={`${styles.band} ${styles[`band${b.tier}`]}`} style={{ top: `${b.top * 100}%`, height: `${b.height * 100}%` }} />
          )}
        </For>
        <span class={styles.even} style={{ top: `${yOf(d(), 0) * 100}%` }} />
        <For each={props.rows}>
          {(e) => (
            <span
              class={styles.dot}
              data-lit={props.lit === entryKey(e) ? "" : undefined}
              style={{
                left: `${xOf(d(), e.pickRate) * 100}%`,
                top: `${yOf(d(), e.score) * 100}%`,
                "--dot": dotTone(e, props.allRoles),
              }}
              onPointerEnter={() => props.onLight(entryKey(e))}
              onPointerLeave={() => props.onLight(undefined)}
            />
          )}
        </For>
      </span>
    </button>
  );
}
