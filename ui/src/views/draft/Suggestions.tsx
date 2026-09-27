import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { DataInfo } from "../../data/generated/DataInfo";
import type { DraftView } from "../../data/generated/DraftView";
import type { Reason } from "../../data/generated/Reason";
import type { Suggestion } from "../../data/generated/Suggestion";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { games, percent, signedPoints, timeAgo } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/roles";
import styles from "./Suggestions.module.css";
import { bySize, Segments, WEAK, WhyTerms } from "./Why";

const REASON_PREFIX: Record<Reason["kind"], string> = { base: "", lane: "vs", jungle: "vs", matchup: "vs", duo: "with" };
const CHIPS = 2;

function reasonLabel(reason: Reason, championName: (id: number) => string): string {
  if (reason.kind === "base" || reason.championId === null) return "Strength";
  return `${REASON_PREFIX[reason.kind]} ${championName(reason.championId)}`;
}

/** Largest solid effects first; a weak one only shows when nothing solid is left. */
function topReasons(reasons: readonly Reason[]): Reason[] {
  const solid = (r: Reason) => (r.kept >= WEAK ? 1 : 0);
  return [...bySize(reasons)].sort((a, b) => solid(b) - solid(a)).slice(0, CHIPS);
}

function tone(points: number): string {
  if (Math.abs(points) < 0.05) return styles.flat ?? "";
  return (points > 0 ? styles.up : styles.down) ?? "";
}

function tierLabel(index: number, size: number): string {
  if (index > 0) return `Tier ${index + 1}`;
  return size > 1 ? "Best · statistically tied" : "Best";
}

function Row(props: { s: Suggestion; selected: boolean; expanded: boolean; onSelect: () => void }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? `Champion ${id}`;
  const reasons = () => topReasons(props.s.reasons);
  return (
    <li class={`${styles.item} ${props.selected ? styles.selected : ""}`}>
      <button
        type="button"
        class={`${styles.row} ${props.s.tier > 0 ? styles.lower : ""}`}
        aria-pressed={props.selected}
        onClick={() => props.onSelect()}
        data-testid="suggestion"
      >
        <ChampionIcon championId={props.s.championId} size={40} />
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
          <For each={reasons()}>
            {(r, i) => (
              <>
                <span class={`${styles.chip} num`}>
                  {reasonLabel(r, name)} <span class={r.kept < WEAK ? styles.weak : tone(r.points)}>{signedPoints(r.points)}</span>
                  {i() < reasons().length - 1 ? " ·" : ""}
                </span>{" "}
              </>
            )}
          </For>
        </span>
        <span class={`${styles.estimate} num`}>
          <span class={styles.pct}>{props.s.estimate.percent.toFixed(1)}%</span>
          <span class={styles.caption}>
            <span class={`${styles.gain} ${tone(props.s.gain)}`}>{signedPoints(props.s.gain)}</span> · ±{" "}
            {props.s.estimate.plusMinus.toFixed(1)}
          </span>
        </span>
      </button>
      {/* Narrow windows have no side panel: a tapped pick explains itself in place. */}
      <Show when={props.expanded}>
        <div class={styles.inline}>
          <WhyTerms suggestion={props.s} class={styles.inlineTerms} />
        </div>
      </Show>
    </li>
  );
}

function DataLine(props: { data: DataInfo }): JSX.Element {
  return (
    <Segments
      class={styles.footer}
      items={[
        { text: props.data.bracket },
        { text: `Patch ${props.data.patch}` },
        { text: `${games(props.data.games)} games` },
        { text: `updated ${timeAgo(props.data.updatedAt)}` },
      ]}
    />
  );
}

export function Suggestions(props: {
  draft: DraftView;
  selected: number | undefined;
  /** Pick whose terms show under its row on narrow windows. */
  expanded?: number | undefined;
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
        <Show when={props.draft.team}>
          {(team) => (
            <span class={`${styles.teamNow} num`}>
              Team now <b>{team().percent.toFixed(1)}%</b> ± {team().plusMinus.toFixed(1)}
            </span>
          )}
        </Show>
      }
      flush={props.draft.suggestions.length > 0}
      scroll
    >
      <Show
        when={props.draft.suggestions.length > 0}
        fallback={
          <EmptyState
            icon="draft"
            title={props.draft.data ? "No suggestions yet" : "Stats not available yet"}
            text={
              props.draft.data
                ? "Suggestions appear once your role is known."
                : "Pick suggestions need champion stats, which download once our stats service is live."
            }
          />
        }
      >
        <ol class={styles.list}>
          <For each={tiers()}>
            {(group, i) => (
              <li class={styles.group}>
                <div class={styles.tier}>{tierLabel(i(), group.length)}</div>
                <ol class={styles.rows}>
                  <For each={group}>
                    {(s) => (
                      <Row
                        s={s}
                        selected={props.selected === s.championId}
                        expanded={props.expanded === s.championId}
                        onSelect={() => props.onSelect(s.championId)}
                      />
                    )}
                  </For>
                </ol>
              </li>
            )}
          </For>
        </ol>
        <Show when={props.draft.data}>{(data) => <DataLine data={data()} />}</Show>
      </Show>
    </Card>
  );
}
