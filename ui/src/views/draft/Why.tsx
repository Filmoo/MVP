import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { DataInfo } from "../../data/generated/DataInfo";
import type { Reason } from "../../data/generated/Reason";
import type { Suggestion } from "../../data/generated/Suggestion";
import { Card } from "../../design/Card";
import { games, percent, signedPoints, timeAgo } from "../../lib/format";
import styles from "./Why.module.css";

const KIND_LABEL: Record<Reason["kind"], string> = { base: "Strength", lane: "Lane", jungle: "Jungle", matchup: "Matchup", duo: "Duo" };
/** Bars span ±5 pp. */
const SCALE = 5;
/** Below this share kept, the value is mostly the prior: flagged as weak evidence. */
const WEAK = 0.3;

function Bar(props: { points: number }): JSX.Element {
  const width = () => `${(Math.min(Math.abs(props.points), SCALE) / SCALE) * 50}%`;
  return (
    <div class={styles.bar} aria-hidden="true" data-free-style>
      <div
        class={`${styles.fill} ${props.points >= 0 ? styles.fillUp : styles.fillDown}`}
        style={props.points >= 0 ? { left: "50%", width: width() } : { right: "50%", width: width() }}
      />
    </div>
  );
}

export function Why(props: { suggestion: Suggestion | undefined; teamPercent: number; data: DataInfo }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? `Champion ${id}`;
  const label = (r: Reason, self: number) => {
    if (r.kind === "base") return `${name(self)}`;
    if (r.championId === null) return KIND_LABEL[r.kind];
    return `${r.kind === "duo" ? "with" : "vs"} ${name(r.championId)}`;
  };
  return (
    <Card title={props.suggestion ? `Why ${name(props.suggestion.championId)}` : "Why"}>
      <Show when={props.suggestion} fallback={<p class={styles.meta}>Select a pick to see how its estimate is built.</p>}>
        {(s) => (
          <>
            <div class={`${styles.summary} num`}>
              <span class={styles.big}>{s().estimate.percent.toFixed(1)}%</span>
              <span class={styles.pm}>± {s().estimate.plusMinus.toFixed(1)}</span>
              <span class={`${styles.delta} ${s().gain >= 0 ? styles.up : styles.down}`}>
                {signedPoints(s().gain)} vs team now ({props.teamPercent.toFixed(1)}%)
              </span>
            </div>
            <ul class={styles.rows}>
              <For each={s().reasons}>
                {(r) => (
                  <li class={styles.row}>
                    <span class={styles.label}>
                      <span class={styles.kind}>{KIND_LABEL[r.kind]} · </span>
                      {label(r, s().championId)}
                    </span>
                    <span class={`${styles.value} num ${r.points >= 0 ? styles.up : styles.down}`}>{signedPoints(r.points)}</span>
                    <Bar points={r.points} />
                    <span class={`${styles.meta} num`}>
                      {games(r.games)} games
                      <Show when={r.kind !== "base"}>
                        {" · "}
                        <span class={r.kept < WEAK ? styles.weak : ""}>
                          {r.kept < WEAK ? `weak evidence, ${percent(r.kept)} kept` : `${percent(r.kept)} of observed effect kept`}
                        </span>
                      </Show>
                      <Show when={r.probability < 0.995}> · if {percent(r.probability)} role guess holds</Show>
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <Show when={s().mine}>
              {(m) => (
                <p class={`${styles.footer} num`}>
                  You: {m().games} games, {percent(m().wins / m().games)} win rate on this champion (not counted in the estimate)
                </p>
              )}
            </Show>
            <p class={`${styles.footer} num`}>
              {props.data.bracket} · Patch {props.data.patch} · {games(props.data.games)} games · updated {timeAgo(props.data.updatedAt)}
            </p>
          </>
        )}
      </Show>
    </Card>
  );
}
