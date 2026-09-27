import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { Role } from "../../data/generated/Role";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { kdaRatio, percent } from "../../lib/format";
import styles from "./PerformanceSummary.module.css";
import { summarize } from "./summary";

const ROLE_LABEL: Record<Role, string> = {
  top: "Top",
  jungle: "Jungle",
  middle: "Mid",
  bottom: "Bot",
  support: "Support",
};
const MAX_CHAMPIONS = 5;
/** Below this, a win rate is noise: shown neutral instead of green/red. */
const MIN_GAMES_FOR_COLOR = 3;

function wrClass(wins: number, games: number): string {
  if (games < MIN_GAMES_FOR_COLOR) return styles.neutral ?? "";
  return (wins / games >= 0.5 ? styles.good : styles.bad) ?? "";
}

export function PerformanceSummary(props: { matches: readonly MatchSummary[] }): JSX.Element {
  const { staticData } = useData();
  const s = createMemo(() => summarize(props.matches));
  const wr = () => (s().games ? s().wins / s().games : 0);

  return (
    <Card title={`Recent form · ${s().games} ${s().games === 1 ? "game" : "games"}`}>
      <Show when={s().games > 0} fallback={<EmptyState icon="tiers" title="No stats yet" text="Play a few games to see your form." />}>
        <div class={styles.wrap}>
          <div class={styles.layout}>
            <div class={`${styles.stats} num`}>
              <div class={styles.stat}>
                <span class={`${styles.value} ${wr() >= 0.5 ? styles.good : styles.bad}`}>{percent(wr())}</span>
                <span class={styles.label}>
                  {s().wins}W {s().games - s().wins}L
                </span>
              </div>
              <div class={styles.stat}>
                <span class={styles.value}>{kdaRatio(s().kills, s().deaths, s().assists)}</span>
                <span class={styles.label}>KDA</span>
              </div>
              <div class={styles.stat}>
                <span class={styles.value}>{s().csPerMinute.toFixed(1)}</span>
                <span class={styles.label}>CS / min</span>
              </div>
            </div>

            <div class={`${styles.section} ${styles.champions}`}>
              <h3 class={styles.sectionTitle}>Champions</h3>
              <For each={s().champions.slice(0, MAX_CHAMPIONS)}>
                {(c) => (
                  <div class={styles.champ}>
                    <ChampionIcon championId={c.championId} size={32} />
                    <div class={styles.champName}>
                      <span class={styles.champTitle}>{staticData()?.champions.get(c.championId)?.name ?? `Champion ${c.championId}`}</span>
                      <span class={`${styles.champMeta} num`}>
                        {c.games} {c.games === 1 ? "game" : "games"} · {kdaRatio(c.kills, c.deaths, c.assists)} KDA
                      </span>
                    </div>
                    <span class={`${styles.champWr} num ${wrClass(c.wins, c.games)}`}>{percent(c.wins / c.games)}</span>
                  </div>
                )}
              </For>
            </div>

            <div class={`${styles.section} ${styles.rolesSection}`}>
              <h3 class={styles.sectionTitle}>Roles</h3>
              <div class={styles.roles}>
                <For each={s().roles}>
                  {(r) => (
                    <div class={styles.role}>
                      <span>{ROLE_LABEL[r.role]}</span>
                      <div class={styles.roleBar}>
                        <div class={styles.roleFill} style={{ width: percent(r.games / s().games, 1) }} />
                      </div>
                      <span class={`${styles.roleCount} num`}>{r.games}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
          <Show when={props.matches.length > s().games}>
            <p class={styles.note}>
              {props.matches.length - s().games} {props.matches.length - s().games === 1 ? "remake" : "remakes"} not counted
            </p>
          </Show>
        </div>
      </Show>
    </Card>
  );
}
