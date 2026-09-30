import { createSignal } from "solid-js";
import type { IconName } from "../design/Icon";
import type { Messages } from "../i18n";

export interface Route {
  path: string;
  /** Its name and rail label: `t().nav[nav]`. */
  nav: Exclude<keyof Messages["nav"], "main">;
  /** Not built yet: the rail marks it. */
  planned?: boolean;
  icon: IconName;
  /** Other pages that belong to this section (its item stays lit there). */
  also?: readonly string[];
}

export const mainRoutes: readonly Route[] = [
  { path: "/", nav: "home", icon: "home" },
  { path: "/draft", nav: "draft", icon: "draft" },
  { path: "/live", nav: "live", icon: "live" },
  // Champions are found in the tier list: their pages (`/champions?id=…`) belong to it, and so
  // does ARAM: Mayhem's page (its last queue tab).
  { path: "/tier-list", nav: "tierList", icon: "tiers", also: ["/champions", "/mayhem"] },
];

export const settingsRoute: Route = { path: "/settings", nav: "settings", icon: "settings" };

/** `#/champions?id=103` → path `/champions`, query `id=103`. */
function fromHash(): { path: string; query: string } {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const q = hash.indexOf("?");
  return q < 0 ? { path: hash, query: "" } : { path: hash.slice(0, q) || "/", query: hash.slice(q + 1) };
}

const [location, setLocation] = createSignal(fromHash(), { equals: (a, b) => a.path === b.path && a.query === b.query });
window.addEventListener("hashchange", () => setLocation(fromHash()));

/** Current route path, without its query. Hash-based so it works identically in Tauri, tests and a future web build. */
export const path = () => location().path;

/** A query parameter of the current route (`#/champions?id=103`). */
export function queryParam(name: string): string | null {
  return new URLSearchParams(location().query).get(name);
}

export function navigate(to: string): void {
  window.location.hash = to;
}
