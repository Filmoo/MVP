import { createMemo, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../../data/context";
import { useAmbient, useTone } from "../../../design/ambient";
import { ChampionArt, ChampionIcon, championIconUrl } from "../../../design/GameIcon";
import { Glyph } from "../../../design/Glyph";
import { Icon } from "../../../design/Icon";
import { liquid } from "../../../design/liquid/liquid";
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
import styles from "./Shelves.module.css";
import {
  BracketGems,
  DataLine,
  groupByTier,
  NoneRanked,
  QueueTabs,
  roleRailOptions,
  type TierGroup,
  TierTitle,
  useTierData,
  wrSide,
  wrTone,
} from "./shared";

/**
 * Direction A — Shelves. Each tier is a shelf of glass: a plate in the tier's light (its
 * medallion, how many champions, their average win rate), then the champions as faces with their
 * win rate under them, strongest first. A role fits on one screen. Hovering (or focusing) a face
 * brings a small glass card with its numbers, which glides from face to face with the pointer.
 */
export function Shelves(): JSX.Element {
  const data = useTierData();
  const { gameData } = useData();
  const groups = createMemo(() => groupByTier(data.ranked()));
  // The page takes its light from the best champion shown.
  useAmbient(() => championIconUrl(gameData(), data.ranked()[0]?.id));

  return (
    <div class={page.page}>
      <header class={styles.head}>
        <TierTitle role={data.role()} aram={data.queue() === ARAM} />
        <Show when={data.list.data()}>{(l) => <DataLine info={l().info} index={data.index()} />}</Show>
      </header>
      <div class={styles.scope}>
        <QueueTabs />
        <BracketGems />
      </div>
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
                <Board groups={groups()} allRoles={data.role() === "all" && data.queue() !== ARAM} />
              </Widget>
            </Match>
            <Match when={true}>
              <div class={styles.shelves} aria-busy="true">
                <For each={[0, 1, 2]}>{() => <Skeleton height="132px" />}</For>
              </div>
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

function Board(props: { groups: TierGroup[]; allRoles: boolean }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const byRank = createMemo(() => new Map(props.groups.flatMap((g) => g.entries.map((e) => [e.rank, e] as const))));
  const [peek, setPeek] = createSignal<RankedEntry>();
  let board: HTMLDivElement | undefined;
  let card: HTMLDivElement | undefined;

  /** The card over a face: above it, or under it near the top; kept inside the board. */
  const show = (tile: HTMLElement) => {
    const entry = byRank().get(Number(tile.dataset.rank));
    if (!entry || !board || !card) return;
    setPeek(entry);
    const b = board.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const x = Math.min(Math.max(r.left + r.width / 2 - w / 2 - b.left, 8), b.width - w - 8);
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
  const over = (event: Event) => {
    const tile = (event.target as Element).closest<HTMLElement>("[data-rank]");
    if (tile) show(tile);
  };

  return (
    <div
      class={styles.shelves}
      ref={board}
      onPointerOver={over}
      onFocusIn={over}
      onPointerLeave={hide}
      onFocusOut={(event) => {
        if (!board?.contains(event.relatedTarget as Node | null)) hide();
      }}
    >
      <For each={props.groups}>{(group) => <Shelf group={group} allRoles={props.allRoles} name={name} />}</For>
      <div class={styles.peek} ref={card} aria-hidden="true">
        <div class={`${styles.peekGlass} glass-rim`} ref={(el) => liquid(el, "panel")} />
        <Show when={peek()}>{(e) => <PeekCard entry={e()} name={name(e().id)} />}</Show>
      </div>
    </div>
  );
}

function Shelf(props: { group: TierGroup; allRoles: boolean; name: (id: number) => string }): JSX.Element {
  const { gameData } = useData();
  const tier = () => props.group.tier;
  const lead = () => props.group.entries[0];
  return (
    <section class={`${styles.shelf} ${styles[`tier${tier()}`]} glass-rim`} aria-label={t().stats.tier(tier())}>
      {/* The champion of the patch, in the S shelf only: its colours (its icon, blurred: there even
          offline), then its art over them once Data Dragon has it. */}
      <Show when={tier() === "S" && lead()}>
        {(e) => (
          <div class={styles.lead} aria-hidden="true" ref={(el) => useTone(el, () => championIconUrl(gameData(), e().id))}>
            <ChampionArt championId={e().id} class={styles.art} />
          </div>
        )}
      </Show>
      <div class={styles.plate}>
        <TierMark grade={tier()} size={40} decorative class={styles.mark} />
        <div class={styles.plateText}>
          <span class={`${styles.plateCount} num`}>{t().tierList.proto.champions(props.group.entries.length)}</span>
          <span class={`${styles.plateAvg} num ${wrTone(props.group.winRate)}`}>
            {t().tierList.proto.average(percent(props.group.winRate, 1))}
          </span>
        </div>
      </div>
      <ul class={styles.tiles}>
        <For each={props.group.entries}>
          {(e) => (
            <li>
              <a
                class={styles.tile}
                href={`#/champions?id=${e.id}${e.role ? `&role=${e.role}` : ""}`}
                data-rank={e.rank}
                data-testid="tier-row"
                data-champion={e.id}
                aria-label={t().tierList.proto.tileLabel(props.name(e.id), e.role ? roleLabel(e.role) : undefined, percent(e.winRate, 1))}
              >
                <span class={styles.face}>
                  <ChampionIcon championId={e.id} size={48} />
                  <Show when={props.allRoles && e.role}>
                    {(role) => (
                      <span class={styles.roleBadge} style={{ "--tone": ROLE_TONE[role()] }}>
                        <Icon name={ROLE_ICON[role()]} size={14} />
                      </span>
                    )}
                  </Show>
                </span>
                <span class={`${styles.wr} num ${wrTone(e.winRate)}`}>{percent(e.winRate, 1)}</span>
              </a>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

/** The numbers of the face under the pointer. */
function PeekCard(props: { entry: RankedEntry; name: string }): JSX.Element {
  const e = () => props.entry;
  return (
    <div class={styles.peekBody}>
      <div class={styles.peekHead}>
        <ChampionIcon championId={e().id} size={40} />
        <div class={styles.peekNames}>
          <span class={styles.peekName}>{props.name}</span>
          <span class={styles.peekSub}>
            <Show when={e().role} fallback={t().tierList.proto.rankN(e().rank)}>
              {(role) => (
                <>
                  <Icon name={ROLE_ICON[role()]} size={14} />
                  {t().tierList.proto.rankIn(e().rank, role())}
                </>
              )}
            </Show>
          </span>
        </div>
        <TierMark grade={e().tier} size={28} />
      </div>
      <dl class={`${styles.peekStats} num`}>
        <div>
          <dt>
            <Glyph name="winRate" size={14} />
            {t().champions.winRate}
          </dt>
          <dd data-wr={wrSide(e().winRate)}>{percent(e().winRate, 1)}</dd>
        </div>
        <div>
          <dt>
            <Glyph name="pick" size={14} />
            {t().champions.pickRate}
          </dt>
          <dd>{percent(e().pickRate, 1)}</dd>
        </div>
        <Show when={e().banRate > 0}>
          <div>
            <dt>
              <Glyph name="ban" size={14} />
              {t().champions.banRate}
            </dt>
            <dd>{percent(e().banRate, 1)}</dd>
          </div>
        </Show>
      </dl>
      <span class={`${styles.peekGames} num`}>
        <Glyph name="games" size={14} />
        {t().common.games(e().g)}
      </span>
    </div>
  );
}
