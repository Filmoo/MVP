import { type Accessor, batch, createEffect, createSignal, on, untrack } from "solid-js";

export interface Query<T> {
  /** The last answer; kept while a newer request runs, cleared by a failure. */
  data: Accessor<T | undefined>;
  /** Why the last request failed (`undefined` after a success). */
  error: Accessor<unknown>;
  /** A request is running. */
  loading: Accessor<boolean>;
  /** Asks again for the current key. */
  refetch: () => void;
}

/**
 * Data for a key that changes (queue, bracket, champion…): asks when the key changes and keeps
 * showing the last answer meanwhile, so switching a filter never blanks the page. Answers to
 * an older key are dropped. Unlike a resource, it never triggers the app's Suspense.
 */
export function createQuery<K, T>(key: Accessor<K>, fetch: (key: K) => Promise<T>): Query<T> {
  const [data, setData] = createSignal<T>();
  const [error, setError] = createSignal<unknown>();
  const [loading, setLoading] = createSignal(true);
  let ticket = 0;
  const run = (k: K) => {
    const mine = ++ticket;
    setLoading(true);
    fetch(k).then(
      (value) => {
        if (mine !== ticket) return;
        batch(() => {
          setData(() => value);
          setError(undefined);
          setLoading(false);
        });
      },
      (reason: unknown) => {
        if (mine !== ticket) return;
        batch(() => {
          setData(undefined);
          setError(() => reason ?? new Error("request failed"));
          setLoading(false);
        });
      },
    );
  };
  createEffect(on(key, run));
  return { data, error, loading, refetch: () => run(untrack(key)) };
}
