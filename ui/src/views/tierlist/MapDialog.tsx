import { createEffect, createMemo, createSignal, createUniqueId, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { useData } from "../../data/context";
import { ChampionIcon } from "../../design/GameIcon";
import { Glyph } from "../../design/Glyph";
import { Icon, iconPath, LineIcon } from "../../design/Icon";
import { TierMark } from "../../design/TierMark";
import { t } from "../../i18n";
import { percent } from "../../lib/format";
import { ROLE_ICON, roleLabel } from "../../lib/roles";
import { entryKey, type RankedEntry, wrSide } from "../../lib/stats";
import type { RoleFilter } from "../../lib/stats-filters";
import styles from "./MapDialog.module.css";
import { dotTone, mapDomain, tierBands, xOf, yOf } from "./MiniMap";
import { championLink } from "./Shelves";

const TICKS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2];
/** How much a face grows when pointed at (MapDialog.module.css): it stays inside the plot. */
const LIT_SCALE = 1.35;

interface Placed {
  e: RankedEntry;
  x: number;
  y: number;
}

/**
 * The meta map, full screen over the page (loaded when first opened): strength up, popularity
 * across, each tier a band, each champion its face (a dot in its tier's colour when every lane
 * shows). A modal dialog: the page behind is inert, Escape or the close button closes it, and the
 * focus goes back to what opened it.
 */
