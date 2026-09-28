import { createMemo, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { LiveGame } from "../../data/generated/LiveGame";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { createQuery } from "../../lib/query";
import { roleLabel } from "../../lib/roles";
import { bracketLabel, scopeLabel, statsQueueOf } from "../../lib/stats";
import { filters } from "../../lib/stats-filters";
import { ChampionBuilds } from "../champions/Champions";
import { StatsProblem, useStatsIndex } from "../stats/common";
import styles from "./Live.module.css";

/**
 * The build of the champion the player is on, for this game's mode and their role, from the
 * published stats (the bracket chosen on the stats pages): runes, spells, skill order, items
 * and matchups, the champion page's own cards.
 */
export function MyBuild(props: { game: LiveGame }): JSX.Element {
  const { transport, gameData } = useData();
  const { version } = useStatsIndex();
  const me = () => props.game.allies.find((p) => p.isMe);
  const queue = () => statsQueueOf(props.game.queueId);
  const key = createMemo(() => {
    const championId = me()?.championId;
    const q = queue();
    return championId && q ? { championId, queue: q, bracket: filters().bracket, version: version() } : undefined;
  });
  const stats = createQuery(key, (k) =>
    k ? transport.call("champion_stats", { championId: k.championId, queue: k.queue, bracket: k.bracket }) : Promise.resolve(undefined),
  );
  const name = () => {
    const id = me()?.championId;
    return id ? (gameData()?.champions.get(id)?.name ?? t().common.championN(id)) : t().common.yourChampion;
  };
  const role = () => (queue() === 450 ? undefined : (me()?.role ?? undefined));

  const scope = () => {
    const q = queue();
    return q ? t().imports.mostPlayedIn(q, bracketLabel(filters().bracket)) : "";
  };

  return (
    <div class={styles.build} data-testid="my-build">
      <Show when={queue() && me()?.championId}>
        {(id) => (
          <p class={styles.buildFor}>
            <ChampionIcon championId={id()} size={24} />
            <span class={styles.buildWho}>
              {name()}
              {role() ? ` · ${roleLabel(role() ?? "top")}` : ""}
            </span>
            <span class={styles.buildScope}>
              {scope()} · <a href={`#/champions?id=${id()}${role() ? `&role=${role()}` : ""}`}>{t().live.build.page}</a>
            </span>
          </p>
        )}
      </Show>
      <Switch>
        <Match when={!queue()}>
          <Card>
            <EmptyState icon="champions" title={t().live.build.noMode.title} text={t().live.build.noMode.text} />
          </Card>
        </Match>
        <Match when={!me()?.championId}>
          <Card>
            <EmptyState icon="champions" title={t().live.build.noChampion.title} text={t().live.build.noChampion.text} />
          </Card>
        </Match>
        <Match when={stats.error() !== undefined && !stats.loading()}>
          <StatsProblem error={stats.error()} onRetry={stats.refetch} />
        </Match>
        <Match when={!stats.data()}>
          <div aria-busy="true">
            <Card title={t().champions.runes}>
              <Skeleton height="310px" />
            </Card>
          </div>
        </Match>
        <Match when={stats.data() && !stats.data()?.stats}>
          <Card>
            <EmptyState
              icon="champions"
              title={t().stats.noGamesOf(name())}
              text={t().stats.nothingCounted(scopeLabel(queue() ?? 420, filters().bracket))}
            />
          </Card>
        </Match>
        <Match when={stats.data()}>{(page) => <ChampionBuilds page={page()} forRole={role()} />}</Match>
      </Switch>
    </div>
  );
}
