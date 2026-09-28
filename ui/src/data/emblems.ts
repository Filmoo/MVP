import { type Accessor, createSignal } from "solid-js";
import { useData } from "./context";
import type { RankEmblems } from "./generated/RankEmblems";
import type { Tier } from "./generated/Tier";

const [emblems, setEmblems] = createSignal<ReadonlyMap<Tier, string>>(new Map());
let asked = false;

const apply = (next: RankEmblems | null) => {
  if (next) setEmblems(new Map(next.emblems.map((e) => [e.tier, e.url])));
};

/**
 * Riot's ranked emblems (data URLs), as the core has them: asked once for the whole app, then
 * kept up to date by `rank-emblems` events. Empty until downloaded (components draw a crest).
 */
export function useRankEmblems(): Accessor<ReadonlyMap<Tier, string>> {
  const { transport } = useData();
  if (!asked) {
    asked = true;
    transport.call("rank_emblems").then(apply, () => {
      // No core (or no emblems yet): the crests stay.
    });
    transport.listen("rank-emblems", apply);
  }
  return emblems;
}
