import type { AppInfo } from "./generated/AppInfo";
import type { ClientStatus } from "./generated/ClientStatus";
import type { GameData } from "./generated/GameData";
import type { PlayerProfile } from "./generated/PlayerProfile";

/** Commands answered by the core. Keep in sync with `apps/desktop/src/commands.rs`. */
export interface Commands {
  app_info: { args: undefined; result: AppInfo };
  client_status: { args: undefined; result: ClientStatus };
  current_profile: { args: undefined; result: PlayerProfile | null };
  /** `null` until the core has loaded the current patch (a `game-data` event follows). */
  game_data: { args: undefined; result: GameData | null };
}

/** Events pushed by the core. */
export interface Events {
  "client-status": ClientStatus;
  "game-data": GameData;
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
