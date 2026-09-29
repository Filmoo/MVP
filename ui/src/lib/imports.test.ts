import { describe, expect, it } from "vitest";
import type { ImportOutcome } from "../data/generated/ImportOutcome";
import type { ImportResult } from "../data/generated/ImportResult";
import type { ImportWarning } from "../data/generated/ImportWarning";
import {
  createImportMemory,
  importForLabel,
  listOf,
  lockInToasts,
  outcomeText,
  statusOf,
  toneOf,
  warningRequest,
  warningText,
} from "./imports";

const spell = (id: number) => ({ 4: "Flash", 14: "Ignite", 12: "Teleport" })[id] ?? `Spell ${id}`;

const result = (parts: ImportResult["parts"]): ImportResult => ({ championId: 103, role: "middle", queue: 420, automatic: true, parts });

describe("import words", () => {
  it("joins lists like a sentence", () => {
    expect(listOf(["runes"])).toBe("runes");
    expect(listOf(["runes", "spells"])).toBe("runes and spells");
    expect(listOf(["runes", "item set", "spells"])).toBe("runes, item set and spells");
  });

  it("says where Flash went", () => {
    const set: ImportOutcome = { kind: "spellsSet", spellIds: [14, 4], changed: true, flash: { kind: "keptOnYourKey", key: "f" } };
    expect(outcomeText("spells", set, spell)).toBe("Spells set: Ignite on D, Flash on F. Flash stays on F, your usual key.");
    expect(toneOf(set)).toBe("warn");
    expect(toneOf({ ...set, flash: null })).toBe("done");
  });

  it("says the client didn't answer instead of quoting a transport error as a refusal", () => {
    const text = outcomeText("runes", { kind: "failed", reason: { kind: "notAnswering" } }, spell);
    expect(text).toContain("didn't answer");
    expect(text).not.toContain("refused");
  });

  it("explains a full account and the last seconds", () => {
    expect(outcomeText("runes", { kind: "failed", reason: { kind: "noFreePage" } }, spell)).toContain("rename one to “MVP”");
    expect(outcomeText("spells", { kind: "skipped", reason: { kind: "tooLate", secondsLeft: 3 } }, spell)).toBe(
      "Spells not changed: only 3 s left in champion select.",
    );
  });

  it("puts what needs attention first in the status line", () => {
    const saved = { kind: "saved", name: "MVP · Ahri Mid" } as const;
    expect(
      statusOf(
        [
          { part: "runes", outcome: saved },
          { part: "itemSet", outcome: saved },
        ],
        spell,
      ),
    ).toEqual({ tone: "done", text: "Imported runes and item set." });
    expect(
      statusOf(
        [
          { part: "runes", outcome: saved },
          { part: "itemSet", outcome: { kind: "failed", reason: { kind: "client", message: "Busy (HTTP 503)" } } },
        ],
        spell,
      ),
    ).toEqual({ tone: "failed", text: "The League client refused: Busy (HTTP 503)" });
    // A click as champion select ends: what happened, not a failure that isn't one.
    expect(statusOf([{ part: "runes", outcome: { kind: "skipped", reason: { kind: "champSelectEnded" } } }], spell)).toEqual({
      tone: "skipped",
      text: "Champion select ended before the import.",
    });
    // A part MVP paused for everyone: the button did nothing, and the player should know why.
    expect(statusOf([{ part: "runes", outcome: { kind: "skipped", reason: { kind: "paused" } } }], spell)).toEqual({
      tone: "skipped",
      text: "Paused by MVP for now, while it's fixed for the latest League client.",
    });
  });

  it("toasts a lock-in import once, and each failure on its own", () => {
    const toasts = lockInToasts(
      result([
        { part: "runes", outcome: { kind: "saved", name: "MVP · Ahri Mid" } },
        { part: "itemSet", outcome: { kind: "failed", reason: { kind: "noBuild" } } },
        { part: "spells", outcome: { kind: "skipped", reason: { kind: "tooLate", secondsLeft: 2 } } },
      ]),
      "Ahri",
      spell,
    );
    expect(toasts).toEqual([
      { tone: "success", text: "Imported runes for Ahri. Spells not changed: only 2 s left in champion select." },
      { tone: "error", text: "Couldn't import item set for Ahri: No build for this champion and role in the stats yet." },
    ]);
    // The same reason for every part is said once.
    const ended = { kind: "skipped", reason: { kind: "champSelectEnded" } } as const;
    expect(
      lockInToasts(
        result([
          { part: "runes", outcome: ended },
          { part: "itemSet", outcome: ended },
        ]),
        "Ahri",
        spell,
      ),
    ).toEqual([{ tone: "success", text: "Ahri: Champion select ended before the import." }]);
  });

  it("says what MVP's build is for and what you play now", () => {
    const champion = (id: number) => ({ 103: "Ahri", 99: "Lux", 222: "Jinx" })[id] ?? `Champion ${id}`;
    const warning = (builtFor: ImportWarning["builtFor"], now: ImportWarning["now"]): ImportWarning => ({
      builtFor,
      now,
      parts: ["runes"],
    });
    // A trade: the role stays, the champion says it all.
    const trade = warning({ championId: 103, role: "middle" }, { championId: 99, role: "middle" });
    expect(warningText(trade, champion)).toBe("MVP's build is for Ahri Mid, you're now on Lux.");
    expect(importForLabel(trade, champion)).toBe("Import for Lux");
    // A role swap: the role is what changed.
    const swap = warning({ championId: 103, role: "middle" }, { championId: 103, role: "support" });
    expect(warningText(swap, champion)).toBe("MVP's build is for Ahri Mid, you're now on Ahri Support.");
    expect(importForLabel(swap, champion)).toBe("Import for Ahri Support");
    // ARAM: no roles.
    const reroll = warning({ championId: 222, role: null }, { championId: 99, role: null });
    expect(warningText(reroll, champion)).toBe("MVP's build is for Jinx, you're now on Lux.");
    expect(warningRequest(trade)).toEqual({
      championId: 99,
      role: "middle",
      queue: null,
      bracket: null,
      parts: ["runes"],
      champSelect: true,
    });
  });
});

