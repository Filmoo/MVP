import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { Role } from "../../data/generated/Role";
import { useTone } from "../../design/ambient";
import { ChampionArt, ChampionIcon, championIconUrl } from "../../design/GameIcon";
import { Glyph } from "../../design/Glyph";
import { liquid } from "../../design/liquid/liquid";
import { RoleIcon } from "../../design/RoleIcon";
import { EmptyState } from "../../design/States";
import { TierMark } from "../../design/TierMark";
import { t } from "../../i18n";
import { percent, signedPoints } from "../../lib/format";
import { createProgressive } from "../../lib/progressive";
import { roleLabel } from "../../lib/roles";
import { entryKey, groupByTier, type RankedEntry, type Trend, wrSide } from "../../lib/stats";
import { MiniMap, markLit } from "./MiniMap";
import styles from "./Shelves.module.css";

/** Faces built with the view; the rest follow while the page is idle ("all roles": ~220). */
const FIRST_FACES = 60;

export const championLink = (e: RankedEntry): string => `#/champions?id=${e.id}${e.role ? `&role=${e.role}` : ""}`;

export interface ShelvesProps {
  /** The lane's rows, ranked; `shown` the ones matching the filter (all without one). */
  rows: RankedEntry[];
  shown: RankedEntry[];
  filtering: boolean;
  allRoles: boolean;
  trends: Map<string, Trend> | undefined;
  /** The champion under the pointer here or on the map (`entryKey`). */
  lit: string | undefined;
  onLight: (key: string | undefined) => void;
  onOpenMap: () => void;
}

/**
 * The tier list as shelves: the podium and a small meta map, then each tier a shelf of glass in
 * its colour (its medallion, size and average win rate) with its champions as faces, strongest
 * first. A glass card with a face's numbers glides from face to face with the pointer.
 */
export function Shelves(props: ShelvesProps): JSX.Element {
  return (
    <div class={styles.view}>
      <Show when={!props.filtering && props.rows.length > 0}>
        <div class={styles.top}>
          <Podium rows={props.rows.slice(0, 3)} allRoles={props.allRoles} onLight={props.onLight} />
          <MiniMap rows={props.rows} lit={props.lit} onLight={props.onLight} onOpen={props.onOpenMap} />
        </div>
      </Show>
      <Show
        when={props.shown.length > 0}
        fallback={<EmptyState icon="search" title={t().tierList.noMatch} text={t().champions.checkSpelling} />}
      >
        <Board {...props} />
      </Show>
    </div>
  );
}

const MEDAL = ["var(--rank-gold)", "var(--rank-silver)", "var(--rank-bronze)"];

function RoleLine(props: { role: Role }): JSX.Element {
  return (
    <span class={styles.roleLine}>
      <RoleIcon role={props.role} size={14} />
      {roleLabel(props.role)}
    </span>
  );
}

/** The first three, a step each (the first higher), with their art. */
function Podium(props: { rows: RankedEntry[]; allRoles: boolean; onLight: (key: string | undefined) => void }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  return (
    <ol class={styles.podium} aria-label={t().tierList.podium}>
      <For each={props.rows}>
        {(e, i) => (
          <li class={styles.step} style={{ "--medal": MEDAL[i()] ?? "var(--text-3)" }}>
            <a
              class={`${styles.stepCard} glass-rim`}
              href={championLink(e)}
              data-testid="podium-step"
              onPointerEnter={() => props.onLight(entryKey(e))}
              onPointerLeave={() => props.onLight(undefined)}
            >
              <div class={styles.stepArt} aria-hidden="true" ref={(el) => useTone(el, () => championIconUrl(gameData(), e.id))}>
                {/* Without its art (offline, not loaded yet), the champion's face. */}
                <ChampionArt
                  championId={e.id}
                  class={styles.stepSplash}
                  fallback={
                    <span class={styles.stepFace}>
                      <ChampionIcon championId={e.id} size={56} />
                    </span>
                  }
                />
              </div>
              <div class={styles.stepText}>
                <div class={styles.stepHead}>
                  <span class={`${styles.medal} num`}>
                    <Show when={i() === 0}>
                      <Glyph name="crown" size={16} />
                    </Show>
                    {e.rank}
                  </span>
                  <span class={styles.stepName}>{name(e.id)}</span>
                  <Show when={props.allRoles && e.role}>{(role) => <RoleLine role={role()} />}</Show>
                </div>
                <div class={`${styles.stepStats} num`}>
                  <span class={styles.stepWr} data-wr={wrSide(e.winRate)}>
                    {percent(e.winRate, 1)}
                  </span>
                  <TierMark grade={e.tier} size="sm" />
                  <span class={styles.stepFacts}>
                    <span data-hint-title={t().tierList.columns.pick} data-hint={t().tierList.titles.pick}>
                      <Glyph name="pick" size={14} />
                      {percent(e.pickRate, 1)}
                    </span>
                    <Show when={e.banRate > 0}>
                      <span data-hint-title={t().tierList.columns.ban} data-hint={t().tierList.titles.ban}>
                        <Glyph name="ban" size={14} />
                        {percent(e.banRate, 1)}
                      </span>
                    </Show>
                  </span>
                </div>
              </div>
            </a>
          </li>
        )}
      </For>
    </ol>
  );
}

