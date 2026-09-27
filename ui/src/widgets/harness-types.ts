/** Contract of the test-only widget harness (`#/__harness`, mock builds). */
export interface HarnessMeasurement {
  renderMs: number[];
  domNodes: number;
}

export interface HarnessApi {
  names: string[];
  measure(name: string, runs: number): HarnessMeasurement;
}

declare global {
  interface Window {
    __SCOUT_HARNESS__?: HarnessApi;
  }
}
