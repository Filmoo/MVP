/**
 * One window of the stack of opened games (GameStack.tsx): a game of the history in liquid glass.
 * Its head says the game at once, from its row: result and queue, the LP it was worth, champion,
 * role, length and when, and the grade of the player whose games these are with what moved it.
 * Then its tabs: the scoreboard (both teams, each named player a link to their page) and the
 * end-of-game stats, a few groups a tab (MatchStats.tsx). Nothing scrolls in it: every tab fits
 * the window (the tables' lines share its height, their columns give way as it narrows). The game
 * is asked for when the window is built (the current game or a neighbour), once while the stack is
 * open.
 */
import { createMemo, createResource, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { BackendError } from "../../data/generated/BackendError";
import type { LpGame } from "../../data/generated/LpGame";
import type { MatchDetails } from "../../data/generated/MatchDetails";
import type { MatchGrade } from "../../data/generated/MatchGrade";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { RiotId } from "../../data/generated/RiotId";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { liquid } from "../../design/liquid/liquid";
import { Segmented } from "../../design/Segmented";
import { ErrorState, Skeleton } from "../../design/States";
import { TierBadge } from "../../design/TierBadge";
import { t } from "../../i18n";
import { dayLabel } from "../../lib/days";
import { decimal, duration, queueName, REMAKE_MAX_SECONDS, signedPoints } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import { Widget } from "../../widgets/Widget";
import styles from "./GameStack.module.css";
import { GradeChip } from "./GradeChip";
import { factorWords, MatchTable, markedIn, type OpenPlayer } from "./MatchDetails";
import { MatchStats, STAT_TABS, type StatTab, statRows, tabName } from "./MatchStats";

/** A window's tabs: its scoreboard, then its end-of-game stats. */
export type Tab = "scoreboard" | StatTab;
const STATS = Object.keys(STAT_TABS) as StatTab[];

export interface WindowProps {
  match: MatchSummary;
  /** Its place in the history, newest first: where it sits in the stack. */
  slot: number;
  /**
   * The current game's window (0), or a neighbour peeking at the stack's top (−1, the newer game)
   * or bottom (+1, the older one), inert.
   */
  place: number;
  /** The player whose games these are: their line is marked, their grade and LP head the window. */
  focus: RiotId | undefined;
  grade: MatchGrade | null;
  lp: LpGame | undefined;
  lpPending: boolean;
  /** The tab chosen, the stack's: it stays from game to game. */
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** A narrow window: the stats turn around (MatchStats.tsx). */
  narrow: boolean;
  /** Games read while the stack is open: going back to one doesn't ask again. */
  cache: Map<string, MatchDetails>;
  onPlayer: OpenPlayer;
  onClose: () => void;
}

/** The id of a window's title, which labels it (and the stack while it is the current game). */
export const titleOf = (matchId: string) => `game-title-${matchId}`;

export function GameWindow(props: WindowProps): JSX.Element {
  const { transport, gameData } = useData();
  const id = props.match.matchId;
  const [game, { refetch }] = createResource(
    () => props.match.matchId,
    (matchId) =>
      props.cache.get(matchId) ??
      transport.call("match_details", { matchId }).then((read) => {
        props.cache.set(matchId, read);
        return read;
      }),
  );
  // Read only once ready: a pending resource would suspend the list around the stack.
  const ready = () => (game.state === "ready" ? game() : undefined);
  // The core's `BackendError` (anything else reads as unreachable), worded like the other lookups.
  const failure = () => {
    const { players, stats, matchDetails } = t();
    const error: BackendError = (game.error as { detail?: BackendError } | undefined)?.detail ?? { kind: "network", message: "" };
    if (error.kind === "network") return { ...players.network, retry: true };
    if (error.kind === "rateLimited") {
      return { title: stats.errors.rateLimited.title, text: stats.errors.rateLimited.text(error.retryAfter), retry: true };
    }
    return { title: matchDetails.errors.title, text: matchDetails.errors[error.kind], retry: error.kind !== "notFound" };
  };

  const m = () => props.match;
  const outcome = () => (m().durationSeconds <= REMAKE_MAX_SECONDS ? "remake" : m().win ? "win" : "loss");
  const champion = () => gameData()?.champions.get(m().championId)?.name ?? t().common.championN(m().championId);
  /** The line of the player whose games these are, once the game is in. */
  const own = () => {
    const g = ready();
    return g ? markedIn(g, props.focus) : undefined;
  };
  const grade = () => props.grade ?? own()?.grade ?? null;
  const meta = () => {
    const ended = new Date(m().endedAt);
    const role = own()?.role ?? m().role;
    return [
      champion(),
      ...(role ? [roleLabel(role)] : []),
      duration(m().durationSeconds),
      t().matchDetails.playedAt(dayLabel(m().endedAt), ended.getHours(), ended.getMinutes()),
    ].join(" · ");
  };
  /** Promoted or demoted: the tier or division changed. */
  const moved = (lp: LpGame) => {
    if (lp.before.tier === lp.after.tier && lp.before.division === lp.after.division) return undefined;
    return lp.delta > 0 ? t().matchDetails.lp.promoted : t().matchDetails.lp.demoted;
  };

  // Its tabs: the stats it has (while it loads, most likely all of them); none past the scoreboard, no tabs.
  const tabs = createMemo((): Tab[] => {
    const g = ready();
    const stats = game.error ? [] : g ? STATS.filter((tab) => statRows(g, tab).length > 0) : STATS;
    return stats.length > 0 ? ["scoreboard", ...stats] : [];
  });
  const shown = (): Tab => (tabs().includes(props.tab) ? props.tab : "scoreboard");
  const current = () => props.place === 0;

  return (
    <section
      class={`${styles.window} glass-rim`}
      style={{ translate: `0 calc(${props.slot} * (100% + var(--gap)))` }}
      aria-labelledby={titleOf(id)}
      inert={!current() || undefined}
      aria-hidden={current() ? undefined : "true"}
      // It takes the focus when it becomes the current game: the keyboard's keys are the stack's.
      tabindex="-1"
      data-window
      data-place={current() ? "current" : props.place < 0 ? "newer" : "older"}
      data-current={current() ? "" : undefined}
      data-testid="game-window"
      // ←/→ change the tab from anywhere in it (the tabs themselves handle theirs).
      onKeyDown={(e) => {
        const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        const list = tabs();
        if (!by || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || list.length === 0) return;
        e.preventDefault();
        props.onTab(list[(list.indexOf(shown()) + by + list.length) % list.length] ?? "scoreboard");
      }}
    >
      <div class={styles.glass} aria-hidden="true" ref={(el) => liquid(el, "sheet")} />
      {/* A neighbour is a window behind: its glass under a veil. */}
      <div class={styles.veil} aria-hidden="true" />
      <header class={styles.head}>
        <ChampionIcon championId={m().championId} size={48} />
        <div class={styles.heading}>
          <div class={styles.titleLine}>
            <h2 id={titleOf(id)} class={styles.title}>
              <span class={styles[outcome()]}>{t().matches.outcome[outcome()]}</span> · {queueName(m().queueId)}
            </h2>
            <Show when={props.lp}>
              {(lp) => (
                <span class={styles.lp} data-testid="game-lp">
                  <span class={`${styles.delta} num`} data-lp={Math.sign(lp().delta)}>
                    {t().matches.lp(signedPoints(lp().delta, 0))}
                  </span>
                  <span class={`${styles.standing} num`}>
                    <TierBadge tier={lp().after.tier} division={lp().after.division} plain />
                    {t().common.lp(lp().after.leaguePoints)}
                  </span>
                  <Show when={moved(lp())}>
                    {(word) => (
                      <span class={styles.moved} data-lp={Math.sign(lp().delta)}>
                        {word()}
                      </span>
                    )}
                  </Show>
                </span>
              )}
            </Show>
            <Show when={!props.lp && props.lpPending}>
              <span class={styles.pending} data-testid="game-lp">
                {t().matchDetails.lp.pending}
              </span>
            </Show>
          </div>
          <p class={`${styles.meta} num`}>{meta()}</p>
        </div>
        <button
          type="button"
          class={styles.close}
          aria-label={t().matchDetails.close}
          data-hint={t().matchDetails.close}
          onClick={() => props.onClose()}
        >
          <Icon name="close" size={20} />
        </button>
      </header>
      <Show when={grade() || tabs().length > 0}>
        <div class={styles.bar}>
          <Show when={grade()}>
            {(g) => (
              // The grade of the player whose games these are, and the facts that moved it most.
              <div class={styles.grade} data-testid="game-grade">
                <GradeChip grade={g()} />
                <p class={`${styles.score} num`}>
                  {decimal(g().score, 1)} <span class={styles.outOf}>{t().matchDetails.outOf}</span>
                  <span class={g().badge ? styles.badge : styles.place}>
                    {((badge) => (badge ? t().grade[badge] : t().matchDetails.placeOf(t().grade.place(g().place))))(g().badge)}
                  </span>
                </p>
                <ul class={styles.factors}>
                  <For each={g().factors}>
                    {(f) => <li class={`num ${f.points >= 0 ? styles.up : styles.down}`}>{factorWords(f, m().deaths)}</li>}
                  </For>
                </ul>
              </div>
            )}
          </Show>
          <Show when={tabs().length > 0}>
            <Segmented
              size="sm"
              class={styles.tabs}
              label={t().matchDetails.tabs.label}
              options={tabs().map((tab) => ({ value: tab, label: tabName(tab, m().queueId) }))}
              value={shown()}
              onChange={props.onTab}
              testId="game-tabs"
            />
          </Show>
        </div>
      </Show>
      <div class={styles.main}>
        <div class={styles.body} aria-busy={game.loading} data-testid="game-body">
          <Show
            when={!game.error}
            fallback={
              <Show when={failure().retry} fallback={<ErrorState title={failure().title} message={failure().text} />}>
                <ErrorState title={failure().title} message={failure().text} onRetry={() => void refetch()} />
              </Show>
            }
          >
            <Show
              when={shown() !== "scoreboard" && shown()}
              fallback={
                <Widget name="match-details">
                  {/* The tables' exact height: nothing moves when the game arrives. */}
                  <Show when={ready()} fallback={<Skeleton height="min(100cqh, 540px)" />}>
                    {(g) => <MatchTable game={g()} focus={props.focus} onPlayer={props.onPlayer} />}
                  </Show>
                </Widget>
              }
            >
              {(tab) => (
                <Show when={ready()} fallback={<Skeleton height="min(100cqh, 540px)" />}>
                  {(g) => (
                    <Widget name="match-stats">
                      <MatchStats game={g()} tab={tab() as StatTab} marked={markedIn(g(), props.focus)} narrow={props.narrow} />
                    </Widget>
                  )}
                </Show>
              )}
            </Show>
          </Show>
        </div>
      </div>
    </section>
  );
}
