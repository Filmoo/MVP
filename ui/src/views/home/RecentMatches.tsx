import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import { Card } from "../../design/Card";
import { ChampionIcon, ItemIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { groupByDay } from "../../lib/days";
import { duration, kdaRatio, perMinute, queueName, REMAKE_MAX_SECONDS, timeAgo } from "../../lib/format";
import styles from "./RecentMatches.module.css";

const ITEM_SLOTS = 6;

/** DPM-style KDA coloring: great ≥ 5, good ≥ 3, poor < 1.5. */
function kdaBand(ratio: string): string {
  const value = Number(ratio);
  if (value >= 5) return styles.kdaGreat ?? "";
  if (value >= 3) return styles.kdaGood ?? "";
  if (value < 1.5) return styles.kdaPoor ?? "";
  return "";
}

function MatchRow(props: { match: MatchSummary }): JSX.Element {
  const m = () => props.match;
  const remake = () => m().durationSeconds <= REMAKE_MAX_SECONDS;
  const outcome = () => (remake() ? "remake" : m().win ? "win" : "loss");
  const label = { win: "Victory", loss: "Defeat", remake: "Remake" } as const;
  const ratio = () => kdaRatio(m().kills, m().deaths, m().assists);
  const { gameData } = useData();
  const champion = () => gameData()?.champions.get(m().championId)?.name ?? "Unknown";
  const slots = () => Array.from({ length: ITEM_SLOTS }, (_, i) => m().items[i]);

  return (
    <li class={`${styles.row} ${styles[outcome()]}`} data-testid="match-row" data-outcome={outcome()}>
      <ChampionIcon championId={m().championId} size={40} />
      <div class={styles.outcome}>
        <span class={styles.result}>{label[outcome()]}</span>
        <span class={styles.sub}>
          {champion()} · {queueName(m().queueId)}
        </span>
      </div>
      <div class={`${styles.stat} num`}>
        <span class={styles.kdaLine}>
          {m().kills} <span class={styles.slash}>/</span> <span class={styles.deaths}>{m().deaths}</span>{" "}
          <span class={styles.slash}>/</span> {m().assists}
        </span>
        <span class={`${styles.caption} ${ratio() === "Perfect" ? styles.perfect : kdaBand(ratio())}`}>
          {ratio() === "Perfect" ? "Perfect KDA" : `${ratio()} KDA`}
        </span>
      </div>
      <div class={`${styles.stat} ${styles.cs} num`}>
        <span class={styles.value}>
          {m().creepScore} <span class={styles.unit}>CS</span>
        </span>
        <span class={styles.caption}>{perMinute(m().creepScore, m().durationSeconds)} / min</span>
      </div>
      <div class={styles.items}>
        <For each={slots()}>{(id) => <ItemIcon itemId={id} size={20} />}</For>
      </div>
      <span class={`${styles.when} num`}>
        <span class={styles.duration}>{duration(m().durationSeconds)}</span>
        <span class={styles.ago}>{timeAgo(m().endedAt)}</span>
      </span>
    </li>
  );
}

function DayRecord(props: { matches: readonly MatchSummary[] }): JSX.Element {
  const counted = () => props.matches.filter((m) => m.durationSeconds > REMAKE_MAX_SECONDS);
  const wins = () => counted().filter((m) => m.win).length;
  return (
    <Show when={counted().length > 0}>
      <span class={styles.dayRecord}>
        <span class={styles.dayWins}>{wins()}W</span> <span class={styles.dayLosses}>{counted().length - wins()}L</span>
      </span>
    </Show>
  );
}

export function RecentMatches(props: { matches: readonly MatchSummary[] }): JSX.Element {
  const hasMatches = () => props.matches.length > 0;
  return (
    <Card title="Match history" flush={hasMatches()}>
      <Show
        when={hasMatches()}
        fallback={<EmptyState icon="draft" title="No recent games" text="Finish a game and it shows up here, with your stats and build." />}
      >
        <ol class={styles.list}>
          <For each={groupByDay(props.matches, (m) => m.endedAt)}>
            {(day) => (
              <li class={styles.day}>
                <div class={`${styles.dayHead} num`}>
                  <span>{day.label}</span>
                  <DayRecord matches={day.items} />
                </div>
                <ol class={styles.rows}>
                  <For each={day.items}>{(match) => <MatchRow match={match} />}</For>
                </ol>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </Card>
  );
}
