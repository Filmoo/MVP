/**
 * Every change the page makes: shown at once (optimistic), sent, then either confirmed with the
 * server's answer or rolled back with a toast saying why. Changes that can be undone leave an
 * entry for Ctrl+Z and the toast's Undo.
 */
import { batch } from "solid-js";
import { api, type FeaturePatch, type NewFeature } from "../api";
import { nextAfter, placeMove } from "../lib/order";
import { type Feature, STATUS_LABEL, type Status } from "../types";
import { data, drop, feature, features, place, put, setData, signedOut, version } from "./data";
import { toast } from "./toasts";

interface Undo {
  label: string;
  run: () => Promise<boolean>;
}

const undos: Undo[] = [];

/** Keeps the undo and says what happened, with an Undo button. */
function done(text: string, undo: (() => Promise<boolean>) | null): void {
  if (!undo) {
    toast(text);
    return;
  }
  const entry: Undo = { label: text, run: undo };
  undos.push(entry);
  if (undos.length > 30) undos.shift();
  toast(text, {
    action: {
      label: "Undo",
      run: () => {
        const index = undos.indexOf(entry);
        if (index >= 0) undos.splice(index, 1);
        void entry.run();
      },
    },
  });
}

function failed(what: string, error: unknown): false {
  if (!signedOut(error)) {
    const why = error instanceof Error ? error.message : String(error);
    toast(`Couldn't ${what}: ${why}`, { tone: "error" });
  }
  return false;
}

export function canUndo(): boolean {
  return undos.length > 0;
}

/** Ctrl+Z: undoes the last change still on the stack. */
export async function undoLast(): Promise<void> {
  const last = undos.pop();
  if (!last) {
    toast("Nothing to undo");
    return;
  }
  await last.run();
}

const VERB: Record<Status, string> = {
  proposed: "Sent back to proposals",
  accepted: "Accepted",
  in_progress: "Started",
  done: "Done:",
  rejected: "Rejected",
};

function snapshot(f: Feature): Pick<Feature, "status" | "startedAt" | "doneAt" | "updatedAt"> {
  return { status: f.status, startedAt: f.startedAt, doneAt: f.doneAt, updatedAt: f.updatedAt };
}

export async function setStatus(id: number, to: Status, undoable = true): Promise<boolean> {
  const f = feature(id);
  if (!f || f.status === to) return false;
  const before = snapshot(f);
  const now = new Date().toISOString();
  setData("features", id, {
    status: to,
    startedAt: to === "in_progress" ? (f.startedAt ?? now) : f.startedAt,
    doneAt: to === "done" ? now : null,
  });
  try {
    put(await api.setStatus(id, to));
    done(`${VERB[to]} “${f.title}”`, undoable ? () => setStatus(id, before.status, false) : null);
    return true;
  } catch (error) {
    setData("features", id, before);
    return failed(`mark “${f.title}” ${STATUS_LABEL[to].toLowerCase()}`, error);
  }
}

/** Moves a feature into a version, before another feature (or last), maybe changing status. */
export async function move(id: number, versionId: number, beforeId: number | null, status?: Status, undoable = true): Promise<boolean> {
  const f = feature(id);
  if (!f) return false;
  const all = features();
  // Read before the optimistic change: `f` is the store's live object.
  const back = { versionId: f.versionId, beforeId: nextAfter(all, id), status: f.status, title: f.title };
  const touched = all
    .filter((x) => x.versionId === f.versionId || x.versionId === versionId)
    .map((x) => ({ id: x.id, versionId: x.versionId, position: x.position }));
  const before = snapshot(f);
  const newStatus = status !== undefined && status !== back.status ? status : undefined;
  batch(() => {
    place(placeMove(all, id, versionId, beforeId));
    if (newStatus) setData("features", id, "status", newStatus);
  });
  try {
    const moved = await api.move(id, { versionId, beforeId, ...(newStatus ? { status: newStatus } : {}) });
    batch(() => {
      place(moved.placements);
      put(moved.feature);
    });
    const where = versionId === back.versionId ? "Moved" : `Moved to ${version(versionId)?.name ?? "another version"}:`;
    done(
      newStatus ? `${VERB[newStatus]} “${back.title}”` : `${where} “${back.title}”`,
      undoable ? () => move(id, back.versionId, back.beforeId, newStatus ? back.status : undefined, false) : null,
    );
    return true;
  } catch (error) {
    batch(() => {
      place(touched);
      setData("features", id, before);
    });
    return failed(`move “${f.title}”`, error);
  }
}

