import { createEffect, createMemo, createSignal, For, type JSX, Match, on, Show, Switch } from "solid-js";
import { queryParam } from "../../app/router";
import { useData } from "../../data/context";
import type { ChampionPage } from "../../data/generated/ChampionPage";
import type { Role } from "../../data/generated/Role";
import { useAmbient } from "../../design/ambient";
import { Card } from "../../design/Card";
import { championArtUrl } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { Segmented } from "../../design/Segmented";
import { EmptyState, Skeleton } from "../../design/States";
import { createQuery } from "../../lib/query";
import { ROLE_LABEL, ROLES } from "../../lib/roles";
import { BRACKET_LABEL, buildFor, pickRole, QUEUE_LABEL, ROLE_FILTER_OPTIONS, roleTabs } from "../../lib/stats";
import { ARAM, filters, setFilter } from "../../lib/stats-filters";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import { ScopeSwitches, StatsProblem, useLinkFilters, useStatsIndex } from "../stats/common";
import { ItemsCard, SkillsCard, SpellsCard } from "./Builds";
import { ChampionGrid } from "./ChampionGrid";
import { ChampionHero } from "./ChampionHero";
import styles from "./Champions.module.css";
import { MatchupsCard } from "./Matchups";
import { RunesCard } from "./Runes";

const parseRole = (value: string | null): Role | undefined => ROLES.find((r) => r === value);

/** Builds (runes, spells, skills, items) and matchups of one role. */
export function ChampionBuilds(props: { page: ChampionPage; forRole: Role | undefined }): JSX.Element {
  const { gameData } = useData();
  const build = () => buildFor(props.page, props.forRole);
  const name = () => gameData()?.champions.get(props.page.stats?.id ?? 0)?.name ?? "This champion";
  return (
    <div class={styles.grid}>
      <div class={styles.main}>
        <Show
          when={build()}
          fallback={
            <Card title="Build">
              <EmptyState
                icon="champions"
                title="No build data yet"
                text={`${name()} needs more games${props.forRole ? ` as ${ROLE_LABEL[props.forRole]}` : ""} before its build is published.`}
              />
            </Card>
          }
        >
          {(b) => (
            <>
              <Widget name="champion-runes">
                <RunesCard build={b()} />
              </Widget>
              <div class={styles.pair}>
                <Widget name="champion-spells">
                  <SpellsCard build={b()} />
                </Widget>
                <Widget name="champion-skills">
                  <SkillsCard build={b()} />
                </Widget>
              </div>
              <Widget name="champion-items">
                <ItemsCard build={b()} />
              </Widget>
            </>
          )}
        </Show>
      </div>
      <Widget name="champion-matchups" class={styles.aside}>
        <MatchupsCard page={props.page} forRole={props.forRole} />
      </Widget>
    </div>
  );
}

