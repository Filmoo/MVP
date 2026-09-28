import type { Accessor } from "solid-js";
import { useData } from "./context";
import { createFollowed } from "./follow";
import type { ClientStatus } from "./generated/ClientStatus";

/** The League client's status, following `client-status` events (`undefined` until read). */
export function useClientStatus(): Accessor<ClientStatus | undefined> {
  const { transport } = useData();
  const [status] = createFollowed(
    () => transport.call("client_status").catch(() => undefined),
    (set) => transport.listen("client-status", set),
  );
  // Read only once ready: a pending resource would suspend the whole view.
  return () => (status.state === "ready" ? status() : undefined);
}
