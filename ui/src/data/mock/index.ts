import { CommandError, type CommandName, type Events, type Transport } from "../transport";
import { loadDevGameData } from "./game-data";
import { type Scenario, type ScenarioName, scenarios } from "./scenarios";

export {
  type Scenario,
  type ScenarioName,
  scenarioNames,
  scenarios,
} from "./scenarios";

export function scenarioFromUrl(search: string): Scenario {
  const name = new URLSearchParams(search).get("scenario") ?? "default";
  return scenarios[name as ScenarioName] ?? scenarios.default;
}

type Handler = (payload: never) => void;

/** Test/demo hooks exposed on `window.__SCOUT_MOCK__`. */
export interface MockControls {
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
  calls: CommandName[];
  /** Every call with its arguments, in order. */
  log: Array<{ command: CommandName; args: unknown }>;
}

declare global {
  interface Window {
    __SCOUT_MOCK__?: MockControls;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockTransport(scenario: Scenario): Transport {
  const handlers = new Map<string, Set<Handler>>();
  const calls: CommandName[] = [];
  const log: MockControls["log"] = [];

  const emit = (event: string, payload: unknown) => {
    for (const handler of handlers.get(event) ?? []) (handler as (p: unknown) => void)(payload);
  };
  window.__SCOUT_MOCK__ = { emit, calls, log };

  return {
    kind: "mock",
    async call(command, args) {
      calls.push(command);
      log.push({ command, args: structuredClone(args) });
      const response = scenario.responses[command];
      // Game data comes from the local Data Dragon cache unless a scenario overrides it.
      if (!response && command === "game_data") return (await loadDevGameData()) as never;
      if (!response) throw new CommandError(command, `mock scenario has no response for ${command}`);
      if (response.delayMs) await sleep(response.delayMs);
      if ("error" in response) throw new CommandError(command, response.error, response.detail);
      if ("load" in response) return (await response.load()) as never;
      if ("handle" in response) return structuredClone((response.handle as (a: unknown) => unknown)(args)) as never;
      return structuredClone(response.data) as never;
    },
    listen(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler as Handler);
      handlers.set(event, set);
      const timers = (scenario.timeline ?? [])
        .filter((step) => step.event === event)
        .map((step) => setTimeout(() => emit(event, step.payload), step.afterMs));
      return () => {
        set.delete(handler as Handler);
        for (const t of timers) clearTimeout(t);
      };
    },
  };
}