export default function MapDialog(props: {
  rows: RankedEntry[];
  role: RoleFilter;
  allRoles: boolean;
  lit: string | undefined;
  onLight: (key: string | undefined) => void;
  onClose: () => void;
}): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const heading = `map-${createUniqueId()}`;
  let dialog: HTMLDialogElement | undefined;
  let plot: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  onMount(() => {
    dialog?.showModal();
    if (!plot) return;
    const observe = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observe.observe(plot);
    onCleanup(() => observe.disconnect());
  });
  const d = createMemo(() => mapDomain(props.rows));
  const dots = () => props.allRoles;
  const radius = () => (dots() ? 6 : size().w < 520 ? 12 : 16);
  // Faces pushed apart where they'd overlap (each stays near its true spot); dots may touch.
  // Every point stays inside the plot, grown or not.
  const placed = createMemo<Placed[]>(() => {
    const { w, h } = size();
    if (w === 0) return [];
    const r = radius();
    const edge = Math.ceil(r * LIT_SCALE);
    const inside = (p: Placed) => {
      p.x = Math.min(Math.max(p.x, edge), w - edge);
      p.y = Math.min(Math.max(p.y, edge), h - edge);
    };
    const points = props.rows.map((e) => ({ e, x: xOf(d(), e.pickRate) * w, y: yOf(d(), e.score) * h }));
    if (dots()) {
      for (const p of points) inside(p);
      return points;
    }
    const gap = r * 2 + 2;
    for (let round = 0; round < 40; round++) {
      let moved = false;
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const a = points[i];
          const b = points[j];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= gap) continue;
          const push = (gap - dist) / 2;
          const ux = dist > 0.01 ? dx / dist : 1;
          const uy = dist > 0.01 ? dy / dist : 0;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
          moved = true;
        }
      }
      for (const p of points) inside(p);
      if (!moved) break;
    }
    return points;
  });
  // The name of the face pointed at: one tag over it (under it near the top), inside the plot.
  const litPoint = createMemo(() => placed().find((p) => entryKey(p.e) === props.lit));
  let tag: HTMLSpanElement | undefined;
  createEffect(() => {
    const p = litPoint();
    if (!p || !tag) return;
    const lift = radius() * LIT_SCALE + 8;
    const x = Math.min(Math.max(p.x - tag.offsetWidth / 2, 0), Math.max(0, size().w - tag.offsetWidth));
    const above = p.y - lift - tag.offsetHeight;
    tag.style.translate = `${Math.round(x)}px ${Math.round(above >= 0 ? above : p.y + lift)}px`;
  });
  const words = () => t().tierList.map;
  const role = () => (props.role === "all" ? t().stats.allRoles : roleLabel(props.role));

  return (
    <dialog ref={dialog} class={styles.dialog} aria-labelledby={heading} onClose={() => props.onClose()} data-testid="map-dialog">
      <header class={styles.head}>
        <h2 id={heading} class={styles.title}>
          <Glyph name="map" size={20} class={styles.titleIcon} />
          {words().title}
          <span class={styles.titleRole}>{role()}</span>
        </h2>
        <button type="button" class={styles.close} onClick={() => dialog?.close()} aria-label={words().close} data-hint={words().close}>
          <Icon name="close" size={20} />
        </button>
      </header>
      <div class={styles.chart}>
        <div class={styles.axisY} aria-hidden="true">
          <Glyph name="winRate" size={14} />
          {words().strength}
        </div>
        <div class={styles.frame}>
          <div class={styles.plot} ref={plot} style={{ "--d": `${radius() * 2}px` }}>
            <For each={tierBands(d())}>
              {(b) => (
                <div
                  class={`${styles.band} ${styles[`band${b.tier}`]}`}
                  style={{ top: `${b.top * 100}%`, height: `${b.height * 100}%` }}
                  aria-hidden="true"
                >
                  <Show when={b.height * size().h >= 30}>
                    <TierMark grade={b.tier} size="sm" decorative class={styles.bandMark} />
                  </Show>
                </div>
              )}
            </For>
            <div class={styles.even} style={{ top: `${yOf(d(), 0) * 100}%` }} aria-hidden="true">
              <span>{words().even}</span>
            </div>
            <For each={TICKS}>
              {(tick) => (
                <Show when={xOf(d(), tick) > 0 && xOf(d(), tick) < 1}>
                  <div class={styles.gridX} style={{ left: `${xOf(d(), tick) * 100}%` }} aria-hidden="true" />
                </Show>
              )}
            </For>
            <span class={`${styles.corner} ${styles.topLeft}`} aria-hidden="true">
              {words().hidden}
            </span>
            <span class={`${styles.corner} ${styles.topRight}`} aria-hidden="true">
              {words().meta}
            </span>
            <span class={`${styles.corner} ${styles.bottomRight}`} aria-hidden="true">
              {words().traps}
            </span>
            <For each={placed()}>
              {(p) => (
                <a
                  class={`${styles.point} ${dots() ? styles.dot : ""}`}
                  classList={{ [styles.lit ?? ""]: props.lit === entryKey(p.e) }}
                  href={championLink(p.e)}
                  style={{
                    left: `${p.x}px`,
                    top: `${p.y}px`,
                    "--ring": `var(--tier-${p.e.tier.toLowerCase()})`,
                    "--dot": dotTone(p.e),
                  }}
                  aria-label={words().pointLabel(name(p.e.id), percent(p.e.winRate, 1), percent(p.e.pickRate, 1))}
                  onPointerEnter={() => props.onLight(entryKey(p.e))}
                  onPointerLeave={() => props.onLight(undefined)}
                  onFocus={() => props.onLight(entryKey(p.e))}
                  onBlur={() => props.onLight(undefined)}
                  data-testid="map-point"
                >
                  <span class={styles.face}>
                    <Show when={!dots()}>
                      <ChampionIcon championId={p.e.id} size={32} round />
                    </Show>
                  </span>
                </a>
              )}
            </For>
            <span ref={tag} class={styles.tag} data-shown={litPoint() ? "" : undefined} aria-hidden="true">
              <Show when={litPoint()}>
                {(p) => (
                  <>
                    {/* Every lane shown: the lane is in the tag (colours are the tiers'). */}
                    <Show when={props.allRoles && p().e.role}>
                      {(lane) => <LineIcon d={iconPath(ROLE_ICON[lane()])} size={14} class={styles.tagLane} label={roleLabel(lane())} />}
                    </Show>
                    <span class={styles.tagName}>{name(p().e.id)}</span>
                    <span class={`${styles.tagWr} num`} data-wr={wrSide(p().e.winRate)}>
                      {percent(p().e.winRate, 1)}
                    </span>
                  </>
                )}
              </Show>
            </span>
          </div>
          <div class={`${styles.axisX} num`} aria-hidden="true">
            <For each={TICKS}>
              {(tick) => (
                <Show when={xOf(d(), tick) > 0 && xOf(d(), tick) < 1}>
                  <span style={{ left: `${xOf(d(), tick) * 100}%` }}>{percent(tick, tick < 0.01 ? 1 : 0)}</span>
                </Show>
              )}
            </For>
            <span class={styles.axisXName}>
              <Glyph name="pick" size={14} />
              {words().popularity}
            </span>
          </div>
        </div>
      </div>
    </dialog>
  );
}
