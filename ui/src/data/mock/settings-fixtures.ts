import { MAX_AUTO_ACCEPT_DELAY } from "../../lib/settings";
import type { Settings } from "../generated/Settings";

/** Mirrors `Settings::default()` in crates/domain/src/settings.rs. */
export const defaultSettings: Settings = {
  autoAccept: false,
  autoAcceptDelaySeconds: 2,
  bringToFrontOnChampSelect: true,
  autoSwitchView: true,
  launchAtStartup: false,
  closeToTray: true,
  effects: "auto",
  importRunes: "oneClick",
  importItemSet: "oneClick",
  importSpells: "oneClick",
  flashKey: "auto",
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
  importRunes: "onLockIn",
  importItemSet: "onLockIn",
  importSpells: "off",
  flashKey: "f",
};

/** Every part imported by itself on lock-in. */
export const lockInSettings: Settings = {
  ...defaultSettings,
  importRunes: "onLockIn",
  importItemSet: "onLockIn",
  importSpells: "onLockIn",
};

/** Every import turned off: no import bar in Draft. */
export const importsOffSettings: Settings = {
  ...defaultSettings,
  importRunes: "off",
  importItemSet: "off",
  importSpells: "off",
};

/** What the core does with an update: clamps the delay, then answers what it saved. */
export function saveSettings(next: Settings): Settings {
  return {
    ...next,
    autoAcceptDelaySeconds: Math.min(Math.max(0, Math.round(next.autoAcceptDelaySeconds)), MAX_AUTO_ACCEPT_DELAY),
  };
}
