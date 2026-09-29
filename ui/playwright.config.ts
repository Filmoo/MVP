import { defineConfig } from "@playwright/test";

const CI = Boolean(process.env.CI);
/** Preview port; set `MVP_UI_PORT` to run suites from several checkouts side by side. */
const PORT = Number(process.env.MVP_UI_PORT ?? 4173);

/**
 * UI test projects (all run against the production build with mock scenarios):
 * (each of layout, coherence, errors and interactions also runs in French: `<name>-fr`)
 * - layout:    every view × scenario × window size keeps a sound layout
 * - coherence: rendered styles only use design tokens; views share one frame
 * - errors:    failure scenarios render the right states, nothing crashes
 * - interactions: controls do what they say (settings, core-driven navigation, toasts, search, live,
 *                 build imports, stats pages, match rows and their games, tooltips, the history's
 *                 filters, older games and LP, the last game's summary)
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
    // The app's language follows the webview's (`auto`): English unless a project says French.
    locale: "en-US",
  },
  webServer: {
    // The browser preview: the app with its mock scenarios (`pnpm build` is the desktop app's).
    command: `pnpm run build:preview && pnpm exec vite preview --outDir dist-preview --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
  projects: [
    { name: "layout", testMatch: /layout\.spec\.ts/ },
    { name: "coherence", testMatch: /coherence\.spec\.ts/ },
    { name: "errors", testMatch: /errors\.spec\.ts/ },
    { name: "interactions", testMatch: /(interactions|search|live|backdrop|imports|stats|matches|tooltips|history)\.spec\.ts/ },
    // The same suites in French (longer words, other formats): the views × sizes matrix at 400,
    // 1280 and 2560 px (tests/app.ts FRENCH_SIZES), everything else as in English.
    { name: "layout-fr", testMatch: /layout\.spec\.ts/, use: { locale: "fr-FR" } },
    { name: "coherence-fr", testMatch: /coherence\.spec\.ts/, use: { locale: "fr-FR" } },
    { name: "errors-fr", testMatch: /errors\.spec\.ts/, use: { locale: "fr-FR" } },
    {
      name: "interactions-fr",
      testMatch: /(interactions|search|live|backdrop|imports|stats|matches|tooltips|history)\.spec\.ts/,
      use: { locale: "fr-FR" },
    },
    // Timed without Playwright's trace: its screencast captures every frame, which slowed the
    // slowest view switch by half (the numbers are in reports/perf/latest.json anyway).
    { name: "perf", testMatch: /perf\.spec\.ts/, use: { trace: "off" } },
    { name: "showcase", testMatch: /showcase\.spec\.ts/ },
  ],
});
