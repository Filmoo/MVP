import { createEffect, createMemo, createSignal, For, type JSX, lazy, Match, on, Show, Suspense, Switch } from "solid-js";
import { navigate, queryParam } from "../../app/router";
import { useData } from "../../data/context";
import { useAmbient } from "../../design/ambient";
import { Card } from "../../design/Card";
import { championIconUrl } from "../../design/GameIcon";
import { PenguinArt } from "../../design/PenguinArt";
import { EmptyState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { timeAgo } from "../../lib/format";
import { bestMatches } from "../../lib/fuzzy";
import { createQuery } from "../../lib/query";
import { matchingEntries, patchName, rankEntries, trendsOf } from "../../lib/stats";
import { ARAM, filters, type RoleFilter } from "../../lib/stats-filters";
import { parseView, setTierView, type TierView, tierView } from "../../lib/tier-view";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import { type Fact, QueueTabs, RankPicker, SearchField, StatsHead, useLinkFilters, useStatsIndex } from "../stats/common";
import { NoStatsChampions } from "./NoStats";
import { championLink, Shelves } from "./Shelves";
import styles from "./TierList.module.css";
import { TierTable } from "./TierTable";
import { LaneButtons, LaneScope, NoStatsNotice, ViewSwitch } from "./Toolbar";

// The full meta map loads when first opened.
const MapDialog = lazy(() => import("./MapDialog"));

/** The tier list's data: this patch's list and the previous one's (trends), for the shared filters. */
function useTierData() {
  const { transport } = useData();
  const { index, version } = useStatsIndex();
  useLinkFilters({ role: true });
  const queue = createMemo(() => filters().queue);
  const bracket = createMemo(() => filters().bracket);
  const key = () => ({ queue: queue(), bracket: bracket(), version: version() });
  const list = createQuery(key, (k) => transport.call("tier_list", { queue: k.queue, bracket: k.bracket }));
  // Trends need the previous patch's list: without it (or when it can't be had) none show.
  const previous = createQuery(key, (k) => transport.call("previous_tier_list", { queue: k.queue, bracket: k.bracket }).catch(() => null));
  const role = (): RoleFilter => (queue() === ARAM ? "all" : filters().role);
  const ranked = createMemo(() => {
    const d = list.data();
    return d ? rankEntries(d.entries, role()) : [];
  });
  const trends = createMemo(() => {
    const d = list.data();
    return d ? trendsOf(d, previous.data()) : undefined;
  });
  return {
    index,
    list,
    queue,
    role,
    ranked,
    trends,
  };
}

/** Shelves: the podium's row, then shelves. The table: its header, then rows. */
const SKELETONS = { shelves: ["176px", "108px", "108px", "108px"], table: ["28px", ...Array<string>(9).fill("36px")] };

/** Same boxes as the view shown, so nothing jumps when it lands. */
function ViewSkeleton(props: { view: TierView }): JSX.Element {
  return (
    <div class={styles.skeleton} data-view={props.view} aria-busy="true">
      <For each={SKELETONS[props.view]}>{(height) => <Skeleton height={height} />}</For>
    </div>
  );
}

/**
 * The tier list, where champions are found: a compact header (queue tabs; lanes, rank, a
 * champion filter and the view), then shelves (the podium, a meta map, a shelf per tier) or a table
 * sorted by any column. Every champion opens its build in that lane. Without stats, every
 * champion by class.
 */
export default function TierListView(): JSX.Element {
  const { gameData } = useData();
  const data = useTierData();
  // A link can pick the view too: `#/tier-list?view=table`.
  createEffect(
    on(
      () => queryParam("view"),
      (value) => {
        const view = parseView(value);
        if (view) setTierView(view);
      },
    ),
  );
  const [query, setQuery] = createSignal("");
  // The champion under the pointer, lit on its face and on the map (`entryKey`).
  const [lit, setLit] = createSignal<string>();
  const [mapOpen, setMapOpen] = createSignal(false);
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const filtering = () => query().trim().length > 0;
  // The filter keeps the list's order; Enter opens the best match.
  const shown = createMemo(() => matchingEntries(data.ranked(), query(), name));
  const aram = () => data.queue() === ARAM;
  const allRoles = () => data.role() === "all" && !aram();
  // Why there is nothing to rank (kept while a retry runs, so nothing flickers).
  const failed = () => (data.list.data() || data.list.error() === undefined ? undefined : data.list.error());
  const facts = (): Fact[] => {
    const info = data.list.data()?.info;
    if (!info) return [];
    return [
      { glyph: "patch", text: t().common.patch(patchName(data.index(), info.patch)) },
      { glyph: "games", text: t().common.games(info.games) },
      { text: t().common.updated(timeAgo(info.updatedAt)) },
    ];
  };
  // The page takes its light from the best champion shown.
  useAmbient(() => championIconUrl(gameData(), data.ranked()[0]?.id));
  const openBest = () => {
    const best = filtering() ? bestMatches(query(), shown(), (e) => name(e.id), 1)[0] : undefined;
    if (best) navigate(championLink(best).slice(1));
  };
  const busy = () => (data.list.loading() ? styles.busy : undefined);

  return (
    <div class={page.page}>
      <StatsHead
        scope={
          <Show when={!aram() && failed() === undefined}>
            <LaneScope role={data.role()} />
          </Show>
        }
        facts={failed() === undefined ? facts() : undefined}
        testId="data-badge"
      />
      {/* ARAM: Mayhem's augments have a page of their own. */}
      <QueueTabs mayhem={{ selected: false, onSelect: () => navigate("/mayhem") }} />
      <div class={styles.tools}>
        <div class={styles.scope}>
          <Show when={!aram() && failed() === undefined}>
            <LaneButtons />
          </Show>
          <RankPicker index={data.index()} />
        </div>
        <div class={styles.find}>
          <SearchField
            label={t().tierList.filter}
            value={query()}
            onInput={setQuery}
            onEnter={openBest}
            class={styles.filter}
            testId="champion-filter"
          />
          <Show when={failed() === undefined}>
            <ViewSwitch />
          </Show>
        </div>
      </div>
      <Show when={failed() !== undefined}>
        <NoStatsNotice error={failed()} onRetry={data.list.refetch} />
      </Show>
      <Switch>
        <Match when={failed() !== undefined}>
          <Widget name="tier-no-stats">
            <NoStatsChampions query={query()} />
          </Widget>
        </Match>
        <Match when={data.list.data() && data.ranked().length === 0}>
          <Card>
            <EmptyState icon="tiers" art={<PenguinArt size={72} />} title={t().tierList.empty.title} text={t().tierList.empty.text} />
          </Card>
        </Match>
        <Match when={data.list.data() && tierView() === "table"}>
          <Widget name="tier-table" class={busy()}>
            <TierTable rows={shown()} aram={aram()} allRoles={allRoles()} trends={data.trends()} />
          </Widget>
        </Match>
        <Match when={data.list.data()}>
          <Widget name="tier-shelves" class={busy()}>
            <Shelves
              rows={data.ranked()}
              shown={shown()}
              filtering={filtering()}
              allRoles={allRoles()}
              trends={data.trends()}
              lit={lit()}
              onLight={setLit}
              onOpenMap={() => setMapOpen(true)}
            />
          </Widget>
        </Match>
        <Match when={true}>
          <ViewSkeleton view={tierView()} />
        </Match>
      </Switch>
      <Show when={data.list.data() && data.ranked().length > 0}>
        <p class={styles.note}>{t().tierList.note}</p>
      </Show>
      <Show when={mapOpen()}>
        {/* The page says it is loading while the map's code arrives (tests wait for it). */}
        <Suspense fallback={<span data-state="loading" hidden />}>
          <MapDialog
            rows={data.ranked()}
            role={data.role()}
            allRoles={allRoles()}
            lit={lit()}
            onLight={setLit}
            onClose={() => setMapOpen(false)}
          />
        </Suspense>
      </Show>
    </div>
  );
}
