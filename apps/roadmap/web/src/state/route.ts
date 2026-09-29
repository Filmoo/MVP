/**
 * Where the page is, in its hash, so a reload or a shared link lands in the same place:
 * `#/board?area=draft&status=in_progress&q=glass&feature=12&panel=inbox`.
 */
import { createSignal } from "solid-js";
import { type Filters, fromParams, NO_FILTERS, toParams } from "../lib/filters";

export type View = "board" | "roadmap" | "list";
export type Panel = "inbox" | "activity" | null;

export const VIEWS: readonly View[] = ["board", "roadmap", "list"];

export interface Route {
  view: View;
  filters: Filters;
  feature: number | null;
  panel: Panel;
}

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(query);
  const view = (VIEWS as readonly string[]).includes(path) ? (path as View) : "board";
  const id = Number.parseInt(params.get("feature") ?? "", 10);
  const panel = params.get("panel");
  return {
    view,
    filters: fromParams(params),
    feature: Number.isFinite(id) ? id : null,
    panel: panel === "inbox" || panel === "activity" ? panel : null,
  };
}

export function toHash(route: Route): string {
  const params = toParams(route.filters);
  if (route.feature !== null) params.set("feature", String(route.feature));
  if (route.panel) params.set("panel", route.panel);
  const query = params.toString();
  return `#/${route.view}${query ? `?${query}` : ""}`;
}

const [current, setCurrent] = createSignal<Route>(parseHash(window.location.hash));
export const route = current;

window.addEventListener("hashchange", () => setCurrent(parseHash(window.location.hash)));

/** Goes somewhere; `replace` keeps typing in the search out of the history. */
export function go(patch: Partial<Route>, replace = false): void {
  const next = { ...current(), ...patch };
  const hash = toHash(next);
  if (hash === window.location.hash) return;
  if (replace) window.history.replaceState(null, "", hash);
  else window.history.pushState(null, "", hash);
  setCurrent(next);
}

export function setFilters(patch: Partial<Filters>, replace = true): void {
  go({ filters: { ...current().filters, ...patch } }, replace);
}

export function clearFilters(): void {
  go({ filters: NO_FILTERS });
}

export function openFeature(id: number | null): void {
  go({ feature: id });
}
