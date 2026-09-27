import type { AppInfo } from "./generated/AppInfo";
import type { AutoAcceptEvent } from "./generated/AutoAcceptEvent";
import type { ClientStatus } from "./generated/ClientStatus";
import type { DraftView } from "./generated/DraftView";
import type { GameData } from "./generated/GameData";
import type { PlayerProfile } from "./generated/PlayerProfile";
import type { Settings } from "./generated/Settings";
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
  ) {
    super(message);
  }
}
