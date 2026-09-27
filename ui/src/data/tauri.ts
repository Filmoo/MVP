import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CommandError, errorMessage, type Transport } from "./transport";

export function createTauriTransport(): Transport {
  return {
    kind: "tauri",
    async call(command, args) {
      try {
        return await invoke(command, args ?? {});
      } catch (error) {
        throw new CommandError(command, errorMessage(error), typeof error === "object" ? error : undefined);
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
