/**
 * The stack of opened games (GameStack.tsx), pure: what the wheel and the keyboard do to it.
 * Nothing scrolls inside a window, so the wheel only changes window: one deliberate gesture moves
 * to the next, older game (down) or the newer one (up). Past the stack's ends a gesture pulls it
 * instead, with resistance: far enough past the newest game it closes the stack, past the last
 * game loaded it loads older ones (the history's "load more"); at the very end it only gives,
 * like a rubber band; a smaller pull springs back.
 *
 * A gesture is wheel events less than `GESTURE_GAP_MS` apart; its deltas add up to a pull. It is
 * deliberate: once the deltas have shrunk twice in a row (momentum: a touchpad's inertia, a flung
 * wheel) they add nothing more, as a hand's deltas go up and down while momentum's shrink
 * steadily. A gesture that did what it pulled for is spent: the rest of it (more notches, the
 * inertia) is swallowed, and the wheel rests `SETTLE_MS` while the stack glides.
 */

/** Wheel pixels that move to the next or the previous game: half a notch of a mouse wheel, a short swipe. */
export const WHEEL_MOVE = 50;
/** Wheel pixels past the last game loaded that load older games: two notches. */
export const WHEEL_LOAD = 200;
/** Wheel pixels past the newest game that close the stack: four notches. */
export const WHEEL_CLOSE = 360;
/** Pixels a finger drags to move to the next or the previous game, or to load older ones (on release). */
export const TOUCH_MOVE = 100;
/** Pixels a finger drags past the newest game to close the stack (on release). */
export const TOUCH_CLOSE = 140;
/** A pause this long between two wheel events starts a new gesture. */
export const GESTURE_GAP_MS = 200;
/**
 * After a move the wheel rests this long, pause or not, while the stack glides: a spin never
 * carries on into the game it brought, even when the page, busy drawing, hands its last notches
 * over late.
 */
export const SETTLE_MS = 400;
/** No wheel event for this long: the pull springs back (notch after notch still adds up). */
export const RELEASE_MS = 500;

/** How far the stack follows `distance` pixels of pull: less and less, like a rubber band. */
export function rubber(distance: number): number {
  const reach = 280;
  return Math.sign(distance) * reach * (1 - 1 / (1 + (Math.abs(distance) * 0.55) / reach));
}

/** Older games of the history: some to load, loading, failed (try again), none left; `undefined`: the list can't load more. */
export type More = "idle" | "loading" | "failed" | "end" | undefined;

/**
 * What a gesture does: move to the newer or the older game, close the stack (past the newest
 * game), load older games (past the last one loaded), or nothing but a rubber band (the
 * history's end, or older games on their way).
 */
export type EdgeAction = "newer" | "older" | "close" | "load" | "loading" | "end";

/** What a gesture in `direction` (+1 down, −1 up) does on game `index` of `count`. */
export function edgeAction(direction: number, index: number, count: number, more: More): EdgeAction {
  if (direction < 0) return index > 0 ? "newer" : "close";
  if (index < count - 1) return "older";
  if (more === "loading") return "loading";
  return more === "idle" || more === "failed" ? "load" : "end";
}

/** Whether `action` moves between games at once (else it pulls the stack past one of its ends). */
export const moves = (action: EdgeAction): boolean => action === "newer" || action === "older";

/** The pull that makes `action` happen, by wheel or by finger: none (`Infinity`) where nothing does. */
export function threshold(action: EdgeAction, touch: boolean): number {
  if (action === "close") return touch ? TOUCH_CLOSE : WHEEL_CLOSE;
  if (action === "end" || action === "loading") return Number.POSITIVE_INFINITY;
  if (touch) return TOUCH_MOVE;
  return action === "load" ? WHEEL_LOAD : WHEEL_MOVE;
}

/** Wheel input, the first event of a gesture on. */
export interface WheelPull {
  /**
   * The pull after this event (signed pixels, + down); `null` when the event belongs to a gesture
   * already spent: it does nothing.
   */
  wheel(time: number, dy: number): number | null;
  /** Lets go: the pull springs back (the gesture may pull again). */
  release(): void;
  /** The pull did what it pulled for (moved, closed, loaded): the rest of its gesture is swallowed, and the wheel rests `SETTLE_MS`. */
  spend(): void;
}

export function wheelPull(): WheelPull {
  let last = Number.NEGATIVE_INFINITY;
  let previous = 0;
  /** Events in a row that were smaller than the one before. */
  let shrinking = 0;
  let spent = false;
  /** When the gesture was spent. */
  let spentAt = Number.NEGATIVE_INFINITY;
  let distance = 0;
  return {
    wheel(time, dy) {
      if (dy === 0) return spent ? null : distance;
      if (time - last > GESTURE_GAP_MS && time - spentAt > SETTLE_MS) {
        spent = false;
        previous = 0;
        shrinking = 0;
      }
      last = time;
      if (spent) return null;
      const size = Math.abs(dy);
      // Turned back: a pull the other way begins.
      if (distance * dy < 0) {
        distance = 0;
        previous = 0;
      }
      shrinking = size < previous ? shrinking + 1 : 0;
      if (shrinking < 2) distance += dy;
      previous = size;
      return distance;
    },
    release() {
      distance = 0;
    },
    spend() {
      distance = 0;
      spent = true;
      spentAt = last;
    },
  };
}

/**
 * What a key does to the stack: move to the next game (+1, down) or the previous one (−1), or go
 * to the newest (`first`) or the oldest game loaded (`last`). `undefined`: not a key of the stack
 * (←/→ are the window's tabs').
 */
export function keyStep(key: string): 1 | -1 | "first" | "last" | undefined {
  switch (key) {
    case "ArrowDown":
    case "PageDown":
      return 1;
    case "ArrowUp":
    case "PageUp":
      return -1;
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return undefined;
  }
}
