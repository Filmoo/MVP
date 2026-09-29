import { createSignal } from "solid-js";
import type { Transport } from "../data/transport";

export interface AppIssue {
  id: number;
  message: string;
  at: number;
  /**
   * `error`: something failed (stays until dismissed); `success`: a confirmation (fades on its
   * own); `warn`: something the player may want to act on (stays, with its action).
   */
  tone: "error" | "success" | "warn";
  /** A button in the toast; using it closes the toast. */
  action?: { label: string; run: () => void } | undefined;
}

const [issues, setIssues] = createSignal<AppIssue[]>([]);
let nextId = 1;

/** How long a confirmation stays on screen. */
const SUCCESS_MS = 4_000;

/** Last unexpected errors and confirmations, surfaced in non-blocking toasts. */
export { issues };

function push(message: string, tone: AppIssue["tone"], action?: AppIssue["action"]): number {
  const id = nextId++;
  setIssues((list) => [...list.slice(-2), { id, message, at: Date.now(), tone, action }]);
  return id;
}

/** Something to act on ("Import for Lux"): stays until used or dismissed. Returns its id. */
export function warn(message: string, action: NonNullable<AppIssue["action"]>): number {
  return push(message, "warn", action);
}

/** Set while the player opted in to crash reports (see `forwardCrashes`). */
let sendCrash: ((message: string, stack: string | null) => void) | undefined;

/** Bugs worth a crash report: uncaught errors and crashed panels, not expected failures. */
function isCrash(context: string | undefined): boolean {
  return context === "uncaught" || context === "unhandled promise" || (context?.startsWith("widget:") ?? false);
}

export function reportError(error: unknown, context?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  // Keep the console trace for developers; users get the toast.
  console.error(context ? `[${context}]` : "[error]", error);
  push(message, "error");
  if (sendCrash && isCrash(context)) sendCrash(`${context}: ${message}`, error instanceof Error ? (error.stack ?? null) : null);
}

/** At most this many crash reports per session, each distinct message once. */
const MAX_CRASH_REPORTS = 10;

/**
 * Opt-in crash reports (Settings → App): while the player's setting is on, UI crashes go to the
 * core, which scrubs them (names, ids, paths) and sends them. Nothing leaves while it's off; the
 * core checks the setting again on its side.
 */
export function forwardCrashes(transport: Transport): () => void {
  // The setting as last heard; asked for only when a crash happens (nothing at boot).
  let enabled: Promise<boolean> | undefined;
  const sent = new Set<string>();
  const stop = transport.listen("settings", (settings) => {
    enabled = Promise.resolve(settings.crashReports);
  });
  sendCrash = (message, stack) => {
    if (sent.has(message) || sent.size >= MAX_CRASH_REPORTS) return;
    sent.add(message);
    enabled ??= transport.call("get_settings").then(
      (settings) => settings.crashReports,
      () => false,
    );
    void enabled.then((on) => {
      if (!on) return;
      transport.call("report_error", { message, stack }).catch(() => {
        // Best effort: a report about a failing report helps nobody.
      });
    });
  };
  return () => {
    stop();
    sendCrash = undefined;
  };
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
