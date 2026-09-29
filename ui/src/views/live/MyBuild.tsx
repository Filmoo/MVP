import { createMemo, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { LiveGame } from "../../data/generated/LiveGame";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { createQuery } from "../../lib/query";
import { roleLabel } from "../../lib/roles";
import { asStatsQueue, bracketLabel, scopeLabel } from "../../lib/stats";
import { filters } from "../../lib/stats-filters";
import { Widget } from "../../widgets/Widget";
import { ChampionBuilds } from "../champions/Champions";
import champ from "../champions/Champions.module.css";
import { ChampionAugments, isMayhem, sentence } from "../mayhem/parts";
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
  // The core reads it from the game's map: Rift builds for customs and co-op vs AI too.
  const queue = () => asStatsQueue(props.game.statsQueue);
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
  // ARAM: Mayhem: the augments first (known before the game: nothing reacts to its offers), then
  // ARAM's build, said to be ARAM's.
  const mayhem = () => isMayhem(props.game.queueId);

  const scope = () => {
    const q = queue();
    return q ? t().imports.mostPlayedIn(q, bracketLabel(filters().bracket)) : "";
  };
  const link = (id: number) => {
    const extra = mayhem() ? "&mode=mayhem" : role() ? `&role=${role()}` : "";
    return `#/champions?id=${id}${extra}`;
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
              {/* Mayhem: where the build comes from is said above it, under "ARAM builds". */}
              {mayhem() ? "" : `${scope()} · `}
              <a href={link(id())}>{t().live.build.page}</a>
            </span>
          </p>
        )}
      </Show>
      <Show when={mayhem() && me()?.championId}>
        {(id) => (
          <>
            <Card title={t().mayhem.of(name())}>
              <Widget name="mayhem-champion">
                <ChampionAugments championId={id()} name={name()} full />
              </Widget>
            </Card>
            <div class={champ.aramHead}>
              <h2 class={champ.aramTitle}>{t().mayhem.aramBuilds}</h2>
              <p class={champ.aramNote}>
                {sentence(scope())} · {t().mayhem.aramNote}
              </p>
            </div>
          </>
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
