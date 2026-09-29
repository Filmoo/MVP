/**
 * ARAM: Mayhem for the browser preview and the UI tests: made-up augments (invented names and
 * words, no game text or art in the repository), MVP's tiers, pick counts of shared games, and
 * each champion's augments ranked per rarity the way the core ranks them
 * (`crates/companion/src/mayhem.rs` `champion`).
 */
import type { AugmentCatalog } from "../generated/AugmentCatalog";
import type { AugmentInfo } from "../generated/AugmentInfo";
import type { AugmentPriorities } from "../generated/AugmentPriorities";
import type { AugmentPriority } from "../generated/AugmentPriority";
import type { AugmentRarity } from "../generated/AugmentRarity";
import type { AugmentTier } from "../generated/AugmentTier";
import type { Language } from "../generated/Language";
import type { MayhemAugments } from "../generated/MayhemAugments";
import type { MayhemChampion } from "../generated/MayhemChampion";
import type { MayhemOverview } from "../generated/MayhemOverview";
import type { MayhemTiers } from "../generated/MayhemTiers";
import type { PickCount } from "../generated/PickCount";
import { FIXTURE_NOW } from "./fixtures";

const NAMES: Record<AugmentRarity, string[]> = {
  silver: [
    "Quiet Tide",
    "Iron Veil",
    "Lucky Coin",
    "Paper Tiger",
    "Kite String",
    "Copper Lung",
    "Moss Step",
    "Salt Lamp",
    "Tin Drum",
    "Reed Flute",
    "Pebble Guard",
    "Warm Hearth",
    "Slow Burn",
    "Dust Devil",
  ],
  gold: [
    "Ember Rush",
    "Storm Anchor",
    "Frost Bloom",
    "Echo Chamber",
    "Velvet Fang",
    "Night Market",
    "River Song",
    "Sun Dial",
    "Thorn Garden",
    "Glass Harbor",
    "Honey Trap",
    "Wild Orchard",
    "Mirror Lake",
    "Last Lantern",
    "Second Wind Chime",
    "Bramble Coat",
  ],
  prismatic: [
    "Starfall",
    "Hollow Crown",
    "Ashen Oath",
    "Moonlit Step",
    "Comet Tail",
    "Aurora Engine",
    "Twin Suns",
    "Void Garden",
    "Crystal Choir",
    "Endless Summer",
  ],
};

const EFFECTS = [
  "Your attacks leave a trail of sparks that slows enemies for a moment.",
  "Gain a shield after using your ultimate.\nThe shield grows with your bonus health.",
  "Takedowns restore some of your health and mana.",
  "Your abilities cost nothing for a few seconds after a takedown.",
  "Gain movement speed toward enemy champions below half health.",
  "Every third hit on a champion deals extra magic damage around them.",
  "Heals and shields you cast on allies also affect you, at half strength.",
  "Standing still for a second grants armor and magic resist until you move.",
];

const RARITY_BASE: Record<AugmentRarity, number> = { silver: 9_100, gold: 9_300, prismatic: 9_500 };

/** Every made-up augment: ids by rarity, invented names and words, no icon (the tile shows initials). */
export const mayhemAugments: MayhemAugments = {
  patch: "16.19",
  augments: (Object.keys(NAMES) as AugmentRarity[]).flatMap((rarity) =>
    (NAMES[rarity] ?? []).map(
      (name, i): AugmentInfo => ({
        id: RARITY_BASE[rarity] + i,
        rarity,
        name,
        description: EFFECTS[(i + name.length) % EFFECTS.length] ?? "",
        icon: "",
      }),
    ),
  ),
};

/** Where the game's augment art is (the core builds the same URLs). */
const ICON_BASE = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";

/**
 * `?augments=dev` (dev server and screenshots, never the tests): the game's real augments
 * (`.cache/mayhem/augments.json`, built from the game's files by `mvp-backend mayhem augments`)
 * stand in for the made-up ones, rarity by rarity in id order, so the made-up tiers and pick
 * counts still line up. Their art loads from the game's files; their words are in the UI's
 * language, English where French is missing (as the core gives them). Made-up ones without the
 * file.
 */
export async function loadMayhemAugments(args?: { language: Language }): Promise<MayhemAugments> {
  if (new URLSearchParams(window.location.search).get("augments") !== "dev") return mayhemAugments;
  try {
    const res = await fetch("/dev-mayhem/augments.json");
    if (!res.ok) return mayhemAugments;
    const catalog = (await res.json()) as AugmentCatalog;
    const real = (rarity: AugmentRarity) => catalog.augments.filter((a) => a.rarity === rarity);
    const byRarity = { silver: real("silver"), gold: real("gold"), prismatic: real("prismatic") };
    const pick = (text: { en: string; fr: string }) => (args?.language === "fr" && text.fr.trim() ? text.fr : text.en);
    return {
      patch: catalog.patch,
      augments: mayhemAugments.augments.map((a) => {
        const game = byRarity[a.rarity][a.id - RARITY_BASE[a.rarity]];
        return game ? { ...a, name: pick(game.name), description: pick(game.description), icon: `${ICON_BASE}/${game.icon}` } : a;
      }),
    };
  } catch {
    return mayhemAugments;
  }
}