describe("what an import bar keeps", () => {
  const saved = { kind: "saved", name: "MVP · Ahri Mid" } as const;
  const ahri = { championId: 103, role: "middle" } as const;
  const spells: ImportResult = {
    championId: 103,
    role: "middle",
    queue: 420,
    automatic: false,
    parts: [{ part: "spells", outcome: { kind: "spellsSet", spellIds: [4, 14], changed: true, flash: null } }],
  };

  it("keeps a result when the client sends its session again, even without the role or champion for a moment", () => {
    const memory = createImportMemory();
    memory.follow(ahri);
    memory.record(spells);
    // The spells change made the client send its session again: the same champion and role.
    memory.follow({ ...ahri });
    // …or a session with no position, or no champion, then the full one again.
    memory.follow({ championId: 103, role: null });
    memory.follow(null);
    memory.follow(ahri);
    const shown = memory.shown(ahri);
    expect(shown.results.spells?.kind).toBe("spellsSet");
    expect(shown.last.map((p) => p.part)).toEqual(["spells"]);
  });

  it("starts afresh for another champion or role, and a new champion select", () => {
    const memory = createImportMemory();
    memory.follow(ahri);
    memory.record({ ...spells, parts: [{ part: "runes", outcome: saved }] });
    memory.follow({ championId: 103, role: "support" });
    expect(memory.shown({ championId: 103, role: "support" }).results).toEqual({});
    memory.follow(ahri);
    expect(memory.shown(ahri).results, "MVP's page may be another's since").toEqual({});
    memory.record({ ...spells, parts: [{ part: "runes", outcome: saved }] });
    memory.follow({ championId: 99, role: "middle" });
    expect(memory.shown({ championId: 99, role: "middle" }).results).toEqual({});
    // An answer for the champion shown before still lands, for that champion only.
    memory.record(spells);
    expect(memory.shown(ahri).results.spells?.kind).toBe("spellsSet");
    expect(memory.shown({ championId: 99, role: "middle" }).results).toEqual({});
    // Champion select ended: the next one starts afresh.
    memory.reset();
    expect(memory.shown(ahri).results).toEqual({});
  });

  it("says when the core couldn't be asked", () => {
    const memory = createImportMemory();
    memory.follow(ahri);
    memory.record({ ...spells, parts: [{ part: "runes", outcome: saved }] });
    memory.fail(ahri, ["itemSet"], "MVP is still starting");
    const shown = memory.shown(ahri);
    expect(shown.unreachable).toBe("Couldn't import: MVP is still starting");
    expect(shown.results.itemSet?.kind).toBe("failed");
    expect(shown.results.runes, "earlier results stay").toEqual(saved);
    // The next answer is what the status line says.
    memory.record(spells);
    expect(memory.shown(ahri).unreachable).toBeUndefined();
  });
});
