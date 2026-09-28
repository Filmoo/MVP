import type { FailReason } from "../data/generated/FailReason";
import type { FlashNote } from "../data/generated/FlashNote";
import type { ImportOutcome } from "../data/generated/ImportOutcome";
import type { ImportPart } from "../data/generated/ImportPart";
import type { ImportResult } from "../data/generated/ImportResult";
import type { PartResult } from "../data/generated/PartResult";
import type { SkipReason } from "../data/generated/SkipReason";
import type { SpellKey } from "../data/generated/SpellKey";
import { notify, reportError } from "./errors";

/** Words for build imports, shared by the Draft import bar and the lock-in toasts. */

export const IMPORT_PARTS: readonly ImportPart[] = ["runes", "itemSet", "spells"];

export const PART_LABEL: Record<ImportPart, string> = { runes: "Runes", itemSet: "Item set", spells: "Spells" };
const PART_NOUN: Record<ImportPart, string> = { runes: "runes", itemSet: "item set", spells: "spells" };

const KEY: Record<SpellKey, string> = { d: "D", f: "F" };

/** How a part's last import went, for its button and the status line. */
export type PartTone = "done" | "warn" | "skipped" | "failed";

export function failText(reason: FailReason, part: ImportPart): string {
  switch (reason.kind) {
    case "noClient":
      return "The League client isn't connected.";
    case "noBuild":
      return "No build for this champion and role in the stats yet.";
    case "noData":
      return part === "runes"
        ? "The stats have no full rune page for this build yet."
        : part === "itemSet"
          ? "The stats have no items for this build yet."
          : "The stats have no summoner spells for this build yet.";
    case "unsupportedMode":
      return "MVP has no builds for this game mode.";
    case "noFreePage":
      return "No free rune page: delete one, or rename one to “MVP” to let MVP use it.";
    case "client":
      return `The League client refused: ${reason.message}`;
  }
}

export function skipText(reason: SkipReason): string {
  switch (reason.kind) {
    case "off":
      return "Turned off in Settings.";
    case "paused":
      return "Paused by MVP for now, while it's fixed for the latest League client.";
    case "notInChampSelect":
      return "Spells can only change during champion select.";
    case "tooLate":
      return reason.secondsLeft > 0
        ? `Spells not changed: only ${reason.secondsLeft} s left in champion select.`
        : "Spells not changed: the game is starting.";
  }
}

export function flashText(note: FlashNote): string {
  switch (note.kind) {
    case "keptOnYourKey":
      return `Flash stays on ${KEY[note.key]}, your usual key.`;
    case "guessed":
      return `No Flash in your recent games, so it went on ${KEY[note.key]}. Pick your key in Settings.`;
    case "notInBuild":
      return "This build doesn't take Flash.";
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
export function outcomeText(part: ImportPart, outcome: ImportOutcome, spellName: (id: number) => string): string {
  switch (outcome.kind) {
    case "saved":
      return part === "runes" ? `“${outcome.name}” is your current rune page.` : `Item set “${outcome.name}” is in the shop.`;
    case "spellsSet": {
      const [d, f] = outcome.spellIds;
      const spells = `${spellName(d)} on D, ${spellName(f)} on F.`;
      const done = outcome.changed ? `Spells set: ${spells}` : `Spells already set: ${spells}`;
      return outcome.flash ? `${done} ${flashText(outcome.flash)}` : done;
    }
    case "skipped":
      return skipText(outcome.reason);
    case "failed":
      return failText(outcome.reason, part);
  }
}

const SEVERITY: Record<PartTone, number> = { done: 0, skipped: 1, warn: 2, failed: 3 };

/** "a", "a and b", "a, b and c". */
export function listOf(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * The status line after an import: the part that most needs attention (a failure, a Flash note,
 * a skip), else what was imported. Parts turned off in Settings aren't news.
 */
export function statusOf(parts: readonly PartResult[], spellName: (id: number) => string): { tone: PartTone; text: string } | undefined {
  const shown = parts.filter((p) => !(p.outcome.kind === "skipped" && p.outcome.reason.kind === "off"));
  const worst = [...shown].sort((a, b) => SEVERITY[toneOf(b.outcome)] - SEVERITY[toneOf(a.outcome)])[0];
  if (!worst) return undefined;
  const tone = toneOf(worst.outcome);
  const done = shown.filter((p) => toneOf(p.outcome) === "done");
  if (tone === "done" && done.length > 1) {
    return { tone, text: `Imported ${listOf(done.map((p) => PART_NOUN[p.part]))}.` };
  }
  return { tone, text: outcomeText(worst.part, worst.outcome, spellName) };
}

/**
 * Toasts for an automatic import on lock-in: what was imported (with the Flash note or a skip),
 * and each failure on its own.
 */
export function lockInToasts(
  result: ImportResult,
  championName: string,
  spellName: (id: number) => string,
): Array<{ tone: "success" | "error"; text: string }> {
  const toasts: Array<{ tone: "success" | "error"; text: string }> = [];
  const done = result.parts.filter((p) => p.outcome.kind === "saved" || p.outcome.kind === "spellsSet");
  const notes = result.parts.flatMap((p) => {
    if (p.outcome.kind === "spellsSet" && p.outcome.flash) return [flashText(p.outcome.flash)];
    if (p.outcome.kind === "skipped" && p.outcome.reason.kind !== "off") return [skipText(p.outcome.reason)];
    return [];
  });
  if (done.length > 0) {
    const text = `Imported ${listOf(done.map((p) => PART_NOUN[p.part]))} for ${championName}.`;
    toasts.push({ tone: "success", text: [text, ...notes].join(" ") });
  } else if (notes.length > 0) {
    toasts.push({ tone: "success", text: `${championName}: ${notes.join(" ")}` });
  }
  for (const p of result.parts) {
    if (p.outcome.kind === "failed") {
      toasts.push({
        tone: "error",
        text: `Couldn't import ${PART_NOUN[p.part]} for ${championName}: ${outcomeText(p.part, p.outcome, spellName)}`,
      });
    }
  }
  return toasts;
}

/** Shows the toasts of an automatic import on lock-in (see `lock-in-toasts.ts`). */
export function showLockInToasts(result: ImportResult, championName: string, spellName: (id: number) => string): void {
  for (const toast of lockInToasts(result, championName, spellName)) {
    if (toast.tone === "success") notify(toast.text);
    else reportError(toast.text, "import");
  }
}
