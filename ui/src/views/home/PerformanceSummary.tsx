import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { ChampionMastery } from "../../data/generated/ChampionMastery";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { t } from "../../i18n";
import { games, integer, kdaRatio, percent } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import styles from "./PerformanceSummary.module.css";
import { summarize } from "./summary";

const MAX_CHAMPIONS = 5;
/** Below this, a win rate is noise: shown neutral instead of blue/rose. */
const MIN_GAMES_FOR_COLOR = 3;

function wrClass(wins: number, games: number): string {
  if (games < MIN_GAMES_FOR_COLOR) return styles.neutral ?? "";
  return (wins / games >= 0.5 ? styles.good : styles.bad) ?? "";
}

/** Champions shown with their mastery. */
const MAX_MASTERY = 5;

/** Recent champions and the role split (the headline numbers live in the profile hero); your mastery on Home. */
export function PerformanceSummary(props: {
  matches: readonly MatchSummary[];
  mastery?: readonly ChampionMastery[] | undefined;
}): JSX.Element {
  const { gameData } = useData();
  const s = createMemo(() => summarize(props.matches));
  const remakes = () => props.matches.length - s().games;
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);

  return (
    <Card title={t().summary.title(s().games)}>
      <Show when={s().games > 0} fallback={<EmptyState icon="tiers" title={t().summary.empty.title} text={t().summary.empty.text} />}>
        <div class={styles.wrap}>
          <ol class={styles.champions}>
            <For each={s().champions.slice(0, MAX_CHAMPIONS)}>
              {(c) => (
                <li class={styles.champ}>
                  <ChampionIcon championId={c.championId} size={36} round />
                  <span class={styles.champName}>
                    <span class={styles.champTitle}>{name(c.championId)}</span>
                    <span class={`${styles.champMeta} num`}>{t().common.kda(kdaRatio(c.kills, c.deaths, c.assists))}</span>
                  </span>
                  <span class={`${styles.champWr} num`}>
                    <Show
                      when={c.games >= MIN_GAMES_FOR_COLOR}
                      fallback={
                        <>
                          <span class={styles.neutral}>{t().common.record(c.wins, c.games - c.wins)}</span>
                          <span class={styles.champGames}>{t().common.games(c.games)}</span>
                        </>
                      }
                    >
                      <span class={wrClass(c.wins, c.games)}>{percent(c.wins / c.games)}</span>
                      <span class={styles.champGames}>{t().common.record(c.wins, c.games - c.wins)}</span>
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ol>

          <div class={styles.rolesSection}>
            <h3 class={styles.sectionTitle}>{t().summary.roles}</h3>
            <div
              class={styles.split}
              role="img"
              aria-label={s()
                .roles.map((r) => `${roleLabel(r.role)} ${r.games}`)
                .join(", ")}
            >
              <For each={s().roles}>{(r) => <span class={`${styles.segment} ${styles[r.role]}`} style={{ "flex-grow": r.games }} />}</For>
            </div>
            <ul class={styles.legend}>
              <For each={s().roles}>
                {(r) => (
                  <li class={styles.legendItem}>
                    <span class={`${styles.swatch} ${styles[r.role]}`} aria-hidden="true" />
                    <span class={styles.legendName}>{roleLabel(r.role)}</span>
                    <span class={`${styles.legendValue} num`}>{percent(r.games / s().games)}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>

          <Show when={props.mastery?.length}>
            <div class={styles.rolesSection}>
              <h3 class={styles.sectionTitle}>{t().summary.mastery}</h3>
              <ol class={styles.mastery}>
                <For each={props.mastery?.slice(0, MAX_MASTERY)}>
                  {(m) => (
                    <li class={styles.masteryItem} title={t().summary.masteryTitle(name(m.championId), m.level, integer(m.points))}>
                      <span class={styles.masteryIcon}>
                        <ChampionIcon championId={m.championId} size={40} round />
                        <span class={`${styles.masteryLevel} num`}>{m.level}</span>
                      </span>
                      <span class={`${styles.masteryPoints} num`}>{games(m.points)}</span>
                    </li>
                  )}
                </For>
              </ol>
            </div>
          </Show>

          <Show when={remakes() > 0}>
            <p class={styles.note}>{t().summary.remakes(remakes())}</p>
          </Show>
        </div>
      </Show>
    </Card>
  );
}