/** Same boxes as the builds, so nothing jumps when they land. */
function BuildsSkeleton(): JSX.Element {
  return (
    <div class={styles.grid} aria-busy="true">
      <div class={styles.main}>
        <Card title="Runes">
          <Skeleton height="310px" />
        </Card>
        <div class={styles.pair}>
          <Card title="Summoner spells">
            <Skeleton height="148px" />
          </Card>
          <Card title="Skill order">
            <Skeleton height="148px" />
          </Card>
        </div>
      </div>
      <div class={styles.aside}>
        <Card title="Matchups">
          <div class={styles.skeletonList}>
            <For each={[0, 1, 2, 3, 4]}>{() => <Skeleton height="44px" />}</For>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** One champion: hero with its roles, then the chosen role's build and matchups. */
function ChampionView(props: { championId: number }): JSX.Element {
  const { transport, gameData } = useData();
  const { index, version } = useStatsIndex();
  useLinkFilters({ role: false });
  const queue = createMemo(() => filters().queue);
  const bracket = createMemo(() => filters().bracket);
  const stats = createQuery(
    () => ({ championId: props.championId, queue: queue(), bracket: bracket(), version: version() }),
    (k) => transport.call("champion_stats", { championId: k.championId, queue: k.queue, bracket: k.bracket }),
  );
  const tabs = createMemo(() => {
    const p = stats.data();
    return p ? roleTabs(p) : [];
  });
  // A link can ask for a role (`&role=middle`); a champion never played there shows its main role.
  const [wanted, setWanted] = createSignal<Role | undefined>(parseRole(queryParam("role")));
  createEffect(
    on(
      () => queryParam("role"),
      (r) => setWanted(parseRole(r)),
      { defer: true },
    ),
  );
  const role = createMemo(() => pickRole(tabs(), wanted()));
  useAmbient(() => championArtUrl(gameData(), props.championId));
  const name = () => gameData()?.champions.get(props.championId)?.name ?? `Champion ${props.championId}`;

  return (
    <div class={page.page}>
      <div class={styles.top}>
        <a class={styles.back} href="#/champions">
          <Icon name="back" size={16} />
          All champions
        </a>
        <ScopeSwitches />
      </div>
      <Widget name="champion-hero">
        <ChampionHero
          championId={props.championId}
          page={stats.data()}
          loading={stats.loading()}
          tabs={tabs()}
          forRole={role()}
          onRole={setWanted}
          index={index()}
        />
      </Widget>
      <Switch>
        <Match when={stats.error() !== undefined && !stats.loading()}>
          <StatsProblem error={stats.error()} onRetry={stats.refetch} />
        </Match>
        <Match when={!stats.data()}>
          <BuildsSkeleton />
        </Match>
        <Match when={stats.data() && !stats.data()?.stats}>
          <Card>
            <EmptyState
              icon="champions"
              title={`No games of ${name()} yet`}
              text={`Nothing counted in ${QUEUE_LABEL[queue()]} · ${BRACKET_LABEL[bracket()]} on this patch yet: new champions show up after their first games.`}
            />
          </Card>
        </Match>
        <Match when={stats.data()}>
          {(p) => (
            <div class={stats.loading() ? styles.busy : undefined}>
              <ChampionBuilds page={p()} forRole={role()} />
            </div>
          )}
        </Match>
      </Switch>
    </div>
  );
}

/** `/champions`: every champion, searchable, with its tier in the chosen role. */
function ChampionIndex(): JSX.Element {
  const { transport } = useData();
  const { version } = useStatsIndex();
  useLinkFilters({ role: true });
  const queue = createMemo(() => filters().queue);
  const bracket = createMemo(() => filters().bracket);
  const list = createQuery(
    () => ({ queue: queue(), bracket: bracket(), version: version() }),
    (k) => transport.call("tier_list", { queue: k.queue, bracket: k.bracket }),
  );
  const [query, setQuery] = createSignal("");
  const ranked = () => queue() !== ARAM && list.data() !== undefined;
  return (
    <div class={page.page}>
      <div class={styles.indexHead}>
        <h1 class={page.title}>Champions</h1>
        <label class={styles.search}>
          <Icon name="search" size={16} class={styles.searchIcon} />
          <input
            type="search"
            class={styles.searchInput}
            placeholder="Search a champion"
            aria-label="Search a champion"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            data-testid="champion-search"
          />
        </label>
      </div>
      <div class={styles.indexFilters}>
        <Show when={ranked()}>
          <Segmented
            label="Role"
            options={ROLE_FILTER_OPTIONS}
            value={filters().role}
            onChange={(r) => setFilter({ role: r })}
            testId="role-filter"
          />
        </Show>
        <Show when={list.data()}>
          <p class={styles.scope}>
            Tiers from the <a href="#/tier-list">tier list</a>: {QUEUE_LABEL[queue()]} · {BRACKET_LABEL[bracket()]}
          </p>
        </Show>
      </div>
      <Widget name="champion-grid">
        <ChampionGrid list={list.data()} roleFilter={ranked() ? filters().role : "all"} query={query()} />
      </Widget>
    </div>
  );
}

export default function Champions(): JSX.Element {
  const { gameData } = useData();
  const id = () => {
    const raw = queryParam("id");
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  // Unknown ids wait for game data before falling back to the list.
  const known = () => {
    const n = id();
    return n !== undefined && (gameData() === undefined || gameData()?.champions.has(n)) ? n : undefined;
  };
  return (
    <Show when={known()} fallback={<ChampionIndex />} keyed>
      {(championId) => <ChampionView championId={championId} />}
    </Show>
  );
}