/** One of the longest real names, and a long description: rows must hold them. */
export const longAugment: AugmentInfo = {
  id: 9_999,
  rarity: "prismatic",
  name: "Transmogrified Celestial Quintessence Engine",
  description: `${EFFECTS[1]}\n${EFFECTS[5]} ${EFFECTS[6]}`,
  icon: "",
};

const ids = (rarity: AugmentRarity, at: number[]) => at.map((i) => RARITY_BASE[rarity] + i);

/** MVP's tiers: in each, first is best. */
export const mayhemTiers: MayhemTiers = {
  patch: "26.19",
  updatedAt: "2026-09-28",
  tiers: {
    S: [...ids("prismatic", [0, 2]), ...ids("gold", [0]), ...ids("prismatic", [4]), ...ids("silver", [0])],
    A: [...ids("gold", [1, 2, 3]), ...ids("silver", [1, 2]), ...ids("prismatic", [1, 3])],
    B: [...ids("gold", [4, 5, 6, 7]), ...ids("silver", [3, 4, 5]), ...ids("prismatic", [5])],
    C: [...ids("silver", [6, 7]), ...ids("gold", [8])],
  },
};

/** How often each augment was taken, from its id (deterministic). */
const picks = (id: number, salt: number) => ((id * 37 + salt * 101) % 97) + (id % 5) * 11;

/** Shared games of this patch: every augment's pick count over all champions. */
export const mayhemOverview: MayhemOverview = {
  tiers: mayhemTiers,
  popularity: {
    patch: "16.19",
    games: 1_284,
    players: 12_840,
    updatedAt: FIXTURE_NOW - 2 * 3_600_000,
    augments: mayhemAugments.augments.map((a) => ({ id: a.id, n: picks(a.id, 3) * 9 })).sort((a, b) => b.n - a.n || a.id - b.id),
  },
};

/** Nothing published yet: a new patch or a fresh server. */
export const emptyOverview: MayhemOverview = { tiers: null, popularity: null };

const MIN_GAMES = 30;
const PER_RARITY = 8;
const TIER_ORDER: AugmentTier[] = ["S", "A", "B", "C"];

function placed(tiers: MayhemTiers | null, id: number): { tier: AugmentTier; rank: number } | undefined {
  for (const tier of TIER_ORDER) {
    const at = tiers?.tiers[tier].indexOf(id) ?? -1;
    if (at >= 0) return { tier, rank: at + 1 };
  }
  return undefined;
}

/** A champion's shared games: some with plenty, some with a few, one with none (Teemo). */
export function championGames(championId: number): number {
  if (championId === 17) return 0;
  return championId % 3 === 0 ? 12 : 40 + (championId % 50);
}

/** One champion in Mayhem, ranked like the core ranks it. */
export function mayhemChampion(championId: number, overview: MayhemOverview = mayhemOverview): MayhemChampion {
  const games = overview.popularity ? championGames(championId) : 0;
  const byRate = games >= MIN_GAMES;
  // Up to about half of its games each, a few augments not at all.
  const share = (id: number) => Math.max(0, ((id * 37 + championId * 11) % 64) - 12) / 100;
  const counts = new Map<number, number>(games > 0 ? mayhemAugments.augments.map((a) => [a.id, Math.round(games * share(a.id))]) : []);
  const own: PickCount[] = [...counts]
    .map(([id, n]) => ({ id, n }))
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n || a.id - b.id);
  const priorities = (["silver", "gold", "prismatic"] as const).map((rarity): AugmentPriorities => {
    const entries = mayhemAugments.augments
      .filter((a) => a.rarity === rarity)
      .flatMap((a): AugmentPriority[] => {
        const where = placed(overview.tiers, a.id);
        const n = counts.get(a.id) ?? 0;
        if (!where && !(byRate && n > 0)) return [];
        return [{ id: a.id, tier: where?.tier ?? null, rank: where?.rank ?? null, picks: n, pickRate: byRate ? n / games : null }];
      })
      .sort((a, b) => {
        const tier = (e: AugmentPriority) => (e.tier ? TIER_ORDER.indexOf(e.tier) : TIER_ORDER.length);
        // The owner's tier and rank first; picks then order the untiered ones.
        return tier(a) - tier(b) || (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.picks - a.picks || a.id - b.id;
      })
      .slice(0, PER_RARITY);
    return { rarity, byPickRate: byRate, entries };
  });
  const items = [3089, 6655, 3157, 3020, 4645, 3135, 3165, 3116, 6653, 3102];
  return {
    championId,
    patch: overview.popularity ? overview.popularity.patch : null,
    games,
    minGames: MIN_GAMES,
    augments: own.slice(0, 10),
    items: games > 0 ? items.map((id, i) => ({ id, n: Math.max(1, Math.round(games * (0.7 - i * 0.06))) })) : [],
    priorities,
    tiered: overview.tiers !== null,
  };
}
