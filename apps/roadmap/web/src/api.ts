/** The only door to the service: same-origin fetches, the CSRF header on every change. */
import type { Area, AuditPage, Comment, Feature, FeatureDetail, Link, Me, Moved, Roadmap, Status, Version } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrf = "";

export function setCsrf(token: string | null): void {
  csrf = token ?? "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "network", "The server can't be reached. Check your connection.");
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(response.status, failure.error ?? "http", failure.message ?? `The server answered ${response.status}.`);
  }
  return data as T;
}

export interface NewFeature {
  title: string;
  description: string;
  versionId: number;
  area: string;
  status?: Status;
}

export interface FeaturePatch {
  title?: string;
  description?: string;
  area?: string;
  versionId?: number;
}

export interface MoveTo {
  versionId: number;
  beforeId: number | null;
  status?: Status;
}

export interface VersionInput {
  name?: string;
  goal?: string;
  targetDate?: string | null;
  releasedOn?: string | null;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  roadmap: () => request<Roadmap>("GET", "/api/roadmap"),
  feature: (id: number) => request<FeatureDetail>("GET", `/api/features/${id}`),
  audit: (before?: number) => request<AuditPage>("GET", `/api/audit?limit=60${before === undefined ? "" : `&before=${before}`}`),
  createFeature: (input: NewFeature) => request<Feature>("POST", "/api/features", input),
  updateFeature: (id: number, patch: FeaturePatch) => request<Feature>("PATCH", `/api/features/${id}`, patch),
  setStatus: (id: number, status: Status) => request<Feature>("POST", `/api/features/${id}/status`, { status }),
  move: (id: number, to: MoveTo) => request<Moved>("POST", `/api/features/${id}/move`, to),
  remove: (id: number) => request<Feature>("DELETE", `/api/features/${id}`),
  restore: (id: number) => request<Feature>("POST", `/api/features/${id}/restore`, {}),
  comment: (id: number, body: string) => request<Comment>("POST", `/api/features/${id}/comments`, { body }),
  link: (id: number, url: string, label: string) => request<Link>("POST", `/api/features/${id}/links`, { url, label }),
  unlink: (id: number, linkId: number) => request<void>("DELETE", `/api/features/${id}/links/${linkId}`),
  createVersion: (input: VersionInput & { name: string }) => request<Version>("POST", "/api/versions", input),
  updateVersion: (id: number, patch: VersionInput) => request<Version>("PATCH", `/api/versions/${id}`, patch),
  moveVersion: (id: number, beforeId: number | null) => request<Version[]>("POST", `/api/versions/${id}/move`, { beforeId }),
  deleteVersion: (id: number) => request<void>("DELETE", `/api/versions/${id}`),
  createArea: (name: string) => request<Area>("POST", "/api/areas", { name }),
  logout: () => request<void>("POST", "/auth/logout"),
};
