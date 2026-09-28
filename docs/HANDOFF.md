# Handoff — finishing MVP on a machine with a League client

Written 2026-09-27, updated 2026-09-28 at the end of the second cloud session. Read `CLAUDE.md`
first (rules, layout, commands), then `docs/decisions.md` (the owner's product calls),
`docs/policy.md` (Riot red lines) and `docs/architecture.md`. Work on branch
`claude/upbeat-hamilton-0bms1t`.

## State
Everything below is merged on `claude/upbeat-hamilton-0bms1t` and green on
`node scripts/check.mjs full`, except where marked.

- **Desktop app** (Tauri 2 + SolidJS): Home (own profile from the LCU), Draft (live champ select,
  stats-only model on the published stats, pool-first picks, both teams' compositions, ARAM's
  bench ranked by the team's chances), Live (loading-screen scouting of
  all 10 players), player search (title bar, Ctrl+K) + player pages, build imports (rune page,
  item set, spells: one click in Draft, on a champion page or on lock-in), Tier list and
  Champions pages (builds, runes, items, matchups), Live's "My build" tab, Settings (auto-accept
  opt-in, imports, stats rank, window follows the game, close to tray, launch at startup, visual
  effects, language). English and French. Liquid glass that refracts the page behind it, ambient
  light sampled from champion art, Riot's ranked emblems (downloaded at run time).
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
2. *(done)* **Glass and light** (`ui/src/design/backdrop/`, `ui/src/design/liquid/`, see
   architecture.md "Glass and light", decisions.md "Liquid glass"): liquid glass over the page
   (SVG lenses from real optics: title bar over scrolling content, search results, toasts, the
   rail's selection lens, held switches, segmented thumbs, the rank pane over art, the floating
   tab bar on narrow windows), the backdrop shader's thick-glass card edges, rim glints toward
   the pointer, springs for motion; Settings → App → Visual effects (Full / Light / Off, kept in
   `Settings.effects`). Draft's Why captions are brighter over art. The glass floats above the
   page (decisions.md "Refraction you can see"): rims bend 10–40 px, drops are loupes, labels
   stay crisp at rest; `pnpm dev` → `#/__harness?show=glass` shows every kind bending art, text
   and lines. Left:
   - **verify on real Windows/WebView2 GPUs**: frame times while scrolling under the title bar
     and while the rail lens glides (DevTools → Rendering → Frame rendering stats), at 100 % and
     150 % scaling, on an iGPU; the speed probe keeps "Full" off where the backdrop is slow;
   - the lenses are Chromium-only by design (WebView2): a future web build falls back to blur.
3. *(done)* **Scouting identity fix:** `POST /v1/players/batch` takes `players` (Riot IDs); the
   server resolves them with account-v1 (cached a day) and the core matches cards back to seats by
   Riot ID. Client PUUIDs never leave the core; streamer-mode players are still dropped before
   anything (tested on the request body). `puuids` stays accepted for 0.1.0 apps, and a PUUID Riot
   can't decrypt (400) now gets no card instead of failing the batch. **Verify on the real
   client** that `/lol-gameflow/v1/session` team entries carry `gameName`/`tagLine` for every
   visible player: a player without them gets no card (see the checklist).
