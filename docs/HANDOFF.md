# Handoff — finishing MVP on a machine with a League client

Written 2026-09-27 at the end of the cloud session. Read `CLAUDE.md` first (rules, layout,
commands), then `docs/decisions.md` (the owner's product calls), `docs/policy.md` (Riot red lines)
and `docs/architecture.md`. Work on branch `claude/keen-curie-92uuqm`.

## State
Everything below is merged on `claude/keen-curie-92uuqm` and green on `node scripts/check.mjs full`,
except where marked.

- **Desktop app** (Tauri 2 + SolidJS): Home (own profile from the LCU), Draft (live champ select,
  stats-only model, mock stats), Live (loading-screen scouting of all 10 players), player search
  (title bar, Ctrl+K) + player pages, Settings (auto-accept opt-in, window follows the game, close
  to tray, launch at startup). Glass UI with ambient light sampled from champion art.
- **Backend** `apps/backend` (`mvp-backend`): player profiles, batch scouting, `/v1/stats/*` file
  serving, caches. **Crawler** `apps/crawler` (`mvp-crawler crawl|publish|status`) + `crates/aggregate`:
  Emerald+ ranked/ARAM aggregates → per-patch JSON (tier list, builds, matchups, priors).
- **Platform services in the app** (architecture.md, "Remote config, app updates and crash
  reports"): remote config followed by the core (kill switches applied at once, banners, update
  required), self-updates with tauri-plugin-updater (never during a game, restart on request or
  install on quit), opt-in scrubbed crash reports (Settings → App).
- Everything was tested against `mock-lcu` and fake Riot/backend servers, **never against a real
  League client or on Windows** (CI builds the .exe and measures RAM/CPU only).

## Open jobs, in order
1. *(done)* App updates, `/v1/config` RemoteConfig, opt-in `/v1/reports`, rate limiting, metrics
   and the Riot cache snapshot are merged in `apps/backend` (see its README). Stats downloads share
   the per-install rate limit (60 burst, 120/min): the app must cache stats files and revalidate
   with `If-None-Match`.
2. *(done)* Glass backdrop shader (`ui/src/design/backdrop/`, see architecture.md "Window
   backdrop"): render on demand, half resolution, CSS fallback. Left: a Settings row "Visual
   effects" (auto/light/off; today only `localStorage["mvp.effects"]`), ideally backed by an
   `effects` field in the Rust `Settings`; verify GPU cost on a real Windows/WebView2 machine; fix
   text contrast over art in Draft's Why card ("± 2.0", "+3.1 vs team now") and the phase pill
   (≈3.3–3.6, target ≥ 4.5).
3. *(done)* **Scouting identity fix:** `POST /v1/players/batch` takes `players` (Riot IDs); the
   server resolves them with account-v1 (cached a day) and the core matches cards back to seats by
   Riot ID. Client PUUIDs never leave the core; streamer-mode players are still dropped before
   anything (tested on the request body). `puuids` stays accepted for 0.1.0 apps, and a PUUID Riot
   can't decrypt (400) now gets no card instead of failing the batch. **Verify on the real
   client** that `/lol-gameflow/v1/session` team entries carry `gameName`/`tagLine` for every
   visible player: a player without them gets no card (see the checklist).
4. **Stats in the app:** download `/v1/stats/index` + the current patch files in the core (cache on
   disk per patch, ETag), implement the draft data source feeding `crates/stats` draft
   `evaluate/suggest` (replace the mock DraftView suggestions; pool-first using the player's
   mastery — `/lol-champion-mastery/v1/local-player/champion-mastery` — and recent games), then the
   **Champions** page (builds: runes, spells, skill order, items, matchups) and **Tier list** page
   (both are placeholders at `/champions` and `/tier-list`). No ban suggestions (owner's call).
5. **Imports (LCU writes, declare them in policy.md):** rune page (dedicated "MVP" page, never
   delete the player's pages: `/lol-perks/v1/pages`), item set (`/lol-item-sets/v1/item-sets/{summonerId}/sets`),
   summoner spells (`PATCH /lol-champ-select/v1/session/my-selection`) — with the owner's Flash
   rule: respect the player's usual Flash key (D/F) from their past games, warn when it differs, never
   change spells in the last seconds of champ select, and every automation can be turned off.
   Modes: one click, or automatic on lock-in (setting).
6. *(done)* **Desktop side of updates/config/reports**: updater (plan in `companion::updates`,
   shell in `apps/desktop/src/updater.rs`), remote config (`companion::remote`, kill switches in
   `companion::start_full`), crash reports (`companion::crash`, `crates/scrub`), UI banners /
   update prompt / update-required card (`ui/src/app/Banners.tsx`, `app/notices/`), Settings →
   About update row and App → "Send crash reports". **Left:**
   - **Generate the update key pair** (backend README, "The signing key pair"): paste the public
     key in `apps/desktop/tauri.conf.json` `plugins.updater.pubkey`, the private key + password in
     the GitHub secrets. Until then no build updates itself and `release.yml` refuses to run.
   - The `draftHelper` flag and the import kill switches are exposed (`remote_config`) but have
     nothing to stop yet: honor them when the stats draft source and the imports land (jobs 4, 5).
   - French banner/`minVersion` texts are served but the UI shows `en` (job 7).
   - Consider `plugins.updater.requireSignedVersion: true` once the CLI's signatures carry the
     version (the plugin then rejects a manifest pairing a new version with an older installer).
7. **French** UI strings (owner wants EN + FR), after the screens settle.

## Verify with the real client (Windows)
```sh
pnpm install && node scripts/fetch-dev-assets.mjs
RIOT_API_KEY=… pnpm backend              # 127.0.0.1:8787, the default the app uses
pnpm app                                 # or pnpm build:exe and install the NSIS setup
```
Checklist: title bar says "League client connected" · Home shows your real rank/LP/games ·
Settings persist across restarts · auto-accept (turn on, queue) accepts after the delay, never
after you declined · champ select brings the window up on Draft with the real teams/bans/roles
(ranked: allies stay anonymous) · loading screen switches to Live and fills 10 cards (looked up
by Riot ID: if some stay empty, check the session's `gameName`/`tagLine` fields) · search a
Riot ID · close to tray keeps automations running · launch at startup starts in the tray ·
RAM/idle CPU stay low (`scripts/windows-footprint.ps1`). Fix what differs from the mock; add a
mock-lcu scenario for anything the real client does that the mock didn't.

Platform services (a `config.json` in the backend's data dir drives the config; config and
crash reports work with a local backend and `pnpm app`, updates need a release build with the
update key and the backend on HTTPS):
- a banner in `config.json` shows within `pollAfterSecs` (or at the next start), "More info" opens
  the browser, a dismissible one stays closed after a restart;
- `"killSwitches": { "autoAccept": true }` stops auto-accept even mid-delay, and Settings says so;
- `minVersion` above the running version: the update-required card, "Restart to update" works;
- `mvp-backend release add` a newer build: Settings → About → "Check for updates" downloads it
  (not in champ select or game: start a game mid-download, it must stop), the "Update ready —
  Restart" prompt restarts into the passive NSIS installer and reopens MVP (if started with
  `--autostart` it reopens in the tray: the plugin passes the launch arguments on), or Quit from
  the tray installs it without reopening;
- crash reports: turn them on, crash the UI (devtools: `throw` in a timeout) → a line in
  `reports/` on the server, scrubbed; turn them off → `crash-reports/` next to the settings is empty.

## Known issues
- `tests/search.spec.ts` "local list never waits" can time out under heavy parallel load (passes
  alone); make it robust rather than skipping it.
- `/live` first view switch is close to the 120 ms budget on loaded machines (lazy chunk).
- A dev Riot key is slow: a cold 10-player scout ≈ 230 calls; crawling ≈ 2k games/day. Public use
  needs the production key (register the product; policy.md lists endpoints to declare).
- Not yet verified on Windows: window re-creation from tray, autostart, WebView2 glass/blur cost,
  the updater's install (passive NSIS, relaunch), `open_banner_link` (ShellExecute), the panic
  hook's report surviving `panic = "abort"`, the OS/webview version string in reports.
- While a banner shows, the live screens (Draft, Live) scroll by the banner's height (the strip
  sits above the page); dismissible banners go away with ×.
- `CARGO_TARGET_DIR` shared between worktrees: workspace crates of two checkouts hash to the same
  artifacts, so a build can pick up the other checkout's crate as "fresh". Touch your crates'
  `src/lib.rs` (or build in your own target dir) before trusting a result.

## Working rules (from CLAUDE.md, the ones that bite)
Design tokens only; every block in `<Widget name>` with a perf budget; budget raises in their own
commit with a reason; idle means idle; after visual changes run the screenshots
(`pnpm --filter @scout/ui screenshots`) and the `ui-reviewer` agent, fix P0/P1, show the owner.
If another `vite preview` holds port 4173, Playwright reuses it — set `MVP_UI_PORT`. Secrets
(`RIOT_API_KEY`, `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`) only in env / GitHub secrets. The owner
cares about UI polish above feature count, speaks French and English, and wants screenshots.
