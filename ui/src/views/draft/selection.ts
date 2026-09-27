import type { DraftView } from "../../data/generated/DraftView";

/**
 * What the Why panel explains: the pick the player clicked while it is still a suggestion, else the
 * champion they are hovering ("is my hover good?"), else the top pick.
 */
export function selectedPick(draft: DraftView, clicked: number | undefined): number | undefined {
  const listed = (id: number | null | undefined): id is number =>
    id !== null && id !== undefined && draft.suggestions.some((s) => s.championId === id);
  if (listed(clicked)) return clicked;
  const mine = draft.allies.find((slot) => slot.isMe)?.championId;
  if (listed(mine)) return mine;
  return draft.suggestions[0]?.championId;
}
