import { createRoot, getOwner, type JSX, onCleanup } from "solid-js";
import { queryParam } from "../app/router";
import page from "../views/page.module.css";
import type {} from "./harness-types";
import { widgetRegistry } from "./registry";
import { Widget } from "./Widget";

/**
 * Test-only page (mock builds, `#/__harness`): mounts one widget at a time, synchronously,
 * inside the app's context (static data loaded), and reports its render cost.
 * `#/__harness?show=<widget>` shows that widget on its own instead (screenshots and layout
 * checks of widgets no page shows yet, such as `build-summary`).
 */
export default function Harness(): JSX.Element {
  const shown = queryParam("show");
  const show = shown ? widgetRegistry[shown] : undefined;
  if (shown && show) {
    return (
      <div class={page.page} data-harness>
        <Widget name={shown}>{show()}</Widget>
      </div>
    );
  }

  const owner = getOwner();
  const host = (<div class={page.page} data-harness />) as HTMLDivElement;
  window.__SCOUT_HARNESS__ = {
    names: Object.keys(widgetRegistry),
    measure(name, runs) {
      const factory = widgetRegistry[name];
      if (!factory) throw new Error(`unknown widget ${name}`);
      const renderMs: number[] = [];
      let domNodes = 0;
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const dispose = createRoot((d) => {
          host.replaceChildren(factory() as Node);
          return d;
        }, owner ?? undefined);
        renderMs.push(performance.now() - t0);
        domNodes = host.querySelectorAll("*").length;
        dispose();
        host.replaceChildren();
      }
      return { renderMs, domNodes };
    },
  };
  onCleanup(() => {
    delete window.__SCOUT_HARNESS__;
  });
  return host;
}
