import type { ClientStatus } from "../generated/ClientStatus";
import type { PlayerProfile } from "../generated/PlayerProfile";
import { DEFAULT_REMOTE_CONFIG } from "../remote-defaults";
import type { CommandName, Commands, EventName, Events } from "../transport";
import { champSelectDraft } from "./draft-fixtures";
import { corruptProfile, extremeProfile, newPlayerProfile, profile } from "./fixtures";
import { liveExtreme, liveFailed, liveGame, liveScouting, searchPlayer } from "./live-fixtures";
import {
  autoAcceptKilledConfig,
  bannersConfig,
  installId,
  requiredConfig,
  updateDownloading,
  updateReady,
  upToDate,
} from "./platform-fixtures";
import { customSettings, defaultSettings, saveSettings } from "./settings-fixtures";

/** Profile captured by `capture-profile`, served by the dev server; falls back to the fixture. */
async function loadCapturedProfile(): Promise<PlayerProfile> {
  try {
    const res = await fetch("/fixtures/profile.json");
    if (res.ok) return (await res.json()) as PlayerProfile;
  } catch {
    // no capture: fall through
  }
  return profile;
}

export type MockResponse<T, A = undefined> =
  | { data: T; delayMs?: number }
  /** Fails; `detail` is the structured error the core would send (e.g. a `BackendError`). */
  | { error: string; detail?: unknown; delayMs?: number }
  | { load: () => Promise<T>; delayMs?: number }
  /** Answers from the command's arguments (e.g. echoes saved settings). */
  | { handle: (args: A) => T; delayMs?: number };

export interface Scenario {
  description: string;
  responses: { [K in CommandName]?: MockResponse<Commands[K]["result"], Commands[K]["args"]> };
  /** Events emitted after the given delay (ms) once the app subscribes. */
  timeline?: ReadonlyArray<{
    afterMs: number;
    event: EventName;
    payload: Events[EventName];
  }>;
}

const connectedIdle: ClientStatus = { connection: "connected", phase: "idle" };

const base: Scenario["responses"] = {
  app_info: { data: { name: "MVP", version: "0.1.0", platform: "web", installId: null } },
  client_status: { data: connectedIdle },
  current_profile: { data: profile },
  draft_state: { data: null },
  get_settings: { data: defaultSettings },
  update_settings: { handle: (args) => saveSettings(args.settings), delayMs: 60 },
  view_changed: { data: null },
  // A lookup takes a moment, like the real backend with a warm cache.
  search_player: { handle: searchPlayer, delayMs: 350 },
  live_game: { data: null },
  retry_scouting: { data: null },
  remote_config: { data: DEFAULT_REMOTE_CONFIG },
  open_banner_link: { data: null },
  update_status: { data: upToDate },
  // A check takes a moment, then MVP is up to date.
  check_for_updates: { handle: () => upToDate, delayMs: 700 },
  install_update: { data: null },
  report_error: { data: null },
};

const inGame: ClientStatus = { connection: "connected", phase: "inGame" };