export async function remove(id: number, undoable = true): Promise<boolean> {
  const f = feature(id);
  if (!f || f.removedAt) return false;
  setData("features", id, "removedAt", new Date().toISOString());
  try {
    put(await api.remove(id));
    done(`Removed “${f.title}”`, undoable ? () => restore(id, false) : null);
    return true;
  } catch (error) {
    setData("features", id, "removedAt", null);
    return failed(`remove “${f.title}”`, error);
  }
}

export async function restore(id: number, undoable = true): Promise<boolean> {
  const f = feature(id);
  if (!f?.removedAt) return false;
  const removedAt = f.removedAt;
  setData("features", id, "removedAt", null);
  try {
    put(await api.restore(id));
    done(`Restored “${f.title}”`, undoable ? () => remove(id, false) : null);
    return true;
  } catch (error) {
    setData("features", id, "removedAt", removedAt);
    return failed(`restore “${f.title}”`, error);
  }
}

/** Title, description, area; another version goes through `move`. */
export async function edit(id: number, patch: Omit<FeaturePatch, "versionId">, undoable = true): Promise<boolean> {
  const f = feature(id);
  if (!f) return false;
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== undefined && patch[k] !== f[k]);
  if (changed.length === 0) return false;
  const back: Omit<FeaturePatch, "versionId"> = Object.fromEntries(changed.map((k) => [k, f[k]]));
  const next: Omit<FeaturePatch, "versionId"> = Object.fromEntries(changed.map((k) => [k, patch[k]]));
  setData("features", id, next);
  try {
    put(await api.updateFeature(id, next));
    done(`Saved “${data.features[id]?.title ?? f.title}”`, undoable ? () => edit(id, back, false) : null);
    return true;
  } catch (error) {
    setData("features", id, back);
    return failed(`save “${f.title}”`, error);
  }
}

let temporary = -1;

/** Shows the new feature at once (under a temporary id), then with the server's. */
export async function create(input: NewFeature): Promise<Feature | null> {
  const id = temporary--;
  const now = new Date().toISOString();
  const position =
    Math.max(
      -1,
      ...features()
        .filter((f) => f.versionId === input.versionId)
        .map((f) => f.position),
    ) + 1;
  const status = input.status ?? "accepted";
  put({
    id,
    title: input.title.trim(),
    description: input.description,
    versionId: input.versionId,
    status,
    area: input.area,
    proposedBy: "owner",
    position,
    links: [],
    comments: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: status === "in_progress" || status === "done" ? now : null,
    doneAt: status === "done" ? now : null,
    removedAt: null,
  });
  try {
    const created = await api.createFeature(input);
    batch(() => {
      drop(id);
      put(created);
    });
    done(`Added “${created.title}” to ${version(created.versionId)?.name ?? "the roadmap"}`, () => remove(created.id, false));
    return created;
  } catch (error) {
    drop(id);
    failed(`add “${input.title.trim()}”`, error);
    return null;
  }
}

/** Accepting a proposal can pick its version on the way. */
export async function accept(id: number, versionId?: number): Promise<boolean> {
  const f = feature(id);
  if (!f) return false;
  if (versionId !== undefined && versionId !== f.versionId) return move(id, versionId, null, "accepted");
  return setStatus(id, "accepted");
}

export async function reject(id: number): Promise<boolean> {
  return setStatus(id, "rejected");
}

export { failed };
