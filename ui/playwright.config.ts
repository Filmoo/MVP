import { defineConfig } from "@playwright/test";

const CI = Boolean(process.env.CI);
/** Preview port; set `MVP_UI_PORT` to run suites from several checkouts side by side. */
const PORT = Number(process.env.MVP_UI_PORT ?? 4173);

/**
 * UI test projects (all run against the production build with mock scenarios):
 * - layout:    every view × scenario × window size keeps a sound layout
 * - coherence: rendered styles only use design tokens; views share one frame
 * - errors:    failure scenarios render the right states, nothing crashes
 * - interactions: controls do what they say (settings, core-driven navigation, toasts, search, live,
 *                 build imports, stats pages)
 * - perf:      per-widget and global budgets (run with --workers=1)
 * - showcase:  screenshots for review (not asserted), written to reports/screenshots
 */
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  workers: CI ? 2 : 4,
  reporter: CI ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    colorScheme: "dark",
  },
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
  projects: [
    { name: "layout", testMatch: /layout\.spec\.ts/ },
    { name: "coherence", testMatch: /coherence\.spec\.ts/ },
    { name: "errors", testMatch: /errors\.spec\.ts/ },
    { name: "interactions", testMatch: /(interactions|search|live|backdrop|imports|stats)\.spec\.ts/ },
    { name: "perf", testMatch: /perf\.spec\.ts/ },
    { name: "showcase", testMatch: /showcase\.spec\.ts/ },
  ],
});
