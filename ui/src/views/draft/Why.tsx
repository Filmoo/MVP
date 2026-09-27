import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { Reason } from "../../data/generated/Reason";
import type { Suggestion } from "../../data/generated/Suggestion";
import { Card } from "../../design/Card";
import { games, percent, signedPoints } from "../../lib/format";
import styles from "./Why.module.css";

const KIND_LABEL: Record<Reason["kind"], string> = { base: "Strength", lane: "Lane", jungle: "Jungle", matchup: "Matchup", duo: "Duo" };
/** Bars span ±5 pp. */
const SCALE = 5;
/** Below this share kept, the value is mostly the prior: flagged as weak evidence. */
export const WEAK = 0.3;

/** Largest effect first, the order the list's reason chips use. */
export function bySize(reasons: readonly Reason[]): Reason[] {
  return [...reasons].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

interface Segment {
  text: string;
  class?: string | undefined;
  title?: string;
}

/** `a · b · c` that only wraps between segments, never inside one. */
export function Segments(props: { items: Segment[]; class?: string | undefined }): JSX.Element {
  return (
    <span class={`${props.class ?? ""} num`}>
      <For each={props.items}>
        {(seg, i) => (
          <>
            <span class={`${styles.seg} ${seg.class ?? ""}`} title={seg.title}>
              {seg.text}
              {i() < props.items.length - 1 ? " ·" : ""}
            </span>{" "}
          </>
        )}
      </For>
    </span>
  );
}

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

function evidence(r: Reason): Segment[] {
  const segments: Segment[] = [{ text: `${games(r.games)} games` }];
  if (r.kind !== "base") {
    const kept = percent(r.kept);
    const title = `Small samples are pulled toward zero: ${kept} of the observed effect is kept.`;
    segments.push(r.kept < WEAK ? { text: `weak evidence, ${kept} kept`, class: styles.weak, title } : { text: `${kept} kept`, title });
  }
  if (r.probability < 0.995) {
    const odds = percent(r.probability);
    segments.push({ text: `${odds} role odds`, title: `Counts only if the role guess holds (${odds} likely).` });
  }
  return segments;
}

/** The terms that add up to a pick's estimate, largest first. */
export function WhyTerms(props: { suggestion: Suggestion; class?: string | undefined }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? `Champion ${id}`;
  const label = (r: Reason) => {
    if (r.kind === "base") return name(props.suggestion.championId);
    if (r.championId === null) return KIND_LABEL[r.kind];
    return `${r.kind === "duo" ? "with" : "vs"} ${name(r.championId)}`;
  };
  return (
    <ul class={`${styles.rows} ${props.class ?? ""}`}>
      <For each={bySize(props.suggestion.reasons)}>
        {(r) => (
          <li class={styles.row}>
            <span class={styles.label}>
              <span class={styles.kind}>{KIND_LABEL[r.kind]} · </span>
              {label(r)}
            </span>
            <span class={`${styles.value} num ${r.points >= 0 ? styles.up : styles.down}`}>{signedPoints(r.points)}</span>
            <Bar points={r.points} />
            <Segments class={styles.meta} items={evidence(r)} />
          </li>
        )}
      </For>
    </ul>
  );
}

export function Why(props: { suggestion: Suggestion | undefined; teamPercent: number | undefined }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? `Champion ${id}`;
  return (
    <Card title={props.suggestion ? `Why ${name(props.suggestion.championId)}` : "Why"}>
      <Show when={props.suggestion} fallback={<p class={styles.meta}>Select a pick to see how its estimate is built.</p>}>
        {(s) => (
          <>
            <div class={`${styles.summary} num`}>
              <span class={styles.big}>{s().estimate.percent.toFixed(1)}%</span>
              <span class={styles.pm}>± {s().estimate.plusMinus.toFixed(1)}</span>
              <Show when={props.teamPercent}>
                {(team) => (
                  <span class={styles.delta}>
                    <b class={s().gain >= 0 ? styles.up : styles.down}>{signedPoints(s().gain)}</b> vs team now ({team().toFixed(1)}%)
                  </span>
                )}
              </Show>
            </div>
            <WhyTerms suggestion={s()} />
            <Show when={s().mine}>
              {(m) => (
                <Segments
                  class={styles.footer}
                  items={[
                    { text: `You: ${m().games} ${m().games === 1 ? "game" : "games"}` },
                    { text: `${percent(m().wins / m().games)} WR` },
                    { text: "not in estimate", title: "Your own games are shown for reference; the estimate uses everyone's games." },
                  ]}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </Card>
  );
}
