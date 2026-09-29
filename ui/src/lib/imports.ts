import { createSignal } from "solid-js";
import type { FailReason } from "../data/generated/FailReason";
import type { FlashNote } from "../data/generated/FlashNote";
import type { ImportOutcome } from "../data/generated/ImportOutcome";
import type { ImportPart } from "../data/generated/ImportPart";
import type { ImportResult } from "../data/generated/ImportResult";
import type { ImportWarning } from "../data/generated/ImportWarning";
import type { Lock } from "../data/generated/Lock";
import type { PartResult } from "../data/generated/PartResult";
import type { SkipReason } from "../data/generated/SkipReason";
import type { SpellKey } from "../data/generated/SpellKey";
import type { Transport } from "../data/transport";
import { t } from "../i18n";
import { notify, reportError, warn } from "./errors";
import { listOf } from "./format";

export { listOf };

/** Words for build imports, shared by the Draft import bar and the automatic import's toasts. */

export const IMPORT_PARTS: readonly ImportPart[] = ["runes", "itemSet", "spells"];

/** Flash's summoner spell id: the imports name it in the game data's language (`Saut éclair`). */
export const FLASH_ID = 4;

/** Names of summoner spells by id, from game data (Flash, Ignite…). */
export type SpellName = (id: number) => string;

const KEY: Record<SpellKey, string> = { d: "D", f: "F" };

/** How a part's last import went, for its button and the status line. */
export type PartTone = "done" | "warn" | "skipped" | "failed";

export function failText(reason: FailReason, part: ImportPart): string {
  const fail = t().imports.fail;
  switch (reason.kind) {
    case "noClient":
      return fail.noClient;
    case "notAnswering":
      return fail.notAnswering;
    case "noBuild":
      return fail.noBuild;
    case "noData":
      return part === "runes" ? fail.noRunes : part === "itemSet" ? fail.noItems : fail.noSpells;
    case "unsupportedMode":
      return fail.unsupportedMode;
    case "noFreePage":
      return fail.noFreePage;
    case "client":
      return fail.client(reason.message);
  }
}

export function skipText(reason: SkipReason): string {
  const skip = t().imports.skip;
  switch (reason.kind) {
    case "paused":
      return skip.paused;
    case "notInChampSelect":
      return skip.notInChampSelect;
    case "champSelectEnded":
      return skip.champSelectEnded;
    case "tooLate":
      return skip.tooLate(reason.secondsLeft);
  }
}

export function flashText(note: FlashNote, spellName: SpellName): string {
  const flash = t().imports.flash;
  const name = spellName(FLASH_ID);
  switch (note.kind) {
    case "keptOnYourKey":
      return flash.kept(name, KEY[note.key]);
    case "guessed":
      return flash.guessed(name, KEY[note.key]);
    case "notInBuild":
      return flash.notInBuild(name);
  }
}

export function toneOf(outcome: ImportOutcome): PartTone {
  switch (outcome.kind) {
    case "saved":
      return "done";
    case "spellsSet":
      return outcome.flash ? "warn" : "done";
    case "skipped":
      return "skipped";
    case "failed":
      return "failed";
  }
}

/** One sentence about a part's import. `spellName` names summoner spells (Flash, Ignite…). */
export function outcomeText(part: ImportPart, outcome: ImportOutcome, spellName: SpellName): string {
  const words = t().imports;
  switch (outcome.kind) {
    case "saved":
      return part === "runes" ? words.savedRunes(outcome.name) : words.savedItemSet(outcome.name);
    case "spellsSet": {
      const [d, f] = outcome.spellIds;
      const spells = words.spellsOn(spellName(d), spellName(f));
      const done = outcome.changed ? words.spellsSet(spells) : words.spellsAlready(spells);
      return outcome.flash ? `${done} ${flashText(outcome.flash, spellName)}` : done;
    }
    case "skipped":
      return skipText(outcome.reason);
    case "failed":
      return failText(outcome.reason, part);
  }
}

const SEVERITY: Record<PartTone, number> = { done: 0, skipped: 1, warn: 2, failed: 3 };

const nouns = (parts: readonly PartResult[]) => listOf(parts.map((p) => t().imports.nouns[p.part]));

