/** Order within a version, the same rules as the service (apps/roadmap/src/store.rs). */
import type { Feature, Placement, Status } from "../types";

export const byPosition = (a: Feature, b: Feature): number => a.position - b.position || a.id - b.id;

/** A version's features in order, removed ones included (they keep their place). */
export function orderOf(features: Iterable<Feature>, versionId: number): Feature[] {
  return [...features].filter((f) => f.versionId === versionId).sort(byPosition);
}

/**
 * Where every feature of the versions a move touches ends up: `id` goes into `versionId` before
 * `beforeId` (or last), and both versions are numbered again from 0.
 */
export function placeMove(features: Feature[], id: number, versionId: number, beforeId: number | null): Placement[] {
  const moving = features.find((f) => f.id === id);
  if (!moving) return [];
  const target = orderOf(features, versionId)
    .filter((f) => f.id !== id)
    .map((f) => f.id);
  const found = beforeId === null ? -1 : target.indexOf(beforeId);
  target.splice(found < 0 ? target.length : found, 0, id);
  const placements = target.map((fid, position) => ({ id: fid, versionId, position }));
  if (moving.versionId !== versionId) {
    const rest = orderOf(features, moving.versionId).filter((f) => f.id !== id);
    placements.push(...rest.map((f, position) => ({ id: f.id, versionId: moving.versionId, position })));
  }
  return placements;
}

/** The feature after `id` in its version (to put it back there), or null when it is last. */
export function nextAfter(features: Feature[], id: number): number | null {
  const moving = features.find((f) => f.id === id);
  if (!moving) return null;
  const order = orderOf(features, moving.versionId);
  const index = order.findIndex((f) => f.id === id);
  return order[index + 1]?.id ?? null;
}

/**
 * Where a card dropped in a lane goes: before the lane's card at `index`, or, past the lane's
 * last card, at the end of the version (the lane shows it last either way).
 */
export function beforeIdForLane(lane: Feature[], index: number, draggedId: number): number | null {
  const others = lane.filter((f) => f.id !== draggedId);
  return others[index]?.id ?? null;
}

export interface Progress {
  total: number;
  done: number;
  inProgress: number;
  accepted: number;
  proposed: number;
}

/** A version's progress: features that count (not removed, not rejected). */
export function progress(features: Iterable<Feature>): Progress {
  const counts: Progress = { total: 0, done: 0, inProgress: 0, accepted: 0, proposed: 0 };
  const key: Partial<Record<Status, keyof Progress>> = {
    done: "done",
    in_progress: "inProgress",
    accepted: "accepted",
    proposed: "proposed",
  };
  for (const feature of features) {
    if (feature.removedAt || feature.status === "rejected") continue;
    counts.total += 1;
    const bucket = key[feature.status];
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

/** Done over total, 0 when empty. */
export function ratio(p: Progress): number {
  return p.total === 0 ? 0 : p.done / p.total;
}
