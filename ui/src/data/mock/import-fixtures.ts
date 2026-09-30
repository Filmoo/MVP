import type { ImportOutcome } from "../generated/ImportOutcome";
import type { ImportPart } from "../generated/ImportPart";
import type { ImportRequest } from "../generated/ImportRequest";
import type { ImportResult } from "../generated/ImportResult";
import type { ImportWarning } from "../generated/ImportWarning";
import type { Role } from "../generated/Role";

const FLASH = 4;
const TELEPORT = 12;

/** Champions of the fixtures, for the names MVP gives its page and set (like the core). */
const NAMES: Record<number, string> = { 54: "Malphite", 98: "Shen", 99: "Lux", 103: "Ahri" };
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

/**
 * You locked Shen in first (MVP imported his build by itself), then a trade gave you Malphite:
 * MVP's build is still Shen's, and it never imports again by itself.
 */
export const tradedWarning: ImportWarning = {
  builtFor: { championId: 98, role: "top" },
  now: { championId: 54, role: "top" },
  parts: ["runes", "itemSet", "spells"],
};

/**
 * The core's side of Draft's warning for a scenario: `import_warning` answers `initial` until an
 * import for the champion select, for the lock it names, takes its parts off; `import-warning`
 * then says what is left (`null`: nothing), like the core. Other imports answer as usual.
 */
export function warningResponses(initial: ImportWarning) {
  let warning: ImportWarning | null = initial;
  const answer = importAnswer();
  return {
    import_warning: { handle: () => warning },
    import_build: {
      handle: (args: { request: ImportRequest }) => {
        const { request } = args;
        const now = warning?.now;
        if (warning && now && request.champSelect && request.championId === now.championId && request.role === now.role) {
          const parts = warning.parts.filter((part) => !request.parts.includes(part));
          warning = parts.length > 0 ? { ...warning, parts } : null;
          window.__SCOUT_MOCK__?.emit("import-warning", warning);
        }
        return answer(args);
      },
      delayMs: 400,
    },
  };
}

/** The automatic import at the first lock-in imported everything for Malphite, Flash kept on F. */
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
