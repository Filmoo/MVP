import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CommandError, type Transport } from "./transport";

const DDRAGON_VERSION = "16.19.1";

export function createTauriTransport(): Transport {
  return {
    kind: "tauri",
    assetBase: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`,
    async call(command, args) {
      try {
        return await invoke(command, args ?? {});
      } catch (error) {
        throw new CommandError(command, String(error));
      }
    },
    listen(event, handler) {
      let unlisten: (() => void) | undefined;
      let disposed = false;
      void listen<Parameters<typeof handler>[0]>(event, (e) => handler(e.payload)).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
  };
}
