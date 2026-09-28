# Handoff — finishing MVP on a machine with a League client

Written 2026-09-27 at the end of the cloud session. Read `CLAUDE.md` first (rules, layout,
commands), then `docs/decisions.md` (the owner's product calls), `docs/policy.md` (Riot red lines)
and `docs/architecture.md`. Work on branch `claude/keen-curie-92uuqm`.

## State
Everything below is merged on `claude/keen-curie-92uuqm` and green on `node scripts/check.mjs full`,
except where marked.

- **Desktop app** (Tauri 2 + SolidJS): Home (own profile from the LCU), Draft (live champ select,
  stats-only model, mock stats), Live (loading-screen scouting of all 10 players), player search
  (title bar, Ctrl+K) + player pages, build imports (rune page, item set, spells: one click in
  Draft or on lock-in), Settings (auto-accept opt-in, imports, window follows the game, close
  to tray, launch at startup). Glass UI with ambient light sampled from champion art.
- **Backend** `apps/backend` (`mvp-backend`): player profiles, batch scouting, `/v1/stats/*` file
  serving, caches. **Crawler** `apps/crawler` (`mvp-crawler crawl|publish|status`) + `crates/aggregate`:
  Emerald+ ranked/ARAM aggregates → per-patch JSON (tier list, builds, matchups, priors).
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
3. **Scouting identity fix:** LCU PUUIDs can differ from the API key's PUUIDs. Make
   `POST /v1/players/batch` accept Riot IDs (the core already reads them from the gameflow session)
   and use them; keep hidden/streamer-mode players out of any lookup.
4. **Stats in the app:** download `/v1/stats/index` + the current patch files in the core (cache on
   disk per patch, ETag), implement the draft data source feeding `crates/stats` draft
   `evaluate/suggest` (replace the mock DraftView suggestions; pool-first using the player's
   mastery — `/lol-champion-mastery/v1/local-player/champion-mastery` — and recent games), then the
   **Champions** page (builds: runes, spells, skill order, items, matchups) and **Tier list** page
   (both are placeholders at `/champions` and `/tier-list`). No ban suggestions (owner's call).
5. *(built, against mock-lcu only)* **Imports** (`companion::imports`, architecture.md "Build
   imports", policy.md "Build imports"): MVP's own rune page (never touches the player's pages),
   MVP's item set per champion (the player's sets round-trip untouched), summoner spells in champ
   select (Flash on the player's key from their games or Settings, never with ≤ 5 s left). Per
   part: off / one click (default, Draft's import bar) / on lock-in (once per lock, toast), plus
   the Flash key (auto/D/F) in Settings → Imports. **Left:** plug the stats client in as the
   `BuildSource` (`Services.builds` in `apps/desktop/src/core.rs`, today `NoBuilds`: every import
   answers "no build" and Draft's buttons wait for `draft.data`); the lead's Champions page import
   action can reuse `ImportBar` (`ui/src/views/draft/ImportBar.tsx`, props: champion, role,
   queue, `inChampSelect`); verify on a real client (checklist below).
6. **Desktop side of updates/config** (after 1): `tauri-plugin-updater` (pubkey, endpoint
   `https://<api>/v1/updates/{{target}}/{{arch}}/{{current_version}}?channel=stable`), send
   `X-MVP-Install` (already stored as `install-id` next to `settings.json`), never update during a
   game; RemoteConfig fetch at start + `pollAfterSecs`, kill switches applied immediately, banners,
   `updateRequired`; opt-in crash reports toggle in Settings.
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
(ranked: allies stay anonymous) · loading screen switches to Live and fills 10 cards · search a
Riot ID · close to tray keeps automations running · launch at startup starts in the tray ·
RAM/idle CPU stay low (`scripts/windows-footprint.ps1`). Fix what differs from the mock; add a
mock-lcu scenario for anything the real client does that the mock didn't.

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

## Known issues
- `tests/search.spec.ts` "local list never waits" can time out under heavy parallel load (passes
  alone); make it robust rather than skipping it.
- `/live` first view switch is close to the 120 ms budget on loaded machines (lazy chunk).
- A dev Riot key is slow: a cold 10-player scout ≈ 230 calls; crawling ≈ 2k games/day. Public use
  needs the production key (register the product; policy.md lists endpoints to declare).
- Not yet verified on Windows: window re-creation from tray, autostart, WebView2 glass/blur cost.

## Working rules (from CLAUDE.md, the ones that bite)
Design tokens only; every block in `<Widget name>` with a perf budget; budget raises in their own
commit with a reason; idle means idle; after visual changes run the screenshots
(`pnpm --filter @scout/ui screenshots`) and the `ui-reviewer` agent, fix P0/P1, show the owner.
If another `vite preview` holds port 4173, Playwright reuses it — set `MVP_UI_PORT`. Secrets
(`RIOT_API_KEY`, `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`) only in env / GitHub secrets. The owner
cares about UI polish above feature count, speaks French and English, and wants screenshots.
