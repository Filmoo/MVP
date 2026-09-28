# MVP — League of Legends desktop companion

Lightweight Porofessor-style companion with U.GG/Lolalytics-grade stats, a stats-only draft
helper and a dpm.lol-inspired look. **Public, free app. Windows first. EUW first.**
No in-game overlay for now (keep the architecture overlay-ready).

**Picking this up? Read `docs/HANDOFF.md` first** (state, open jobs, real-client checklist).

## Decisions so far (see docs/decisions.md)
- **Tauri 2 + Rust core**, UI in **SolidJS + TypeScript + CSS modules** rendered by WebView2.
  Not Electron, not Overwolf. The UI must stay tiny and idle-silent.
- **Own stats backend** (key kept server-side): live lookup API in `apps/backend`; crawler +
  aggregates in `apps/crawler` / `crates/aggregate` publish per-patch JSON (Emerald+, 420 + ARAM).
- Draft helper is **statistics only** (no AI/ML picks), transparent "why" for every number.
- Riot policy red lines are in docs/policy.md — read before adding any feature that touches
  champ select, other players, in-game info or monetization.

## Layout
- `apps/desktop/` Tauri shell (window, tray, commands). `tauri.conf.json` lives here.
- `apps/backend/` `mvp-backend` axum service (the only holder of the Riot key): `/health`, player
  profiles, scouting batch, in-memory caches, published stats files (`STATS_DIR`); Dockerfile +
  deploy notes in its README.
- `apps/crawler/` `mvp-crawler`: `crawl` (Emerald+ ladders → ranked/ARAM matches + timelines →
  facts in SQLite, resumable, idempotent) and `publish` (→ `stats/v1/{patch}/{queue}/{bracket}/…`).
- `deploy/` the server behind Cloudflare (`https://api.mvpgg.com`): its configuration files,
  `mvp-deploy` (release tags of `main` only), `mvp-set-riot-key` and the runbook (`deploy/README.md`).
- `crates/domain` UI-facing types → exported to `ui/src/data/generated/*.ts` by ts-rs
  (`cargo test -p domain`; never edit generated files).
- `crates/lcu` League client API: pinned Riot root TLS, REST, WAMP events, discovery, connector.
- `crates/mock-lcu` fake League client (tests + `pnpm mock-lcu` for dev without League).
- `crates/companion` app core (Tauri-free): client status/phases → domain types.
- `crates/static-data` Data Dragon game data with per-patch disk cache and offline fallback.
- `crates/stats` pure statistics incl. `draft`: the stats-only draft model (see research D).
- `crates/aggregate` pure stats pipeline: Match-V5 → `GameFacts` → mergeable `Dataset` (champion ×
  role, bans, matchups, duos, builds) → published JSON (types in `crates/domain/src/stats.rs`).
- `crates/riot-api` Riot Web API client for the **backend only** (key never in the app):
  routing, header-driven rate limits, 429/5xx retries, typed endpoints.
- `crates/stats` pure statistics (smoothing, intervals, draft scoring) — property-tested.
- `ui/` SolidJS app. `src/data/transport.ts` is the only door to the core:
  Tauri IPC in the app, scripted **mock scenarios** (`src/data/mock/scenarios.ts`) in a browser
  (dev server, `build:preview` for the UI tests; `pnpm build`, the desktop build, leaves them out).
- `ui/tests/` Playwright suites; `ui/perf-budgets.json` budgets.
- `fixtures/` shared fixture metadata. `.cache/` git-ignored dev assets (Data Dragon).

## Commands
- `pnpm install` then `node scripts/fetch-dev-assets.mjs` (champion/item icons for dev & tests).
- `pnpm dev` UI in the browser with mock data → http://127.0.0.1:1420/?scenario=default
- `RIOT_API_KEY=… pnpm backend` backend on http://127.0.0.1:8787 (`/health`; 503s without a key).
- Stats: `RIOT_API_KEY=… cargo run -p mvp-crawler -- crawl --max-matches 500`, then
  `cargo run -p mvp-crawler -- publish`; serve with `STATS_DIR=.cache/crawler/stats pnpm backend`.
- `pnpm app` full desktop app (needs Tauri system deps). `pnpm build:exe` → NSIS installer.
  Backend URL: `MVP_BACKEND_URL` at build time (default `http://127.0.0.1:8787`); debug builds also
  read it at run time (docs/architecture.md, Backend client).
- Without League: `pnpm mock-lcu`, then run a debug app with
  `SCOUT_LCU_LOCKFILE=.cache/mock-lcu/lockfile SCOUT_LCU_CA=.cache/mock-lcu/ca.pem` (debug builds only).
- `node scripts/check.mjs fast|ui|full` — the quality gates (also run by the Stop hook and CI).
  `MVP_UI_PORT=4183` moves the Playwright preview off 4173 (several checkouts side by side).
- `pnpm --filter @scout/ui screenshots` → `reports/screenshots/*.png` for design review.
- Real data for the owner's account (Fillmo#7272, EUW): with `RIOT_API_KEY` set,
  `cargo run -p players --bin capture-profile -- "Fillmo#7272"` → `.cache/fixtures/profile.json`
  (git-ignored), shown by `?scenario=me`. Personal data is never committed.

## Rules
- Every change keeps `check.mjs full` green. Never weaken a test or raise a budget silently:
  budget changes go in their own commit with a reason.
- Git: work on a branch from `main` and open a pull request into `main`. Never push to `main` or
  create `v*` tags: the owner merges and tags, and the server only runs tags of `main`. Never
  commit a key, token, password or `.env` file (`scripts/check-secrets.mjs` blocks known formats).
- UI: only design tokens (`ui/src/design/tokens.css`); the coherence suite enforces it.
  Wrap self-contained blocks in `<Widget name>` (error isolation + perf budget entry required).
  New views need: layout-safe at 400→2560px, empty/error/loading states, mock scenarios.
- Every word the player reads is in `ui/src/i18n` (English source, French with the same shape:
  the typecheck and `catalogue.test.ts` enforce it); no literals in components.
- After any visual change: run the screenshots, have the `ui-reviewer` agent critique them,
  fix P0/P1, and show the user the before/after when the change is notable.
- Idle means idle: no timers, polling or animations while nothing changes (perf suite checks).
- Never commit Riot assets (icons, splash) — they're downloaded at runtime / into `.cache/`.
- Never ship the Riot API key in the app. Never scrape other stat sites.
- Rust: no `unwrap()`, no `println!`; clippy pedantic clean. Secrets redacted in Debug impls.

## Working with the owner
The owner vibe-codes but wants to stay in the loop: ask when unsure whether something looks
or works right, and send screenshots of rendered layouts for feedback.
