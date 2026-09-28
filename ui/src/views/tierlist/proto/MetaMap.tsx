import { createMemo, createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { useData } from "../../../data/context";
import type { TierGrade } from "../../../data/generated/TierGrade";
import { useAmbient } from "../../../design/ambient";
import { ChampionIcon, championIconUrl } from "../../../design/GameIcon";
import { Glyph } from "../../../design/Glyph";
import { Icon } from "../../../design/Icon";
import { RoleRail } from "../../../design/RoleRail";
import { Skeleton } from "../../../design/States";
import { TierMark } from "../../../design/TierMark";
import { t } from "../../../i18n";
import { percent } from "../../../lib/format";
import { ROLE_ICON, ROLE_TONE, roleLabel } from "../../../lib/roles";
import type { RankedEntry } from "../../../lib/stats";
import { ARAM, filters, setFilter } from "../../../lib/stats-filters";
import { Widget } from "../../../widgets/Widget";
import page from "../../page.module.css";
import { StatsProblem } from "../../stats/common";
import styles from "./MetaMap.module.css";
import { DataLine, NoneRanked, roleRailOptions, ScopeButton, TIERS, TierTitle, useTierData, wrSide } from "./shared";

/**
 * Direction C — Meta map. The tier list as a chart: strength up (the score, so each tier is a
 * band of its own colour), popularity across (pick rate, log scale). Every champion is its face on
 * the map: the meta's staples top right, the hidden picks top left, the traps bottom right. A
 * ranked list under it keeps names one glance away; the two light up together.
 */
export function MetaMap(): JSX.Element {
  const data = useTierData();
  const { gameData } = useData();
  useAmbient(() => championIconUrl(gameData(), data.ranked()[0]?.id));
  const [lit, setLit] = createSignal<number>();

  return (
    <div class={page.page}>
      <header class={styles.head}>
        <div class={styles.titles}>
          <TierTitle role={data.role()} aram={data.queue() === ARAM} />
          <Show when={data.list.data()}>{(l) => <DataLine info={l().info} index={data.index()} />}</Show>
        </div>
        <ScopeButton />
      </header>
      <div class={styles.body}>
        <Show when={data.queue() !== ARAM}>
          <RoleRail
            class={styles.rail}
            label={t().stats.role}
            options={roleRailOptions(data.counts)}
            value={filters().role}
            onChange={(role) => setFilter({ role })}
            testId="role-filter"
          />
        </Show>
        <div class={styles.main}>
          <Switch>
            <Match when={data.list.error() !== undefined && !data.list.loading()}>
              <StatsProblem error={data.list.error()} onRetry={data.list.refetch} />
            </Match>
            <Match when={data.list.data() && data.ranked().length === 0}>
              <NoneRanked />
            </Match>
            <Match when={data.list.data()}>
              <Widget name="tier-list" class={data.list.loading() ? styles.busy : undefined}>
                <Chart rows={data.ranked()} dots={data.role() === "all" && data.queue() !== ARAM} lit={lit()} onLight={setLit} />
                <Standings rows={data.ranked().slice(0, 50)} lit={lit()} onLight={setLit} />
              </Widget>
            </Match>
            <Match when={true}>
              <Skeleton height="440px" />
            </Match>
          </Switch>
        </div>
      </div>
      <Show when={data.list.data() && data.ranked().length > 0}>
        <p class={styles.note}>{t().tierList.note}</p>
      </Show>
    </div>
  );
}

/** Score cut-offs (crates/aggregate): a tier is a band of the strength axis. */
const CUTS: Record<TierGrade, [number, number]> = { S: [2, 99], A: [0.75, 2], B: [-0.75, 0.75], C: [-2, -0.75], D: [-99, -2] };
const TICKS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2];

interface Placed {
  e: RankedEntry;
  x: number;
  y: number;
}

