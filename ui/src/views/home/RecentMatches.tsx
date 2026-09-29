import { type Accessor, createResource, createSignal, For, type JSX, lazy, Show, Suspense } from "solid-js";
import { useData } from "../../data/context";
import type { GradedMatch } from "../../data/generated/GradedMatch";
import type { MatchGrade } from "../../data/generated/MatchGrade";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { RiotId } from "../../data/generated/RiotId";
import { Card } from "../../design/Card";
import { ChampionIcon, ItemIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { t } from "../../i18n";
import { groupByDay } from "../../lib/days";
import { duration, kda, kdaRatio, perMinute, queueName, REMAKE_MAX_SECONDS, timeAgo } from "../../lib/format";
import { GradeChip } from "./GradeChip";
import styles from "./RecentMatches.module.css";

const ITEM_SLOTS = 6;

/** What an opened game and a grade's why need (`GameSheet.tsx`), loaded on first use. */
type Details = Pick<typeof import("./GameSheet"), "GameSheet" | "hint">;
let load: () => Promise<Details>;
let loading: Promise<Details> | undefined;

/** Where that code comes from: the app hands in its loader (with the views' words; see App.tsx). */
export function provideDetails(from: () => Promise<Details>): void {
  load = from;
}
const chunk = () => (loading ??= load());
const Sheet = lazy(() => chunk().then((m) => ({ default: m.GameSheet })));

/** DPM-style KDA coloring: perfect, great ≥ 5, good ≥ 3, poor < 1.5. */
function kdaBand(value: number | null): string {
  if (value === null) return styles.perfect ?? "";
  if (value >= 5) return styles.kdaGreat ?? "";
  if (value >= 3) return styles.kdaGood ?? "";
  if (value < 1.5) return styles.kdaPoor ?? "";
  return "";
}

function MatchRow(props: { match: MatchSummary; grade: MatchGrade | null; open: boolean; onOpen: () => void }): JSX.Element {
  const m = () => props.match;
  const remake = () => m().durationSeconds <= REMAKE_MAX_SECONDS;
  const outcome = () => (remake() ? "remake" : m().win ? "win" : "loss");
  const value = () => kda(m().kills, m().deaths, m().assists);
  const { gameData } = useData();
  const champion = () => gameData()?.champions.get(m().championId)?.name ?? t().common.unknown;
  const slots = () => Array.from({ length: ITEM_SLOTS }, (_, i) => m().items[i]);

  return (
    <li data-testid="match-row" data-outcome={outcome()}>
      <button
        type="button"
        id={`match-${m().matchId}`}
        class={`${styles.row} ${styles[outcome()]} glass-pill`}
        data-glass
        aria-haspopup="dialog"
        aria-expanded={props.open}
        onClick={() => props.onOpen()}
      >
        <ChampionIcon championId={m().championId} size={40} />
        <span class={styles.outcome}>
          <span class={styles.result}>{t().matches.outcome[outcome()]}</span>
          <span class={styles.sub}>
            {champion()} · {queueName(m().queueId)}
          </span>
        </span>
        <span class={`${styles.stat} num`}>
          <span class={styles.kdaLine}>
            {m().kills} <span class={styles.slash}>/</span> <span class={styles.deaths}>{m().deaths}</span>{" "}
            <span class={styles.slash}>/</span> {m().assists}
          </span>
          <span class={`${styles.caption} ${kdaBand(value())}`}>
            {value() === null ? t().matches.perfectKda : t().common.kda(kdaRatio(m().kills, m().deaths, m().assists))}
          </span>
        </span>
        <span class={styles.grade} data-grade>
          <Show when={props.grade}>
            {(g) => (
              <>
                <GradeChip grade={g()} />
                <span class={`${styles.place} ${g().badge ? styles.badge : ""}`}>
                  {((badge) => (badge ? t().grade[badge] : t().grade.place(g().place)))(g().badge)}
                </span>
              </>
            )}
          </Show>
        </span>
        <span class={`${styles.stat} ${styles.cs} num`}>
          <span class={styles.value}>
            {m().creepScore} <span class={styles.unit}>CS</span>
          </span>
          <span class={styles.caption}>{t().matches.perMinute(perMinute(m().creepScore, m().durationSeconds))}</span>
        </span>
        <span class={styles.items}>
          <For each={slots()}>{(id) => <ItemIcon itemId={id} size={24} />}</For>
        </span>
        <span class={`${styles.when} num`}>
          <span class={styles.duration}>{duration(m().durationSeconds)}</span>
          <span class={styles.ago}>{timeAgo(m().endedAt)}</span>
        </span>
      </button>
    </li>
  );
}

/** The grades (and roles) of your own games, by match id, once the core has read them. */
export type LateGrades = Accessor<ReadonlyMap<string, GradedMatch> | undefined>;

/**
 * Your own games come without their grades (a grade needs the whole game): the core reads them
 * from the client after the list, once, and answers each game's grade with the role you played
 * there (the list only guesses it). Other players' games come graded: nothing to ask.
 */
export function createLateGrades(matches: Accessor<readonly MatchSummary[]>): LateGrades {
  const { transport } = useData();
  const [late] = createResource(
    () => {
      const ids = matches()
        .filter((m) => !m.grade && m.durationSeconds > REMAKE_MAX_SECONDS)
        .map((m) => m.matchId);
      return ids.length > 0 && ids;
    },
    (matchIds) =>
      transport.call("match_grades", { matchIds }).then(
        (list) => new Map(list.map((g) => [g.matchId, g])),
        () => new Map<string, GradedMatch>(),
      ),
  );
  // Read only once ready: a pending resource would suspend the page.
  return () => (late.state === "ready" ? late() : undefined);
}

function DayRecord(props: { matches: readonly MatchSummary[] }): JSX.Element {
  const counted = () => props.matches.filter((m) => m.durationSeconds > REMAKE_MAX_SECONDS);
  const wins = () => counted().filter((m) => m.win).length;
  return (
    <Show when={counted().length > 0}>
      <span class={styles.dayRecord}>
        <span class={styles.dayWins}>{t().common.wins(wins())}</span>{" "}
        <span class={styles.dayLosses}>{t().common.losses(counted().length - wins())}</span>
      </span>
    </Show>
  );
}

export function RecentMatches(props: {
  matches: readonly MatchSummary[];
  /** The player whose games these are: their line is marked in an opened game. */
  focus?: RiotId | undefined;
  /** Your own games' grades, read after the list (`createLateGrades`): their chips wait empty meanwhile. */
  late?: LateGrades | undefined;
}): JSX.Element {
  const hasMatches = () => props.matches.length > 0;
  // A row opens its game in a sheet over the page (GameSheet.tsx), one at a time.
  const [open, setOpen] = createSignal<MatchSummary>();
  const gradeOf = (m: MatchSummary) => m.grade ?? props.late?.()?.get(m.matchId)?.grade ?? null;
  // A grade's why shows while it's hovered, or its row has the keyboard focus: the chunk follows
  // the list's pointer and focus events.
  const find = (id: string) => {
    const match = props.matches.find((m) => m.matchId === id);
    const grade = match && gradeOf(match);
    return match && grade ? { match, grade } : undefined;
  };
  const hint = (e: Event) => void chunk().then((m) => m.hint(e, find));

  return (
    <Card title={t().matches.title} flush={hasMatches()}>
      <Show when={hasMatches()} fallback={<EmptyState icon="history" title={t().matches.empty.title} text={t().matches.empty.text} />}>
        <ol class={styles.list} onPointerOver={hint} onPointerOut={hint} onFocusIn={hint} onFocusOut={hint}>
          <For each={groupByDay(props.matches, (m) => m.endedAt)}>
            {(day) => (
              <li class={styles.day}>
                <div class={`${styles.dayHead} num`}>
                  <span>{day.label}</span>
                  <DayRecord matches={day.items} />
                </div>
                <ol class={styles.rows}>
                  <For each={day.items}>
                    {(match) => (
                      <MatchRow
                        match={match}
                        grade={gradeOf(match)}
                        open={open()?.matchId === match.matchId}
                        onOpen={() => setOpen(match)}
                      />
                    )}
                  </For>
                </ol>
              </li>
            )}
          </For>
        </ol>
        <Show when={open()}>
          {(match) => (
            // Nothing to see while its code loads, but the page says it is loading (tests wait).
            <Suspense fallback={<div data-state="loading" hidden />}>
              <Sheet match={match()} focus={props.focus} onClosed={() => setOpen(undefined)} />
            </Suspense>
          )}
        </Show>
      </Show>
    </Card>
  );
}
