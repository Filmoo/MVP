/**
 * Dragging cards with a mouse or pen: the card lifts (a floating copy follows the pointer), a
 * line shows where it will land (a lane of a version, before a card or last), the board scrolls
 * near its edges. Escape cancels. Everything here runs only during a drag.
 */
import { createSignal, onCleanup } from "solid-js";
import type { Status } from "../types";

export interface DropTarget {
  versionId: number;
  status: Status;
  /** Index among the lane's other cards. */
  index: number;
}

interface Start {
  id: number;
  card: HTMLElement;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export function createDrag(options: {
  board: () => HTMLElement | undefined;
  scroller: () => HTMLElement | null;
  enabled: () => boolean;
  ghostClass: string;
  onDrop: (id: number, target: DropTarget) => void;
}) {
  const [dragging, setDragging] = createSignal<number | null>(null);
  const [target, setTarget] = createSignal<DropTarget | null>(null);
  let start: Start | null = null;
  let ghost: HTMLElement | null = null;
  let frame = 0;
  let pointer = { x: 0, y: 0 };

  function locate(x: number, y: number): void {
    const hit = document.elementFromPoint(x, y);
    const lane = hit?.closest<HTMLElement>("[data-lane]");
    if (!lane || !options.board()?.contains(lane)) {
      setTarget(null);
      return;
    }
    const cards = [...lane.querySelectorAll<HTMLElement>("[data-feature]")].filter((c) => Number(c.dataset.feature) !== dragging());
    let index = cards.length;
    for (const [i, card] of cards.entries()) {
      const box = card.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        index = i;
        break;
      }
    }
    const next = { versionId: Number(lane.dataset.version), status: lane.dataset.lane as Status, index };
    const now = target();
    if (!now || now.versionId !== next.versionId || now.status !== next.status || now.index !== next.index) setTarget(next);
  }

  /** Scrolls the board sideways and the page up or down while the pointer is near an edge. */
  function edges(): void {
    const board = options.board();
    const scroller = options.scroller();
    const zone = 64;
    if (board) {
      const box = board.getBoundingClientRect();
      if (pointer.x < box.left + zone) board.scrollLeft -= Math.ceil((box.left + zone - pointer.x) / 4);
      else if (pointer.x > box.right - zone) board.scrollLeft += Math.ceil((pointer.x - (box.right - zone)) / 4);
    }
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (pointer.y < box.top + zone) scroller.scrollTop -= Math.ceil((box.top + zone - pointer.y) / 4);
      else if (pointer.y > box.bottom - zone) scroller.scrollTop += Math.ceil((pointer.y - (box.bottom - zone)) / 4);
    }
    locate(pointer.x, pointer.y);
    frame = requestAnimationFrame(edges);
  }

  function begin(s: Start): void {
    setDragging(s.id);
    const box = s.card.getBoundingClientRect();
    ghost = s.card.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-feature");
    ghost.removeAttribute("id");
    ghost.classList.add(options.ghostClass);
    ghost.style.setProperty("width", `${box.width}px`);
    ghost.setAttribute("aria-hidden", "true");
    document.body.appendChild(ghost);
    document.documentElement.dataset.dragging = "true";
    frame = requestAnimationFrame(edges);
  }

  function follow(x: number, y: number): void {
    if (!ghost || !start) return;
    ghost.style.setProperty("transform", `translate3d(${x - start.dx}px, ${y - start.dy}px, 0) rotate(1.5deg)`);
  }

  function stop(): void {
    cancelAnimationFrame(frame);
    ghost?.remove();
    ghost = null;
    start = null;
    delete document.documentElement.dataset.dragging;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    setDragging(null);
    setTarget(null);
  }

  function onMove(event: PointerEvent): void {
    if (!start) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (dragging() === null) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
      begin(start);
    }
    event.preventDefault();
    follow(event.clientX, event.clientY);
    locate(event.clientX, event.clientY);
  }

  function onUp(): void {
    const id = dragging();
    const where = target();
    const moved = id !== null;
    stop();
    if (moved) {
      // The click that ends a drag isn't a click on the card.
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    }
    if (id !== null && where) options.onDrop(id, where);
  }

  function swallow(event: Event): void {
    event.stopPropagation();
  }

  function onCancel(): void {
    stop();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stop();
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.pointerType === "touch" || !options.enabled()) return;
    const element = event.target as Element;
    if (element.closest("button, a, input, textarea, select")) return;
    const card = element.closest<HTMLElement>("[data-feature][data-draggable]");
    if (!card) return;
    const box = card.getBoundingClientRect();
    start = {
      id: Number(card.dataset.feature),
      card,
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - box.left,
      dy: event.clientY - box.top,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  }

  onCleanup(stop);

  return { dragging, target, onPointerDown };
}