/**
 * The status line after an import: the part that most needs attention (a failure, a Flash note,
 * a skip), else what was imported.
 */
export function statusOf(parts: readonly PartResult[], spellName: SpellName): { tone: PartTone; text: string } | undefined {
  const worst = [...parts].sort((a, b) => SEVERITY[toneOf(b.outcome)] - SEVERITY[toneOf(a.outcome)])[0];
  if (!worst) return undefined;
  const tone = toneOf(worst.outcome);
  const done = parts.filter((p) => toneOf(p.outcome) === "done");
  if (tone === "done" && done.length > 1) return { tone, text: t().imports.imported(nouns(done)) };
  return { tone, text: outcomeText(worst.part, worst.outcome, spellName) };
}

/** Names champions by id, in the game data's language. */
export type ChampionName = (id: number) => string;

/** `Ahri Mid`; `Lux` without a role (blind pick, ARAM). */
export const lockName = (lock: Lock, champion: ChampionName): string =>
  lock.role ? `${champion(lock.championId)} ${t().roles[lock.role]}` : champion(lock.championId);

/** What the player has now, as the warning says it: the champion, with the role when that changed. */
const nowName = (warning: ImportWarning, champion: ChampionName): string =>
  warning.now.role && warning.now.role !== warning.builtFor.role ? lockName(warning.now, champion) : champion(warning.now.championId);

/** Draft's warning after the automatic import: "MVP's build is for Ahri Mid, you're now on Lux." */
export const warningText = (warning: ImportWarning, champion: ChampionName): string =>
  t().imports.warning.text(lockName(warning.builtFor, champion), nowName(warning, champion));

/** Its one click: "Import for Lux". */
export const importForLabel = (warning: ImportWarning, champion: ChampionName): string =>
  t().imports.warning.importFor(nowName(warning, champion));

/**
 * Toasts for an automatic import (or the warning's import made from a toast): what was imported
 * (with the Flash note or a skip), and each failure on its own.
 */
export function lockInToasts(
  result: ImportResult,
  championName: string,
  spellName: SpellName,
): Array<{ tone: "success" | "error"; text: string }> {
  const words = t().imports;
  const toasts: Array<{ tone: "success" | "error"; text: string }> = [];
  const done = result.parts.filter((p) => p.outcome.kind === "saved" || p.outcome.kind === "spellsSet");
  // Each note once: every part can be skipped for the same reason (champion select ended).
  const notes = [
    ...new Set(
      result.parts.flatMap((p) => {
        if (p.outcome.kind === "spellsSet" && p.outcome.flash) return [flashText(p.outcome.flash, spellName)];
        if (p.outcome.kind === "skipped") return [skipText(p.outcome.reason)];
        return [];
      }),
    ),
  ];
  if (done.length > 0) {
    toasts.push({ tone: "success", text: [words.importedFor(nouns(done), championName), ...notes].join(" ") });
  } else if (notes.length > 0) {
    toasts.push({ tone: "success", text: words.notesFor(championName, notes.join(" ")) });
  }
  for (const p of result.parts) {
    if (p.outcome.kind === "failed") {
      toasts.push({ tone: "error", text: words.failedFor(p.part, championName, outcomeText(p.part, p.outcome, spellName)) });
    }
  }
  return toasts;
}

/** Shows the toasts of an automatic import (see `lock-in-toasts.ts`). */
export function showLockInToasts(result: ImportResult, championName: string, spellName: SpellName): void {
  for (const toast of lockInToasts(result, championName, spellName)) {
    if (toast.tone === "success") notify(toast.text);
    else reportError(toast.text, "import");
  }
}

/** Whose results an import bar shows: the champion and role they were imported for. */
export interface Owner {
  championId: number;
  role: Lock["role"];
}

/** What a bar shows between imports. */
export interface Shown {
  /** Each part's last outcome. */
  results: Partial<Record<ImportPart, ImportOutcome>>;
  /** The last import's parts: the status line. */
  last: readonly PartResult[];
  /** The core couldn't be asked at all (still starting): said instead of the last outcome. */
  unreachable?: string | undefined;
}

interface Kept extends Shown {
  owner?: Owner | undefined;
}

/**
 * Same champion, and the same role unless one isn't known: a session the client sends again
 * without the position (or a view that briefly has no champion) is no change.
 */
