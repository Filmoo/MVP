/**
 * Opened games: a stack of windows of liquid glass over the page (GameWindow.tsx), one per game of
 * the history and in its order, newest on top. The current window covers the page beside the rail
 * and under the title bar but for a small margin, the page behind bent along its rim and frosted in
 * its middle; its neighbours peek at the stack's top and bottom edges (a click on one goes there).
 *
 * A window's game scrolls first. Going on past its end moves to the next, older game, past its top
 * to the newer one: by wheel (a deliberate pull, with resistance, then the stack glides on), by
 * finger, or by keyboard (↑/↓, PageUp/PageDown, Space: the game, then the next one; Home/End: the
 * newest and the oldest game loaded). Past the newest game's top a pull closes the stack; past the
 * last game loaded it loads older ones (the history's "load more"), then moves on to them; at the
 * very end it only gives, like a rubber band. What each pull does is decided in stack.ts
 * (unit-tested); a hint says it while pulling.
 *
 * Only the current window and its neighbours are built, and their games asked for. A modal dialog
 * labelled by the current game's title: the page behind is inert, the focus stays in the current
 * window and goes back to its game's row after. It closes on Escape, a click around the window, its
 * close button, a player's link (their page opens) and the pull past the newest game. Only transform
 * and opacity move; nothing runs while nothing moves (reduced motion: the stack jumps, pulls don't
 * move it, the hint and the thresholds still work).
 *
 * The chunk of an opened game (RecentMatches.tsx loads it on first use, with the views' words).
 */
import { createEffect, createMemo, createSignal, For, type JSX, on, onCleanup, onMount, Show } from "solid-js";
import { navigate } from "../../app/router";
import { useData } from "../../data/context";
import type { LpGame } from "../../data/generated/LpGame";
import type { MatchDetails } from "../../data/generated/MatchDetails";
import type { MatchGrade } from "../../data/generated/MatchGrade";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { RiotId } from "../../data/generated/RiotId";
import { Icon } from "../../design/Icon";
import { t } from "../../i18n";
import { REMAKE_MAX_SECONDS, timeAgo } from "../../lib/format";
import styles from "./GameStack.module.css";
import { GameWindow, titleOf, type View } from "./GameWindow";
import { type EdgeAction, edgeAction, keyStep, type More, RELEASE_MS, rubber, threshold, touchPull, wheelPull } from "./stack";

export { hint } from "./MatchDetails";

export interface GameStackProps {
  /** The history's games as listed, newest first: the stack's windows, in that order. */
  games: () => readonly MatchSummary[];
  /** The game it opens on. */
  start: MatchSummary;
  /** The player whose games these are: their line is marked, their grade and LP head each window. */
  focus: RiotId | undefined;
  /** A game's grade for that player as the list knows it (else the game's own, once loaded). */
  grade: (match: MatchSummary) => MatchGrade | null;
  /** The LP a game was worth (your ranked games MVP followed). */
  lp?: ((matchId: string) => LpGame | undefined) | undefined;
  /** A game whose LP the client hasn't counted yet (the one that just ended). */
  lpPending?: ((matchId: string) => boolean) | undefined;
  /** Older games of the history (Home): what there is to load, and loading them. */
  more?: { state: () => More; load: () => void } | undefined;
  /** Closed on `last`, the game it showed last (its row takes the focus back). */
  onClosed: (last: MatchSummary) => void;
}

/** How the stack leaves: pulled past the newest game's top (down), or dismissed. */
type Exit = "down" | "away";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether `body` can't scroll further up or down. */
const edgesOf = (body: HTMLElement) => ({
  atTop: body.scrollTop <= 0,
  atEnd: body.scrollHeight - body.clientHeight - body.scrollTop <= 1,
});

