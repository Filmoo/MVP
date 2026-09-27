import { createSignal } from "solid-js";

export interface AppIssue {
  id: number;
  message: string;
  at: number;
  /** `error`: something failed (stays until dismissed); `success`: a confirmation (fades on its own). */
  tone: "error" | "success";
}

const [issues, setIssues] = createSignal<AppIssue[]>([]);
let nextId = 1;

/** How long a confirmation stays on screen. */
const SUCCESS_MS = 4_000;

/** Last unexpected errors and confirmations, surfaced in non-blocking toasts. */
export { issues };

function push(message: string, tone: AppIssue["tone"]): number {
  const id = nextId++;
  setIssues((list) => [...list.slice(-2), { id, message, at: Date.now(), tone }]);
  return id;
}

export function reportError(error: unknown, context?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  // Keep the console trace for developers; users get the toast.
  console.error(context ? `[${context}]` : "[error]", error);
  push(message, "error");
}

/** A short confirmation ("Match accepted"). One timer per toast, only while it shows. */
export function notify(message: string): void {
  const id = push(message, "success");
  setTimeout(() => dismissIssue(id), SUCCESS_MS);
}

export function dismissIssue(id: number): void {
  setIssues((list) => list.filter((i) => i.id !== id));
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "uncaught"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandled promise"));
}
