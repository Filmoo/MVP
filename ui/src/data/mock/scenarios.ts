import { loadEffects } from "../../design/backdrop/quality";
import { savedLanguage } from "../../i18n";
import type { BackendError } from "../generated/BackendError";
import type { Bracket } from "../generated/Bracket";
import type { ChampionPage } from "../generated/ChampionPage";
import type { ClientStatus } from "../generated/ClientStatus";
import type { PlayerProfile } from "../generated/PlayerProfile";
import type { Settings } from "../generated/Settings";
import type { TierList } from "../generated/TierList";
import { DEFAULT_REMOTE_CONFIG } from "../remote-defaults";
import { CommandError, type CommandName, type Commands, type EventName, type Events } from "../transport";
import {
  aramDraft,
  champSelectDraft,
  champSelectLocked,
  champSelectNoComps,
  champSelectNoStats,
  champSelectPlanning,
} from "./draft-fixtures";
import { rankEmblemsFixture } from "./emblem-fixtures";
import { corruptProfile, extremeProfile, newPlayerProfile, profile } from "./fixtures";
import { flashKept, importAnswer, importFailures } from "./import-fixtures";
import { liveExtreme, liveFailed, liveGame, liveScouting, otherProfile, searchPlayer } from "./live-fixtures";
import { detailsFrom, gradesFrom, withGrades } from "./match-fixtures";
import {
  autoAcceptKilledConfig,
  bannersConfig,
  installId,
  requiredConfig,
  updateDownloading,
  updateReady,
  upToDate,
} from "./platform-fixtures";
import { customSettings, defaultSettings, importsOffSettings, lockInSettings, saveSettings } from "./settings-fixtures";
import { mockChampionPage, mockStatsIndex, mockTierList } from "./stats-fixtures";

/** Published queues: anything else is "not published", like the core answers. */
function publishedQueue(command: CommandName, queue: number): 420 | 450 {
  if (queue === 420 || queue === 450) return queue;
  throw new CommandError(command, `queue ${queue} is not published`, { kind: "notFound" } satisfies BackendError);
}

const tierList = (args: { queue: number; bracket: Bracket }): TierList =>
  mockTierList(publishedQueue("tier_list", args.queue), args.bracket);
const championStats = (args: { championId: number; queue: number; bracket: Bracket }): ChampionPage =>
  mockChampionPage(args.championId, publishedQueue("champion_stats", args.queue), args.bracket);

/** Only ARAM is published (ranked answers "not published"). */
function aramOnly<A extends { queue: number }, T>(command: CommandName, answer: (args: A) => T): (args: A) => T {
  return (args) => {
    if (args.queue !== 450) throw new CommandError(command, "not published", { kind: "notFound" } satisfies BackendError);
    return answer(args);
  };
}

const notPublished = { error: "stats not published", detail: { kind: "notFound" } satisfies BackendError };
const offline = {
  error: "error sending request for url (http://127.0.0.1:8787/v1/stats/index)",
  detail: { kind: "network", message: "error sending request for url (http://127.0.0.1:8787/v1/stats/index)" } satisfies BackendError,
};

/** The captured profile once loaded: its rows open on made-up games around your real line. */
let captured: PlayerProfile = profile;

