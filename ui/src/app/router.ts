import { createSignal } from "solid-js";
import type { IconName } from "../design/Icon";

export interface Route {
  path: string;
  label: string;
  icon: IconName;
}

export const mainRoutes: readonly Route[] = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/draft", label: "Draft", icon: "draft" },
  { path: "/live", label: "Live game", icon: "live" },
  { path: "/champions", label: "Champions", icon: "champions" },
  { path: "/tier-list", label: "Tier list", icon: "tiers" },
];

export const settingsRoute: Route = {
  path: "/settings",
  label: "Settings",
  icon: "settings",
};

const fromHash = () => window.location.hash.replace(/^#/, "") || "/";
const [path, setPath] = createSignal(fromHash());
window.addEventListener("hashchange", () => setPath(fromHash()));

/** Current route path. Hash-based so it works identically in Tauri, tests and a future web build. */
export { path };

export function navigate(to: string): void {
  window.location.hash = to;
}
