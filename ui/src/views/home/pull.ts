/**
 * Scroll to close, for the opened game's sheet (pure: the sheet feeds it its wheel and touch
 * input and draws what it answers). Scrolling on past the sheet's end, or past its top, pulls
 * the sheet along with resistance; a big enough pull closes it, a smaller one springs back.
 *
 * A pull is always deliberate. A wheel gesture that scrolled the content up to the edge (a fast
 * spin of the wheel, a touchpad flick and its inertia) stops there: the next one, begun at the
 * edge, pulls. And inertia doesn't add to a pull: momentum shrinks event after event, steadily;
 * a hand scrolling doesn't (a wheel's notches are alike, or come merged two or three in one when
 * the page is busy, a touchpad's deltas go up and down).
 */

/** Wheel pixels past the edge that close the sheet: four notches of a mouse wheel. */
export const WHEEL_CLOSE = 360;
/** Pixels a finger drags past the edge to close the sheet (on release). */
export const TOUCH_CLOSE = 140;
/** A pause this long between two wheel events starts a new gesture. */
export const GESTURE_GAP_MS = 200;
/** No wheel event for this long: the pull springs back (notch after notch still adds up). */
export const RELEASE_MS = 500;

/** How far the sheet follows `distance` pixels of pull: less and less, like a rubber band. */
export function rubber(distance: number): number {
  const reach = 280;
  return Math.sign(distance) * reach * (1 - 1 / (1 + (Math.abs(distance) * 0.55) / reach));
}

/** Whether the content can't scroll further in `dy`'s direction (+: toward its end). */
export interface Edges {
  atTop: boolean;
  atEnd: boolean;
}

/** Wheel input, from the first event of a gesture on: answers the pull after each event (signed pixels, + past the end). */
export function wheelPull(): { wheel(time: number, dy: number, edges: Edges): number; release(): void } {
  let last = Number.NEGATIVE_INFINITY;
  let previous = 0;
  /** Events in a row that were smaller than the one before. */
  let shrinking = 0;
  let moved = false;
  let distance = 0;
  return {
    wheel(time, dy, { atTop, atEnd }) {
      if (dy === 0) return distance;
      if (time - last > GESTURE_GAP_MS) {
        moved = false;
        previous = 0;
        shrinking = 0;
      }
      last = time;
      const size = Math.abs(dy);
      shrinking = size < previous ? shrinking + 1 : 0;
      const over = dy > 0 ? atEnd : atTop;
      if (!over || distance * dy < 0) {
        // The content scrolls (this gesture can't pull anymore), or the pull turns back.
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
      // Dragged back past where the pull began: the content scrolls again.
      distance = next * distance < 0 ? 0 : next;
      return distance;
    },
  };
}
