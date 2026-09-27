import { ErrorBoundary, type JSX, onMount } from "solid-js";
import { ErrorState } from "../design/States";
import { reportError } from "../lib/errors";
import { markWidgetMounted } from "../lib/perf";

/**
 * Boundary for every self-contained block of a view:
 * - a crash inside renders an error card for this widget only;
 * - mount time is recorded for the perf budget tests (`widget:<name>`).
 */
export function Widget(props: { name: string; class?: string | undefined; children: JSX.Element }): JSX.Element {
  const startedAt = performance.now();
  onMount(() => markWidgetMounted(props.name, startedAt));
  return (
    <section class={props.class} data-widget={props.name}>
      <ErrorBoundary
        fallback={(error, reset) => {
          reportError(error, `widget:${props.name}`);
          return <ErrorState title="This panel failed to load" message={String(error?.message ?? error)} onRetry={reset} />;
        }}
      >
        {props.children}
      </ErrorBoundary>
    </section>
  );
}
