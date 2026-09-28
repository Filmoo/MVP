import { createResource, onCleanup, type ResourceReturn } from "solid-js";

/**
 * A value the core answers once, then pushes by event (the draft, the live game, the client
 * status, the settings), as a resource: pending until the first answer, errored if the core
 * can't answer, `refetch` to ask again. An event that arrives while an answer is on its way wins
 * over that answer, which is older (see `follow` in platform.ts for the plain-signal version).
 */
export function createFollowed<T>(ask: () => Promise<T>, subscribe: (set: (next: T) => void) => () => void): ResourceReturn<T> {
  let heard: { value: T } | undefined;
  // Read through a function: an event can set it while the answer is awaited.
  const pushed = (): { value: T } | undefined => heard;
  const resource = createResource(async () => {
    heard = undefined;
    try {
      const answer = await ask();
      // Whatever was pushed wins, `null` included (e.g. champion select ended meanwhile).
      const latest = pushed();
      return latest ? latest.value : answer;
    } catch (error) {
      const latest = pushed();
      if (latest) return latest.value;
      throw error;
    }
  });
  onCleanup(
    subscribe((next) => {
      heard = { value: next };
      resource[1].mutate(() => next);
    }),
  );
  return resource;
}