/** Profile captured by `capture-profile`, served by the dev server; falls back to the fixture. */
async function loadCapturedProfile(): Promise<PlayerProfile> {
  try {
    const res = await fetch("/fixtures/profile.json");
    if (res.ok) captured = (await res.json()) as PlayerProfile;
  } catch {
    // no capture: fall through
  }
  return captured;
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

/** What the core saved last, while the page lives (a reload starts from the defaults again). */
let savedSettings: Settings | undefined;

/** The backend answers player pages with every game's grade. */
const gradedSearch = (args: Commands["search_player"]["args"]) => withGrades(searchPlayer(args));
/** The games behind Home's and the player pages' rows. */
const details = detailsFrom([profile, otherProfile]);
const gameError = (message: string, detail: BackendError) => ({ error: message, detail, delayMs: 200 });

const base: Scenario["responses"] = {
  app_info: { data: { name: "MVP", version: "0.1.0", platform: "web", installId: null } },
  client_status: { data: connectedIdle },
  current_profile: { data: profile },
  // Your grades come after the list: the core reads each game whole from the client once.
  match_grades: { handle: gradesFrom([profile]), delayMs: 300 },
  match_details: { handle: details, delayMs: 250 },
  // Riot's emblems come from the core (downloaded at run time): the preview draws MVP's crests.
  rank_emblems: { data: null },
  draft_state: { data: null },
  // The browser preview has no core to persist settings: they last as long as the page, and the
  // effects and language choices live in localStorage.
  get_settings: { handle: () => ({ ...(savedSettings ?? defaultSettings), effects: loadEffects(), language: savedLanguage() }) },
  update_settings: {
    handle: (args) => {
      savedSettings = saveSettings(args.settings);
      return savedSettings;
    },
    delayMs: 60,
  },
  view_changed: { data: null },
  // A lookup takes a moment, like the real backend with a warm cache.
  search_player: { handle: gradedSearch, delayMs: 350 },
  live_game: { data: null },
  retry_scouting: { data: null },
  remote_config: { data: DEFAULT_REMOTE_CONFIG },
  open_banner_link: { data: null },
  update_status: { data: upToDate },
  // A check takes a moment, then MVP is up to date.
  check_for_updates: { handle: () => upToDate, delayMs: 700 },
  install_update: { data: null },
  report_error: { data: null },
  diagnostics: { data: "MVP 0.0.0 · browser preview\nLeague client: Connected, phase None\n\n--- no log file ---\n" },
  open_logs: { data: null },
  // Published champion stats (synthetic, see stats-fixtures.ts), answered from the core's cache.
  stats_index: { data: mockStatsIndex() },
  tier_list: { handle: tierList },
  champion_stats: { handle: championStats },
  // Champion pages import too (each takes a moment, like the real client).
  import_build: { handle: importAnswer(), delayMs: 400 },
};

const inGame: ClientStatus = { connection: "connected", phase: "inGame" };

/** Mid-draft, with imports that work (each takes a moment, like the real client). */
const champSelect: Scenario["responses"] = {
  ...base,
  client_status: { data: { connection: "connected", phase: "champSelect" } },
  draft_state: { data: champSelectDraft },
};

export const scenarios = {
  default: {
    description: "Client connected, rich profile.",
    responses: base,
  },
  me: {
    description:
      "Your own profile captured from the Riot API (.cache/fixtures/profile.json), else the default one; its games open on made-up lobbies around your line.",
    responses: {
      ...base,
      current_profile: { load: loadCapturedProfile },
      match_grades: { handle: (args) => gradesFrom([captured])(args), delayMs: 300 },
      match_details: { handle: (args) => detailsFrom([captured, otherProfile])(args), delayMs: 250 },
    },
  },
  "champ-select": {
    description: "Mid-draft: you're picking top against a locked Irelia. Imports work.",
    responses: champSelect,
  },
  "import-failures": {
    description: "Imports fail: no free rune page, the client refuses the item set, spells too late.",
    responses: { ...champSelect, import_build: { handle: importAnswer(importFailures), delayMs: 300 } },
  },
  "import-flash": {
    description: "The spells import keeps Flash on your key (F) although the build lists it on D.",
    responses: { ...champSelect, import_build: { handle: importAnswer(flashKept), delayMs: 300 } },
  },
  "import-lock-in": {
    description:
      "Imports on lock-in: you locked Malphite in with every part set to import by itself. Tests emit the import (`lockInImport`) themselves: a toast only lasts 4 s.",
    responses: { ...champSelect, draft_state: { data: champSelectLocked }, get_settings: { data: lockInSettings } },
  },
  "draft-no-stats": {
    description: "Champion select before stats exist: no picks, the import buttons say why they wait.",
    responses: { ...champSelect, draft_state: { data: champSelectNoStats } },
  },
  "draft-planning": {
    description: "Planning: nobody has picked or hovered yet, the team compositions wait for picks.",
    responses: { ...champSelect, draft_state: { data: champSelectPlanning } },
  },
  "draft-no-comps": {
    description: "Stats published before team compositions were: picks and odds, no compositions yet.",
    responses: { ...champSelect, draft_state: { data: champSelectNoComps } },
  },
  "aram-champ-select": {
    description: "ARAM: you have Lux, four champions on the bench and a reroll; ranked by the team's chance with each.",
    responses: { ...champSelect, draft_state: { data: aramDraft } },
  },
  "imports-off": {
    description: "Every import turned off in Settings: no import bar in Draft.",
    responses: { ...champSelect, get_settings: { data: importsOffSettings } },
  },
  "import-error": {
    description: "The core can't be asked (the app is still starting): the button says so.",
    responses: { ...champSelect, import_build: { error: "MVP is still starting, try again in a moment", delayMs: 200 } },
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
    description: "Longest names, biggest numbers: layout must not overflow (opened games too: every slot filled, longest names).",
    responses: {
      ...base,
      current_profile: { data: extremeProfile },
      match_grades: { handle: gradesFrom([extremeProfile], true), delayMs: 300 },
      match_details: { handle: detailsFrom([extremeProfile], true), delayMs: 250 },
    },
  },
  "match-details-slow": {
    description: "Opening a game takes 2.5 s: a skeleton the size of the table, then the game in place.",
    responses: { ...base, match_details: { handle: details, delayMs: 2_500 } },
  },
  "match-details-error": {
    description: "Opening a game fails (MVP's server unreachable): an error in place, with a retry.",
    responses: { ...base, match_details: gameError("backend unreachable", { kind: "network", message: "couldn't connect" }) },
  },
  "match-details-gone": {
    description: "The game isn't available anymore: says so, no retry.",
    responses: { ...base, match_details: gameError("not found", { kind: "notFound" }) },
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
    responses: { ...base, search_player: { handle: gradedSearch, delayMs: 2_500 } },
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
  emblems: {
    description: "The core has Riot's ranked emblems (stand-in images here): Home and Live show them.",
    responses: { ...base, rank_emblems: { data: rankEmblemsFixture }, client_status: { data: inGame }, live_game: { data: liveGame } },
  },
  "stats-empty": {
    description: "No champion stats published yet: the tier list and champion pages say so.",
    responses: { ...base, stats_index: { data: null }, tier_list: notPublished, champion_stats: notPublished },
  },
  "stats-offline": {
    description: "Offline without cached stats: the stats pages show an error with a retry.",
    responses: { ...base, stats_index: { data: null }, tier_list: offline, champion_stats: offline },
  },
  "stats-slow": {
    description: "Stats take 2.5 s: skeletons first, then the numbers without layout jumps.",
    responses: {
      ...base,
      stats_index: { data: mockStatsIndex(), delayMs: 2_500 },
      tier_list: { handle: tierList, delayMs: 2_500 },
      champion_stats: { handle: championStats, delayMs: 2_500 },
    },
  },
  "stats-aram-only": {
    description: "Only ARAM is published: ranked says so, switching to ARAM shows the stats.",
    responses: {
      ...base,
      tier_list: { handle: aramOnly("tier_list", tierList) },
      champion_stats: { handle: aramOnly("champion_stats", championStats) },
    },
  },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof scenarios;
export const scenarioNames = Object.keys(scenarios) as ScenarioName[];
