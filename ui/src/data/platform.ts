import { type Accessor, createSignal, onCleanup } from "solid-js";
import { useData } from "./context";
import type { RemoteConfig } from "./generated/RemoteConfig";
import type { UpdateStatus } from "./generated/UpdateStatus";
import { DEFAULT_REMOTE_CONFIG } from "./remote-defaults";

export { DEFAULT_REMOTE_CONFIG, IN_GAME_PHASES } from "./remote-defaults";

/**
 * Follows `command`'s answer, then `event`. Plain signals (not resources): nothing suspends a
 * page, and the default shows until the core answers. An event beats a slower first answer.
 */
function follow<T>(initial: T, load: () => Promise<T>, subscribe: (set: (next: T) => void) => () => void): Accessor<T> {
  const [value, setValue] = createSignal(initial);
  let fresh = false;
  load().then(
    (answer) => {
      if (!fresh) setValue(() => answer);
    },
    () => {
      // The core can't say: keep the default.
    },
  );
  onCleanup(
    subscribe((next) => {
      fresh = true;
      setValue(() => next);
    }),
  );
  return value;
}

/** The server's remote config as the core holds it (banners, flags, kill switches, minimum version). */
export function useRemoteConfig(): Accessor<RemoteConfig> {
  const { transport } = useData();
  return follow(
    DEFAULT_REMOTE_CONFIG,
    () => transport.call("remote_config"),
    (set) => transport.listen("remote-config", set),
  );
}

export interface Updates {
  status: Accessor<UpdateStatus>;
  /** Checks now; resolves once the core answered (its events keep the status current). */
  check(): Promise<void>;
  /** Restarts into the downloaded update; rejects with the reason (e.g. during a game). */
  restart(): Promise<void>;
}

/** The app's own update, following `app-update` events. */
export function useUpdates(): Updates {
  const { transport } = useData();
  const [status, setStatus] = createSignal<UpdateStatus>({ state: "idle" });
  let fresh = false;
  transport.call("update_status").then(
    (answer: UpdateStatus) => {
      if (!fresh) setStatus(answer);
    },
    () => {
      // No updater (e.g. an older core): stays idle.
    },
  );
  onCleanup(
    transport.listen("app-update", (next: UpdateStatus) => {
      fresh = true;
      setStatus(next);
    }),
  );
  return {
    status,
    async check() {
      setStatus({ state: "checking" });
      try {
        setStatus(await transport.call("check_for_updates"));
      } catch (error) {
        setStatus({ state: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    },
    async restart() {
      await transport.call("install_update");
    },
  };
}
