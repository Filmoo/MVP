import { describe, expect, it } from "vitest";
import type { DraftView } from "../../data/generated/DraftView";
import { champSelectDraft } from "../../data/mock/draft-fixtures";
import { selectedPick } from "./selection";

const SHEN = 98;
const ORNN = 516;
const MALPHITE = 54;

/** The fixture with the local player hovering `championId` (or nothing). */
function hovering(championId: number | null): DraftView {
  return {
    ...champSelectDraft,
    allies: champSelectDraft.allies.map((slot) => (slot.isMe ? { ...slot, championId } : slot)),
  };
}

describe("selectedPick", () => {
  it("explains the champion the player hovers", () => {
    expect(selectedPick(hovering(ORNN), undefined)).toBe(ORNN);
  });

  it("prefers what the player clicked", () => {
    expect(selectedPick(hovering(ORNN), SHEN)).toBe(SHEN);
  });

  it("falls back to the top pick when nothing is hovered or the hover isn't a suggestion", () => {
    expect(selectedPick(hovering(null), undefined)).toBe(MALPHITE);
    expect(selectedPick(hovering(64), undefined)).toBe(MALPHITE);
  });

  it("drops a click on a champion that left the list (picked or banned since)", () => {
    const gone = { ...hovering(ORNN), suggestions: champSelectDraft.suggestions.filter((s) => s.championId !== SHEN) };
    expect(selectedPick(gone, SHEN)).toBe(ORNN);
  });

  it("selects nothing without suggestions", () => {
    expect(selectedPick({ ...champSelectDraft, suggestions: [] }, SHEN)).toBeUndefined();
  });
});
