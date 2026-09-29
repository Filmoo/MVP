/**
 * The stack of opened games (GameStack.tsx), pure: its wheel, touch and keyboard input, and what
 * going on past a window's edge does. A window's own game scrolls first. Scrolling on past its end
 * (or its top) pulls the stack along with resistance: a big enough pull moves to the next, older
 * game (or the newer one above); a smaller one springs back. Past the newest game's top the pull
 * closes the stack; past the last game loaded it loads older ones (the history's "load more"); at
 * the very end it only gives, like a rubber band.
 *
 * A pull is always deliberate. A wheel gesture that scrolled the game up to its edge (a fast spin
 * of the wheel, a touchpad flick and its inertia) stops there: the next one, begun at the edge,
 * pulls. Inertia doesn't add to a pull: momentum shrinks event after event, steadily; a hand
 * scrolling doesn't (a wheel's notches are alike, or come merged two or three in one when the page
 * is busy, a touchpad's deltas go up and down). And a gesture that moved the stack is spent: what
 * is left of it (more notches, the inertia) doesn't scroll the game it brought.
 */

/** Wheel pixels past the edge that move to the next or the previous game: two notches of a mouse wheel. */
export const WHEEL_MOVE = 200;
/** Wheel pixels past the newest game's top that close the stack: four notches. */
export const WHEEL_CLOSE = 360;
/** Pixels a finger drags past the edge to move to the next or the previous game (on release). */
export const TOUCH_MOVE = 100;
/** Pixels a finger drags past the newest game's top to close the stack (on release). */
export const TOUCH_CLOSE = 140;
/** A pause this long between two wheel events starts a new gesture. */
export const GESTURE_GAP_MS = 200;
/** No wheel event for this long: the pull springs back (notch after notch still adds up). */
export const RELEASE_MS = 500;

/** How far the stack follows `distance` pixels of pull: less and less, like a rubber band. */
export function rubber(distance: number): number {
  const reach = 280;
  return Math.sign(distance) * reach * (1 - 1 / (1 + (Math.abs(distance) * 0.55) / reach));
}

/** Whether the game can't scroll further up (`atTop`) or down (`atEnd`). */
export interface Edges {
  atTop: boolean;
  atEnd: boolean;
}

/** Older games of the history: some to load, loading, failed (try again), none left; `undefined`: the list can't load more. */
export type More = "idle" | "loading" | "failed" | "end" | undefined;

/**
 * What going on past an edge does: move to the newer or the older game, close the stack (past the
 * newest game's top), load older games (past the last one loaded), or nothing but a rubber band
 * (the history's end, or older games on their way).
 */
export type EdgeAction = "newer" | "older" | "close" | "load" | "loading" | "end";

/** What going on past the current game's edge in `direction` (+1 down, −1 up) does: game `index` of `count`. */
export function edgeAction(direction: number, index: number, count: number, more: More): EdgeAction {
  if (direction < 0) return index > 0 ? "newer" : "close";
  if (index < count - 1) return "older";
  if (more === "loading") return "loading";
  return more === "idle" || more === "failed" ? "load" : "end";
}

/** The pull that makes `action` happen, by wheel or by finger: none (`Infinity`) where nothing does. */
export function threshold(action: EdgeAction, touch: boolean): number {
  if (action === "close") return touch ? TOUCH_CLOSE : WHEEL_CLOSE;
  if (action === "end" || action === "loading") return Number.POSITIVE_INFINITY;
  return touch ? TOUCH_MOVE : WHEEL_MOVE;
}

/** Wheel input, the first event of a gesture on. */
export interface WheelPull {
  /**
   * The pull after this event (signed pixels, + past the end); `null` when the event belongs to a
   * gesture already spent: nothing may scroll with it.
   */
  wheel(time: number, dy: number, edges: Edges): number | null;
  /** Lets go: the pull springs back (the gesture may pull again). */
  release(): void;
  /** The pull did what it pulled for (moved, loaded): the rest of its gesture is swallowed. */
  spend(): void;
}

export function wheelPull(): WheelPull {
  let last = Number.NEGATIVE_INFINITY;
  let previous = 0;
  /** Events in a row that were smaller than the one before. */
  let shrinking = 0;
  let moved = false;
  let spent = false;
  let distance = 0;
  return {
    wheel(time, dy, { atTop, atEnd }) {
      if (dy === 0) return spent ? null : distance;
      if (time - last > GESTURE_GAP_MS) {
        moved = false;
        spent = false;
        previous = 0;
        shrinking = 0;
      }
      last = time;
      if (spent) return null;
      const size = Math.abs(dy);
      shrinking = size < previous ? shrinking + 1 : 0;
      const over = dy > 0 ? atEnd : atTop;
      if (!over || distance * dy < 0) {
        // The game scrolls (this gesture can't pull anymore), or the pull turns back.
        moved = true;
        distance = 0;
      } else if (!moved && shrinking < 2) {
        distance += dy;
      }
      previous = size;
      return distance;
    },
    release() {
      distance = 0;
    },
    spend() {
      distance = 0;
      spent = true;
    },
  };
}

/** Touch input: a finger dragging past the edge pulls (a finger is always deliberate). */
export function touchPull(): { start(y: number): void; move(y: number, edges: Edges): number } {
  let at = 0;
  let distance = 0;
  return {
    start(y) {
      at = y;
      distance = 0;
    },
    move(y, { atTop, atEnd }) {
      const dy = at - y;
      at = y;
      if (distance === 0 && !(dy > 0 ? atEnd : dy < 0 && atTop)) return 0;
      const next = distance + dy;
      // Dragged back past where the pull began: the game scrolls again.
      distance = next * distance < 0 ? 0 : next;
      return distance;
    },
  };
}

/**
 * What a key does to the stack: scroll the game by a line (`line`) or a page (`page`), down (+1)
 * or up (−1), and past its edge move on like the wheel; Home and End go to the newest and the
 * oldest game loaded. `undefined`: not a key of the stack.
 */
export function keyStep(key: string, shift: boolean): { by: "line" | "page"; direction: 1 | -1 } | "first" | "last" | undefined {
  switch (key) {
    case "ArrowDown":
      return { by: "line", direction: 1 };
    case "ArrowUp":
      return { by: "line", direction: -1 };
    case "PageDown":
      return { by: "page", direction: 1 };
    case "PageUp":
      return { by: "page", direction: -1 };
    case " ":
      return { by: "page", direction: shift ? -1 : 1 };
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return undefined;
  }
}
