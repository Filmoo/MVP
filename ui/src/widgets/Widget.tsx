import { ErrorBoundary, type JSX, onMount } from "solid-js";
import { ErrorState } from "../design/States";
import { t } from "../i18n";
import { reportError } from "../lib/errors";
import { markWidgetMounted } from "../lib/perf";

/**
 * Boundary for every self-contained block of a view:
 * - a crash inside renders an error card for this widget only;
 * - mount time is recorded for the perf budget tests (`widget:<name>`).
 *
 * `hideable`: the view may hide this widget (on some sizes because its content is shown another
 * way there, or when a search leaves it out); the layout tests then accept it hidden (never
 * squeezed).
 */
export function Widget(props: { name: string; class?: string | undefined; hideable?: boolean; children: JSX.Element }): JSX.Element {
  const startedAt = performance.now();
  onMount(() => markWidgetMounted(props.name, startedAt));
  return (
    <section class={props.class} data-widget={props.name} data-hideable={props.hideable ? "" : undefined}>
      <ErrorBoundary
        fallback={(error, reset) => {
          reportError(error, `widget:${props.name}`);
          return <ErrorState title={t().common.panelFailed} message={String(error?.message ?? error)} onRetry={reset} />;
        }}
      >
        {props.children}
      </ErrorBoundary>
    </section>
  );
}