function Board(props: ShelvesProps): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  // Built a slice at a time; each shelf shows its part of what is built so far.
  const { shown, complete } = createProgressive(() => props.shown, FIRST_FACES);
  const groups = createMemo(() => groupByTier([...shown()]));
  // A tier's size and average win rate count all of its rows, built or not.
  const facts = createMemo(() => {
    const sums = new Map<string, { n: number; wr: number }>();
    for (const e of props.shown) {
      const s = sums.get(e.tier) ?? { n: 0, wr: 0 };
      sums.set(e.tier, { n: s.n + 1, wr: s.wr + e.winRate });
    }
    return sums;
  });
  const byKey = createMemo(() => new Map(props.shown.map((e) => [entryKey(e), e] as const)));
  const [peek, setPeek] = createSignal<RankedEntry>();
  let board: HTMLDivElement | undefined;
  let card: HTMLDivElement | undefined;

  /** The card over a face: above it, or under it near the top; kept inside the board. */
  const show = (tile: HTMLElement) => {
    const entry = byKey().get(tile.dataset.key ?? "");
    if (!entry || !board || !card) return;
    setPeek(entry);
    const b = board.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const x = Math.min(Math.max(r.left + r.width / 2 - w / 2 - b.left, 0), b.width - w);
    const above = r.top - b.top - h - 10;
    const y = above >= 0 ? above : r.bottom - b.top + 10;
    const to = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (card.dataset.shown === undefined) {
      // Appearing: in place at once, then it may glide.
      card.style.transition = "none";
      card.style.transform = to;
      void card.offsetWidth;
      card.style.transition = "";
      card.dataset.shown = "";
    } else {
      card.style.transform = to;
    }
  };
  const hide = () => {
    if (card) delete card.dataset.shown;
  };
  // The face under the pointer (or the focus), found from the board: its card, its dot on the map.
  const over = (event: Event) => {
    const tile = (event.target as Element).closest<HTMLElement>("[data-key]");
    if (tile) show(tile);
    props.onLight(tile?.dataset.key);
  };
  const leave = () => {
    hide();
    props.onLight(undefined);
  };
  markLit(
    () => board,
    () => props.lit,
  );

  return (
    <div
      class={styles.shelves}
      ref={board}
      onPointerOver={over}
      onFocusIn={over}
      onPointerLeave={leave}
      onFocusOut={(event) => {
        if (!board?.contains(event.relatedTarget as Node | null)) leave();
      }}
      aria-busy={complete() ? undefined : "true"}
    >
      <For each={groups()}>
        {(group) => {
          const size = () => facts().get(group.tier)?.n ?? group.entries.length;
          const average = () => (facts().get(group.tier)?.wr ?? 0) / Math.max(1, size());
          return (
            <section class={`${styles.shelf} ${styles[`tier${group.tier}`]} glass-rim`} aria-label={t().stats.tier(group.tier)}>
              <div class={styles.plate}>
                <TierMark grade={group.tier} size="lg" decorative tip class={styles.mark} />
                <div class={styles.plateText}>
                  <span class={`${styles.plateCount} num`}>{t().tierList.champions(size())}</span>
                  <span class={`${styles.plateAvg} num`} data-wr={wrSide(average())}>
                    {t().tierList.average(percent(average(), 1))}
                  </span>
                </div>
              </div>
              <ul class={styles.tiles}>
                <For each={group.entries}>
                  {(e) => (
                    <li>
                      <a
                        class={styles.tile}
                        href={championLink(e)}
                        data-key={entryKey(e)}
                        data-testid="tier-row"
                        data-champion={e.id}
                        data-role={e.role}
                        aria-label={t().tierList.tileLabel(name(e.id), e.role ? roleLabel(e.role) : undefined, percent(e.winRate, 1))}
                      >
                        <span class={styles.face}>
                          <ChampionIcon championId={e.id} size={48} />
                          <Show when={props.allRoles && e.role}>
                            {(role) => (
                              <span class={styles.roleBadge}>
                                <RoleIcon role={role()} size={14} />
                              </span>
                            )}
                          </Show>
                        </span>
                        {/* While filtering, each face says who it is. */}
                        <Show when={props.filtering}>
                          <span class={styles.name} aria-hidden="true">
                            {name(e.id)}
                          </span>
                        </Show>
                        <span class={`${styles.wr} num`} data-wr={wrSide(e.winRate)}>
                          {percent(e.winRate, 1)}
                        </span>
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          );
        }}
      </For>
      <div class={styles.peek} ref={card} aria-hidden="true">
        <div class={`${styles.peekGlass} glass-rim`} ref={(el) => liquid(el, "panel")} />
        <Show when={peek()}>{(e) => <PeekCard entry={e()} name={name(e().id)} trend={props.trends?.get(entryKey(e()))} />}</Show>
      </div>
    </div>
  );
}

/** A change since the previous patch: an arrow and the points, coloured for win rates. */
export function TrendMark(props: { points: number; tone: boolean }): JSX.Element {
  const side = () => (props.points >= 0.05 ? "up" : props.points <= -0.05 ? "down" : "flat");
  return (
    <span class={`${styles.trend} num`} data-trend={side()} data-tone={props.tone ? "" : undefined}>
      {signedPoints(props.points, 1)}
    </span>
  );
}

/** The numbers of the face under the pointer, and how they moved since the previous patch. */
function PeekCard(props: { entry: RankedEntry; name: string; trend: Trend | undefined }): JSX.Element {
  const e = () => props.entry;
  return (
    <div class={styles.peekBody}>
      <div class={styles.peekHead}>
        <ChampionIcon championId={e().id} size={40} />
        <div class={styles.peekNames}>
          <span class={styles.peekName}>{props.name}</span>
          <span class={styles.peekSub}>
            <Show when={e().role} fallback={t().tierList.rankN(e().rank)}>
              {(role) => (
                <>
                  <RoleIcon role={role()} size={14} />
                  {t().tierList.rankIn(e().rank, role())}
                </>
              )}
            </Show>
          </span>
        </div>
        {/* The card is a picture of the face's numbers (aria-hidden, never hovered): no tooltip. */}
        <TierMark grade={e().tier} size="md" decorative />
      </div>
      <dl class={`${styles.peekStats} num`}>
        <div>
          <dt>
            <Glyph name="winRate" size={14} />
            {t().tierList.columns.winRate}
          </dt>
          <dd data-wr={wrSide(e().winRate)}>{percent(e().winRate, 1)}</dd>
          <Show when={props.trend}>{(trend) => <TrendMark points={trend().winRate} tone />}</Show>
        </div>
        <div>
          <dt>
            <Glyph name="pick" size={14} />
            {t().tierList.columns.pick}
          </dt>
          <dd>{percent(e().pickRate, 1)}</dd>
          <Show when={props.trend}>{(trend) => <TrendMark points={trend().pickRate} tone={false} />}</Show>
        </div>
        <Show when={e().banRate > 0}>
          <div>
            <dt>
              <Glyph name="ban" size={14} />
              {t().tierList.columns.ban}
            </dt>
            <dd>{percent(e().banRate, 1)}</dd>
            <Show when={props.trend}>{(trend) => <TrendMark points={trend().banRate} tone={false} />}</Show>
          </div>
        </Show>
      </dl>
      <Show when={props.trend}>
        <span class={styles.peekSince}>{t().tierList.sincePrevious}</span>
      </Show>
      <span class={`${styles.peekGames} num`}>
        <Glyph name="games" size={14} />
        {t().common.games(e().g)}
      </span>
    </div>
  );
}
