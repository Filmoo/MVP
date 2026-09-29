import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { DataInfo } from "../../data/generated/DataInfo";
import type { DraftView } from "../../data/generated/DraftView";
import type { Reason } from "../../data/generated/Reason";
import type { Suggestion } from "../../data/generated/Suggestion";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { t } from "../../i18n";
import { decimal, percent, percentOf100, signedPoints, timeAgo } from "../../lib/format";
import { bracketName } from "../../lib/stats";
import { TopAugments } from "../mayhem/parts";
import styles from "./Suggestions.module.css";
import { bySize, Segments, WEAK, WhyTerms } from "./Why";

const CHIPS = 2;
/** ARAM's stats queue. */
const ARAM = 450;
/** The row's delta bar spans ±5 points around "team now". */
const DELTA_SCALE = 5;

function reasonLabel(reason: Reason, championName: (id: number) => string): string {
  if (reason.kind === "base" || reason.championId === null) return t().draft.strength;
  const name = championName(reason.championId);
  return reason.kind === "duo" ? t().draft.with(name) : t().draft.vs(name);
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
  if (index > 0) return t().draft.tier(index + 1);
  return t().draft.best(size > 1);
}

/**
 * Your line next to the name: your games on this pick in the role, else your mastery of it; in
 * ARAM, the champion you have now says so.
 */
function yourLine(s: Suggestion, yours: number | undefined): string | undefined {
  if (s.championId === yours) return s.mastery ? t().draft.yoursMastery(s.mastery.level) : t().draft.yours;
  if (s.mine) return t().draft.yourGames(s.mine.games, percent(s.mine.wins / s.mine.games));
  if (s.mastery) return t().draft.yourMastery(s.mastery.level);
  return undefined;
}

function masteryTitle(s: Suggestion): string | undefined {
  if (!s.mastery) return undefined;
  return t().draft.masteryTitle(s.mastery.level, s.mastery.points);
}

function Row(props: {
  s: Suggestion;
  selected: boolean;
  expanded: boolean;
  /** ARAM: the champion you have now. */
  yours?: number | undefined;
  /** ARAM: Mayhem: the champion's most picked augments show under its line. */
  mayhem?: boolean;
  onSelect: () => void;
}): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const reasons = () => topReasons(props.s.reasons);
  return (
    <li class={`${styles.item} ${props.selected ? styles.selected : ""}`}>
      <button
        type="button"
        class={`${styles.row} ${props.s.tier > 0 ? styles.lower : ""} ${props.mayhem ? styles.augmented : ""}`}
        data-glass
        aria-pressed={props.selected}
        onClick={() => props.onSelect()}
        data-testid="suggestion"
      >
        <ChampionIcon championId={props.s.championId} size={40} />
        <span class={styles.nameLine}>
          <span class={styles.name}>{name(props.s.championId)}</span>
          <Show when={yourLine(props.s, props.yours)}>
            {(line) => (
              <span class={`${styles.mine} num`} title={masteryTitle(props.s)}>
                {line()}
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
        <Show when={props.mayhem}>
          <span class={styles.augments}>
            <TopAugments championId={props.s.championId} name={name(props.s.championId)} />
          </span>
        </Show>
        <span class={styles.delta} aria-hidden="true" data-free-style>
          <span
            class={`${styles.deltaFill} ${props.s.gain >= 0 ? styles.deltaUp : styles.deltaDown}`}
            style={
              props.s.gain >= 0
                ? { left: "50%", width: `${(Math.min(Math.abs(props.s.gain), DELTA_SCALE) / DELTA_SCALE) * 50}%` }
                : { right: "50%", width: `${(Math.min(Math.abs(props.s.gain), DELTA_SCALE) / DELTA_SCALE) * 50}%` }
            }
          />
        </span>
        <span class={`${styles.estimate} num`}>
          <span class={styles.pct}>{percentOf100(props.s.estimate.percent)}</span>
          <span class={styles.caption}>
            <span class={`${styles.gain} ${tone(props.s.gain)}`}>{signedPoints(props.s.gain)}</span> · ±{" "}
            {decimal(props.s.estimate.plusMinus, 1)}
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

function DataLine(props: { data: DataInfo; rerolls: number | null }): JSX.Element {
  return (
    <Segments
      class={styles.footer}
      items={[
        ...(props.data.queue === ARAM ? [{ text: t().queues[ARAM] }] : []),
        { text: bracketName(props.data.bracket) },
        { text: t().common.patch(props.data.patch) },
        { text: t().common.games(props.data.games) },
        { text: t().common.updated(timeAgo(props.data.updatedAt)) },
        ...(props.rerolls === null ? [] : [{ text: t().draft.rerolls(props.rerolls) }]),
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
  const aram = () => props.draft.queue === ARAM;
  const yours = () => (aram() ? (props.draft.allies.find((slot) => slot.isMe)?.championId ?? undefined) : undefined);
  const empty = () => {
    if (!props.draft.data) return t().draft.noStats;
    return aram() ? t().draft.aramWaiting : t().draft.noSuggestions;
  };
  const tiers = () => {
    const groups: Suggestion[][] = [];
    for (const s of props.draft.suggestions) {
      const group = groups[s.tier] ?? [];
      group.push(s);
      groups[s.tier] = group;
    }
    return groups.filter((g) => g.length > 0);
  };
  return (
    <Card
      title={aram() ? t().draft.aramPicks : t().draft.picksFor(props.draft.myRole)}
      actions={
        <Show when={props.draft.team}>
          {(team) => (
            <span class={`${styles.teamNow} num`} title={t().draft.teamNow(percentOf100(team().percent))}>
              {t().draft.ifPicked}
            </span>
          )}
        </Show>
      }
      flush={props.draft.suggestions.length > 0}
      scroll
    >
      <Show when={props.draft.suggestions.length > 0} fallback={<EmptyState icon="draft" title={empty().title} text={empty().text} />}>
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
                        yours={yours()}
                        mayhem={props.draft.mode === "mayhem"}
                        onSelect={() => props.onSelect(s.championId)}
                      />
                    )}
                  </For>
                </ol>
              </li>
            )}
          </For>
        </ol>
        <Show when={props.draft.data}>{(data) => <DataLine data={data()} rerolls={props.draft.rerolls} />}</Show>
      </Show>
    </Card>
  );
}
