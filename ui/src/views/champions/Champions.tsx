import { createEffect, createMemo, createSignal, For, type JSX, Match, on, Show, Switch } from "solid-js";
import { queryParam } from "../../app/router";
import { useClientStatus } from "../../data/client-status";
import { useData } from "../../data/context";
import type { ChampionPage } from "../../data/generated/ChampionPage";
import type { Role } from "../../data/generated/Role";
import { useAmbient } from "../../design/ambient";
import { Card } from "../../design/Card";
import { championArtUrl } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { Segmented } from "../../design/Segmented";
import { EmptyState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { createQuery } from "../../lib/query";
import { ROLES } from "../../lib/roles";
import { bracketLabel, buildFor, pickRole, roleFilterOptions, roleTabs, scopeLabel } from "../../lib/stats";
import { ARAM, filters, setFilter } from "../../lib/stats-filters";
import { Widget } from "../../widgets/Widget";
import { ImportBar, useImportModes } from "../draft/ImportBar";
import page from "../page.module.css";
import { ScopeSwitches, StatsProblem, useLinkFilters, useStatsIndex } from "../stats/common";
import { ChampionAugments } from "../mayhem/parts";
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
  const name = () => gameData()?.champions.get(props.page.stats?.id ?? 0)?.name ?? t().common.thisChampion;
  return (
    <div class={styles.grid}>
      <div class={styles.main}>
        <Show
          when={build()}
          fallback={
            <Card title={t().champions.build}>
              <EmptyState icon="champions" title={t().champions.noBuild.title} text={t().champions.noBuild.text(name(), props.forRole)} />
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
        <Card title={t().champions.runes}>
          <Skeleton height="310px" />
        </Card>
        <div class={styles.pair}>
          <Card title={t().champions.spells}>
            <Skeleton height="148px" />
          </Card>
          <Card title={t().champions.skills}>
            <Skeleton height="148px" />
          </Card>
        </div>
      </div>
      <div class={styles.aside}>
        <Card title={t().champions.matchups}>
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
  // ARAM: Mayhem's tab (`&mode=mayhem`): the champion's augments, then ARAM's builds.
  const [mayhem, setMayhem] = createSignal(queryParam("mode") === "mayhem");
  createEffect(
    on(
      () => queryParam("mode"),
      (mode) => setMayhem(mode === "mayhem"),
      { defer: true },
    ),
  );
  const queue = createMemo(() => (mayhem() ? ARAM : filters().queue));
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
  const name = () => gameData()?.champions.get(props.championId)?.name ?? t().common.championN(props.championId);
  // The build shown can go into the League client, like in Draft (spells in champion select only).
  const modes = useImportModes();
  const client = useClientStatus();
  const imports = () => Object.values(modes()).some((mode) => mode !== "off");

  return (
    <div class={page.page}>
      <div class={styles.top}>
        <a class={styles.back} href="#/champions">
          <Icon name="back" size={16} />
          {t().champions.all}
        </a>
        <ScopeSwitches mayhem={{ selected: mayhem(), onSelect: () => setMayhem(true), onLeave: () => setMayhem(false) }} />
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
      <Show when={mayhem()}>
        <Card title={t().mayhem.of(name())}>
          <Widget name="mayhem-champion">
            <ChampionAugments championId={props.championId} name={name()} full />
          </Widget>
        </Card>
        <div class={styles.aramHead}>
          <h2 class={styles.aramTitle}>{t().mayhem.aramBuilds}</h2>
          <p class={styles.aramNote}>{t().mayhem.aramNote}</p>
        </div>
      </Show>
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
              title={t().stats.noGamesOf(name())}
              text={t().stats.nothingCountedNew(scopeLabel(queue(), bracket()))}
            />
          </Card>
        </Match>
        <Match when={stats.data()}>
          {(p) => (
            <div class={`${styles.content} ${stats.loading() ? styles.busy : ""}`}>
              <Show when={imports()}>
                <Widget name="champion-import">
                  <ImportBar
                    championId={props.championId}
                    role={queue() === ARAM ? null : (role() ?? null)}
                    context={t().imports.mostPlayedIn(queue(), bracketLabel(bracket()))}
                    queue={queue()}
                    bracket={bracket()}
                    available={buildFor(p(), role()) !== undefined}
                    inChampSelect={client()?.phase === "champSelect"}
                    clientReady={client()?.connection === "connected"}
                    modes={modes()}
                  />
                </Widget>
              </Show>
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
        <h1 class={page.title}>{t().champions.title}</h1>
        <label class={styles.search}>
          <Icon name="search" size={16} class={styles.searchIcon} />
          <input
            type="search"
            class={styles.searchInput}
            placeholder={t().champions.search}
            aria-label={t().champions.search}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            data-testid="champion-search"
          />
        </label>
      </div>
      <div class={styles.indexFilters}>
        <Show when={ranked()}>
          <Segmented
            label={t().stats.role}
            options={roleFilterOptions()}
            value={filters().role}
            onChange={(r) => setFilter({ role: r })}
            testId="role-filter"
          />
        </Show>
        <Show when={list.data()}>
          <p class={styles.scope}>
            {t().champions.tiersFrom.before}
            <a href="#/tier-list">{t().champions.tiersFrom.link}</a>
            {t().champions.tiersFrom.after(scopeLabel(queue(), bracket()))}
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