4. **Stats in the app:** *(core done, see architecture.md "Stats in the app")* `companion::stats`
   downloads the index + current patch files (disk cache per patch with ETags, offline, pruning),
   the commands `stats_index` / `tier_list` / `champion_stats` and the `stats-index` event are
   wired, and `companion::draft` fills `DraftView` (team odds, pool-first picks with reasons,
   enemy roles) from mastery, own games and pickable champions. No ban suggestions (owner's call).
   The **Tier list** (`/tier-list`) and **Champions** pages (`/champions`: grid; `?id=…`: builds,
   runes, spells, skill order, items, matchups) run on those commands (architecture.md "Stats
   pages"; rune trees in `GameData`, the `Segmented` control, mock scenarios `stats-empty` /
   `stats-offline` / `stats-slow` / `stats-aram-only`). Left:
   - check the pages against real published files (the mock is synthetic: sizes, option counts,
     thin Master+ data, sections with `n = 0`, long lane lists);
   - check against a real client: mastery field names (`championId`, `championLevel`,
     `championPoints`), whether `pickable-champion-ids` is filled from the planning phase on (an
     empty list is treated as "unknown", bans/picks are filtered from the session anyway), how
     many games the match history returns (the "You · N games" record uses them);
   - later: calibration of the model (research D §3.14), own games in the estimate (shown, not
     counted). The bracket setting and ARAM are job 9.
5. *(built, against mock-lcu only)* **Imports** (`companion::imports`, architecture.md "Build
   imports", policy.md "Build imports"): MVP's own rune page (never touches the player's pages),
   MVP's item set per champion (the player's sets round-trip untouched), summoner spells in champ
   select (Flash on the player's key from their games or Settings, never with ≤ 5 s left). Per
   part: off / one click (default, Draft's import bar) / on lock-in (once per lock, toast), plus
   the Flash key (auto/D/F) in Settings → Imports. The stats client is the
   `BuildSource` (`Services.builds`, wired in `apps/desktop/src/core.rs`); the remote config can
   pause each part for everyone (`SkipReason::Paused`). Champion pages import the build shown
   (`ImportBar`, same messages), Live's "My build" tab shows the build of your champion and role
   for the game's mode. **Left:** verify on a real client (checklist below).
6. *(done)* **Desktop side of updates/config/reports**: updater (plan in `companion::updates`,
   shell in `apps/desktop/src/updater.rs`), remote config (`companion::remote`, kill switches in
   `companion::Services.remote`), crash reports (`companion::crash`, `crates/scrub`), UI banners /
   update prompt / update-required card (`ui/src/app/Banners.tsx`, `app/notices/`), Settings →
   About update row and App → "Send crash reports". **Left:**
   - **Generate the update key pair** (backend README, "The signing key pair"): paste the public
     key in `apps/desktop/tauri.conf.json` `plugins.updater.pubkey`, the private key + password in
     the GitHub secrets. Until then no build updates itself and `release.yml` refuses to run.
   - The `draftHelper` flag hides the draft helper's numbers at once (teams stay); the import
     kill switches and flags pause each part (`remote::import_allowed`), also mid champ select.
   - French banner/`minVersion` texts show when the UI is in French (job 7).
   - Consider `plugins.updater.requireSignedVersion: true` once the CLI's signatures carry the
     version (the plugin then rejects a manifest pairing a new version with an older installer).
7. *(done)* **English + French** (architecture.md "Languages"): every UI string in typed
   catalogues (`ui/src/i18n`), Settings → App → Language (Auto follows Windows), `Intl` number
   and date formats, Data Dragon names in French (`fr_FR`), French banners, the UI suites in
   French (`*-fr` projects). **Left:**
   - the owner reads the French screens (`pnpm screenshots` → `reports/screenshots/fr-*.png`) and
     fixes any wording that doesn't sound like the French client; unsure terms are listed in the
     i18n report (e.g. Swiftplay/Quickplay names, "Survol", roles as players say them — Top,
     Jungle, Mid, Bot, Support — where the League client says Haut, Milieu, Bas; shard rows);
   - *(done)* the tray menu and MVP's item set block titles follow the UI's language (the rune
     page and set names, "MVP · Ahri Mid", read the same in both);
   - check the French Data Dragon names on a real client (`fr_FR`, cached per patch).
8. *(done, verify on a real machine)* **Rank emblems** (architecture.md "Ranked emblems"): the core
   downloads Riot's ranked emblems (`CommunityDragon`'s mirror of the client files), crops them to
   the crest and caches them; until then MVP draws its own crest (metal rim, enamel, cut gem,
   ornaments per tier). Blocked from the cloud sandbox, so never seen for real: check the crop on
   every tier (checklist below), and before the production-key application, which source Riot
   prefers (policy.md).

9. *(built, against mock-lcu and synthetic stats only)* **Draft insights** (architecture.md "Stats
   pipeline" and "Stats in the app"): the crawler keeps each game's length and every player's
   damage by type, damage soaked and crowd control, and publishes `compositions.json` per data
   set; the draft shows both teams' compositions (side panel, *Teams* tab: damage mix, frontline,
   crowd control, short/long games, neutral readings; hovers counted and marked) and your team's
   with each suggestion; ARAM ranks your champion and the bench by the team's chances (nothing is
   swapped); Settings → Stats → Rank (Emerald+/Diamond+/Master+) drives the draft, its
   compositions and imports at once, and is where the stats pages start. Left:
   - crawl again: games crawled before this have none of the composition numbers (left out, so
     `compositions.json` appears once new games are in); check the file's size and the numbers
     against real games (frontline ≈ 0.2 for a tank, damage per minute, CC seconds);
   - calibrate the readings' thresholds (`companion::stats::comp`: 70 % one damage type, frontline
     0.85/1.15 × usual, crowd control 0.7/1.3 × usual, 3 points between short and long games) and
     ARAM's length buckets (17 and 22 minutes, a guess) on real data;
   - the real client (checklist below): ARAM's session fields and the gameflow queue.

## Verify with the real client (Windows)
When something doesn't work: Settings → About → **Copy diagnostics** (versions, the client's
state, MVP's data and settings, the last 200 log lines with personal data removed) and paste it
into the report; **Open log folder** shows `mvp.log` (this run) and `mvp.previous.log`
(`%LOCALAPPDATA%\gg.mvp.companion\logs`). A release build has no console: the file is the log.

