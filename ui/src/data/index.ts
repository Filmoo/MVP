import type { Transport } from "./transport";

export * from "./transport";

/**
 * Picks the transport for the current host:
 * - inside the desktop app → Tauri IPC to the Rust core;
 * - in a plain browser (dev server, tests, demos) → scripted mock scenarios,
 *   selected with `?scenario=<name>`. The desktop build (`vite build --mode app`) leaves them out.
 */
export async function createTransport(): Promise<Transport> {
  if ("__TAURI_INTERNALS__" in window) {
    const { createTauriTransport } = await import("./tauri");
    return createTauriTransport();
  }
  if (!__MVP_MOCK__) throw new Error("This build of MVP only runs in its desktop app.");
  const { createMockTransport, scenarioFromUrl } = await import("./mock");
  return createMockTransport(scenarioFromUrl(window.location.search));
}
