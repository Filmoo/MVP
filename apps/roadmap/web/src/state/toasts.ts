/** Short messages at the bottom: what just happened, with Undo when it can be undone. */
import { createSignal } from "solid-js";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void } | undefined;
}

const [list, setList] = createSignal<Toast[]>([]);
export const toasts = list;

let next = 1;
const LIFETIME_MS = 6_000;

export function dismiss(id: number): void {
  setList((all) => all.filter((t) => t.id !== id));
}

export function toast(text: string, options: { tone?: Toast["tone"]; action?: Toast["action"] } = {}): number {
  const id = next++;
  // At most three at once: the oldest goes.
  setList((all) => [...all.slice(-2), { id, text, tone: options.tone ?? "info", action: options.action }]);
  // Each toast leaves on its own after a few seconds; nothing runs once they're gone.
  setTimeout(() => dismiss(id), options.tone === "error" ? LIFETIME_MS * 1.5 : LIFETIME_MS);
  return id;
}
