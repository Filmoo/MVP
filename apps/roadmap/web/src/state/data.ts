/**
 * The roadmap as the page knows it: loaded once, changed optimistically by `ops.ts`, read again
 * when the tab comes back after a while (an event, never a timer: idle means idle).
 */
import { batch, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { ApiError, api, setCsrf } from "../api";
import { orderOf } from "../lib/order";
import type { Area, Feature, Me, Placement, Version } from "../types";

interface Data {
  loaded: boolean;
  error: string | null;
  versions: Version[];
  areas: Area[];
  features: Record<number, Feature>;
}

export const [data, setData] = createStore<Data>({ loaded: false, error: null, versions: [], areas: [], features: {} });

/** `undefined` while asking, `null` when signed out. */
export const [me, setMe] = createSignal<Me | null | undefined>(undefined);
/** Why the session ended mid-work (shown on the sign-in screen). */
export const [signedOutReason, setSignedOutReason] = createSignal<string | null>(null);

let loadedAt = 0;

export function signedOut(error: unknown): boolean {
  if (error instanceof ApiError && (error.status === 401 || error.code === "notAdmin")) {
    setSignedOutReason(error.message);
    setMe(null);
    return true;
  }
  return false;
}

export async function signIn(): Promise<void> {
  try {
    const who = await api.me();
    setCsrf(who.csrf);
    setMe(who);
  } catch (error) {
    // Not signed in yet is the normal start: only other failures need words.
    const quiet = error instanceof ApiError && error.status === 401;
    setSignedOutReason(quiet ? null : error instanceof Error ? error.message : String(error));
    setMe(null);
  }
}

export async function load(): Promise<void> {
  try {
    const roadmap = await api.roadmap();
    batch(() => {
      setData("versions", reconcile(roadmap.versions, { key: "id" }));
      setData("areas", reconcile(roadmap.areas, { key: "key" }));
      setData("features", reconcile(Object.fromEntries(roadmap.features.map((f) => [f.id, f]))));
      setData({ loaded: true, error: null });
    });
    loadedAt = Date.now();
  } catch (error) {
    if (!signedOut(error)) setData("error", error instanceof Error ? error.message : String(error));
  }
}

/** Back to the tab after a while: read the roadmap again (Claude may have proposed things). */
export function reloadIfStale(): void {
  if (data.loaded && Date.now() - loadedAt > 30_000) void load();
}

export function features(): Feature[] {
  return Object.values(data.features);
}

export function feature(id: number | null | undefined): Feature | undefined {
  return id === null || id === undefined ? undefined : data.features[id];
}

export function area(key: string): Area | undefined {
  return data.areas.find((a) => a.key === key);
}

export function areaName(key: string): string {
  return area(key)?.name ?? key;
}

/** `var(--<token>)` for an area's colour (the accent when unknown). */
export function areaColor(key: string): string {
  const color = area(key)?.color ?? "accent";
  return /^[a-z0-9-]+$/.test(color) ? `var(--${color})` : "var(--accent)";
}

export function version(id: number | null | undefined): Version | undefined {
  return data.versions.find((v) => v.id === id);
}

/** The live features of a version, in order. */
export function liveIn(versionId: number): Feature[] {
  return orderOf(features(), versionId).filter((f) => !f.removedAt);
}

/** Claude's proposals waiting for the owner, oldest first. */
export function proposals(): Feature[] {
  return features()
    .filter((f) => f.status === "proposed" && f.proposedBy === "claude" && !f.removedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

/** Where a version stands: released, being built, or planned. */
export function versionState(v: Version): "released" | "active" | "planned" {
  if (v.releasedOn) return "released";
  return features().some((f) => f.versionId === v.id && f.status === "in_progress" && !f.removedAt) ? "active" : "planned";
}

/** The version work goes to by default: the first one not released. */
export function currentVersion(): Version | undefined {
  return data.versions.find((v) => !v.releasedOn) ?? data.versions[data.versions.length - 1];
}

export function put(f: Feature): void {
  setData("features", f.id, reconcile(f));
}

export function place(placements: Placement[]): void {
  batch(() => {
    for (const p of placements) {
      if (data.features[p.id]) setData("features", p.id, { versionId: p.versionId, position: p.position });
    }
  });
}

export function drop(id: number): void {
  setData(
    "features",
    reconcile(
      Object.fromEntries(
        features()
          .filter((f) => f.id !== id)
          .map((f) => [f.id, f]),
      ),
    ),
  );
}
