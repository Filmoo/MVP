# Handoff — finishing MVP on a machine with a League client

Written 2026-09-27, updated 2026-09-28 at the end of the third cloud session. Read `CLAUDE.md`
first (rules, layout, commands), then `docs/decisions.md` (the owner's product calls),
`docs/policy.md` (Riot red lines) and `docs/architecture.md`. Work on branch
`claude/upbeat-hamilton-0bms1t`.

## Summary for the next agent (2026-09-28, end of the third session)
Branch `claude/upbeat-hamilton-0bms1t`, version 0.2.0, `check.mjs full` green. CI: runs 26–40 failed
on the crawler image (fixed), 41–42 green, 43 failed once on a new match test (fixed in c85ceaf);
check the latest run before building on it.

**Done this session**
- Features: glass that visibly refracts (floating optics, loupes, frosted cores), Riot's ranked
  emblems at run time with MVP's own crest meanwhile, French UI and core words, diagnostics and
  logs (Settings → About), draft insights (compositions, ARAM bench, stats rank), match insights
  (a grade per game, the whole game behind each row; job 10).
- Fixes: CI's crawler image couldn't write `/data` (every run since it was added failed);
  `/champions` built ~170 tiles before its first frame (now in slices, `lib/progressive.ts`);
  `settle()` returned before lazily loaded views mounted (tests pushed events to nobody); the perf
  suite timed Playwright's trace screencast; several test races (`data/follow.ts`).
- Owner's calls: grades stay (policy.md); bundle budgets raised once, 46 KB startup / 125 KB
  total (`ui/scripts/check-bundle.mjs`); release v0.2.0 once the update key exists (below).

**To fix / finish**
1. **No stats server is deployed, so every CI build is empty wherever stats are needed.** CI and
   release builds point the app at `http://127.0.0.1:8787` (`MVP_BACKEND_URL` unset at build
   time): Draft's picks and compositions, the Tier list and Champions pages, builds and imports,
   player search and loading-screen scouting say the stats service isn't there. Seen in the real
   desktop app (debug build against mock-lcu, 2026-09-28): Home, grades and opened games work
   from the League client; Draft shows "Stats not available yet". Deploy `apps/backend` and the
   crawler timer (apps/crawler/README.md "Scheduled on the VPS"; the Riot key, HTTPS), then give
   `ci.yml` and `release.yml` `MVP_BACKEND_URL` (a repository variable). Until then the owner sees
   "nothing changed" in each build.
2. **A newer MVP started while an older one sits in the tray shows the old one** (single instance,
   close to tray by default: `window::open` on the running app, the new process exits). The owner
   ran run 43's exe and saw the old app. Quit from the tray first. Fix: a different executable
   takes over (the running one hands over and quits), and Settings → About and the diagnostics
   show the build's commit, so anyone can tell which build runs.
3. **Updates need the owner's key, once**: `node scripts/setup-updates.mjs` on the owner's machine
   (makes the key pair in `~/.tauri`, writes the public key into `tauri.conf.json`, sets the two
   GitHub secrets with `gh` or says what to paste). Commit, push, then tag the version in
   Cargo.toml on a green commit (`v0.2.0`): `release.yml` publishes the signed installer and
   `latest.json`, and installed apps update from the latest GitHub release (the backend first,
   once it serves updates over HTTPS). Install that first release by hand; later ones (a new
   version, tagged) install themselves. Until then no build updates itself.
4. **Nothing has run against a real League client or on Windows** beyond CI's build and footprint:
   the checklists below (client fields, imports, grades, emblems' crop, updates, glass frame times
   on real GPUs) are the next real work, on the owner's machine.
5. **Design review of the match insights screens**: the agent checked its own screenshots; run
   the screenshots and the `ui-reviewer` agent on them (Home and player page: rows, the opened
   game at 420 → 2560 px, the grade's why, French), fix P0/P1.
6. Calibrate on crawled data: grades (`crates/stats/src/grade.rs`, each role should average 5),
   composition readings and ARAM length buckets (job 9), the draft model (job 4).
7. Crawl again for `compositions.json` (older games lack the numbers); check real published files
   against the pages (sizes, thin Master+ data, `n = 0` sections).
8. Bundle: at 45.1 / 46 KB and 123.1 / 125 KB. Look for savings before the next feature: lazy
   views re-list ~6 startup files in their preload lists; shared startup code splits into a new
   chunk whenever a lazy chunk imports part of it.
9. Production Riot key: register the product (policy.md lists the endpoints to declare); a dev
   key crawls ~2k games a day.

**To implement next** (none started)
- Match history: filters (queue, champion), "load more", LP won/lost per game and a post-game
  summary card.
- Tier list trends (this patch against the last: win/pick rate arrows) and champion mastery on
  the profile.
- The updater's `requireSignedVersion` once signatures carry the version (job 6).
- Later, by the owner's earlier calls: an in-game overlay (the architecture is ready for it, not
  wanted yet); no ban suggestions, no AI picks.

## State
Everything below is merged on `claude/upbeat-hamilton-0bms1t` and green on
`node scripts/check.mjs full`, except where marked.

- **Desktop app** (Tauri 2 + SolidJS): Home (own profile from the LCU, a grade on every game and
  the whole game behind each row), Draft (live champ select,
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
10. *(built, against mock-lcu and a fake backend only)*
   **Match insights** (architecture.md "Match insights", policy.md "Per-game grades"): a grade per
   finished game (`stats::grade`: S+ to C, score out of 10, place, MVP/ACE, the facts that moved
   it) on every match row, its why on hover or keyboard focus, and a row opens on the whole game
   (both teams, Riot IDs with hidden players kept hidden, KDA, CS, gold, damage bars, vision,
   items, spells, runes, every grade; the page owner's line marked). Your games are graded by the
   core from `GET /lol-match-history/v1/games/{gameId}` (each read once, after the profile);
   others' by the backend, which also answers `GET /v1/matches/{platform}/{matchId}`. Left:
   - *(owner, 2026-09-28: kept)* the gray area (policy.md): grades of all ten players in an
     opened game, the letters, the score, MVP/ACE;
   - calibrate the references and cut-offs on crawled games (`crates/stats/src/grade.rs`: role
     shares, kill-participation offsets, scales; each role should average 5, S+ should be rare);
   - the backend's match snapshot moved to format 2: the first start after the upgrade begins
     with an empty match cache (older snapshots are ignored);
   - Match-V5 and streamer mode: we treat a participant without `riotIdGameName` as hidden; check
     what Riot sends for hidden players today (policy.md "Re-identify Streamer Mode players");
   - bundle: the grade chip and the rows' wiring cost the first screen +0.9 KB gzip, the game and
     the why (in the player page's chunk) and their words +4.7 KB; the budgets were raised for it
     with the owner's OK (46 KB startup, 125 KB total).

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
Checklist: title bar says "League client connected" (and "League client not responding", amber,
when another app holds the client's connections: Home says MVP retries, then loads by itself once
it answers; log "league client not answering" / "answers again") · Home shows your real rank/LP/games ·
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

Match insights (Home after a few games; a player page with the backend running):
- **Your grades:** chips fill in a moment after Home shows (a game the client doesn't return logs
  "game not read for its grade" and keeps an empty slot); a remake, Arena or Swarm gets none
  (never read), nor a game that isn't two full teams of five; after the next game only that game
  is read (`/lol-match-history/v1/games/{id}` once per game, never again for a finished one).
- **The game's shape** (`crates/companion/src/matches.rs` reads it): `participantIdentities[].player`
  `gameName`/`tagLine`/`puuid`/`summonerId`/`nameVisibilityType`; `participants[].stats` (kills,
  deaths, assists, `totalMinionsKilled` + `neutralMinionsKilled`, `goldEarned`,
  `totalDamageDealtToChampions`, `totalDamageTaken` + `damageSelfMitigated`, `visionScore`,
  `damageDealtToObjectives`, `champLevel`, `item0`–`item6`, `perk0`, `perkSubStyle`, `win`),
  `spell1Id`/`spell2Id`, `timeline.lane`/`role` (only evidence: each team's roles are worked out
  from the champions' role shares, Smite, lane minions and support items; compare with the player
  page's Match-V5 `teamPosition` for the same games), `gameDuration` in seconds, `platformId`.
- **Opened games:** yours open instantly the second time (cached); someone else's (player page)
  come from the backend; a streamer-mode player shows "Hidden player" in both; your line (or the
  page owner's) is marked; Escape closes and the row keeps the focus.
- **Grades look right:** the MVP is the best of the winners, an obviously bad game gets a C, a
  support with high vision isn't punished for low CS, and the why's facts match the end screen.

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
