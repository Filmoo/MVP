/** Moves the glass highlight (see design/glass.css) under the pointer; at most once per frame. */
export function followPointerOnGlass(): () => void {
  let frame = 0;
  let last: PointerEvent | undefined;
  const update = () => {
    frame = 0;
    const event = last;
    if (!event) return;
    const glass = (event.target as Element | null)?.closest?.<HTMLElement>("[data-glass]");
    if (!glass) return;
    const box = glass.getBoundingClientRect();
    glass.style.setProperty("--mx", `${Math.round(event.clientX - box.left)}px`);
    glass.style.setProperty("--my", `${Math.round(event.clientY - box.top)}px`);
  };
  const onMove = (event: PointerEvent) => {
    last = event;
    if (!frame) frame = requestAnimationFrame(update);
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    document.removeEventListener("pointermove", onMove);
    if (frame) cancelAnimationFrame(frame);
  };
}
