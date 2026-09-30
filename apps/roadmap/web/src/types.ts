/** The service's JSON (apps/roadmap/src/model.rs, api.rs): camelCase, RFC 3339 times. */

export type Status = "proposed" | "accepted" | "in_progress" | "done" | "rejected";
export type Proposer = "owner" | "claude";
export type ActorKind = "owner" | "claude" | "system" | "visitor";

export const STATUSES: readonly Status[] = ["proposed", "accepted", "in_progress", "done", "rejected"];
/** The board's lanes, in the order work flows. Rejected features show only when filtered in. */
export const LANES: readonly Status[] = ["proposed", "accepted", "in_progress", "done"];

export const STATUS_LABEL: Record<Status, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
};

export interface Actor {
  kind: ActorKind;
  name: string;
}

export interface Area {
  key: string;
  name: string;
  /** A design token's name (`accent`, `win`…): painted with `var(--<color>)`. */
  color: string;
  position: number;
}

export interface Version {
  id: number;
  name: string;
  goal: string;
  targetDate: string | null;
  releasedOn: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Link {
  id: number;
  url: string;
  label: string;
  createdAt: string;
}

export interface Feature {
  id: number;
  title: string;
  description: string;
  versionId: number;
  status: Status;
  area: string;
  proposedBy: Proposer;
  position: number;
  links: Link[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  doneAt: string | null;
  removedAt: string | null;
}

export interface Comment {
  id: number;
  featureId: number;
  author: Actor;
  body: string;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: Actor;
  action: string;
  featureId: number | null;
  versionId: number | null;
  summary: string;
  detail: unknown;
}

export interface Roadmap {
  versions: Version[];
  areas: Area[];
  features: Feature[];
}

export interface FeatureDetail {
  feature: Feature;
  comments: Comment[];
  activity: AuditEntry[];
}

export interface Placement {
  id: number;
  versionId: number;
  position: number;
}

export interface Moved {
  feature: Feature;
  placements: Placement[];
}

export interface Me {
  kind: ActorKind;
  login: string;
  name: string;
  avatarUrl: string;
  csrf: string | null;
  repo: string;
  dev: boolean;
}

export interface AuditPage {
  entries: AuditEntry[];
  next: number | null;
}
