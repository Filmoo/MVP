import type { AppInfo } from "./generated/AppInfo";
import type { AutoAcceptEvent } from "./generated/AutoAcceptEvent";
import type { Bracket } from "./generated/Bracket";
import type { ChampionPage } from "./generated/ChampionPage";
import type { ClientStatus } from "./generated/ClientStatus";
import type { DraftView } from "./generated/DraftView";
import type { GameData } from "./generated/GameData";
import type { GradedMatch } from "./generated/GradedMatch";
import type { ImportRequest } from "./generated/ImportRequest";
import type { ImportResult } from "./generated/ImportResult";
import type { Language } from "./generated/Language";
import type { LiveGame } from "./generated/LiveGame";
import type { MatchDetails } from "./generated/MatchDetails";
import type { PlayerProfile } from "./generated/PlayerProfile";
import type { RankEmblems } from "./generated/RankEmblems";
import type { RemoteConfig } from "./generated/RemoteConfig";
import type { RiotId } from "./generated/RiotId";
import type { Settings } from "./generated/Settings";
import type { StatsIndex } from "./generated/StatsIndex";
import type { TierList } from "./generated/TierList";
import type { UpdateStatus } from "./generated/UpdateStatus";
import type { ViewRoute } from "./generated/ViewRoute";

/** Commands answered by the core. Keep in sync with `apps/desktop/src/commands.rs`. */
export interface Commands {
  app_info: { args: undefined; result: AppInfo };
  client_status: { args: undefined; result: ClientStatus };
  /** Your profile from the League client; games already read whole carry their grade. */
  current_profile: { args: undefined; result: PlayerProfile | null };
  /**
   * Your grade in each of your listed games (`current_profile`'s ids), and the role you played
   * there as worked out from the whole game (the list only guesses it): the core reads each game
   * whole from the League client once, a few at a time. Remakes, modes without two teams of five
   * and ids that aren't your listed games answer `grade: null` (the last without any read).
   */
  match_grades: { args: { matchIds: string[] }; result: GradedMatch[] };
  /**
   * One finished game in full (both teams, every player's grade): yours from the League client,
   * anyone else's from our backend. Rejects with a `BackendError` as the error's `detail`.
   */
  match_details: { args: { matchId: string }; result: MatchDetails };
  /**
   * Names and asset ids of the current patch in `language` (the UI's, `auto` resolved: English
   * or French); `null` until the core has loaded them in it (a `game-data` event follows). Asking
   * in another language makes the core load that one and emit `game-data` again.
   */
  game_data: { args: { language: Language }; result: GameData | null };
  /** Riot's ranked emblems, `null` until the core has them (a `rank-emblems` event follows). */
  rank_emblems: { args: undefined; result: RankEmblems | null };
  /** Current champion select, `null` outside of it (`draft` events follow changes). */
  draft_state: { args: undefined; result: DraftView | null };
  get_settings: { args: undefined; result: Settings };
  /** Saves and applies; answers what was saved (normalized). Rejects when saving failed. */
  update_settings: { args: { settings: Settings }; result: Settings };
  /** The UI shows this route: the core's automatic view switches never fight the user. */
  view_changed: { args: { path: string }; result: null };
  /**
   * Another player's profile from our backend (`platform`: `euw1`…). Rejects with a
   * `BackendError` as the error's `detail` (not found, rate limited, unavailable, unreachable).
   */
  search_player: { args: { riotId: RiotId; platform: string }; result: PlayerProfile };
  /** The game being loaded or played with its scouting cards, `null` outside of a game (`live` events follow). */
  live_game: { args: undefined; result: LiveGame | null };
  /** Asks the core for the scouting cards again (after a failure). */
  retry_scouting: { args: undefined; result: null };
  /**
   * What our backend has published (patches, data sets, `current` patch), as the core last
   * fetched it; `null` when nothing is published yet, or offline without a cached copy.
   */
  stats_index: { args: undefined; result: StatsIndex | null };
  /**
   * The current patch's tier list for `queue` (420 = ranked solo/duo, 450 = ARAM) and `bracket`.
   * The core caches every stats file on disk per patch (revalidated with ETags), so this
   * answers offline too. Rejects with a `BackendError` as the error's `detail` when the file
   * is neither published nor cached (`notFound`), or can't be fetched.
   */
  tier_list: { args: { queue: number; bracket: Bracket }; result: TierList };
  /**
   * One champion's page (record, tiers, builds, matchups) for `queue` × `bracket`, current
   * patch. Missing files leave their part empty; rejects like `tier_list` when there is no
   * data set at all.
   */
  champion_stats: { args: { championId: number; queue: number; bracket: Bracket }; result: ChampionPage };
  /**
   * Imports parts of a build into the League client: MVP's own rune page (made current), its
   * item set for the champion, the summoner spells (champion select only, Flash on the player's
   * key, never in the timer's last seconds). Answers what happened to each part; parts turned
   * off in Settings are skipped.
   */
  import_build: { args: { request: ImportRequest }; result: ImportResult };
  /**
   * The server's remote config as the core last received it (banners, feature flags, kill
   * switches, `updateRequired`); defaults when it never answered. `remote-config` events follow.
   */
  remote_config: { args: undefined; result: RemoteConfig };
  /** Opens a banner's "More info" link in the browser (the core looks the link up by banner id). */
  open_banner_link: { args: { id: string }; result: null };
  /** Where the app's own update stands (`app-update` events follow). */
  update_status: { args: undefined; result: UpdateStatus };
  /** Checks for an update now; answers the status right after (events follow). */
  check_for_updates: { args: undefined; result: UpdateStatus };
  /**
   * Restarts MVP into the downloaded update. Rejects with the reason during champion select or
   * a game, or when nothing is downloaded.
   */
  install_update: { args: undefined; result: null };
  /** A UI crash, for the opt-in crash reports (the core drops it unless the player opted in). */
  report_error: { args: { message: string; stack: string | null }; result: null };
  /** A plain-text report for bug reports: versions, client state, data, settings, the log's end (scrubbed). */
  diagnostics: { args: undefined; result: string };
  /** Opens the folder of MVP's log files. */
  open_logs: { args: undefined; result: null };
}

