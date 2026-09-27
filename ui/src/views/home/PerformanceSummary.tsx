import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { kdaRatio, percent } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/roles";
import styles from "./PerformanceSummary.module.css";
import { summarize } from "./summary";

const MAX_CHAMPIONS = 5;
/** Below this, a win rate is noise: shown neutral instead of blue/rose. */
const MIN_GAMES_FOR_COLOR = 3;

function wrClass(wins: number, games: number): string {
  if (games < MIN_GAMES_FOR_COLOR) return styles.neutral ?? "";
  return (wins / games >= 0.5 ? styles.good : styles.bad) ?? "";
}

/** Recent champions and the role split (the headline numbers live in the profile hero). */
export function PerformanceSummary(props: { matches: readonly MatchSummary[] }): JSX.Element {
  const { gameData } = useData();
  const s = createMemo(() => summarize(props.matches));
  const remakes = () => props.matches.length - s().games;

  return (
    <Card title={`Champions · last ${s().games} ${s().games === 1 ? "game" : "games"}`}>
      <Show when={s().games > 0} fallback={<EmptyState icon="tiers" title="No stats yet" text="Play a few games to see your form." />}>
        <div class={styles.wrap}>
          <ol class={styles.champions}>
            <For each={s().champions.slice(0, MAX_CHAMPIONS)}>
              {(c) => (
                <li class={styles.champ}>
                  <ChampionIcon championId={c.championId} size={36} round />
                  <span class={styles.champName}>
                    <span class={styles.champTitle}>{gameData()?.champions.get(c.championId)?.name ?? `Champion ${c.championId}`}</span>
                    <span class={`${styles.champMeta} num`}>{kdaRatio(c.kills, c.deaths, c.assists)} KDA</span>
                  </span>
                  <span class={`${styles.champWr} num`}>
                    <Show
                      when={c.games >= MIN_GAMES_FOR_COLOR}
                      fallback={
                        <>
                          <span class={styles.neutral}>
                            {c.wins}W {c.games - c.wins}L
                          </span>
                          <span class={styles.champGames}>
                            {c.games} {c.games === 1 ? "game" : "games"}
                          </span>
                        </>
                      }
                    >
                      <span class={wrClass(c.wins, c.games)}>{percent(c.wins / c.games)}</span>
                      <span class={styles.champGames}>
                        {c.wins}W {c.games - c.wins}L
                      </span>
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ol>

          <div class={styles.rolesSection}>
            <h3 class={styles.sectionTitle}>Roles</h3>
            <div
              class={styles.split}
              role="img"
              aria-label={s()
                .roles.map((r) => `${ROLE_LABEL[r.role]} ${r.games}`)
                .join(", ")}
            >
              <For each={s().roles}>{(r) => <span class={`${styles.segment} ${styles[r.role]}`} style={{ "flex-grow": r.games }} />}</For>
            </div>
            <ul class={styles.legend}>
              <For each={s().roles}>
                {(r) => (
                  <li class={styles.legendItem}>
                    <span class={`${styles.swatch} ${styles[r.role]}`} aria-hidden="true" />
                    <span class={styles.legendName}>{ROLE_LABEL[r.role]}</span>
                    <span class={`${styles.legendValue} num`}>{percent(r.games / s().games)}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>

          <Show when={remakes() > 0}>
            <p class={styles.note}>
              {remakes()} {remakes() === 1 ? "remake" : "remakes"} not counted
            </p>
          </Show>
        </div>
      </Show>
    </Card>
  );
}
