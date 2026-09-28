/**
 * Light under the pointer, at most once per frame (see design/glass.css):
 * - `[data-glass]` surfaces catch a soft glow where the pointer is;
 * - `.glass-rim` edges glint nearest to it, like a polished edge turned to the light.
 * Nothing runs unless the pointer moves; leaving glass fades its glint out.
 */
export function followPointerOnGlass(): () => void {
  let frame = 0;
  let last: PointerEvent | undefined;
  let lit: HTMLElement | undefined;
  const place = (el: HTMLElement, x: string, y: string, event: PointerEvent) => {
    const box = el.getBoundingClientRect();
    el.style.setProperty(x, `${Math.round(event.clientX - box.left)}px`);
    el.style.setProperty(y, `${Math.round(event.clientY - box.top)}px`);
  };
  const update = () => {
    frame = 0;
    const event = last;
    if (!event) return;
    const target = event.target as Element | null;
    const glass = target?.closest?.<HTMLElement>("[data-glass]");
    if (glass) place(glass, "--mx", "--my", event);
    const rim = target?.closest?.<HTMLElement>(".glass-rim") ?? undefined;
    if (rim !== lit) {
      lit?.removeAttribute("data-glint");
      lit = rim;
      rim?.setAttribute("data-glint", "");
    }
    if (rim) place(rim, "--rx", "--ry", event);
  };
  const onMove = (event: PointerEvent) => {
    last = event;
    if (!frame) frame = requestAnimationFrame(update);
  };
  const onLeave = () => {
    lit?.removeAttribute("data-glint");
    lit = undefined;
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  return () => {
    document.removeEventListener("pointermove", onMove);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    if (frame) cancelAnimationFrame(frame);
  };
}
