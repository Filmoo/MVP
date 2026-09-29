/**
 * What the keyboard acts on: the selected feature (a roving focus through the view's grid), and
 * which overlay is open (palette, new feature, shortcuts).
 */
import { createSignal, onCleanup } from "solid-js";

export const [selected, setSelected] = createSignal<number | null>(null);

/** Columns of feature ids in reading order, as the current view lays them out. */
type Grid = () => number[][];
/** The latest mounted provider wins (a panel over a view), until it unmounts. */
const grids: Grid[] = [];
const grid: Grid = () => grids[grids.length - 1]?.() ?? [];

export function useGrid(next: Grid): void {
  grids.push(next);
  onCleanup(() => {
    const index = grids.lastIndexOf(next);
    if (index >= 0) grids.splice(index, 1);
  });
}

/** Moves the selection: dx between columns (keeping the row), dy within a column. */
export function step(dx: number, dy: number): number | null {
  const columns = grid().filter((c) => c.length > 0);
  if (columns.length === 0) return null;
  const at = selected();
  let col = columns.findIndex((c) => at !== null && c.includes(at));
  if (col < 0) {
    const first = columns[0]?.[0] ?? null;
    setSelected(first);
    return first;
  }
  const row = columns[col]?.indexOf(at ?? -1) ?? 0;
  col = Math.min(Math.max(col + dx, 0), columns.length - 1);
  const column = columns[col] ?? [];
  const target = column[Math.min(Math.max(dx !== 0 ? row : row + dy, 0), column.length - 1)] ?? null;
  setSelected(target);
  return target;
}

export type Overlay =
  | { kind: "palette"; mode: "all" | "move" }
  | { kind: "create"; versionId: number | null; status: "proposed" | null }
  | { kind: "version"; versionId: number | null }
  | { kind: "keys" }
  | null;

export const [overlay, setOverlay] = createSignal<Overlay>(null);

/** Asks the search field to take the focus (the top bar listens). */
export const [searchFocus, setSearchFocus] = createSignal(0);

/** Asks the open feature's title to switch to editing (the sheet listens). */
export const [titleEdit, setTitleEdit] = createSignal(0);
