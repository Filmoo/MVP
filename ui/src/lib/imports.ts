import type { FailReason } from "../data/generated/FailReason";
import type { FlashNote } from "../data/generated/FlashNote";
import type { ImportOutcome } from "../data/generated/ImportOutcome";
import type { ImportPart } from "../data/generated/ImportPart";
import type { ImportResult } from "../data/generated/ImportResult";
import type { PartResult } from "../data/generated/PartResult";
import type { SkipReason } from "../data/generated/SkipReason";
import type { SpellKey } from "../data/generated/SpellKey";
import { t } from "../i18n";
import { notify, reportError } from "./errors";
import { listOf } from "./format";

export { listOf };

/** Words for build imports, shared by the Draft import bar and the lock-in toasts. */

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
    case "off":
      return skip.off;
    case "paused":
      return skip.paused;
    case "notInChampSelect":
      return skip.notInChampSelect;
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
 * a skip), else what was imported. Parts turned off in Settings aren't news.
 */
export function statusOf(parts: readonly PartResult[], spellName: SpellName): { tone: PartTone; text: string } | undefined {
  const shown = parts.filter((p) => !(p.outcome.kind === "skipped" && p.outcome.reason.kind === "off"));
  const worst = [...shown].sort((a, b) => SEVERITY[toneOf(b.outcome)] - SEVERITY[toneOf(a.outcome)])[0];
  if (!worst) return undefined;
  const tone = toneOf(worst.outcome);
  const done = shown.filter((p) => toneOf(p.outcome) === "done");
  if (tone === "done" && done.length > 1) return { tone, text: t().imports.imported(nouns(done)) };
  return { tone, text: outcomeText(worst.part, worst.outcome, spellName) };
}

/**
 * Toasts for an automatic import on lock-in: what was imported (with the Flash note or a skip),
 * and each failure on its own.
 */
export function lockInToasts(
  result: ImportResult,
  championName: string,
  spellName: SpellName,
): Array<{ tone: "success" | "error"; text: string }> {
  const words = t().imports;
  const toasts: Array<{ tone: "success" | "error"; text: string }> = [];
  const done = result.parts.filter((p) => p.outcome.kind === "saved" || p.outcome.kind === "spellsSet");
  const notes = result.parts.flatMap((p) => {
    if (p.outcome.kind === "spellsSet" && p.outcome.flash) return [flashText(p.outcome.flash, spellName)];
    if (p.outcome.kind === "skipped" && p.outcome.reason.kind !== "off") return [skipText(p.outcome.reason)];
    return [];
  });
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

/** Shows the toasts of an automatic import on lock-in (see `lock-in-toasts.ts`). */
export function showLockInToasts(result: ImportResult, championName: string, spellName: SpellName): void {
  for (const toast of lockInToasts(result, championName, spellName)) {
    if (toast.tone === "success") notify(toast.text);
    else reportError(toast.text, "import");
  }
}
