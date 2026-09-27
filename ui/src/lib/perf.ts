/**
 * Lightweight render instrumentation read by the perf tests.
 * Each widget records `widget:<name>` = time from setup to its first painted frame.
 */
export function markWidgetMounted(name: string, startedAt: number): void {
  requestAnimationFrame(() => {
    performance.measure(`widget:${name}`, {
      start: startedAt,
      end: performance.now(),
    });
  });
}
