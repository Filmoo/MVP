import type { PositionIcons } from "../generated/PositionIcons";
import type { RankEmblems } from "../generated/RankEmblems";
import type { Role } from "../generated/Role";
import type { Tier } from "../generated/Tier";
import { DEV_ASSET_BASE } from "./game-data";

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

const ROLES: Role[] = ["top", "jungle", "middle", "bottom", "support"];

/** Stand-ins for League's position icons (not Riot's art): a square per role, for the tests. */
export const positionIconsFixture: PositionIcons = {
  icons: ROLES.map((role) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34"><path d="M6 6h22v22H6z"/></svg>`;
    return { role, url: `data:image/svg+xml,${encodeURIComponent(svg)}` };
  }),
};

/**
 * League's position icons as the core hands them over, from the dev cache (fetch-dev-assets.mjs
 * downloads the client's files there, never committed); none without them (the UI's drawings).
 */
export async function devPositionIcons(): Promise<PositionIcons | null> {
  const icons = await Promise.all(
    ROLES.map(async (role) => {
      const res = await fetch(`${DEV_ASSET_BASE}/cdragon/position-${role === "support" ? "utility" : role}.svg`).catch(() => undefined);
      const svg = res?.ok ? await res.text() : "";
      // The drawing alone, like the core (a file missing from the cache comes back as the page).
      const start = svg.indexOf("<svg");
      return start < 0 || svg.includes("<html") ? [] : [{ role, url: `data:image/svg+xml,${encodeURIComponent(svg.slice(start))}` }];
    }),
  );
  return icons.flat().length > 0 ? { icons: icons.flat() } : null;
}
