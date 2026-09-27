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
- Everything was tested against `mock-lcu` and fake Riot/backend servers, **never against a real
  League client or on Windows** (CI builds the .exe and measures RAM/CPU only).

## Open jobs, in order
1. *(done)* App updates, `/v1/config` RemoteConfig, opt-in `/v1/reports`, rate limiting, metrics
   and the Riot cache snapshot are merged in `apps/backend` (see its README). Stats downloads share
   the per-install rate limit (60 burst, 120/min): the app must cache stats files and revalidate
   with `If-None-Match`.
2. **Glass backdrop shader** (was in progress; if a `claude/wip-glass-shader` branch exists, review
   and merge it, else build it): one WebGL canvas behind the shell rendering the ambient light plus a
   very subtle procedural pattern, with refraction of that backdrop under `data-refract` glass
   rects. Render on demand only (palette change, resize, scroll, rect changes) — never a rAF loop;
   half resolution; fall back to today's CSS gradients without WebGL; setting auto/light/off. Perf
   tests: 0 renders at idle, median render ≤ 2 ms.
3. **Scouting identity fix:** LCU PUUIDs can differ from the API key's PUUIDs. Make
   `POST /v1/players/batch` accept Riot IDs (the core already reads them from the gameflow session)
   and use them; keep hidden/streamer-mode players out of any lookup.
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
