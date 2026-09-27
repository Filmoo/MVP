import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { DraftView } from "../../data/generated/DraftView";
import type { Reason } from "../../data/generated/Reason";
import type { Suggestion } from "../../data/generated/Suggestion";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { percent, signedPoints } from "../../lib/format";
import { ROLE_LABEL } from "./roles";
import styles from "./Suggestions.module.css";

const REASON_PREFIX: Record<Reason["kind"], string> = { base: "", lane: "vs", jungle: "vs", matchup: "vs", duo: "with" };
const CHIPS = 2;

export function reasonLabel(reason: Reason, championName: (id: number) => string): string {
  if (reason.kind === "base" || reason.championId === null) return "Strength";
  return `${REASON_PREFIX[reason.kind]} ${championName(reason.championId)}`;
}

function gainClass(gain: number): string {
  if (Math.abs(gain) < 0.05) return styles.flat ?? "";
  return (gain > 0 ? styles.up : styles.down) ?? "";
}

function Row(props: { s: Suggestion; selected: boolean; onSelect: () => void }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? `Champion ${id}`;
  const top = () => [...props.s.reasons].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, CHIPS);
  return (
    <li>
      <button
        type="button"
        class={`${styles.row} ${props.selected ? styles.selected : ""}`}
        aria-pressed={props.selected}
        onClick={() => props.onSelect()}
        data-testid="suggestion"
      >
        <ChampionIcon championId={props.s.championId} size={40} />
        <span class={styles.main}>
          <span class={styles.nameLine}>
            <span class={styles.name}>{name(props.s.championId)}</span>
            <Show when={props.s.mine}>
              {(m) => (
                <span class={`${styles.mine} num`}>
                  You · {m().games} {m().games === 1 ? "game" : "games"} · {percent(m().wins / m().games)}
                </span>
              )}
            </Show>
          </span>
          <span class={styles.chips}>
            <For each={top()}>
              {(r) => (
                <span class={`${styles.chip} num`}>
                  {reasonLabel(r, name)} <span class={r.points >= 0 ? styles.up : styles.down}>{signedPoints(r.points)}</span>
                </span>
              )}
            </For>
          </span>
        </span>
        <span class={`${styles.estimate} num`}>
          <span class={styles.pct}>{props.s.estimate.percent.toFixed(1)}%</span>
          <span class={styles.pm}>± {props.s.estimate.plusMinus.toFixed(1)}</span>
        </span>
        <span class={`${styles.gain} num ${gainClass(props.s.gain)}`}>{signedPoints(props.s.gain)}</span>
      </button>
    </li>
  );
}

export function Suggestions(props: {
  draft: DraftView;
  selected: number | undefined;
  onSelect: (championId: number) => void;
}): JSX.Element {
  const tiers = () => {
    const groups: Suggestion[][] = [];
    for (const s of props.draft.suggestions) {
      const group = groups[s.tier] ?? [];
      group.push(s);
      groups[s.tier] = group;
    }
    return groups.filter((g) => g.length > 0);
  };
  const role = () => (props.draft.myRole ? ROLE_LABEL[props.draft.myRole] : "your role");
  return (
    <Card
      title={`Picks for ${role()}`}
      actions={
        <span class={`${styles.teamNow} num`}>
          Team now <b>{props.draft.team.percent.toFixed(1)}%</b> ± {props.draft.team.plusMinus.toFixed(1)}
        </span>
      }
      flush={props.draft.suggestions.length > 0}
    >
      <Show
        when={props.draft.suggestions.length > 0}
        fallback={<EmptyState icon="draft" title="No suggestions yet" text="Suggestions appear once your role is known." />}
      >
        <ol class={styles.list}>
          <For each={tiers()}>
            {(group, i) => (
              <>
                <li class={styles.tier} aria-hidden="true">
                  {i() === 0 ? "Best · statistically tied" : `Tier ${i() + 1}`}
                </li>
                <For each={group}>
                  {(s) => <Row s={s} selected={props.selected === s.championId} onSelect={() => props.onSelect(s.championId)} />}
                </For>
              </>
            )}
          </For>
        </ol>
      </Show>
    </Card>
  );
}