export function GameStack(props: GameStackProps): JSX.Element {
  const { gameData } = useData();
  const [currentId, setCurrentId] = createSignal(props.start.matchId);
  const index = createMemo(() => props.games().findIndex((m) => m.matchId === currentId()));
  const count = () => props.games().length;
  const current = () => props.games()[index()] ?? props.start;
  /** The windows built: the current game's and its neighbours', by game. */
  const built = createMemo(() => {
    const list = props.games();
    const at = index();
    return [at - 1, at, at + 1].flatMap((i) => {
      const m = i >= 0 ? list[i] : undefined;
      return m ? [m.matchId] : [];
    });
  });
  const cache = new Map<string, MatchDetails>();
  const bodies = new Map<string, HTMLElement>();
  const body = () => bodies.get(currentId());
  /** "Scoreboard | Details": the view chosen stays while you go from game to game. */
  const [view, setView] = createSignal<View>("scoreboard");
  /** A tall window shows both, one after the other (no tabs): it has the room. */
  const tallQuery = matchMedia("(min-height: 1000px)");
  const [tall, setTall] = createSignal(tallQuery.matches);
  const onTall = (e: MediaQueryListEvent) => setTall(e.matches);
  tallQuery.addEventListener("change", onTall);
  onCleanup(() => tallQuery.removeEventListener("change", onTall));

  let dialog!: HTMLDialogElement;
  let cell!: HTMLDivElement;
  let track!: HTMLDivElement;
  let cue!: HTMLDivElement;
  let closing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** How far the stack is pulled (wheel or finger pixels, + past the end). */
  let pulled = 0;

  /** The track's place: the current game's window in view, moved by `pull` pixels of rubber band. */
  const place = (pull: number) => {
    track.style.translate = `0 calc(${-index()} * (100% + var(--gap)) + ${Math.round(pull)}px)`;
  };
  // The current game changed: the stack glides there (a spring). The list moved under the same game
  // (a new game on top): the track follows at once, with the windows, so nothing moves on screen.
  createEffect(
    on([currentId, index] as const, ([id, at], before) => {
      if (at < 0) return;
      const shifted = before !== undefined && before[0] === id;
      if (shifted) track.style.transition = "none";
      place(0);
      if (shifted) {
        void track.offsetHeight;
        track.style.removeProperty("transition");
      }
    }),
  );

  /** Leaves by `exit` (at once before `then`: a player's page opens), then gives the focus back to the game's row. */
  const close = (exit: Exit, then?: () => void) => {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    const last = current();
    dialog.dataset.closing = exit;
    const done = () => {
      dialog.close();
      props.onClosed(last);
      if (then) then();
      else document.getElementById(`match-${last.matchId}`)?.focus();
    };
    const leaving = then ? [] : cell.getAnimations();
    if (leaving.length > 0) void Promise.all(leaving.map((a) => a.finished)).then(done, done);
    else done();
  };
  const openPlayer = (path: string) => close("away", () => navigate(path));

  /**
   * Moves to game `to` of the list. Arriving from below, its game shows its end (the stack reads
   * like one long page); from above, its top. The keyboard goes on in it.
   */
  const go = (to: number) => {
    const from = index();
    const target = props.games()[to];
    if (!target || to === from || closing) return;
    clearTimeout(timer);
    pulled = 0;
    delete dialog.dataset.pulling;
    setHeld(false);
    setCurrentId(target.matchId);
    const next = body();
    if (next) {
      next.scrollTop = to < from ? next.scrollHeight : 0;
      next.focus({ preventScroll: true });
    }
  };

  // ── Older games ──────────────────────────────────────────────────────────────────────────────
  /** Loading older games because the stack was pulled past its last game: move on once they're in. */
  let onward: number | undefined;
  const loadOlder = () => {
    if (!props.more) return;
    onward = count();
    // The hint waits with them at the bottom.
    cue.dataset.edge = "end";
    props.more.load();
  };
  createEffect(
    on(
      () => props.more?.state(),
      (state) => {
        if (state === "loading" || onward === undefined) return;
        const from = onward;
        onward = undefined;
        if (count() > from && index() === from - 1) go(from);
      },
      { defer: true },
    ),
  );
  /** Older games on their way, or a failure, while the stack is at its last game: the hint says so. */
  const status = createMemo(() => {
    const state = props.more?.state();
    return index() === count() - 1 && (state === "loading" || state === "failed") ? state : undefined;
  });

  // ── Pulls: the hint, the rubber band, what they do ─────────────────────────────────────────────
  /** What the pull does (kept once let go: the hint fades out with its words), and whether one is on. */
  const [said, setSaid] = createSignal<EdgeAction>();
  const [held, setHeld] = createSignal(false);
  const hintText = () => {
    const words = t().matchDetails.stack;
    const more = t().matches.more;
    const waiting = status() === "loading" ? "loading" : status() === "failed" ? "load" : undefined;
    const action = held() || !waiting ? said() : waiting;
    switch (action) {
      case "newer":
      case "older":
      case "close":
        return words[action];
      case "load":
        return props.more?.state() === "failed" ? words.failed : words.load;
      case "loading":
        return more.loading;
      case "end":
        return props.more ? more.end : words.endHere;
      default:
        return "";
    }
  };

  /** Shows a pull of `distance` px (+ past the end) toward `action`; 0 lets go (it springs back). */
  const draw = (distance: number, action: EdgeAction, how: "wheel" | "touch") => {
    if (distance === pulled) return;
    pulled = distance;
    const moved = distance && !reduced() ? -rubber(distance) : 0;
    if (distance) {
      dialog.dataset.pulling = how;
      cue.dataset.edge = distance > 0 ? "end" : "top";
      setSaid(action);
      // Its bar fills up to what the pull does (nothing does at the very end).
      const limit = threshold(action, how === "touch");
      cue.style.setProperty("--progress", `${Number.isFinite(limit) ? Math.min(1, Math.abs(distance) / limit) : 0}`);
      // It rides the seam between the windows, in the room the pull opens.
      cue.style.setProperty("--pull", `${Math.round(Math.abs(moved))}px`);
    } else {
      delete dialog.dataset.pulling;
    }
    setHeld(distance !== 0);
    place(moved);
  };

  /** A pull (or a key) past the edge did enough: `action` happens. */
  const act = (action: EdgeAction) => {
    if (action === "close") return close("down");
    if (action === "newer") go(index() - 1);
    else if (action === "older") go(index() + 1);
    else if (action === "load") loadOlder();
    if (pulled) draw(0, action, "wheel");
  };

  // ── The wheel ────────────────────────────────────────────────────────────────────────────────
  const wheel = wheelPull();
  const onWheel = (e: WheelEvent) => {
    const scroller = body();
    // Zooming and sideways scrolling (the stats table) aren't pulls.
    if (closing || !scroller || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * scroller.clientHeight : e.deltaY;
    const distance = wheel.wheel(e.timeStamp, dy, edgesOf(scroller));
    // The rest of a gesture that moved the stack: the game it brought doesn't scroll with it.
    // A pull takes its events too (at the edge, nothing else would scroll with them): Chromium
    // lets the rest of a wheel sequence be cancelled only when its first event was.
    if (distance === null || distance !== 0) e.preventDefault();
    if (distance === null) return;
    // Over the window's head, around it or over a neighbour: the wheel still scrolls the game.
    if (distance === 0 && !scroller.contains(e.target as Node)) {
      e.preventDefault();
      scroller.scrollBy({ top: dy });
    }
    clearTimeout(timer);
    const action = edgeAction(Math.sign(distance), index(), count(), props.more?.state());
    if (distance && Math.abs(distance) >= threshold(action, false)) {
      wheel.spend();
      return act(action);
    }
    draw(distance, action, "wheel");
    if (distance) {
      timer = setTimeout(() => {
        wheel.release();
        draw(0, action, "wheel");
      }, RELEASE_MS);
    }
  };

  // ── A finger ─────────────────────────────────────────────────────────────────────────────────
  const touch = touchPull();
  let dragged = 0;
  const dragAction = () => edgeAction(Math.sign(dragged), index(), count(), props.more?.state());
  const onTouchStart = (e: TouchEvent) => {
    const finger = e.touches[0];
    if (finger && e.touches.length === 1) touch.start(finger.clientY);
    dragged = 0;
  };
  const onTouchMove = (e: TouchEvent) => {
    const finger = e.touches[0];
    const scroller = body();
    if (closing || !finger || !scroller || e.touches.length > 1) return;
    dragged = touch.move(finger.clientY, edgesOf(scroller));
    // The pull moves the stack, not the page.
    if (dragged && e.cancelable) e.preventDefault();
    draw(dragged, dragAction(), "touch");
  };
  const onTouchEnd = () => {
    const action = dragAction();
    if (dragged && Math.abs(dragged) >= threshold(action, true)) act(action);
    else if (dragged) draw(0, action, "touch");
    dragged = 0;
  };

  // ── Keyboard and pointer ─────────────────────────────────────────────────────────────────────
  /**
   * Escape: a tooltip showing goes first (design/tip closes it alone, stopping the key), then the
   * stack. Heard before anything else (the window, capturing), so the dialog's own close never
   * runs: the stack leaves its way, whatever else hears the key.
   */
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !dialog.open) return;
    e.preventDefault();
    if (!document.querySelector("[role=tooltip]:popover-open")) close("away");
  };
  /** Tab stays in the current window: past its last stop back to its first, and the other way. */
  const trap = (e: KeyboardEvent) => {
    const stops = [...dialog.querySelectorAll<HTMLElement>("a[href], button, [tabindex='0']")].filter(
      (el) => el.tabIndex >= 0 && !el.closest("[inert]") && el.getClientRects().length > 0,
    );
    if (document.activeElement === (e.shiftKey ? stops[0] : stops.at(-1)) || !dialog.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? stops.at(-1) : stops[0])?.focus();
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab") return trap(e);
    if (closing || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = keyStep(e.key, e.shiftKey);
    const target = e.target as Element;
    const scroller = body();
    // Controls keep their keys: the tabs' arrows, Home and End, Space on a button or a link.
    if (!step || !scroller || target.closest("[role=radiogroup]") || (e.key === " " && target.closest("button, a"))) return;
    if (step === "first" || step === "last") {
      e.preventDefault();
      go(step === "first" ? 0 : count() - 1);
      return;
    }
    const edges = edgesOf(scroller);
    if (!(step.direction > 0 ? edges.atEnd : edges.atTop)) {
      // The game scrolls: by itself when the focus is in it, else from here.
      if (!scroller.contains(target)) {
        e.preventDefault();
        const by = step.by === "line" ? 40 : scroller.clientHeight * 0.875;
        scroller.scrollBy({ top: step.direction * by, behavior: reduced() ? "instant" : "smooth" });
      }
      return;
    }
    // At its edge: a key pressed again goes on (held down, it stops there).
    e.preventDefault();
    if (e.repeat) return;
    const action = edgeAction(step.direction, index(), count(), props.more?.state());
    if (action !== "close") act(action);
  };
  /** A click around the window: pressed and released outside every window (not on a neighbour). */
  let pressedOutside = false;
  const outside = (target: EventTarget | null) => !(target as Element | null)?.closest("[data-window], [data-peek]");

  // The current game went from the list (a new history): nothing left to show.
  createEffect(() => {
    if (index() < 0) close("away");
  });

  onMount(() => {
    dialog.showModal();
    // The keyboard scrolls the game at once.
    body()?.focus({ preventScroll: true });
    window.addEventListener("keydown", onEscape, true);
    dialog.addEventListener("wheel", onWheel, { passive: false });
    dialog.addEventListener("touchstart", onTouchStart, { passive: true });
    dialog.addEventListener("touchmove", onTouchMove, { passive: false });
    dialog.addEventListener("touchend", onTouchEnd);
    dialog.addEventListener("touchcancel", onTouchEnd);
  });
  onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener("keydown", onEscape, true);
    if (dialog.open) dialog.close();
  });

  /** A neighbour's peek: what game is there, on hover. */
  const peek = (to: number) => {
    const m = props.games()[to];
    if (!m) return "";
    const outcome = m.durationSeconds <= REMAKE_MAX_SECONDS ? "remake" : m.win ? "win" : "loss";
    const champion = gameData()?.champions.get(m.championId)?.name ?? t().common.championN(m.championId);
    return `${t().matches.outcome[outcome]} · ${champion} · ${timeAgo(m.endedAt)}`;
  };

  return (
    <dialog
      ref={dialog}
      class={styles.stack}
      aria-modal="true"
      aria-labelledby={titleOf(currentId())}
      data-status={status()}
      data-testid="game-stack"
      onPointerDown={(e) => {
        pressedOutside = outside(e.target);
      }}
      onClick={(e) => {
        if (pressedOutside && outside(e.target)) close("away");
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
        props.onClosed(current());
      }}
    >
      <div ref={cell} class={styles.cell}>
        <div ref={track} class={styles.track}>
          <For each={built()}>
            {(id) => {
              const match = () => props.games().find((m) => m.matchId === id) ?? props.start;
              const slot = () => props.games().findIndex((m) => m.matchId === id);
              return (
                <GameWindow
                  match={match()}
                  slot={slot()}
                  place={Math.sign(slot() - index())}
                  focus={props.focus}
                  grade={props.grade(match())}
                  lp={props.lp?.(id)}
                  lpPending={props.lpPending?.(id) ?? false}
                  view={view()}
                  onView={setView}
                  tall={tall()}
                  cache={cache}
                  bodies={bodies}
                  onPlayer={openPlayer}
                  onClose={() => close("away")}
                />
              );
            }}
          </For>
        </div>
        {/* The neighbours' edges: a click goes there (the keyboard has its own keys). */}
        <Show when={index() > 0}>
          <button
            type="button"
            class={styles.peek}
            data-peek="newer"
            tabindex="-1"
            aria-label={t().matchDetails.peek.newer}
            data-hint-title={t().matchDetails.peek.newer}
            data-hint={peek(index() - 1)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => go(index() - 1)}
          />
        </Show>
        <Show when={index() < count() - 1}>
          <button
            type="button"
            class={styles.peek}
            data-peek="older"
            tabindex="-1"
            aria-label={t().matchDetails.peek.older}
            data-hint-title={t().matchDetails.peek.older}
            data-hint={peek(index() + 1)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => go(index() + 1)}
          />
        </Show>
        {/* What the pull does, at the edge being pulled, its bar filling up to it. */}
        <div ref={cue} class={styles.cue} aria-hidden="true" data-edge="end" data-testid="scroll-cue">
          <Icon name="arrowDown" size={16} />
          <span>{hintText()}</span>
        </div>
      </div>
    </dialog>
  );
}
