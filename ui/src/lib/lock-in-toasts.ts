import { createEffect, on } from "solid-js";
import type { ImportWarning } from "../data/generated/ImportWarning";
import type { Transport } from "../data/transport";
import { loadViewWords, t } from "../i18n";
import { dismissIssue } from "./errors";

type Names = () => { champion: (id: number) => string | undefined; spell: (id: number) => string | undefined };

/** Two warnings about the same change of lock (the parts it lists may differ). */
const sameChange = (a: ImportWarning, b: ImportWarning) =>
  a.builtFor.championId === b.builtFor.championId &&
  a.builtFor.role === b.builtFor.role &&
  a.now.championId === b.now.championId &&
  a.now.role === b.now.role;

/**
 * Follows the automatic import, wherever the player is in the app: a toast for each import, which
 * Draft's bar shows too, and a toast with its one click for Draft's warning (the player's
 * champion or role changed since) while they aren't on Draft, which shows it itself. The words
 * load with the first of them (they stay out of the startup bundle). Returns the unsubscribe.
 */
export function listenForLockInImports(transport: Transport, names: Names, onDraft: () => boolean): () => void {
  // Already loaded with Draft's code (preloaded at start), which keeps its bar's results in it.
  const module = () => import("./imports");
  const words = () => Promise.all([module(), loadViewWords()]).then(([loaded]) => loaded);
  const stopImports = transport.listen("import", (result) => {
    if (!result.automatic) return;
    void words().then(({ draftImports, showLockInToasts }) => {
      draftImports.record(result);
      const { champion, spell } = names();
      showLockInToasts(result, champion(result.championId) ?? t().common.yourChampion, (id) => spell(id) ?? t().common.spellN(id));
    });
  });
  let latest: ImportWarning | null = null;
  let toast: { id: number | undefined; about: ImportWarning } | undefined;
  const drop = () => {
    if (toast?.id !== undefined) dismissIssue(toast.id);
    toast = undefined;
  };
  // Draft opened: its bar says it, the toast would say it twice.
  createEffect(on(onDraft, (draft) => draft && drop(), { defer: true }));
  const stopWarnings = transport.listen("import-warning", (warning) => {
    latest = warning;
    // The same change with other parts: the toast stays, its click imports what is listed then.
    if (toast && warning && sameChange(toast.about, warning)) return;
    drop();
    if (!warning || onDraft()) return;
    const about = warning;
    toast = { id: undefined, about };
    void words().then(({ showWarningToast }) => {
      // Gone or changed while the words loaded.
      if (toast?.about !== about) return;
      toast.id = showWarningToast(transport, () => latest, names());
    });
  });
  // Champion select ended: Draft's bar starts afresh in the next one.
  const stopStatus = transport.listen("client-status", (status) => {
    if (status.phase !== "champSelect") void module().then(({ draftImports }) => draftImports.reset());
  });
  return () => {
    stopImports();
    stopWarnings();
    stopStatus();
  };
}