const same = (a: Owner | undefined, b: Owner): boolean =>
  a !== undefined && a.championId === b.championId && (a.role === b.role || a.role === null || b.role === null);

/**
 * What an import bar remembers: each part's last outcome and the last import, for one champion
 * and role. Another champion or role starts afresh; the same one sent again keeps everything.
 */
export interface ImportMemory {
  /** The bar shows `owner` now (`null`: no champion yet, nothing changes). */
  follow(owner: Owner | null): void;
  /** What to show for `owner`: its own results only. */
  shown(owner: Owner | null): Shown;
  /** An import answered (any champion's: the latest answer wins). */
  record(result: ImportResult): void;
  /** An import of `parts` for `owner` couldn't be asked. */
  fail(owner: Owner, parts: readonly ImportPart[], message: string): void;
  /** Champion select ended: the next one starts afresh. */
  reset(): void;
}

const NOTHING: Shown = { results: {}, last: [] };

/** A memory for one bar. */
export function createImportMemory(): ImportMemory {
  const [kept, setKept] = createSignal<Kept>(NOTHING);
  /** Keeps what is `owner`'s (the role filled in once known), else starts afresh; then applies `change`. */
  const update = (owner: Owner, change: (base: Kept) => Partial<Kept> = () => ({})) => {
    const now = kept();
    const base = same(now.owner, owner) ? now : { ...NOTHING, owner };
    setKept({ ...base, ...(owner.role ? { owner } : {}), ...change(base) });
  };
  const merge = (base: Kept, outcomes: Array<[ImportPart, ImportOutcome]>) => ({ ...base.results, ...Object.fromEntries(outcomes) });
  return {
    follow(owner) {
      if (owner) update(owner);
    },
    shown(owner) {
      const now = kept();
      return owner && same(now.owner, owner) ? now : NOTHING;
    },
    reset() {
      setKept(NOTHING);
    },
    record(result) {
      update({ championId: result.championId, role: result.role }, (base) => ({
        results: merge(
          base,
          result.parts.map((p) => [p.part, p.outcome]),
        ),
        last: result.parts,
        unreachable: undefined,
      }));
    },
    fail(owner, parts, message) {
      const failed: ImportOutcome = { kind: "failed", reason: { kind: "client", message } };
      update(owner, (base) => ({
        results: merge(
          base,
          parts.map((part) => [part, failed]),
        ),
        unreachable: t().imports.failed(message),
      }));
    },
  };
}

/**
 * Draft's bar: its results outlive the view for the whole champion select (the client sends its
 * session again, Draft closes and opens again, the automatic import lands while Draft is closed).
 * Reset when champion select ends (`lock-in-toasts.ts`).
 */
export const draftImports: ImportMemory = createImportMemory();

/** The request of the warning's one click: its parts for the lock it names, for this champion select. */
export const warningRequest = (warning: ImportWarning) => ({
  championId: warning.now.championId,
  role: warning.now.role,
  queue: null,
  bracket: null,
  parts: [...warning.parts],
  champSelect: true,
});

/**
 * The warning as a toast while the player is elsewhere in MVP (Draft shows it in its bar). Its
 * one click imports what the warning lists at that moment, then says how it went, like the
 * automatic import. Returns the toast's id.
 */
export function showWarningToast(
  transport: Transport,
  current: () => ImportWarning | null,
  names: { champion: (id: number) => string | undefined; spell: (id: number) => string | undefined },
): number | undefined {
  const warning = current();
  if (!warning) return undefined;
  const champion = (id: number) => names.champion(id) ?? t().common.championN(id);
  const spell = (id: number) => names.spell(id) ?? t().common.spellN(id);
  return warn(warningText(warning, champion), {
    label: importForLabel(warning, champion),
    run: () => {
      const now = current();
      if (!now) return;
      const owner = { championId: now.now.championId, role: now.now.role };
      transport.call("import_build", { request: warningRequest(now) }).then(
        (result) => {
          draftImports.record(result);
          showLockInToasts(result, champion(result.championId), spell);
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          draftImports.fail(owner, now.parts, message);
          reportError(t().imports.failed(message), "import");
        },
      );
    },
  });
}
