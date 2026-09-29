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
import { t } from "../../i18n";
import { className } from "../../lib/champions";
import { percent, timeAgo } from "../../lib/format";
import { ROLE_ICON, roleLabel } from "../../lib/roles";
import { bracketLabel, patchName, type RoleTab, tierFor } from "../../lib/stats";
import { parseQueue } from "../../lib/stats-filters";
import styles from "./ChampionHero.module.css";

/** A figure of the hero; `title` explains it on hover or focus (design/tip), headed by its label. */
function Stat(props: { value: string; label: string; detail: string; tone?: "good" | "bad" | undefined; title?: string }): JSX.Element {
  return (
    <div
      class={styles.stat}
      data-hint={props.title}
      data-hint-title={props.title ? props.label : undefined}
      tabIndex={props.title ? 0 : undefined}
    >
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
  /** Art and identity only, no tier or numbers (ARAM: Mayhem's tab: ARAM's are shown lower, said to be ARAM's). */
  identityOnly?: boolean;
}): JSX.Element {
  const { gameData } = useData();
  const champion = () => gameData()?.champions.get(props.championId);
  const numbers = () => !props.identityOnly;
  const tier = () => (numbers() && props.page ? tierFor(props.page, props.forRole) : undefined);
  const record = () => props.page?.stats?.roles.find((r) => r.role === props.forRole);
  const roleTabs = () => props.tabs.filter((t): t is RoleTab & { role: Role } => t.role !== undefined);
  const aram = () => parseQueue(props.page?.info.queue) === 450;
  return (
    <section class={styles.hero} data-testid="champion-hero" data-refract>
      <ChampionArt championId={props.championId} class={styles.art} light />
      <div class={styles.top}>
        <ChampionIcon championId={props.championId} size={72} />
        <div class={styles.identity}>
          <h1 class={styles.name}>{champion()?.name ?? t().common.championN(props.championId)}</h1>
          <Show when={(champion()?.tags.length ?? 0) > 0}>
            <ul class={styles.tags} aria-label={t().champions.classes}>
              <For each={champion()?.tags}>{(tag) => <li class={styles.tag}>{className(tag)}</li>}</For>
            </ul>
          </Show>
          <Switch>
            <Match when={roleTabs().length > 1}>
              <Segmented
                label={t().stats.role}
                size="sm"
                class={styles.roles}
                options={roleTabs().map((tab) => ({
                  value: tab.role,
                  label: roleLabel(tab.role),
                  icon: ROLE_ICON[tab.role],
                  detail: percent(tab.share),
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
                  {roleLabel(only().role)}
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
        <Show when={numbers() && props.loading && !props.page}>
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
          {(entry) => (
            // What the tier means, on hover or focus of the whole block (design/tip).
            <div
              class={`${styles.grade} glass-rim`}
              data-testid="champion-tier"
              data-tip={`tier:${entry().tier}`}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: its explanation (design/tip) shows on keyboard focus too
              tabIndex={0}
            >
              <div class={styles.gradeGlass} aria-hidden="true" ref={(el) => liquid(el, "clear")} />
              <GradeBadge grade={entry().tier} size="lg" />
              <div class={styles.gradeText}>
                <span class={styles.gradeTitle}>{t().stats.tier(entry().tier)}</span>
                <span class={`${styles.gradeDetail} num`}>
                  {t().champions.pointsVs50(entry().score)}
                  {aram() ? "" : ` · ${roleLabel(entry().role ?? "middle")}`}
                </span>
              </div>
            </div>
          )}
        </Show>
      </div>
      <Show when={numbers() && props.loading && !props.page}>
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
      <Show when={numbers() && props.page?.stats ? props.page : undefined}>
        {(p) => (
          <section class={`${styles.strip} num`} aria-label={t().champions.record}>
            <Show
              when={tier()}
              fallback={
                <Show when={record()}>
                  {(r) => (
                    <Stat
                      value={percent(r().g ? r().w / r().g : 0, 1)}
                      label={t().champions.winRate}
                      detail={t().common.games(r().g)}
                      tone={r().w / Math.max(1, r().g) >= 0.5 ? "good" : "bad"}
                    />
                  )}
                </Show>
              }
            >
              {(entry) => (
                <>
                  <Stat
                    value={percent(entry().winRate, 1)}
                    label={t().champions.winRate}
                    detail={t().common.games(entry().g)}
                    tone={entry().winRate >= 0.5 ? "good" : "bad"}
                    title={t().champions.shrunkTitle(entry().w, entry().g, percent(entry().w / Math.max(1, entry().g), 1))}
                  />
                  <Stat
                    value={percent(entry().pickRate, 1)}
                    label={t().champions.pickRate}
                    detail={t().champions.ofGames(p().info.games)}
                  />
                  <Show when={!aram()}>
                    <Stat
                      value={percent(entry().banRate, 1)}
                      label={t().champions.banRate}
                      detail={t().champions.bans(p().stats?.bans ?? 0)}
                    />
                  </Show>
                </>
              )}
            </Show>
            <Stat
              value={patchName(props.index, p().info.patch)}
              label={t().champions.patch}
              detail={t().champions.patchDetail(aram() ? 450 : 420, bracketLabel(p().info.bracket), timeAgo(p().info.updatedAt))}
            />
          </section>
        )}
      </Show>
    </section>
  );
}
