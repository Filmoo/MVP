import type { AppInfo } from "./generated/AppInfo";
import type { AutoAcceptEvent } from "./generated/AutoAcceptEvent";
import type { Bracket } from "./generated/Bracket";
import type { ChampionPage } from "./generated/ChampionPage";
import type { ClientStatus } from "./generated/ClientStatus";
import type { DraftView } from "./generated/DraftView";
import type { GameData } from "./generated/GameData";
import type { ImportRequest } from "./generated/ImportRequest";
import type { ImportResult } from "./generated/ImportResult";
import type { LiveGame } from "./generated/LiveGame";
import type { PlayerProfile } from "./generated/PlayerProfile";
import type { RiotId } from "./generated/RiotId";
import type { Settings } from "./generated/Settings";
import type { StatsIndex } from "./generated/StatsIndex";
import type { TierList } from "./generated/TierList";
import type { ViewRoute } from "./generated/ViewRoute";

/** Commands answered by the core. Keep in sync with `apps/desktop/src/commands.rs`. */
export interface Commands {
  app_info: { args: undefined; result: AppInfo };
  client_status: { args: undefined; result: ClientStatus };
  current_profile: { args: undefined; result: PlayerProfile | null };
  /** `null` until the core has loaded the current patch (a `game-data` event follows). */
  game_data: { args: undefined; result: GameData | null };
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
}

/** Events pushed by the core. */
export interface Events {
  "client-status": ClientStatus;
  "game-data": GameData;
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
