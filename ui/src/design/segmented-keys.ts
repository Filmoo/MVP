/** Index the keys move a radio group's choice to (wrapping), `undefined` for keys it doesn't handle. */
export function segmentFor(key: string, index: number, count: number): number | undefined {
  if (count === 0) return undefined;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}