export const scenarios = {
  default: {
    description: "Client connected, rich profile.",
    responses: base,
  },
  me: {
    description: "Your own profile captured from the Riot API (.cache/fixtures/profile.json), else the default one.",
    responses: { ...base, current_profile: { load: loadCapturedProfile } },
  },
  "champ-select": {
    description: "Mid-draft: you're picking top against a locked Irelia.",
    responses: {
      ...base,
      client_status: { data: { connection: "connected", phase: "champSelect" } },
      draft_state: { data: champSelectDraft },
    },
  },
  "not-running": {
    description: "League client is not running; no profile.",
    responses: {
      ...base,
      client_status: { data: { connection: "notRunning", phase: "idle" } },
      current_profile: { data: null },
    },
  },
  "slow-loading": {
    description: "Core answers slowly: skeletons must show, no layout jump.",
    responses: {
      ...base,
      client_status: { data: connectedIdle, delayMs: 2_500 },
      current_profile: { data: profile, delayMs: 2_500 },
      get_settings: { data: defaultSettings, delayMs: 2_500 },
    },
  },
  "profile-error": {
    description: "Profile request fails: error state with retry.",
    responses: {
      ...base,
      current_profile: { error: "Riot services are unreachable (HTTP 503)" },
    },
  },
  "new-player": {
    description: "Unranked account without games.",
    responses: { ...base, current_profile: { data: newPlayerProfile } },
  },
  "widget-crash": {
    description: "Corrupt match payload: only the matches panel fails, the rest still renders.",
    responses: { ...base, current_profile: { data: corruptProfile } },
  },
  extreme: {
    description: "Longest names, biggest numbers: layout must not overflow.",
    responses: { ...base, current_profile: { data: extremeProfile } },
  },
  "settings-custom": {
    description: "Automations on (auto-accept after 4 s), app defaults changed.",
    responses: { ...base, get_settings: { data: customSettings } },
  },
  "settings-error": {
    description: "Settings can't be read: error state with retry.",
    responses: { ...base, get_settings: { error: "Settings file is locked by another program" } },
  },
  "settings-save-error": {
    description: "Saving fails: the switch flips back and the card says why.",
    responses: { ...base, update_settings: { error: "settings file not writable: Access is denied. (os error 5)", delayMs: 60 } },
  },
  "search-slow": {
    description: "Player lookups take 2.5 s: the search bar must not reorder or re-highlight when they land.",
    responses: { ...base, search_player: { handle: searchPlayer, delayMs: 2_500 } },
  },
  live: {
    description: "In game, every card in: rich, unranked, streamer-mode and card-less players.",
    responses: { ...base, client_status: { data: inGame }, live_game: { data: liveGame } },
  },
  "live-scouting": {
    description: "The game just loaded: names and champions first, the cards land 1.5 s later.",
    responses: { ...base, client_status: { data: inGame }, live_game: { data: liveScouting } },
    timeline: [{ afterMs: 1_500, event: "live", payload: liveGame }],
  },
  "live-failed": {
    description: "The backend can't be reached: the game still shows, with a retry in the head.",
    responses: { ...base, client_status: { data: inGame }, live_game: { data: liveFailed } },
  },
  "live-extreme": {
    description: "Longest names, apex ranks and every tag: cards must hold.",
    responses: { ...base, client_status: { data: inGame }, live_game: { data: liveExtreme } },
  },
  "live-error": {
    description: "The core can't read the game: error state with retry.",
    responses: { ...base, client_status: { data: inGame }, live_game: { error: "League client stopped answering (HTTP 503)" } },
  },
  "match-accepted": {
    description: "Auto-accept just accepted a match: a confirmation toast shows.",
    responses: { ...base, get_settings: { data: customSettings } },
    timeline: [{ afterMs: 300, event: "auto-accept", payload: { kind: "accepted" } }],
  },
  banners: {
    description: "Notices from our server: patch day (closable, with a link) and an EUW slowdown (stays while it lasts).",
    responses: { ...base, remote_config: { data: bannersConfig } },
  },
  "update-available": {
    description: "An update was downloaded: the 'Update ready — Restart' prompt shows (never during a game).",
    responses: { ...base, update_status: { data: updateReady } },
  },
  "update-downloading": {
    description: "An update is downloading (Settings → About shows its progress).",
    responses: { ...base, update_status: { data: updateDownloading } },
  },
  "update-required": {
    description: "This version is below the server's minimum: the app waits behind a polite 'update required' card.",
    responses: { ...base, remote_config: { data: requiredConfig }, update_status: { data: updateReady } },
  },
  "auto-accept-paused": {
    description: "The server's kill switch stopped auto-accept: Settings says so, the player's choice is kept.",
    responses: { ...base, get_settings: { data: customSettings }, remote_config: { data: autoAcceptKilledConfig } },
  },
  "crash-reports-on": {
    description: "The player opted in to crash reports: UI crashes go to the core, which scrubs and sends them.",
    responses: {
      ...base,
      get_settings: { data: { ...defaultSettings, crashReports: true } },
      app_info: { data: { name: "MVP", version: "0.1.0", platform: "web", installId } },
    },
  },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof scenarios;
export const scenarioNames = Object.keys(scenarios) as ScenarioName[];
