import { type JSX, lazy } from "solid-js";
import { Dynamic } from "solid-js/web";
import { queryParam } from "../../../app/router";

/**
 * Tier list design directions, side by side on the real route (dev server only):
 * `#/tier-list?design=shelves` (A), `ledger` (B), `map` (C). Each is the whole page.
 */
const DESIGNS: Record<string, () => JSX.Element> = {
  shelves: lazy(() => import("./Shelves").then((m) => ({ default: m.Shelves }))),
  ledger: lazy(() => import("./Ledger").then((m) => ({ default: m.Ledger }))),
  map: lazy(() => import("./MetaMap").then((m) => ({ default: m.MetaMap }))),
};

export default function Prototype(): JSX.Element {
  return <Dynamic component={DESIGNS[queryParam("design") ?? ""] ?? DESIGNS.shelves} />;
}
