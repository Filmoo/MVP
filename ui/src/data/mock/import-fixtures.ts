import type { ImportOutcome } from "../generated/ImportOutcome";
import type { ImportPart } from "../generated/ImportPart";
import type { ImportRequest } from "../generated/ImportRequest";
import type { ImportResult } from "../generated/ImportResult";
import type { Role } from "../generated/Role";

const FLASH = 4;
const TELEPORT = 12;

/** Champions of the fixtures, for the names MVP gives its page and set (like the core). */
const NAMES: Record<number, string> = { 54: "Malphite", 99: "Lux", 103: "Ahri" };
const ROLE_WORD: Record<Role, string> = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" };

/** "MVP · Malphite Top", "MVP · Lux ARAM": the core's `build_name`. */
function buildName(request: ImportRequest): string {
  const champion = NAMES[request.championId] ?? `Champion ${request.championId}`;
  const what = request.queue === 450 ? "ARAM" : request.role ? ROLE_WORD[request.role] : "";
  return `MVP · ${champion}${what ? ` ${what}` : ""}`;
}

/** A successful import of every part (Malphite top: the champ-select fixture's champion). */
function saved(request: ImportRequest): Record<ImportPart, ImportOutcome> {
  const name = buildName(request);
  return {
    runes: { kind: "saved", name },
    itemSet: { kind: "saved", name },
    spells: { kind: "spellsSet", spellIds: [FLASH, TELEPORT], changed: true, flash: null },
  };
}

/** Answers `import_build` like the core: one outcome per requested part (success unless given). */
export function importAnswer(outcomes: Partial<Record<ImportPart, ImportOutcome>> = {}) {
  return ({ request }: { request: ImportRequest }): ImportResult => {
    const done = saved(request);
    return {
      championId: request.championId,
      role: request.queue === 450 ? null : request.role,
      queue: request.queue ?? 420,
      automatic: false,
      parts: request.parts.map((part) => ({ part, outcome: outcomes[part] ?? done[part] })),
    };
  };
}

/** Every way a part can go wrong: the account is full, the client refuses, the clock ran out. */
export const importFailures: Partial<Record<ImportPart, ImportOutcome>> = {
  runes: { kind: "failed", reason: { kind: "noFreePage" } },
  itemSet: { kind: "failed", reason: { kind: "client", message: "Item sets are unavailable right now (HTTP 503)" } },
  spells: { kind: "skipped", reason: { kind: "tooLate", secondsLeft: 3 } },
};

/** The build lists Flash on D; the player's games say F: Flash stays on F. */
export const flashKept: Partial<Record<ImportPart, ImportOutcome>> = {
  spells: { kind: "spellsSet", spellIds: [TELEPORT, FLASH], changed: true, flash: { kind: "keptOnYourKey", key: "f" } },
};

/** The lock-in automation imported everything for Malphite, Flash kept on F. */
export const lockInImport: ImportResult = {
  championId: 54,
  role: "top",
  queue: 420,
  automatic: true,
  parts: [
    { part: "runes", outcome: { kind: "saved", name: "MVP · Malphite Top" } },
    { part: "itemSet", outcome: { kind: "saved", name: "MVP · Malphite Top" } },
    {
      part: "spells",
      outcome: { kind: "spellsSet", spellIds: [TELEPORT, FLASH], changed: true, flash: { kind: "keptOnYourKey", key: "f" } },
    },
  ],
};
