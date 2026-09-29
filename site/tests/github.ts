import type { Page } from "@playwright/test";

/** GitHub's release list, shaped like api.github.com/repos/Filmoo/MVP/releases answers it. */
const download = (tag: string, name: string) => `https://github.com/Filmoo/MVP/releases/download/${tag}/${name}`;

export const NOTES_020 = `<!-- Release notes generated using configuration in .github/release.yml at main -->
## What's new
- **Draft helper**: picks for your role start from your champion pool, with the *reasons* behind each one.
- Builds import in one click: runes, item set and \`summoner spells\`.
  - Flash stays on your usual key (D or F).
- Loading-screen cards for all 10 players.

## Fixes
* The window comes back from the tray by @Filmoo in https://github.com/Filmoo/MVP/pull/12
* <img src=x onerror=alert(1)> stays text, and so does [a bad link](javascript:alert(1)).

**Full Changelog**: https://github.com/Filmoo/MVP/compare/v0.1.0...v0.2.0`;

export const DIGEST = "3f5a9c1e7b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a";

export const PRERELEASE = {
  tag_name: "v0.3.0-beta.1",
  name: "MVP 0.3.0 beta 1",
  body: "A preview of the tier list's trends.\n\n- Win and pick rate arrows against the last patch.",
  draft: false,
  prerelease: true,
  created_at: "2026-10-12T09:00:00Z",
  published_at: "2026-10-12T10:00:00Z",
  html_url: "https://github.com/Filmoo/MVP/releases/tag/v0.3.0-beta.1",
  assets: [
    {
      name: "MVP_0.3.0-beta.1_x64-setup.exe",
      size: 10485760,
      browser_download_url: download("v0.3.0-beta.1", "MVP_0.3.0-beta.1_x64-setup.exe"),
    },
  ],
};

export const STABLE = {
  tag_name: "v0.2.0",
  name: "MVP 0.2.0",
  body: NOTES_020,
  draft: false,
  prerelease: false,
  created_at: "2026-09-29T09:00:00Z",
  published_at: "2026-09-29T10:00:00Z",
  html_url: "https://github.com/Filmoo/MVP/releases/tag/v0.2.0",
  // What release.yml publishes (the updater's files first), plus a decoy for another CPU.
  assets: [
    { name: "latest.json", size: 512, browser_download_url: download("v0.2.0", "latest.json") },
    { name: "MVP_0.2.0_x64-setup.exe.sig", size: 420, browser_download_url: download("v0.2.0", "MVP_0.2.0_x64-setup.exe.sig") },
    { name: "MVP_0.2.0_arm64-setup.exe", size: 9000000, browser_download_url: download("v0.2.0", "MVP_0.2.0_arm64-setup.exe") },
    {
      name: "MVP_0.2.0_x64-setup.exe",
      size: 10276044,
      browser_download_url: download("v0.2.0", "MVP_0.2.0_x64-setup.exe"),
      digest: `sha256:${DIGEST}`,
    },
  ],
};

export const OLD = {
  tag_name: "v0.1.0",
  name: "",
  body: "",
  draft: false,
  prerelease: false,
  created_at: "2026-09-20T09:00:00Z",
  published_at: "2026-09-20T10:00:00Z",
  html_url: "https://github.com/Filmoo/MVP/releases/tag/v0.1.0",
  assets: [],
};

export const RELEASES = [PRERELEASE, STABLE, OLD];

export type Api = { status: number; body: unknown } | "hang";

export const API = {
  releases: { status: 200, body: RELEASES },
  empty: { status: 200, body: [] },
  previewOnly: { status: 200, body: [PRERELEASE] },
  rateLimited: { status: 403, body: { message: "API rate limit exceeded for 203.0.113.7." } },
  hang: "hang",
} satisfies Record<string, Api>;

/** Answers GitHub's API from the fixtures; returns a counter of the requests it saw. */
export async function mockGitHub(page: Page, api: Api, delayMs = 0) {
  const seen = { count: 0 };
  await page.route("https://api.github.com/**", async (route) => {
    seen.count++;
    if (api === "hang") return;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: api.status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(api.body),
    });
  });
  return seen;
}
