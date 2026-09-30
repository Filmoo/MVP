import { type Accessor, createSignal } from "solid-js";
import { useData } from "./context";
import type { Events } from "./transport";

/** Riot's art the core hands over: its event, and the command answering what it has so far. */
const COMMANDS = { "rank-emblems": "rank_emblems", "position-icons": "position_icons" } as const;
type ArtEvent = keyof typeof COMMANDS;

/**
 * Riot's art as the core has it (the League client's files, downloaded at run time and cached,
 * never bundled), as data URLs by key: asked once for the whole app, then kept up to date by the
 * core's event. Empty until then: components draw their own.
 */
export function coreArt<E extends ArtEvent, K>(
  event: E,
  entries: (art: Events[E]) => ReadonlyArray<readonly [K, string]>,
): () => Accessor<ReadonlyMap<K, string>> {
  const [art, setArt] = createSignal<ReadonlyMap<K, string>>(new Map());
  let asked = false;
  const apply = (next: Events[E] | null) => {
    if (next) setArt(new Map(entries(next)));
  };
  return () => {
    if (!asked) {
      asked = true;
      // The first component asks (in the app's tree); later ones only read what came.
      const { transport } = useData();
      transport.call(COMMANDS[event]).then(
        (next) => apply(next as Events[E] | null),
        () => {
          // No core (or nothing yet): components keep drawing their own.
        },
      );
      transport.listen(event, apply);
    }
    return art;
  };
}
