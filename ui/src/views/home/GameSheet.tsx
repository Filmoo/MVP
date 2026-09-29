/**
 * An opened game: a sheet of liquid glass over the page (design/liquid "panel": the page behind
 * bent along its rim, frosted in its middle), a modal dialog labelled by the game's title. Its
 * head (result, queue, champion, duration, when) shows at once, from the row; the whole game
 * (both teams, every grade and its why, each named player a link to their page) and the
 * end-of-game stats once loaded.
 *
 * It closes on Escape, a click outside, its close button, a player's link (their page opens),
 * and by scrolling (pull.ts): scrolling on past its end or its top pulls it along with
 * resistance under a hint; a big enough pull closes it, a smaller one springs back. With
 * reduced motion it stays put, the hint and the threshold still work. The focus stays inside
 * while it is open (the page behind is inert) and goes back to the row after. Only transform and
 * opacity animate, and nothing runs while nothing moves.
 *
 * The chunk of an opened game (RecentMatches.tsx loads it on first use, with the views' words).
 */
import { createResource, type JSX, onCleanup, onMount, Show } from "solid-js";
import { navigate } from "../../app/router";
import { useData } from "../../data/context";
import type { BackendError } from "../../data/generated/BackendError";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { RiotId } from "../../data/generated/RiotId";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { liquid } from "../../design/liquid/liquid";
import { ErrorState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { dayLabel } from "../../lib/days";
import { duration, queueName, REMAKE_MAX_SECONDS } from "../../lib/format";
import { Widget } from "../../widgets/Widget";
import styles from "./GameSheet.module.css";
import { MatchTable, markedIn } from "./MatchDetails";
import { MatchStats } from "./MatchStats";
import { RELEASE_MS, rubber, TOUCH_CLOSE, touchPull, WHEEL_CLOSE, wheelPull } from "./pull";

export { hint } from "./MatchDetails";

/** How the sheet leaves: pulled past its end (up), past its top (down), or dismissed. */
type Exit = "up" | "down" | "away";

export function GameSheet(props: { match: MatchSummary; focus: RiotId | undefined; onClosed: () => void }): JSX.Element {
  const { transport, gameData } = useData();
  const [game, { refetch }] = createResource(
    () => props.match.matchId,
    (matchId) => transport.call("match_details", { matchId }),
  );
  // Read only once ready: a pending resource would suspend the list around the sheet.
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
  const when = () => {
    const ended = new Date(m().endedAt);
    return t().matchDetails.playedAt(dayLabel(m().endedAt), ended.getHours(), ended.getMinutes());
  };

  let dialog!: HTMLDialogElement;
  let panel!: HTMLDivElement;
  let body!: HTMLDivElement;
  let cue!: HTMLDivElement;
  let closing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Leaves by `exit` (at once before `then`: a player's page opens), then gives the focus back to the row. */
  const close = (exit: Exit, then?: () => void) => {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    const row = `match-${m().matchId}`;
    dialog.dataset.closing = exit;
    const done = () => {
      dialog.close();
      props.onClosed();
      if (then) then();
      else document.getElementById(row)?.focus({ preventScroll: true });
    };
    const leaving = then ? [] : panel.getAnimations();
    if (leaving.length > 0) void Promise.all(leaving.map((a) => a.finished)).then(done, done);
    else done();
  };
  const openPlayer = (path: string) => close("away", () => navigate(path));

  // ── Scroll to close ──────────────────────────────────────────────────────────────────────────
  let pulled = 0;
  /** Shows a pull of `distance` px (+ past the end) out of `limit`; 0 lets go (it springs back). */
  const draw = (distance: number, limit: number, how: "wheel" | "touch") => {
    if (distance === pulled) return;
    pulled = distance;
    if (distance) {
      dialog.dataset.pulling = how;
      cue.dataset.edge = distance > 0 ? "end" : "top";
      // Its bar fills up to the close.
      cue.style.setProperty("--progress", `${Math.min(1, Math.abs(distance) / limit)}`);
    } else {
      delete dialog.dataset.pulling;
    }
    // Reduced motion: the sheet stays put, the hint says it all.
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.style.translate = distance && !still ? `0 ${-rubber(distance)}px` : "";
  };
  const edges = () => ({ atTop: body.scrollTop <= 0, atEnd: body.scrollHeight - body.clientHeight - body.scrollTop <= 1 });

  const wheel = wheelPull();
  const onWheel = (e: WheelEvent) => {
    // Zooming and sideways scrolling (the stats table) aren't pulls.
    if (closing || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const distance = wheel.wheel(e.timeStamp, e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY, edges());
    clearTimeout(timer);
    if (Math.abs(distance) >= WHEEL_CLOSE) return close(distance > 0 ? "up" : "down");
    draw(distance, WHEEL_CLOSE, "wheel");
    if (distance) {
      timer = setTimeout(() => {
        wheel.release();
        draw(0, WHEEL_CLOSE, "wheel");
      }, RELEASE_MS);
    }
  };

  const touch = touchPull();
  let dragged = 0;
  const onTouchStart = (e: TouchEvent) => {
    const finger = e.touches[0];
    if (finger && e.touches.length === 1) touch.start(finger.clientY);
    dragged = 0;
  };
  const onTouchMove = (e: TouchEvent) => {
    const finger = e.touches[0];
    if (closing || !finger || e.touches.length > 1) return;
    dragged = touch.move(finger.clientY, edges());
    // The pull moves the sheet, not the page.
    if (dragged && e.cancelable) e.preventDefault();
    draw(dragged, TOUCH_CLOSE, "touch");
  };
  const onTouchEnd = () => {
    if (Math.abs(dragged) >= TOUCH_CLOSE) close(dragged > 0 ? "up" : "down");
    else if (dragged) draw(0, TOUCH_CLOSE, "touch");
    dragged = 0;
  };

  // ── Keyboard and pointer ─────────────────────────────────────────────────────────────────────
  /**
   * Escape: a tooltip showing goes first (design/tip closes it alone, stopping the key), then the
   * sheet. Heard before anything else (the window, capturing), so the dialog's own close never
   * runs: the sheet leaves its way, whatever else hears the key.
   */
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !dialog.open) return;
    e.preventDefault();
    if (!document.querySelector("[role=tooltip]:popover-open")) close("away");
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    // The focus stays in the sheet: past its last stop back to its first, and the other way.
    const stops = [...dialog.querySelectorAll<HTMLElement>("a[href], button, [tabindex='0']")].filter(
      (el) => el.getClientRects().length > 0,
    );
    if (document.activeElement === (e.shiftKey ? stops[0] : stops.at(-1))) {
      e.preventDefault();
      (e.shiftKey ? stops.at(-1) : stops[0])?.focus();
    }
  };
  /** A click outside: pressed and released on the dialog's own box (the page around the sheet). */
  let pressedOutside = false;

  onMount(() => {
    dialog.showModal();
    // The keyboard scrolls the game at once.
    body.focus({ preventScroll: true });
    window.addEventListener("keydown", onEscape, true);
    panel.addEventListener("wheel", onWheel, { passive: true });
    panel.addEventListener("touchstart", onTouchStart, { passive: true });
    panel.addEventListener("touchmove", onTouchMove, { passive: false });
    panel.addEventListener("touchend", onTouchEnd);
    panel.addEventListener("touchcancel", onTouchEnd);
  });
  onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener("keydown", onEscape, true);
    if (dialog.open) dialog.close();
  });

  return (
    <dialog
      ref={dialog}
      class={styles.sheet}
      aria-modal="true"
      aria-labelledby="game-title"
      data-testid="game-sheet"
      onPointerDown={(e) => {
        pressedOutside = e.target === dialog;
      }}
      onClick={(e) => {
        if (pressedOutside && e.target === dialog) close("away");
      }}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        close("away");
      }}
      // Closed some other way (the browser's own close): the list still hears it.
      onClose={() => {
        if (closing) return;
        closing = true;
        props.onClosed();
      }}
    >
      <div ref={panel} class={`${styles.panel} glass-rim`} data-testid="game">
        <div class={styles.glass} aria-hidden="true" ref={(el) => liquid(el, "panel")} />
        <header class={styles.head}>
          <ChampionIcon championId={m().championId} size={40} />
          <div class={styles.heading}>
            <h2 id="game-title" class={styles.title}>
              <span class={styles[outcome()]}>{t().matches.outcome[outcome()]}</span> · {queueName(m().queueId)}
            </h2>
            <p class={`${styles.meta} num`}>
              {champion()} · {duration(m().durationSeconds)} · {when()}
            </p>
          </div>
          <button type="button" class={styles.close} aria-label={t().matchDetails.close} onClick={() => close("away")}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <div class={styles.main}>
          <div ref={body} class={styles.body} tabindex="-1" aria-busy={game.loading} data-testid="game-body">
            <Widget name="match-details">
              <Show
                when={!game.error}
                fallback={
                  <Show when={failure().retry} fallback={<ErrorState title={failure().title} message={failure().text} />}>
                    <ErrorState title={failure().title} message={failure().text} onRetry={() => void refetch()} />
                  </Show>
                }
              >
                {/* The tables' exact height: nothing moves when the game arrives. */}
                <Show when={ready()} fallback={<Skeleton height="540px" />}>
                  {(g) => <MatchTable game={g()} focus={props.focus} onPlayer={openPlayer} />}
                </Show>
              </Show>
            </Widget>
            <Show when={ready()}>
              {(g) => (
                <Widget name="match-stats" class={styles.stats}>
                  <h3 id="game-stats" class={styles.statsTitle}>
                    {t().matchDetails.stats.title}
                  </h3>
                  <MatchStats game={g()} marked={markedIn(g(), props.focus)} />
                </Widget>
              )}
            </Show>
          </div>
        </div>
      </div>
      {/* Over the sheet's edge, in the room its pull opens (and over it when it can't move). */}
      <div ref={cue} class={styles.cue} aria-hidden="true" data-testid="scroll-cue">
        <Icon name="arrowDown" size={16} />
        {t().matchDetails.keepScrolling}
      </div>
    </dialog>
  );
}
