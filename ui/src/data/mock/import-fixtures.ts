import type { ImportOutcome } from "../generated/ImportOutcome";
import type { ImportPart } from "../generated/ImportPart";
import type { ImportRequest } from "../generated/ImportRequest";
import type { ImportResult } from "../generated/ImportResult";

const FLASH = 4;
const TELEPORT = 12;

/** A successful import of Malphite top (the champ-select fixture's champion). */
const SAVED: Record<ImportPart, ImportOutcome> = {
  runes: { kind: "saved", name: "MVP · Malphite Top" },
  itemSet: { kind: "saved", name: "MVP · Malphite Top" },
  spells: { kind: "spellsSet", spellIds: [FLASH, TELEPORT], changed: true, flash: null },
};

/** Answers `import_build` like the core: one outcome per requested part (`SAVED` unless given). */
export function importAnswer(outcomes: Partial<Record<ImportPart, ImportOutcome>> = {}) {
  return ({ request }: { request: ImportRequest }): ImportResult => ({
    championId: request.championId,
    role: request.role,
    queue: request.queue ?? 420,
    automatic: false,
    parts: request.parts.map((part) => ({ part, outcome: outcomes[part] ?? SAVED[part] })),
  });
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
