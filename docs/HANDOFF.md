# Handoff — finishing MVP on a machine with a League client

Written 2026-09-27, updated 2026-09-29 during the fourth session (on the owner's Windows PC with
a real League client). Read `CLAUDE.md` first (rules, layout, commands), then `docs/decisions.md`
(the owner's product calls), `docs/policy.md` (Riot red lines) and `docs/architecture.md`. Work on
branch `release/0.3` (named `claude/upbeat-hamilton-0bms1t` until 2026-09-30). One branch per
feature (`feature/<name>`), deleted once tested and merged.

## Summary for the next agent (2026-09-29, fourth session: the owner's PC, a real client)
Branch `release/0.3` (was `claude/upbeat-hamilton-0bms1t`), not pushed (the owner decides when). Budgets: startup JS
40.8 / 46 KB, total 135.2 / 136 KB. The last full gate on main was green except timing-only
failures under load (each green alone): rerun `check.mjs full` on a quiet machine, the perf
suite's boot test is load-sensitive.

**Working with the owner:** they play League on this PC. Run heavy work (cargo, gates,
Playwright) at low priority with 2 workers, and never while the client is in champion select or a
game (`GET /lol-gameflow/v1/gameflow-phase`). One or two helper agents at a time: with 8–10 the
session hit the usage limit five times.

**Merged this session** (the why in decisions.md):
- Settings search.
- The champion list sorted and grouped by tier (being folded into the Tier list hub, below).
- Your games' roles (the most likely assignment per team), a "client not responding" state with
  Home's waiting card, no vision column on Howling Abyss.
- Live names: Riot's live game (Spectator-V5 on our server), then the game's own API; Riot IDs
  open player pages.
- Auto import once at lock-in, then a warning when the champion or role changes (per-part
  switches).
- Hover cards: what runes, shards, spells and items do, and a designed card for every hover (with
  build savings: constant classes set once, short class names).
- The last game's summary, LP per game, history filters and "load more", mastery.
- ARAM: Mayhem: an editorial tier file on our server, opt-in anonymous sharing for pick rates,
  augment priorities per champion and rarity.
- The website (`site/`, for mvpgg.com) and the private roadmap (`apps/roadmap`, for
  dev.mvpgg.com): neither deployed. `docs/riot-application.md`: the production key application.

**Verified on the real client (EUW, 2026-09-28/29)**
- Imports and auto import at lock-in: only MVP's own rune page and item set are replaced, the
  player's are untouched; spells land. In a custom lobby the client assigns the lobby position
  (e.g. middle) and MVP follows it.
- DPM's app auto-imports too and made its page current after MVP's: two apps fight over the
  current page; MVP never imports again by itself (by design).
- Draft's countdown matches the client's timer. Tooltips read the real Data Dragon (16.19.1).
- Live names in a real ARAM: Mayhem game: all ten players named. Their cards failed on the dev
  key: `/v1/players/batch` answered 504 after 30 s (a cold 10-player scout is ~90 calls against
  100 per 2 minutes). Expect it until the production key.
- Custom games: Spectator-V5 lists them without bots, and the client's gameflow session lists no
  bots either, so Live shows only the humans (to do: bot seats from the game's API).
- A game started while the PC was at 100% CPU never loaded: a remake at 3:05 (not MVP).
- An installed MVP in the tray made newer dev builds hand over and quit (known issue 2 below).

**In progress, on branches not merged yet**
- `worktree-agent-aac82646dd1131931`: the Tier list hub (Shelves with the top-3 podium and a mini
  meta map, a DPM-like sortable Table, compact lane icons, a rank dropdown with emblems, tier
  medallions, League-like Jungle and Support icons, the penguin). Stopped with 4 files
  uncommitted.
- `worktree-agent-a81fa7b74de5da1fc`: the opened game as a glass sheet (a long scroll, Escape or a
  click outside closes it), clickable Riot IDs, the end-of-game stats table. Stopped with 1 file
  uncommitted.
- `worktree-agent-af4bb73c493248211`: one more commit (50eae94, the roadmap's design review) to
  merge; keep main's `FeatureSheet.tsx`, `playwright.config.ts` and `roadmap.spec.ts` (b4ef9a8).

**Next**
1. Merge the three branches above, then a full gate on a quiet machine.
2. Deploy the backend (new routes `/v1/live`, `/v1/mayhem/*`), the website and the roadmap
   (a GitHub OAuth app and a `dev` DNS record: `apps/roadmap/README.md`). The legal pages need the
   owner's name, country, contact e-mail and governing law.
3. The production key: `docs/riot-application.md` (the site live with its terms and privacy
   policy plus `riot.txt`, a public installer, a 2–3 minute video).
4. Live: seats for bots from the game's API when Riot's list is shorter than the game.
5. Planned for 0.4: after-game graphs and heatmaps (on the roadmap).

## Summary for the previous session (2026-09-28, end of the third session)
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
1. **The server is live at `https://api.mvpgg.com`** (2026-09-28: an OVHcloud VPS behind
   Cloudflare, `deploy/README.md`), on a development key until the production key comes (it
   expires every 24 h: `sudo mvp-set-riot-key` on the server). Left: CI and release builds still
   point the app at `http://127.0.0.1:8787` (`MVP_BACKEND_URL` unset at build time), so their
   stats, search and scouting say the service isn't there. Give `ci.yml` and `release.yml`
   `MVP_BACKEND_URL` from a repository variable (`https://api.mvpgg.com`); until then the owner
   sees "nothing changed" in each build.
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
8. Bundle: startup JS 43.7 / 46 KB, startup CSS 10.8 / 12 KB, total JS 128.6 / 131 KB with the
   tooltips (they cost ~2.7 KB of JS in all, words in both languages included; the app before
   them and the savings below measured 45.5 / 11.4 / 130.4 at 9472c3c). Three build savings paid
   for them, the same code made smaller: CSS modules' class names are the local name and one hash
   of the file (`tip_k3Zq9`, `scopedName` in `ui/vite.config.ts`; the default added each class's
   line number, ~2.1 KB of JS and 0.6 KB of startup CSS); the lazy views' preload lists no longer
   re-list the startup files, JS or CSS (`startupChunks`, ~0.4 KB); and constant classes
   (`class={styles.x}`, or a template of such names and plain words) are set once: `onceClasses`
   writes Solid's `/*@once*/` on them at build time, where Solid compiled each into an effect
   (~2.7 KB of JS, 1.0 KB of it at startup). Known traps: shared startup code splits into a new
   chunk whenever a lazy chunk imports part of it (the tooltips ride in the player page's chunk
   for that reason: a chunk of their own split `solid-js/web` out of the startup chunk, +0.3 KB);
   Solid drops `@once` on JSX inside an expression (`{open() && <p class=…>}`, `{list.map(…)}`),
   whose classes stay effects.
   *(2026-09-29, the post-game branch)* The first screen is one chunk now (`vite.config.ts`, a
   `codeSplitting` group of every module the entry reaches: 17 startup files → 1, 44.9 → 38.2 KB
   startup and 123.6 → 115.9 KB in all when it landed, before the post-game, LP, history and
   mastery work), so startup code no longer splits when a lazy chunk imports part of it. Lazy
   chunks import from the entry chunk: `main.tsx` must not await at its top level (a module paused
   there makes them wait forever: a blank page).
9. Production Riot key: register the product (policy.md lists the endpoints to declare); a dev
   key crawls ~2k games a day.

**To implement next** (none started)
- Tier list trends (this patch against the last: win/pick rate arrows).
- *(built 2026-09-29, against mock-lcu only: see "After a game" in the checklist below)* the
  post-game summary on Home, LP won/lost per ranked game (rows and the ranked pane's graph),
  history filters and "load more", champion mastery on your profile.
- The updater's `requireSignedVersion` once signatures carry the version (job 6).
- Later, by the owner's earlier calls: an in-game overlay (the architecture is ready for it, not
  wanted yet); no ban suggestions, no AI picks.

## State
Everything below is merged on `release/0.3` and green on
`node scripts/check.mjs full`, except where marked.

- **Desktop app** (Tauri 2 + SolidJS): Home (own profile from the LCU, a grade on every game and
  the whole game behind each row), Draft (live champ select,
  stats-only model on the published stats, pool-first picks, both teams' compositions, ARAM's
  bench ranked by the team's chances), Live (loading-screen scouting of
  all 10 players), player search (title bar, Ctrl+K) + player pages, build imports (rune page,
  item set, spells: one click in Draft or on a champion page; per-part "Auto import" once at the
  first lock-in, then a warning if the champion or role changes), Tier list and
  Champions pages (builds, runes, items, matchups), Live's "My build" tab, Settings (auto-accept
  opt-in, imports, stats rank, window follows the game, close to tray, launch at startup, visual
  effects, language). English and French. Liquid glass that refracts the page behind it, ambient
  light sampled from champion art, Riot's ranked emblems (downloaded at run time). Tooltips on
  every rune, stat shard, summoner spell and item (hover and keyboard focus): a card with the
  thing's icon and art and its full text (architecture.md "Tooltips"; built against mock-lcu and
  the dev cache only).
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
   can't decrypt (400) now gets no card instead of failing the batch. *(2026-09-29)* The real
   client's session carries no names (checked 2026-09-28): the names now come from Riot's live
   game (`GET /v1/live/…`, Spectator-V5) or, when Riot has none (Flex/Arena "filtered", no
   server), from the game's Live Client Data API after the loading screen (architecture.md
   "Loading-screen scouting", policy.md). **Verify on the real client** (checklist below).
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
   part: the buttons always (Draft's import bar, champion pages) and an "Auto import" switch
   (off by default: once at the first lock-in, toast; a later trade or role swap warns in Draft
   with "Import for <champion>", never imports by itself; decisions.md "Auto import, once"), plus
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
11. *(built, against mock-lcu, a fake backend and a local copy of the game files only)* **ARAM:
   Mayhem** (architecture.md "ARAM: Mayhem", policy.md "ARAM: Mayhem augments", decisions.md):
   the owner's augment tiers (`mayhem-tiers.json` on the server; the order inside a tier is the
   rank), the augments built on the server from the game's files, opt-in sharing of the player's
   Mayhem games (champions, augments, final items; never a result) and the pick rates they make;
   the Mayhem page (Tier list → "ARAM: Mayhem"), the champion page's Mayhem tab, Draft's
   *Augments* tab and bench rows, Live's "My build". Left:
   - **the owner writes the first tiers** (`mvp-backend mayhem list`, edit, `mvp-backend mayhem
     check`; apps/backend/README.md "ARAM: Mayhem"): until then every augment is "Not tiered yet";
   - the deployed backend must reach `raw.communitydragon.org` for the catalog (log "built 223
     Mayhem augments…"); without it the Mayhem views say the augments aren't available yet;
   - the bundle: the feature is +9.1 KB of JS gzip, 135.2 KB against the 131 KB budget (the
     owner's call: raise it, or trim);
   - the real client (checklist below).

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
switches to Live and fills 10 cards (names checklist below) · search a
Riot ID · close to tray keeps automations running · launch at startup starts in the tray ·
RAM/idle CPU stay low (`scripts/windows-footprint.ps1`) · after the first start Home and Live show
Riot's ranked emblems (log "ranked emblems ready"; cache in `%LOCALAPPDATA%\gg.mvp.companion\emblems\v1`):
the crop frames every tier (Iron's small crest to Challenger's wings) at 100 % and 150 %, and an
offline first start shows MVP's crests. Fix what differs from the mock; add a
mock-lcu scenario for anything the real client does that the mock didn't.

Live names (a backend with a Riot key; the log says "players named from Riot's live game" or
"players named from the game"; without League: `pnpm mock-lcu`, then the app with
`SCOUT_GAME_CLIENT=$(cat .cache/mock-lcu/game-client)` next to the two `SCOUT_LCU_*` variables):
- **Solo/Duo, normals, ARAM:** names and cards land together during the loading screen (Riot's
  live game); the enemy you know is on the right side and on the right champion; a friend in
  streamer mode shows "Hidden player" (and never their name, in the app or in `mvp.log`).
- **Ranked Flex, Arena:** the head says "Riot doesn't share live … games", names appear after
  the loading screen (the game's API), then the cards. If they never come, the log line "the
  game's API doesn't list the players yet" gives the reason (a TLS error means the game's
  certificate isn't under the League client's root: `lcu::tls`). Arena's 16 players: check how
  the session and the game's list split them (never tried).
- **Custom game vs bots / co-op vs AI:** bots read "Bot", no card, no "Unknown player"; check
  whether Spectator-V5 lists customs at all (else the game's list names everyone).
- **Streamer mode on another account:** confirm how Riot's live game and the game's list show
  that player (anonymous in both; the game's stand-in is its champion's name or no tag,
  `live::game::listed`); adjust the stand-in rules if Riot shows it another way.
- **Idle means idle:** once the names are in (or outside a game) nothing asks port 2999 (the
  game's API isn't asked at all when Riot's live game answered).

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

ARAM: Mayhem (a backend with the catalog built; without League: `cargo run -p mock-lcu -- --mayhem`):
- **Mode:** a Mayhem champion select opens Draft's side panel on *Augments* (the gameflow
  session's `gameData.queue.id` 2400 or `gameMode` `KIWI`: check the names), each bench champion
  shows its most picked augments under its line; in the game, Live's "My build" shows the
  champion's augments, then ARAM's build said to be ARAM's.
- **Sharing:** Settings → Stats → "Help build Mayhem stats" on → the log says "Mayhem games
  shared" (accepted, duplicates) for the recent Mayhem games; after a Mayhem game, again about
  10 s into the end-of-game screen. In `/lol-match-history/v1/games/{gameId}` check
  `participants[].stats.playerAugment1`–`6` (ids `mvp-backend mayhem list` knows), `item0`–`5`,
  `gameVersion`, `queueId` 2400 and `platformId`. A custom Mayhem game is never sent, nor
  anything while the switch is off.
- **Nothing during the game:** nothing on screen changes when the game offers augments, and no
  request asks the game about them.

Build imports (needs a `BuildSource` with real stats; the logs say "rune page imported", "item set
imported", "summoner spells imported", "automatic import at the first lock-in"):
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
- **Auto import:** exactly one import, at the first lock-in, none on hovers; ARAM imports on the
  given champion; a trade, a reroll or bench swap, or a role swap afterwards imports nothing and
  shows Draft's warning (a toast when MVP is on another page), whose "Import for …" imports the
  new champion's build and makes it go; changing your own rune page, spells or item sets never
  warns; blind pick and ARAM (no `assignedPosition`) use the most played role. Check that
  `assignedPosition` stays filled in the sessions the client sends again (an empty one is taken
  as "no change", `LockTracker::on_session`).
- **Draft's bar after a spells change:** the result stays (the client sends its session again;
  this used to reset the bar to its idle hint). A click as the game starts says "Champion select
  ended before the import" (it used to say "No build…").

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

After a game (Home; the logs say "LP of the game", "game not in the history yet", "the client
didn't count the game in time"):
- **Post-game summary:** a ranked game ends → the window comes Home (autopilot) and the card tops
  it within seconds of the end screen: result, grade and its facts, your numbers against your
  lane opponent (check the roles: the opponent must be your role on the other team), then the LP
  when the client counts it (check `/lol-ranked/v1/current-ranked-stats` fires its event after a
  game; else the LP comes from the retries within two minutes). Close it: it doesn't come back;
  the next champion select hides it too. ARAM: the closest share of damage, no LP.
- **LP:** compare MVP's `+19 LP` with the client's end screen over a few games, a promotion and a
  demotion included (MVP counts 100 LP per division: a demotion to 75 LP shows the ladder
  difference, not the client's "−20"); `lp-history.json` in `%APPDATA%\gg.mvp.companion`; a
  restart during a game still gets its LP. Remakes: no LP, no grade.
- **Load more:** how far back `begIndex`/`endIndex` goes on a real client (20 per page; the end
  shows "No older games"), and that older games grade and open like the first 20.
- **Mastery:** the champions card's five portraits match the client's mastery (levels past 7 read
  as numbers).

Tooltips (a champion page, an opened game, Live's cards; the app in English, then in French):
- **Texts:** a rune's full text (the client's rune page), an item's stats and passives, a spell's
  text and cooldown read like the League client's, in the UI's language (`fr_FR` files); an item of
  another mode (Arena, ARAM's) still has one; no `@value@` ever shows (those fall back to the
  short text, or to the name alone).
- **Stat shards:** the first shard tooltip downloads the client's `perks.json` from
  CommunityDragon (`…/raw.communitydragon.org/<patch>/…`, else `latest`) and keeps
  `shards.json` beside the patch's Data Dragon files (`%LOCALAPPDATA%\gg.mvp.companion\ddragon\
  <version>\<locale>\`); its values match the client's (e.g. +2.5 % move speed); offline on a first
  start the UI's own words show, and the log says "stat shard texts unavailable".
- **The card:** its icon and the blurred picture behind are the hovered thing's (a shard: its
  glyph and colour); it stays inside the window near every edge at 100 % and 150 % scaling; Tab
  reaches the icons of a champion page and of an opened game (not inside a match row), Escape
  closes only the tooltip; nothing runs once it's gone (Task Manager: the webview at rest).
- **Compact cards:** the title bar's client status explains itself on hover, and **dragging the
  window from it still moves the window** (it became a drag region of its own to be hoverable);
  the window buttons, the rail, tier badges (a click on one in the tier list still opens the
  champion), build numbers, matchups, a disabled import button: each says what it means.

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
  (it built all ~170 tiles before its first frame; CI failed once at 129.5 ms): it now builds 36
  tiles with the view and the rest when idle (`lib/progressive.ts`; 24 cold switches at load ~20:
  median 48 ms, max 79 ms; 39 ms on a quiet machine since the tier groups).
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
