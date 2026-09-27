import { createSignal } from "solid-js";

export interface AppIssue {
  id: number;
  message: string;
  at: number;
}

const [issues, setIssues] = createSignal<AppIssue[]>([]);
let nextId = 1;

/** Last unexpected errors, surfaced in a non-blocking toast. */
export { issues };

export function reportError(error: unknown, context?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  // Keep the console trace for developers; users get the toast.
  console.error(context ? `[${context}]` : "[error]", error);
  setIssues((list) => [...list.slice(-2), { id: nextId++, message, at: Date.now() }]);
}

export function dismissIssue(id: number): void {
  setIssues((list) => list.filter((i) => i.id !== id));
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "uncaught"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandled promise"));
}
