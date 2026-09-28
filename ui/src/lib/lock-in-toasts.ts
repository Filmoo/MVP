import { createSignal } from "solid-js";
import type { ImportResult } from "../data/generated/ImportResult";
import type { Transport } from "../data/transport";
import { loadViewWords, t } from "../i18n";

const [lastLockIn, setLastLockIn] = createSignal<ImportResult>();

/**
 * The automatic import of the current champion select, if any: Draft's import bar shows it too,
 * even when it opens later. Cleared when champion select ends.
 */
export { lastLockIn };

/**
 * Follows automatic imports on lock-in: a toast for each, wherever the player is in the app.
 * The words load with the first import (they stay out of the startup bundle). Returns the
 * unsubscribe.
 */
export function listenForLockInImports(
  transport: Transport,
  names: () => { champion: (id: number) => string | undefined; spell: (id: number) => string | undefined },
): () => void {
  const stopImports = transport.listen("import", (result) => {
    if (!result.automatic) return;
    setLastLockIn(result);
    void Promise.all([import("./imports"), loadViewWords()]).then(([{ showLockInToasts }]) => {
      const { champion, spell } = names();
      showLockInToasts(result, champion(result.championId) ?? t().common.yourChampion, (id) => spell(id) ?? t().common.spellN(id));
    });
  });
  const stopStatus = transport.listen("client-status", (status) => {
    if (status.phase !== "champSelect") setLastLockIn(undefined);
  });
  return () => {
    stopImports();
    stopStatus();
  };
}
