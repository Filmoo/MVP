import { createSignal } from "solid-js";
import type { Bracket } from "../data/generated/Bracket";

/** Longest auto-accept delay, in seconds. Mirrors `Settings::MAX_AUTO_ACCEPT_DELAY` (crates/domain). */
export const MAX_AUTO_ACCEPT_DELAY = 8;

/**
 * The stats bracket of the player's settings (the core applies it to the draft and imports); the
 * stats pages start from it. Set by the shell whenever settings are read or change.
 */
export const [settingsBracket, setSettingsBracket] = createSignal<Bracket>("emeraldPlus");
