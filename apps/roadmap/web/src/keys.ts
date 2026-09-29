/**
 * The keyboard: Ctrl+K anywhere; the rest only while nothing is being typed. Arrows (or HJKL)
 * walk the features of the view, letters act on the selected one (see the shortcuts dialog).
 */
import { matches } from "./lib/filters";
import { nextAfter } from "./lib/order";
import { areaName, data, feature, features, liveIn, me } from "./state/data";
import { accept, move, reject, remove, setStatus, undoLast } from "./state/ops";
import { go, openFeature, route, VIEWS } from "./state/route";
import { overlay, selected, setOverlay, setSearchFocus, setSelected, setTitleEdit, step } from "./state/ui";

/** Focuses a feature's element in what is in front: the inbox, else the view. */
export function focusFeature(id: number | null): void {
  if (id === null) return;
  queueMicrotask(() => {
    const scope = document.querySelector(route().panel === "inbox" && !route().feature ? "[data-testid=inbox]" : "[data-view]");
    scope?.querySelector<HTMLElement>(`[data-feature="${id}"]`)?.focus();
  });
}

function owner(): boolean {
  return me()?.kind === "owner";
}

/** Alt+arrows: another version, or a step up or down in the lane. */
function shift(key: string): void {
  const f = feature(selected());
  if (!f || f.removedAt || !owner()) return;
  const versions = data.versions.map((v) => v.id);
  const at = versions.indexOf(f.versionId);
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const to = versions[at + (key === "ArrowLeft" ? -1 : 1)];
    if (to !== undefined) void move(f.id, to, null).then(() => focusFeature(f.id));
    return;
  }
  const lane = liveIn(f.versionId).filter((x) => x.status === f.status && matches(x, route().filters, areaName));
  const index = lane.findIndex((x) => x.id === f.id);
  if (key === "ArrowUp" && index > 0) {
    void move(f.id, f.versionId, lane[index - 1]?.id ?? null).then(() => focusFeature(f.id));
  }
  if (key === "ArrowDown" && index >= 0 && index < lane.length - 1) {
    const below = lane[index + 1];
    if (below) void move(f.id, f.versionId, nextAfter(features(), below.id)).then(() => focusFeature(f.id));
  }
}

function act(key: string): boolean {
  const f = feature(selected());
  const lower = key.toLowerCase();
  if (!f || f.removedAt) return false;
  switch (lower) {
    case "enter":
      openFeature(f.id);
      return true;
    case "e":
      if (!owner()) return false;
      openFeature(f.id);
      setTitleEdit((n) => n + 1);
      return true;
    case "a":
      if (!owner() || f.status !== "proposed") return false;
      void accept(f.id);
      return true;
    case "r":
      if (!owner() || f.status !== "proposed") return false;
      void reject(f.id);
      return true;
    case "s":
      if (!owner()) return false;
      void setStatus(f.id, "in_progress");
      return true;
    case "d":
      if (!owner()) return false;
      void setStatus(f.id, "done");
      return true;
    case "m":
      if (!owner()) return false;
      setOverlay({ kind: "palette", mode: "move" });
      return true;
    case "delete":
    case "backspace":
      if (!owner()) return false;
      void remove(f.id).then((ok) => {
        if (ok && route().feature === f.id) openFeature(null);
      });
      return true;
    default:
      return false;
  }
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  h: [-1, 0],
  l: [1, 0],
  k: [0, -1],
  j: [0, 1],
};

export function onKey(event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const typing = target?.closest("input, textarea, select, [contenteditable='true']") !== null && target !== null;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    setOverlay(overlay()?.kind === "palette" ? null : { kind: "palette", mode: "all" });
    return;
  }
  if (typing || event.defaultPrevented) return;
  if (mod && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    void undoLast();
    return;
  }
  if (overlay() !== null) {
    // A dialog without the focus in it still closes with Escape.
    if (event.key === "Escape") setOverlay(null);
    return;
  }
  if (mod) return;
  if (event.altKey) {
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      shift(event.key);
    }
    return;
  }
  const arrow = ARROWS[event.key];
  if (arrow) {
    event.preventDefault();
    focusFeature(step(arrow[0], arrow[1]));
    return;
  }
  const view = VIEWS[Number(event.key) - 1];
  if (view && /^[1-3]$/.test(event.key)) {
    go({ view });
    return;
  }
  switch (event.key) {
    case "/":
      event.preventDefault();
      setSearchFocus((n) => n + 1);
      return;
    case "?":
      setOverlay({ kind: "keys" });
      return;
    case "n":
    case "N":
      if (owner()) {
        event.preventDefault();
        setOverlay({ kind: "create", versionId: null, status: null });
      }
      return;
    case "i":
    case "I":
      go({ panel: route().panel === "inbox" ? null : "inbox" });
      return;
    case "Escape":
      if (route().feature !== null) {
        const id = route().feature;
        openFeature(null);
        focusFeature(id);
      } else if (route().panel) go({ panel: null });
      else {
        setSelected(null);
        (document.activeElement as HTMLElement | null)?.blur();
      }
      return;
  }
  if (act(event.key)) event.preventDefault();
}
