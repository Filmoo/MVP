import { createSignal } from "solid-js";
import type { IconName } from "../design/Icon";

export interface Route {
  path: string;
  label: string;
  /** Under the icon in the rail. */
  short: string;
  /** Not built yet: the rail marks it. */
  planned?: boolean;
  icon: IconName;
}

export const mainRoutes: readonly Route[] = [
  { path: "/", label: "Home", short: "Home", icon: "home" },
  { path: "/draft", label: "Draft", short: "Draft", icon: "draft" },
  { path: "/live", label: "Live game", short: "Live", icon: "live" },
  { path: "/champions", label: "Champions", short: "Champs", icon: "champions" },
  { path: "/tier-list", label: "Tier list", short: "Tiers", icon: "tiers" },
];

export const settingsRoute: Route = {
  path: "/settings",
  label: "Settings",
  short: "Settings",
  icon: "settings",
};

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
