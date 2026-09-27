/**
 * Lightweight render instrumentation read by the perf tests. Per widget:
 * - `widget:<name>:render` — setup → mounted: the widget's own JS + DOM work (stable);
 * - `widget:<name>` — setup → first painted frame (includes page layout, varies with load).
 */
export function markWidgetMounted(name: string, startedAt: number): void {
  performance.measure(`widget:${name}:render`, { start: startedAt, end: performance.now() });
  requestAnimationFrame(() => {
    performance.measure(`widget:${name}`, { start: startedAt, end: performance.now() });
  });
}
