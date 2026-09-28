import type { RemoteConfig } from "./generated/RemoteConfig";

/** Mirrors `RemoteConfig::default()` (crates/domain): everything on, no kill switch, no banner. */
export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  features: {
    scouting: true,
    draftHelper: true,
    playerSearch: true,
    autoAccept: true,
    runeImport: true,
    itemSets: true,
    summonerSpells: true,
  },
  killSwitches: { autoAccept: false, runeImport: false, itemSets: false, summonerSpells: false },
  minVersion: null,
  updateRequired: false,
  banners: [],
  statsIndexUrl: null,
  pollAfterSecs: 6 * 60 * 60,
};

/** Phases in which MVP neither distracts nor installs anything (mirrors `companion::updates::in_game`). */
export const IN_GAME_PHASES: ReadonlySet<string> = new Set(["readyCheck", "champSelect", "loading", "inGame"]);
