import { MAX_AUTO_ACCEPT_DELAY } from "../../lib/settings";
import type { Settings } from "../generated/Settings";

/**
 * Mirrors `Settings::default()` in crates/domain/src/settings.rs, but for the question asked once
 * about sharing Mayhem games: this player answered "Not now" (`first-start` asks it).
 */
export const defaultSettings: Settings = {
  autoAccept: false,
  autoAcceptDelaySeconds: 2,
  bringToFrontOnChampSelect: true,
  autoSwitchView: true,
  launchAtStartup: false,
  closeToTray: true,
  effects: "auto",
  language: "auto",
  autoImportRunes: false,
  autoImportItemSet: false,
  autoImportSpells: false,
  flashKey: "auto",
  statsBracket: "emeraldPlus",
  crashReports: false,
  shareMayhemGames: false,
};

/** A player who turned automations on and changed the app's defaults. */
export const customSettings: Settings = {
  autoAccept: true,
  autoAcceptDelaySeconds: 4,
  bringToFrontOnChampSelect: false,
  autoSwitchView: true,
  launchAtStartup: true,
  closeToTray: false,
  effects: "auto",
  language: "auto",
  autoImportRunes: true,
  autoImportItemSet: true,
  autoImportSpells: false,
  flashKey: "f",
  statsBracket: "diamondPlus",
  crashReports: false,
  shareMayhemGames: false,
};

/** Every part imported by itself at the first lock-in. */
export const autoImportSettings: Settings = {
  ...defaultSettings,
  autoImportRunes: true,
  autoImportItemSet: true,
  autoImportSpells: true,
};

/** What the core does with an update: clamps the delay, then answers what it saved. */
export function saveSettings(next: Settings): Settings {
  return {
    ...next,
    autoAcceptDelaySeconds: Math.min(Math.max(0, Math.round(next.autoAcceptDelaySeconds)), MAX_AUTO_ACCEPT_DELAY),
  };
}
