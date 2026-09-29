import { defineConfig } from "@playwright/test";

const CI = Boolean(process.env.CI);
/** The preview server's port (serve.mjs); `MVP_SITE_PORT` moves it when 4290 is taken. */
const PORT = Number(process.env.MVP_SITE_PORT ?? 4290);

/**
 * Website tests, against site/public served like production (serve.mjs: same headers and CSP).
 * GitHub's API is always mocked: the tests never leave this machine.
 * - smoke: every page in English and French at phone and desktop widths, release states,
 *          links, French typography, no-JS, caching, page weight, layout shifts
 * - shots: screenshots for design review, written to reports/site (not asserted)
 */
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  workers: CI ? 2 : 4,
  reporter: CI ? [["github"], ["list"]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    locale: "en-GB",
  },
  webServer: {
    command: `node serve.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !CI,
    timeout: 20_000,
  },
  projects: [
    { name: "smoke", testMatch: /site\.spec\.ts/ },
    { name: "shots", testMatch: /shots\.spec\.ts/ },
  ],
});
