import { For, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { ChampionPage } from "../../data/generated/ChampionPage";
import type { Role } from "../../data/generated/Role";
import type { StatsIndex } from "../../data/generated/StatsIndex";
import { ChampionArt, ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { liquid } from "../../design/liquid/liquid";
import { Segmented } from "../../design/Segmented";
import { Skeleton } from "../../design/States";
import { GradeBadge } from "../../design/TierBadge";
import { games, percent, signedPoints, timeAgo } from "../../lib/format";
import { ROLE_ICON, ROLE_LABEL } from "../../lib/roles";
import { BRACKET_LABEL, patchName, QUEUE_LABEL, type RoleTab, tierFor } from "../../lib/stats";
import { parseQueue } from "../../lib/stats-filters";
import styles from "./ChampionHero.module.css";

function Stat(props: { value: string; label: string; detail: string; tone?: "good" | "bad" | undefined; title?: string }): JSX.Element {
  return (
    <div class={styles.stat} title={props.title}>
      <span class={`${styles.statValue} ${props.tone ? styles[props.tone] : ""}`}>{props.value}</span>
      <span class={styles.statLabel}>
        {props.label}
        <span class={styles.statDetail}>{props.detail}</span>
      </span>
    </div>
  );
}

/**
 * A champion's hero: art and identity, its role tabs, tier and record in the chosen role. Stats
 * are optional (loading, nothing published, no games): the identity always shows.
 */
export function ChampionHero(props: {
  championId: number;
  page: ChampionPage | undefined;
  /** Waiting for the first answer: skeletons where the numbers go. */
  loading: boolean;
  tabs: readonly RoleTab[];
  forRole: Role | undefined;
  onRole: (role: Role) => void;
  index: StatsIndex | null | undefined;
}): JSX.Element {
  const { gameData } = useData();
  const champion = () => gameData()?.champions.get(props.championId);
  const tier = () => (props.page ? tierFor(props.page, props.forRole) : undefined);
  const record = () => props.page?.stats?.roles.find((r) => r.role === props.forRole);
  const roleTabs = () => props.tabs.filter((t): t is RoleTab & { role: Role } => t.role !== undefined);
  const aram = () => parseQueue(props.page?.info.queue) === 450;
  return (
    <section class={styles.hero} data-testid="champion-hero" data-refract>
      <ChampionArt championId={props.championId} class={styles.art} light />
      <div class={styles.top}>
        <ChampionIcon championId={props.championId} size={72} />
        <div class={styles.identity}>
          <h1 class={styles.name}>{champion()?.name ?? `Champion ${props.championId}`}</h1>
          <Show when={(champion()?.tags.length ?? 0) > 0}>
            <ul class={styles.tags} aria-label="Classes">
              <For each={champion()?.tags}>{(tag) => <li class={styles.tag}>{tag}</li>}</For>
            </ul>
          </Show>
          <Switch>
            <Match when={roleTabs().length > 1}>
              <Segmented
                label="Role"
                size="sm"
                class={styles.roles}
                options={roleTabs().map((t) => ({
                  value: t.role,
                  label: ROLE_LABEL[t.role],
                  icon: ROLE_ICON[t.role],
                  detail: percent(t.share),
                }))}
                value={props.forRole ?? roleTabs()[0]?.role ?? "middle"}
                onChange={props.onRole}
                testId="role-tabs"
              />
            </Match>
            <Match when={roleTabs()[0]}>
              {(only) => (
                <span class={styles.onlyRole} data-testid="only-role">
                  <Icon name={ROLE_ICON[only().role]} size={16} />
                  {ROLE_LABEL[only().role]}
                </span>
              )}
            </Match>
            <Match when={props.loading && !props.page}>
              <div class={styles.roles}>
                <Skeleton width="160px" height="32px" />
              </div>
            </Match>
          </Switch>
        </div>
        <Show when={props.loading && !props.page}>
          <div class={`${styles.grade} glass-rim`}>
            <div class={styles.gradeGlass} aria-hidden="true" />
            <Skeleton width="40px" height="40px" />
            <div class={styles.gradeText}>
              <Skeleton width="72px" height="18px" />
              <Skeleton width="120px" height="14px" />
            </div>
          </div>
        </Show>
        <Show when={tier()}>
          {(t) => (
            <div class={`${styles.grade} glass-rim`} data-testid="champion-tier">
              <div class={styles.gradeGlass} aria-hidden="true" ref={(el) => liquid(el, "clear")} />
              <GradeBadge grade={t().tier} size="lg" />
              <div class={styles.gradeText}>
                <span class={styles.gradeTitle}>Tier {t().tier}</span>
                <span class={`${styles.gradeDetail} num`} title="Shrunk win rate minus 50 %, in points (what the tier is based on)">
                  {signedPoints(t().score)} pts {t().score >= 0 ? "over" : "under"} 50 %
                  {aram() ? "" : ` · ${ROLE_LABEL[t().role ?? "middle"]}`}
                </span>
              </div>
            </div>
          )}
        </Show>
      </div>
      <Show when={props.loading && !props.page}>
        <div class={styles.strip} aria-busy="true">
          <For each={[0, 1, 2, 3]}>
            {() => (
              <div class={styles.stat}>
                <Skeleton width="72px" height="28px" />
                <Skeleton width="112px" height="16px" />
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.page?.stats ? props.page : undefined}>
        {(p) => (
          <section class={`${styles.strip} num`} aria-label="Record">
            <Show
              when={tier()}
              fallback={
                <Show when={record()}>
                  {(r) => (
                    <Stat
                      value={percent(r().g ? r().w / r().g : 0, 1)}
                      label="Win rate"
                      detail={`${games(r().g)} games`}
                      tone={r().w / Math.max(1, r().g) >= 0.5 ? "good" : "bad"}
                    />
                  )}
                </Show>
              }
            >
              {(t) => (
                <>
                  <Stat
                    value={percent(t().winRate, 1)}
                    label="Win rate"
                    detail={`${games(t().g)} games`}
                    tone={t().winRate >= 0.5 ? "good" : "bad"}
                    title={`Shrunk toward 50 %: ${t().w} wins in ${t().g} games is ${percent(t().w / Math.max(1, t().g), 1)} raw`}
                  />
                  <Stat value={percent(t().pickRate, 1)} label="Pick rate" detail={`of ${games(p().info.games)} games`} />
                  <Show when={!aram()}>
                    <Stat value={percent(t().banRate, 1)} label="Ban rate" detail={`${games(p().stats?.bans ?? 0)} bans`} />
                  </Show>
                </>
              )}
            </Show>
            <Stat
              value={patchName(props.index, p().info.patch)}
              label="Patch"
              detail={`${QUEUE_LABEL[aram() ? 450 : 420]} · ${BRACKET_LABEL[p().info.bracket]} · ${timeAgo(p().info.updatedAt)}`}
            />
          </section>
        )}
      </Show>
    </section>
  );
}
