import type { RankEmblems } from "../generated/RankEmblems";
import type { Tier } from "../generated/Tier";

const TIERS: Tier[] = ["iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"];

/**
 * Stand-ins for Riot's emblems (the real ones are downloaded by the core at run time and never
 * committed): a 4:3 image per tier, so the preview and the tests take the "Riot art" path.
 */
export const rankEmblemsFixture: RankEmblems = {
  emblems: TIERS.map((tier, i) => {
    const hue = (i * 36) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><path d="M32 4 48 24 32 44 16 24Z" fill="hsl(${hue} 60% 60%)"/></svg>`;
    return { tier, url: `data:image/svg+xml,${encodeURIComponent(svg)}` };
  }),
};
