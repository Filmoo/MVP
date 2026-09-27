import type { ClientStatus } from "../generated/ClientStatus";
import type { CommandName, Commands, EventName, Events } from "../transport";
import { corruptProfile, extremeProfile, newPlayerProfile, profile } from "./fixtures";

export type MockResponse<T> = { data: T; delayMs?: number } | { error: string; delayMs?: number };

export interface Scenario {
  description: string;
  responses: { [K in CommandName]?: MockResponse<Commands[K]["result"]> };
  /** Events emitted after the given delay (ms) once the app subscribes. */
  timeline?: ReadonlyArray<{
    afterMs: number;
    event: EventName;
    payload: Events[EventName];
  }>;
}

const connectedIdle: ClientStatus = { connection: "connected", phase: "idle" };

const base: Scenario["responses"] = {
  app_info: { data: { name: "Scout", version: "0.1.0", platform: "web" } },
  client_status: { data: connectedIdle },
  current_profile: { data: profile },
};

export const scenarios = {
  default: {
    description: "Client connected, rich profile.",
    responses: base,
  },
  "not-running": {
    description: "League client is not running; no profile.",
    responses: {
      ...base,
      client_status: { data: { connection: "notRunning", phase: "idle" } },
      current_profile: { data: null },
    },
  },
  "slow-loading": {
    description: "Core answers slowly: skeletons must show, no layout jump.",
    responses: {
      ...base,
      client_status: { data: connectedIdle, delayMs: 2_500 },
      current_profile: { data: profile, delayMs: 2_500 },
    },
  },
  "profile-error": {
    description: "Profile request fails: error state with retry.",
    responses: {
      ...base,
      current_profile: { error: "Riot services are unreachable (HTTP 503)" },
    },
  },
  "new-player": {
    description: "Unranked account without games.",
    responses: { ...base, current_profile: { data: newPlayerProfile } },
  },
  "widget-crash": {
    description: "Corrupt match payload: only the matches panel fails, the rest still renders.",
    responses: { ...base, current_profile: { data: corruptProfile } },
  },
  extreme: {
    description: "Longest names, biggest numbers: layout must not overflow.",
    responses: { ...base, current_profile: { data: extremeProfile } },
  },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof scenarios;
export const scenarioNames = Object.keys(scenarios) as ScenarioName[];
