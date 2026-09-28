import { describe, expect, it } from "vitest";
import type { ImportOutcome } from "../data/generated/ImportOutcome";
import type { ImportResult } from "../data/generated/ImportResult";
import { listOf, lockInToasts, outcomeText, statusOf, toneOf } from "./imports";

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
    // Parts turned off aren't news.
    expect(statusOf([{ part: "spells", outcome: { kind: "skipped", reason: { kind: "off" } } }], spell)).toBeUndefined();
    // A part MVP paused for everyone is: the button did nothing, and the player should know why.
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
  });
});
