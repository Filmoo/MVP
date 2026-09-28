import { type Accessor, createResource, onCleanup } from "solid-js";
import { useData } from "./context";
import type { ClientStatus } from "./generated/ClientStatus";

/** The League client's status, following `client-status` events (`undefined` until read). */
export function useClientStatus(): Accessor<ClientStatus | undefined> {
  const { transport } = useData();
  const [status, { mutate }] = createResource(() => transport.call("client_status").catch(() => undefined));
  onCleanup(transport.listen("client-status", (next) => mutate(next)));
  // Read only once ready: a pending resource would suspend the whole view.
  return () => (status.state === "ready" ? status() : undefined);
}
