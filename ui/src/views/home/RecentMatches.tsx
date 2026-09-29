import { createEffect, createSignal, For, type JSX, lazy, Show, Suspense } from "solid-js";
import { useData } from "../../data/context";
import type { LpGame } from "../../data/generated/LpGame";
import type { MatchGrade } from "../../data/generated/MatchGrade";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { RiotId } from "../../data/generated/RiotId";
import { Card } from "../../design/Card";
import { ChampionIcon, ItemIcon } from "../../design/GameIcon";
import { EmptyState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { groupByDay } from "../../lib/days";
import { duration, kda, kdaRatio, perMinute, queueName, REMAKE_MAX_SECONDS, signedPoints, timeAgo } from "../../lib/format";
import { GradeChip } from "./GradeChip";
import styles from "./RecentMatches.module.css";

const ITEM_SLOTS = 6;

/**
 * What an opened row, a grade's why and the last game's summary need (`MatchDetails.tsx`,
 * `PostGame.tsx`), loaded on first use.
 */
type Details = Pick<typeof import("./MatchDetails") & typeof import("./PostGame"), "MatchDetails" | "hint" | "PostGameCard">;
let load: () => Promise<Details>;
let loading: Promise<Details> | undefined;

/**
 * Where that code comes from: the app hands in the player page's chunk, which carries it (with
 * the views' words; see App.tsx). A chunk of its own, imported from here, would split the chunks
 * it shares with the first screen and weigh on the app's first load.
 */
export function provideDetails(from: () => Promise<Details>): void {
  load = from;
}
export const chunk = () => (loading ??= load());
const Details = lazy(() => chunk().then((m) => ({ default: m.MatchDetails })));

/** DPM-style KDA coloring: perfect, great ≥ 5, good ≥ 3, poor < 1.5. */
function kdaBand(value: number | null): string {
  if (value === null) return styles.perfect ?? "";
  if (value >= 5) return styles.kdaGreat ?? "";
  if (value >= 3) return styles.kdaGood ?? "";
  if (value < 1.5) return styles.kdaPoor ?? "";
  return "";
}

function MatchRow(props: {
  match: MatchSummary;
  grade: MatchGrade | null;
  /** The LP it was worth (your ranked games MVP followed). */
  lp?: LpGame | undefined;
  open: boolean;
  focus: RiotId | undefined;
  onToggle: (row: HTMLElement) => void;
  onClose: () => void;
}): JSX.Element {
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
        aria-expanded={props.open}
        onClick={(e) => props.onToggle(e.currentTarget)}
      >
        <ChampionIcon championId={m().championId} size={40} />
        <span class={styles.outcome}>
          <span class={styles.result}>
            {t().matches.outcome[outcome()]}
            <Show when={props.lp}>
              {(lp) => (
                <span class={`${styles.lp} num`} data-lp={Math.sign(lp().delta)}>
                  {t().matches.lp(signedPoints(lp().delta, 0))}
                </span>
              )}
            </Show>
          </span>
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
      <Show when={props.open}>
        {/* Its height is the table's: nothing moves when the game arrives. */}
        <Suspense fallback={<Skeleton height="540px" />}>
          <Details matchId={m().matchId} focus={props.focus} onClose={props.onClose} />
        </Suspense>
      </Show>
    </li>
  );
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
  /** The LP each game was worth, when known (your ranked games). */
  lp?: ((matchId: string) => LpGame | undefined) | undefined;
  /** Above the list: the history's filters. */
  filters?: JSX.Element;
  /** Instead of the empty state: when filters leave no game. */
  empty?: JSX.Element;
  /** Under the list: loading older games. */
  footer?: JSX.Element;
}): JSX.Element {
  const { transport } = useData();
  const hasMatches = () => props.matches.length > 0;
  // One game open at a time; a second click, or Escape, closes it.
  const [open, setOpen] = createSignal<string>();
  // Your own games come without their grades (a grade needs the whole game): the core reads them
  // from the client after the list, once. Their chips wait empty meanwhile. Only the rows shown
  // are asked for (filters, older games), each once per list the core sent.
  const answered = new WeakMap<MatchSummary, MatchGrade | null>();
  const [answers, setAnswers] = createSignal(0);
  createEffect(() => {
    const wanted = props.matches.filter((m) => !m.grade && m.durationSeconds > REMAKE_MAX_SECONDS && !answered.has(m));
    if (wanted.length === 0) return;
    for (const m of wanted) answered.set(m, null);
    void transport.call("match_grades", { matchIds: wanted.map((m) => m.matchId) }).then(
      (list) => {
        const grades = new Map(list.map((g) => [g.matchId, g.grade]));
        for (const m of wanted) answered.set(m, grades.get(m.matchId) ?? null);
        setAnswers((n) => n + 1);
      },
      () => {
        // Chips stay empty: grades are extra.
      },
    );
  });
  const gradeOf = (m: MatchSummary) => {
    answers(); // the answers so far
    return m.grade ?? answered.get(m) ?? null;
  };

  const toggle = (id: string, row: HTMLElement) => {
    // The clicked row stays where it is when a game above it closes.
    const before = row.getBoundingClientRect().top;
    setOpen((current) => (current === id ? undefined : id));
    row.closest("main")?.scrollBy(0, row.getBoundingClientRect().top - before);
  };
  // A grade's why shows while it's hovered, or its row has the keyboard focus: the chunk follows
  // the list's pointer and focus events.
  const find = (id: string) => {
    const match = props.matches.find((m) => m.matchId === id);
    const grade = match && gradeOf(match);
    return match && grade ? { match, grade } : undefined;
  };
  const hint = (e: Event) => void chunk().then((m) => m.hint(e, find));

  return (
    <Card title={t().matches.title} flush={hasMatches() || !!props.filters}>
      {props.filters}
      <Show
        when={hasMatches()}
        fallback={props.empty ?? <EmptyState icon="history" title={t().matches.empty.title} text={t().matches.empty.text} />}
      >
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
                        lp={props.lp?.(match.matchId)}
                        open={open() === match.matchId}
                        focus={props.focus}
                        onToggle={(row) => toggle(match.matchId, row)}
                        onClose={() => setOpen(undefined)}
                      />
                    )}
                  </For>
                </ol>
              </li>
            )}
          </For>
        </ol>
      </Show>
      {props.footer}
    </Card>
  );
}