/** Events pushed by the core. */
export interface Events {
  "client-status": ClientStatus;
  "game-data": GameData;
  /** Riot's ranked emblems, once the core has them (downloaded once, then from its cache). */
  "rank-emblems": RankEmblems;
  /** `null` when champion select ends. */
  draft: DraftView | null;
  settings: Settings;
  /** The core moves the UI along with the game (champ select → draft, in game → live…). */
  navigate: ViewRoute;
  "auto-accept": AutoAcceptEvent;
  /** `null` when the game ends. */
  live: LiveGame | null;
  /** The core fetched a newer stats index (new patch or republication): stats views refetch. */
  "stats-index": StatsIndex;
  /** An automatic import on lock-in finished (`automatic: true`). */
  import: ImportResult;
  /** A new remote config arrived: banners, flags and `updateRequired` apply at once. */
  "remote-config": RemoteConfig;
  "app-update": UpdateStatus;
}

export type CommandName = keyof Commands;
export type EventName = keyof Events;

export interface Transport {
  readonly kind: "tauri" | "mock";
  call<K extends CommandName>(command: K, args?: Commands[K]["args"]): Promise<Commands[K]["result"]>;
  listen<K extends EventName>(event: K, handler: (payload: Events[K]) => void): () => void;
}

/** Any failure of a core command, normalized so views can render one error UI. */
export class CommandError extends Error {
  override readonly name = "CommandError";
  constructor(
    readonly command: CommandName,
    message: string,
    /** The structured error the core answered, when it sent one (e.g. a `BackendError`). */
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

/** Words for an error the core answered as an object (`{ kind, message? }`) or a string. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const { message, kind } = error as { message?: unknown; kind?: unknown };
    if (typeof message === "string") return message;
    if (typeof kind === "string") return kind;
  }
  return String(error);
}