```sh
pnpm install && node scripts/fetch-dev-assets.mjs
RIOT_API_KEY=… pnpm backend              # 127.0.0.1:8787, the default the app uses
pnpm app                                 # or pnpm build:exe and install the NSIS setup
```
Checklist: title bar says "League client connected" · Home shows your real rank/LP/games ·
Settings persist across restarts · auto-accept (turn on, queue) accepts after the delay, never
after you declined · champ select brings the window up on Draft with the real teams/bans/roles
(ranked: allies stay anonymous) and, with published stats (`STATS_DIR`), picks for your role that
start from your pool (mastery, your games) and only list champions you own · loading screen
switches to Live and fills 10 cards (looked up by Riot ID: if some stay empty, check the
session's `gameName`/`tagLine` fields) · search a
Riot ID · close to tray keeps automations running · launch at startup starts in the tray ·
RAM/idle CPU stay low (`scripts/windows-footprint.ps1`) · after the first start Home and Live show
Riot's ranked emblems (log "ranked emblems ready"; cache in `%LOCALAPPDATA%\gg.mvp.companion\emblems\v1`):
the crop frames every tier (Iron's small crest to Challenger's wings) at 100 % and 150 %, and an
offline first start shows MVP's crests. Fix what differs from the mock; add a
mock-lcu scenario for anything the real client does that the mock didn't.

Draft insights (with published stats that have `compositions.json`; without League:
`cargo run -p mock-lcu -- --aram` plays ARAM champion selects):
- **Compositions:** Draft → *Teams* shows both teams as they pick, hovers dashed; your hover's
  change shows under a suggestion ("Your team with …"); the numbers look right for well-known
  champions (a tank's frontline, a mage's magic damage).
- **ARAM:** the list shows your champion and the bench (session `benchEnabled`,
  `benchChampions[].championId`, `allowRerolling`/`rerollsRemaining`: check the names), updates
  after a reroll or a bench swap, "Rerolls left" matches the client; the enemy team shows "Shown
  once the game loads" (`theirTeam` empty); the gameflow session's `gameData.queue.id` is 450 in
  champion select (`/lol-gameflow/v1/session`, read once per champion select), else the bench
  decides.
- **Rank setting:** Settings → Stats → Rank → Diamond+ mid champion select: the data line says
  Diamond+ at once (Emerald+ when Diamond+ isn't published); the Tier list opens on it.

Build imports (needs a `BuildSource` with real stats; the logs say "rune page imported", "item set
imported", "summoner spells imported", "automatic import on lock-in"):
- **Runes:** with a free slot, Runes creates "MVP · <Champion> <Role>" and selects it; again (other
  role) replaces the same page; with every slot used, the message asks to free or rename one;
  renaming a page "MVP" makes MVP use it. Your other pages keep their names and runes. Check the
  real shapes: `canAddCustomPage`/`ownedPageCount` in `/lol-perks/v1/inventory`, the POST/PUT
  body (`subStyleId`, 9 `selectedPerkIds`), the "max pages" error text (`is_page_limit`), whether
  names over ~25 characters are refused (`NAME_MAX_CHARS`).
- **Item set:** shows in the in-game shop for that champion (Summoner's Rift; Howling Abyss for
  ARAM); your own sets unchanged after an import; the client accepts our `uid` ("6d7670a0-…").
- **Spells:** set during picks and finalization, Flash on your key (try `Flash key` D/F/auto);
  refused in the last 5 s; that `timer.internalNowInEpochMs` is this PC's clock (time-left math);
  never outside champ select.
- **On lock-in:** exactly one import per lock-in, none on hovers; a trade imports the new champion;
  ARAM imports on the given champion and after rerolls/bench swaps; blind pick and ARAM (no
  `assignedPosition`) use the most played role.

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
- Wall-clock tests are sensitive to load: "the panel lays out at every window size…" (30 s for
  eight sizes) and `[layout] /live/banners @ qhd` timed out once with several agents building,
  "draft: one click imports a part…" can miss its 400 ms busy state, and one of companion's
  `with_mock_client` tests (5 s waits on the mock client) failed once at load 14;
  the perf suite's view switches (budget 120 ms) are timed on a busy machine too: run perf on a
  quiet one (`--workers=1`, as check.mjs does). `/champions` was the slow one for a real reason
  (it built all ~170 tiles before its first frame; CI failed once at 129.5 ms): it now builds 40
  tiles with the view and the rest when idle (`lib/progressive.ts`; 24 cold switches at load ~20:
  median 48 ms, max 79 ms).
- `settle()` waits for lazily loaded views (App's Suspense marks their loading) and settles again
  if something started loading meanwhile; before, a test could push an event before the view
  listened (fixed 2026-09-28).
- A dev Riot key is slow: a cold 10-player scout ≈ 230 calls; crawling ≈ 2k games/day. Public use
  needs the production key (register the product; policy.md lists endpoints to declare).
- Not yet verified on Windows: window re-creation from tray, autostart, WebView2 glass/blur cost,
  the updater's install (passive NSIS, relaunch), `open_banner_link` (ShellExecute), the panic
  hook's report surviving `panic = "abort"`, the OS/webview version string in reports.
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
