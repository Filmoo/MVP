import { createRoot, getOwner, type JSX, lazy, onCleanup } from "solid-js";
import { queryParam } from "../app/router";
import page from "../views/page.module.css";
import type {} from "./harness-types";
import { widgetRegistry } from "./registry";
import { Widget } from "./Widget";

/**
 * Test-only page (mock builds, `#/__harness`): mounts one widget at a time, synchronously,
 * inside the app's context (static data loaded), and reports its render cost.
 * `#/__harness?show=<widget>` shows that widget on its own instead (screenshots and layout
 * checks of widgets no page shows yet, such as `build-summary`); `?show=glass` the glass lab
 * (dev server only).
 */
// Dev server only (`pnpm dev`): production builds leave the labs out.
const GlassLab = import.meta.env.DEV ? lazy(() => import("./GlassLab")) : undefined;
const EmblemLab = import.meta.env.DEV ? lazy(() => import("./EmblemLab")) : undefined;
const DesignLab = import.meta.env.DEV ? lazy(() => import("./DesignLab")) : undefined;

export default function Harness(): JSX.Element {
  const shown = queryParam("show");
  // The glass lab: every kind of liquid glass over detailed content, to see how each shape bends it.
  if (GlassLab && shown === "glass") {
    return (
      <div class={page.page} data-harness>
        <GlassLab />
      </div>
    );
  }
  // Design pre-shoot: new icons, tier medallions, the penguin (dev server only).
  if (DesignLab && shown === "design") {
    return (
      <div class={page.page} data-harness>
        <DesignLab />
      </div>
    );
  }
  if (EmblemLab && shown === "emblems") {
    return (
      <div class={page.page} data-harness>
        <EmblemLab />
      </div>
    );
  }
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
