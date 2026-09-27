import { For, type JSX, Show } from "solid-js";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import { Card } from "../../design/Card";
import { ChampionIcon, ItemIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { duration, kdaRatio, perMinute, queueName, REMAKE_MAX_SECONDS, timeAgo } from "../../lib/format";
import styles from "./RecentMatches.module.css";

const ITEM_SLOTS = 6;

function MatchRow(props: { match: MatchSummary }): JSX.Element {
  const m = () => props.match;
  const remake = () => m().durationSeconds <= REMAKE_MAX_SECONDS;
  const outcome = () => (remake() ? "remake" : m().win ? "win" : "loss");
  const label = { win: "Victory", loss: "Defeat", remake: "Remake" } as const;
  const ratio = () => kdaRatio(m().kills, m().deaths, m().assists);
  const slots = () => Array.from({ length: ITEM_SLOTS }, (_, i) => m().items[i]);

  return (
    <li class={`${styles.row} ${styles[outcome()]}`} data-testid="match-row" data-outcome={outcome()}>
      <ChampionIcon championId={m().championId} size={44} />
      <div class={styles.outcome}>
        <span class={styles.result}>{label[outcome()]}</span>
        <span class={styles.sub}>
          {queueName(m().queueId)} · {timeAgo(m().endedAt)}
        </span>
      </div>
      <div class={`${styles.kda} num`}>
        <span class={styles.kdaLine}>
          {m().kills} / <span class={styles.deaths}>{m().deaths}</span> / {m().assists}
        </span>
        <span class={`${styles.ratio} ${ratio() === "Perfect" ? styles.perfect : ""}`}>
          {ratio() === "Perfect" ? "Perfect KDA" : `${ratio()} KDA`}
        </span>
      </div>
      <div class={`${styles.cs} num`}>
        <span>{m().creepScore} CS</span>
        <span class={styles.sub}>{perMinute(m().creepScore, m().durationSeconds)}/min</span>
      </div>
      <div class={styles.items}>
        <For each={slots()}>{(id) => <ItemIcon itemId={id} size={24} />}</For>
      </div>
      <span class={`${styles.duration} num`}>{duration(m().durationSeconds)}</span>
    </li>
  );
}

export function RecentMatches(props: { matches: readonly MatchSummary[] }): JSX.Element {
  return (
    <Card title={`Recent matches · ${props.matches.length}`} flush>
      <Show
        when={props.matches.length > 0}
        fallback={<EmptyState icon="sparkles" title="No recent games" text="Your games will show up here as soon as you finish one." />}
      >
        <ol class={styles.list}>
          <For each={props.matches}>{(match) => <MatchRow match={match} />}</For>
        </ol>
      </Show>
    </Card>
  );
}
