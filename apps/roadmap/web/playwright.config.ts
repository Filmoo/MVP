import { defineConfig } from "@playwright/test";

const CI = Boolean(process.env.CI);
/** The test server's port; `MVP_ROADMAP_TEST_PORT` moves it when 4272 is taken. */
const PORT = Number(process.env.MVP_ROADMAP_TEST_PORT ?? 4272);

/**
 * The roadmap's UI against the real service (a debug build with `--dev-login`, a test database,
 * and `tests/fixtures/seed.json`, which every test resets to). One worker: the tests share the
 * server and its database.
 * - roadmap: board, drag, proposals, create/remove/undo, filters, palette, keyboard, layout
 *            400 → 2560, idle, Claude's command line, no console errors or CSP violations
 * - shots:   screenshots for design review in reports/roadmap (not asserted)
 */
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [["github"], ["list"]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    colorScheme: "dark",
    locale: "en-GB",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    // Builds the UI, then serves it (debug builds read web/dist from disk).
    command: `pnpm run build && cargo run --quiet -p mvp-roadmap -- serve --dev-login --bind 127.0.0.1:${PORT} --db ../../../.cache/roadmap/ui-tests.db --seed tests/fixtures/seed.json`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !CI,
    timeout: 900_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [
    { name: "roadmap", testMatch: /roadmap\.spec\.ts/ },
    { name: "shots", testMatch: /shots\.spec\.ts/ },
  ],
});
