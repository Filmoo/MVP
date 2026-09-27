import type { AppInfo } from "./generated/AppInfo";
import type { ClientStatus } from "./generated/ClientStatus";
import type { PlayerProfile } from "./generated/PlayerProfile";

/** Commands answered by the core. Keep in sync with `apps/desktop/src/commands.rs`. */
export interface Commands {
  app_info: { args: undefined; result: AppInfo };
  client_status: { args: undefined; result: ClientStatus };
  current_profile: { args: undefined; result: PlayerProfile | null };
}

/** Events pushed by the core. */
export interface Events {
  "client-status": ClientStatus;
}

export type CommandName = keyof Commands;
export type EventName = keyof Events;

export interface Transport {
  readonly kind: "tauri" | "mock";
  /** Base URL of Data Dragon assets (`…/cdn/<version>` layout). */
  readonly assetBase: string;
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