/** The map: zones, axes, faces. Positions in pixels of the plot, nudged apart where they'd overlap. */
function Chart(props: {
  rows: RankedEntry[];
  dots: boolean;
  lit: number | undefined;
  onLight: (rank: number | undefined) => void;
}): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  let plot: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  onMount(() => {
    if (!plot) return;
    const observe = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observe.observe(plot);
    onCleanup(() => observe.disconnect());
  });
  const domain = createMemo(() => {
    const scores = props.rows.map((e) => e.score);
    const picks = props.rows.map((e) => e.pickRate).filter((p) => p > 0);
    return {
      y0: Math.min(-3, ...scores) - 0.5,
      y1: Math.max(3, ...scores) + 0.5,
      x0: Math.log(Math.min(0.004, ...picks) * 0.9),
      x1: Math.log(Math.max(0.12, ...picks) * 1.25),
    };
  });
  const xOf = (pick: number) => ((Math.log(Math.max(pick, 1e-4)) - domain().x0) / (domain().x1 - domain().x0)) * size().w;
  const yOf = (score: number) => (1 - (score - domain().y0) / (domain().y1 - domain().y0)) * size().h;
  const radius = () => (props.dots ? 6 : size().w < 480 ? 11 : 14);
  const placed = createMemo<Placed[]>(() => {
    const { w, h } = size();
    if (w === 0) return [];
    const r = radius();
    const points = props.rows.map((e) => ({ e, x: xOf(e.pickRate), y: yOf(e.score) }));
    if (props.dots) return points;
    // A few rounds of pushing overlapping faces apart (a face stays near its true spot).
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
          const d = Math.hypot(dx, dy);
          if (d >= gap) continue;
          const push = (gap - d) / 2;
          const ux = d > 0.01 ? dx / d : 1;
          const uy = d > 0.01 ? dy / d : 0;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
          moved = true;
        }
      }
      for (const p of points) {
        p.x = Math.min(Math.max(p.x, r), w - r);
        p.y = Math.min(Math.max(p.y, r), h - r);
      }
      if (!moved) break;
    }
    return points;
  });
  const zone = (tier: TierGrade) => {
    const [lo, hi] = CUTS[tier];
    const top = Math.max(0, yOf(Math.min(hi, domain().y1)));
    const bottom = Math.min(size().h, yOf(Math.max(lo, domain().y0)));
    return { top, height: Math.max(0, bottom - top) };
  };
  const words = () => t().tierList.proto.map;

  return (
    <figure class={`${styles.chart} glass-rim`} aria-label={words().title}>
      <div class={styles.axisY} aria-hidden="true">
        <Glyph name="winRate" size={14} />
        {words().strength}
      </div>
      <div class={styles.frame}>
        <div class={styles.plot} ref={plot} style={{ "--d": `${radius() * 2}px` }}>
          {/* Tier zones, each in its colour, its medallion at the left edge. */}
          <For each={TIERS}>
            {(tier) => (
              <Show when={zone(tier).height > 0}>
                <div
                  class={`${styles.zone} ${styles[`zone${tier}`]}`}
                  style={{ top: `${zone(tier).top}px`, height: `${zone(tier).height}px` }}
                  aria-hidden="true"
                >
                  <Show when={zone(tier).height >= 28}>
                    <TierMark grade={tier} size={20} decorative class={styles.zoneMark} />
                  </Show>
                </div>
              </Show>
            )}
          </For>
          <div class={styles.even} style={{ top: `${yOf(0)}px` }} aria-hidden="true">
            <span>{words().even}</span>
          </div>
          <For each={TICKS}>
            {(tick) => (
              <Show when={xOf(tick) > 0 && xOf(tick) < size().w}>
                <div class={styles.gridX} style={{ left: `${xOf(tick)}px` }} aria-hidden="true" />
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
                class={`${styles.point} ${props.dots ? styles.dot : ""}`}
                classList={{ [styles.lit ?? ""]: props.lit === p.e.rank }}
                href={`#/champions?id=${p.e.id}${p.e.role ? `&role=${p.e.role}` : ""}`}
                style={{
                  left: `${p.x}px`,
                  top: `${p.y}px`,
                  "--ring": `var(--tier-${p.e.tier.toLowerCase()})`,
                  ...(props.dots && p.e.role ? { "--dot": ROLE_TONE[p.e.role] } : {}),
                }}
                aria-label={t().tierList.proto.pointLabel(name(p.e.id), percent(p.e.winRate, 1), percent(p.e.pickRate, 1))}
                onPointerEnter={() => props.onLight(p.e.rank)}
                onPointerLeave={() => props.onLight(undefined)}
                onFocus={() => props.onLight(p.e.rank)}
                onBlur={() => props.onLight(undefined)}
              >
                <span class={styles.face}>
                  <Show when={!props.dots}>
                    <ChampionIcon championId={p.e.id} size={28} round />
                  </Show>
                </span>
                <span class={styles.tag}>
                  <span class={styles.tagName}>{name(p.e.id)}</span>
                  <span class={`${styles.tagWr} num`} data-wr={wrSide(p.e.winRate)}>
                    {percent(p.e.winRate, 1)}
                  </span>
                </span>
              </a>
            )}
          </For>
        </div>
        <div class={`${styles.axisX} num`} aria-hidden="true">
          <For each={TICKS}>
            {(tick) => (
              <Show when={xOf(tick) > 0 && xOf(tick) < size().w}>
                <span style={{ left: `${xOf(tick)}px` }}>{percent(tick, tick < 0.01 ? 1 : 0)}</span>
              </Show>
            )}
          </For>
          <span class={styles.axisXName}>
            <Glyph name="pick" size={14} />
            {words().popularity}
          </span>
        </div>
      </div>
      <Show when={props.dots}>
        <figcaption class={styles.legend}>
          <For each={["top", "jungle", "middle", "bottom", "support"] as const}>
            {(role) => (
              <span class={styles.legendItem} style={{ "--dot": ROLE_TONE[role] }}>
                <Icon name={ROLE_ICON[role]} size={14} />
                {roleLabel(role)}
              </span>
            )}
          </For>
        </figcaption>
      </Show>
    </figure>
  );
}

/** The ranked list under the map, in two columns when there is room. */
function Standings(props: { rows: RankedEntry[]; lit: number | undefined; onLight: (rank: number | undefined) => void }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  return (
    <ol class={`${styles.standings} glass-rim`} aria-label={t().tierList.title}>
      <For each={props.rows}>
        {(e) => (
          <li>
            <a
              class={styles.standing}
              classList={{ [styles.lit ?? ""]: props.lit === e.rank }}
              href={`#/champions?id=${e.id}${e.role ? `&role=${e.role}` : ""}`}
              data-testid="tier-row"
              data-champion={e.id}
              onPointerEnter={() => props.onLight(e.rank)}
              onPointerLeave={() => props.onLight(undefined)}
            >
              <span class={`${styles.standingRank} num`}>{e.rank}</span>
              <ChampionIcon championId={e.id} size={24} />
              <span class={styles.standingName}>{name(e.id)}</span>
              <TierMark grade={e.tier} size={18} />
              <span class={`${styles.standingWr} num`} data-wr={wrSide(e.winRate)}>
                {percent(e.winRate, 1)}
              </span>
              <span class={`${styles.standingPick} num`}>{percent(e.pickRate, 1)}</span>
            </a>
          </li>
        )}
      </For>
    </ol>
  );
}
