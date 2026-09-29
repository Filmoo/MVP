import { createMemo, For, type JSX, Match, Show, Switch } from "solid-js";
import { navigate } from "../../app/router";
import { useData } from "../../data/context";
import { Card } from "../../design/Card";
import { Segmented } from "../../design/Segmented";
import { Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { createQuery } from "../../lib/query";
import { roleFilterOptions } from "../../lib/stats";
import { ARAM, filters, setFilter } from "../../lib/stats-filters";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import { DataBadge, ScopeSwitches, StatsProblem, useLinkFilters, useStatsIndex } from "../stats/common";
import styles from "./TierList.module.css";
import { TierTable } from "./TierTable";

/** Same boxes as the table, so nothing jumps when it lands. */
function TableSkeleton(): JSX.Element {
  return (
    <Card flush>
      <div class={styles.skeleton} aria-busy="true">
        <Skeleton height="20px" width="40%" />
        <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>{() => <Skeleton height="40px" />}</For>
      </div>
    </Card>
  );
}

/** Champion strength per role for the current patch: queue, rank and role filters, sortable. */
export default function TierListView(): JSX.Element {
  const { transport } = useData();
  const { index, version } = useStatsIndex();
  useLinkFilters({ role: true });
  const queue = createMemo(() => filters().queue);
  const bracket = createMemo(() => filters().bracket);
  const list = createQuery(
    () => ({ queue: queue(), bracket: bracket(), version: version() }),
    (k) => transport.call("tier_list", { queue: k.queue, bracket: k.bracket }),
  );
  const role = () => (queue() === ARAM ? "all" : filters().role);

  return (
    <div class={page.page}>
      <div class={styles.head}>
        <h1 class={page.title}>{t().tierList.title}</h1>
        <Show when={list.data()}>{(l) => <DataBadge info={l().info} index={index()} />}</Show>
      </div>
      <div class={styles.filters}>
        {/* ARAM: Mayhem's augments have a page of their own. */}
        <ScopeSwitches mayhem={{ selected: false, onSelect: () => navigate("/mayhem") }} />
        <Show when={queue() !== ARAM}>
          <Segmented
            label={t().stats.role}
            options={roleFilterOptions()}
            value={filters().role}
            onChange={(r) => setFilter({ role: r })}
            testId="role-filter"
          />
        </Show>
      </div>
      <Switch>
        <Match when={list.error() !== undefined && !list.loading()}>
          <StatsProblem error={list.error()} onRetry={list.refetch} />
        </Match>
        <Match when={list.data()}>
          {(l) => (
            <Widget name="tier-list" class={list.loading() ? styles.busy : undefined}>
              <TierTable list={l()} roleFilter={role()} />
            </Widget>
          )}
        </Match>
        <Match when={true}>
          <TableSkeleton />
        </Match>
      </Switch>
      <Show when={list.data()}>
        <p class={styles.note}>{t().tierList.note}</p>
      </Show>
    </div>
  );
}
