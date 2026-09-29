// MVP's releases, from GitHub's public API: the site's only request to another site.
// GitHub allows 60 unauthenticated requests an hour per IP address, so the answer is kept in
// sessionStorage for 10 minutes and shared by every page of the tab.
export const REPO = "Filmoo/MVP";
export const REPO_URL = `https://github.com/${REPO}`;
const API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const KEY = "mvp.releases.v1";
const FRESH_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/**
 * @typedef {{ name: string, size: number, url: string, digest: string }} Asset
 * @typedef {{ tag: string, name: string, body: string, date: string, prerelease: boolean, url: string, assets: Asset[] }} Release
 */

const text = (value) => (typeof value === "string" ? value : "");

/** @returns {Release} only the fields the pages use. */
function trim(raw) {
  return {
    tag: text(raw.tag_name),
    name: text(raw.name),
    body: text(raw.body),
    date: text(raw.published_at) || text(raw.created_at),
    prerelease: raw.prerelease === true,
    url: text(raw.html_url),
    assets: (Array.isArray(raw.assets) ? raw.assets : []).map((asset) => ({
      name: text(asset?.name),
      size: Number(asset?.size) || 0,
      url: text(asset?.browser_download_url),
      digest: text(asset?.digest),
    })),
  };
}

function readCache() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (saved && Date.now() - saved.at < FRESH_MS && Array.isArray(saved.releases)) return saved.releases;
  } catch {
    // No storage (private mode, blocked site data): ask GitHub again.
  }
  return null;
}

function writeCache(releases) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), releases }));
  } catch {
    // Storage full or blocked: the page still works, it just asks again next time.
  }
}

/** Published releases, newest first. Throws when GitHub can't be reached or refuses. */
export async function loadReleases() {
  const cached = readCache();
  if (cached) return cached;
  const response = await fetch(API, {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("GitHub's answer isn't a list of releases");
  const releases = data
    .filter((release) => release && release.draft !== true)
    .map(trim)
    .filter((release) => release.tag)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  writeCache(releases);
  return releases;
}

/** The Windows installer the release workflow publishes: `MVP_<version>_x64-setup.exe`. */
export function installerOf(release) {
  return release?.assets.find((asset) => /_x64-setup\.exe$/i.test(asset.name) && asset.url.startsWith("https://")) ?? null;
}

/** The newest release that isn't a pre-release, with its installer when it has one. */
export function latestStable(releases) {
  const stable = releases.filter((release) => !release.prerelease);
  return stable.find((release) => installerOf(release)) ?? stable[0] ?? null;
}

/** `v0.2.0` → `0.2.0`. */
export function versionOf(release) {
  return release.tag.replace(/^v(?=\d)/, "");
}
