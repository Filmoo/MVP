# Architecture

```mermaid
flowchart LR
  subgraph PC["Player's PC"]
    UI["UI · SolidJS<br/>(WebView2 window, closable to tray)"]
    Core["Rust core · companion<br/>(tray process, idle-silent)"]
    LCU["League client<br/>LCU REST + WebSocket"]
    Game["Game client<br/>Live Client Data :2999"]
    Cache[("Disk cache<br/>game data per patch")]
  end
  DD["Riot Data Dragon<br/>(names, icons)"]
  subgraph Server["Our backend (VPS, Docker behind Caddy/HTTPS)"]
    Api["API · apps/backend (mvp-backend)<br/>player lookups + scouting, updates,<br/>remote config, crash reports"]
    Data[("Data dir (volume)<br/>releases.json · config.json<br/>reports/ · cache snapshot")]
    Crawler["Crawler · apps/crawler (mvp-crawler)<br/>riot-api client, rate limited, SQLite state"]
    Agg["Aggregator · crates/aggregate<br/>per patch × queue × bracket × role"]
    Files[("Stats files stats/v1/…<br/>(served by the API; later R2 / CDN)")]
  end
  Riot["Riot Web API<br/>(production key, server-side only)"]

  UI <-- "Tauri IPC: commands + events" --> Core
  Core <-- "pinned-root TLS, loopback only" --> LCU
  Core -. "later: in-game view" .-> Game
  Core --> Cache
  Core -- "versions + JSON" --> DD
  UI -- "icons (img)" --> DD
  Api <-- "RIOT_API_KEY" --> Riot
  Crawler --> Riot --> Crawler
  Crawler --> Agg --> Files
  Core -- "download compact stats" --> Files
  Api -- "GET /v1/stats/…" --> Files
  UI -- "HTTPS JSON (CORS: tauri origins)" --> Api
  Core -- "updater, config, opt-in reports<br/>(X-MVP-Install)" --> Api
  Api --- Data
  GH["GitHub Releases<br/>signed NSIS installer + .sig"]
  Core -. "download update" .-> GH
```

## Principles
- **The core owns data, the UI renders it.** Every UI-facing type lives in `crates/domain` and is
  exported to TypeScript; the UI reaches the core only through `ui/src/data/transport.ts`
  (Tauri IPC in the app, scripted mock scenarios in a browser, HTTP later for a web version).
- **Light next to League.** No overlay, no injection, no polling loops in the UI; the webview can
  be closed while the core keeps following the client from the tray. Budgets and an idle-work
  test guard this in CI, plus a real-app memory/CPU check on Windows.
- **Privacy and policy by construction.** Hidden players' identities are never deserialized from
  the champ-select session. The Riot API key only exists on our server. See `policy.md`.
- **Stats are transparent.** The draft model (`crates/stats/src/draft`) is additive log-odds with
  empirical-Bayes shrinkage: every number comes with its games, weight and uncertainty.

## Backend API (`apps/backend`)
The only holder of the Riot API key. JSON, camelCase, types from `crates/domain` (so the UI gets
TypeScript types); failures answer `ApiError` `{ error, message, retryAfter? }`.

| Route | Answer |
| --- | --- |
| `GET /health` | `Health` `{ ok, version, riotKey }` |
| `GET /v1/players/{platform}/{gameName}/{tagLine}` | `PlayerProfile` · 400 bad platform · 404 · 429 + `retryAfter` · 503 without key |
| `POST /v1/players/batch` `{ platform, puuids ≤ 10 }` | `ScoutCard[]` for loading-screen scouting |
| `GET /v1/stats/index` | `StatsIndex` (published patches, `current`) · ETag, `max-age=300` |
| `GET /v1/stats/{patch}/{queue}/{file…}` | published stats files (below) · ETag/304, `max-age=3600` · 404 when absent |
| `GET /v1/updates/{target}/{arch}/{version}?channel=` | 204 or the Tauri updater manifest (staged rollout, channels, blocked releases) |
| `GET /v1/config?version=&channel=` | `RemoteConfig` (feature flags, kill switches, min version, banners) · `ETag`/304 |
| `POST /v1/reports` | opt-in `CrashReport`, scrubbed of personal data, kept 30 days |
| `GET /metrics` | Prometheus text (admin address or bearer token) |

Scout cards carry the Riot ID next to the PUUID and positive/neutral tags only (OTP, main role,
hot streak, veteran). Caches in memory with request coalescing: profiles and cards 2 min,
accounts 1 day, compacted match documents forever (LRU-bounded); accounts and matches are
snapshotted to the data dir on shutdown. Lookups share one rate limiter per routing value; a
429 is reported to the caller rather than waited out when Riot asks for more than 5 s.

Platform services (`apps/backend/src/ops.rs` and siblings) sit next to the Riot routes:
- **Updates:** releases are described in `releases.json` (edited by `mvp-backend release
  add|promote|block`), served in the Tauri v2 updater format. Staged rollouts bucket installs
  by `SHA-256(install id, version)`, so an install's answer is stable; beta follows stable too;
  blocked releases are never offered and never downgraded from (the fix is forced instead).
  The release workflow signs the installer (`createUpdaterArtifacts`, key in CI secrets).
- **Remote config:** `config.json`, validated at load and re-read when its mtime changes (no
  watcher, no polling); the app applies kill switches immediately.
- **Reports:** opt-in only, scrubbed (Riot IDs, PUUIDs, user names in paths, e-mails,
  credentials, IPs), per-install rate limited, daily JSONL files pruned after 30 days,
  erasable per install id (`mvp-backend reports forget`).
- **Hardening:** every request gets an id, a span and metrics; `/v1/*` is rate limited per
  `X-MVP-Install` (else IP) with 429 + `Retry-After`; body limits and a 45 s timeout; JSON logs
  in production; graceful shutdown.

Run, deploy, data dir layout and privacy: `apps/backend/README.md`.

## Settings and automations
- **Settings** (`domain::Settings`) are owned by the core: `companion::settings::SettingsStore` loads
  `settings.json` from the app config dir at start (missing/corrupt → defaults), saves every change
  atomically (temp file + fsync + rename) and publishes it on a watch channel. The UI reads and
  writes them with `get_settings` / `update_settings` and follows the `settings` event.
- **Automations** run in the core (`companion::automation`), so they work with the window closed:
  auto-accept (opt-in, delayed, once per ready check, see policy.md) and the `Autopilot`, which
  turns gameflow phases into window intents: focus in champ select, Draft → Live → Home as the game
  goes. The UI reports every view it shows (`view_changed`), so a page the player opened is never
  switched away from.
- **Shell**: the window is created on demand (launch, tray, champ select); closing it frees the
  webview and, with *close to tray*, the app stays in the tray. A `navigate` event moves the UI; a
  window created for an intent opens directly on its view. *Launch at startup* uses
  tauri-plugin-autostart and starts in the tray (`--autostart`).

## Stats pipeline (`apps/crawler` + `crates/aggregate`)
Server-side only (the Riot key never leaves it). Checkpoint 2 scope: **Emerald+**, ranked solo
(420) and **ARAM** (450), current patch with fallback to the previous one.

```text
crawl:   ladder pages (Emerald I–IV, Diamond I–IV, Master/GM/Challenger) → PUUIDs
         → match ids (420 + 450, last N days) → match + timeline → GameFacts → SQLite
publish: SQLite facts of a patch (+ the previous patch) → Dataset → JSON files → STATS_DIR/v1/…
serve:   mvp-backend GET /v1/stats/… (ETag, Cache-Control) → the app downloads and caches
```

- **Crawl state** (`{data dir}/crawl.sqlite`, rusqlite bundled): ladder pages read, players (with
  the bracket they were seeded from and when their history was last read), pending match ids,
  and every fetched match (primary key = match id → never counted twice) with its extracted
  facts or the reason it isn't counted. Any run can stop anytime and the next one resumes. Every
  call goes through `riot-api`'s header-driven limiter; the crawler waits out 429s (a dev key
  just crawls slowly). Brackets are rotated so each gets its share.
- **Facts** (`aggregate::extract`): patch from `gameVersion` (`16.19.712.4` → `16.19`, public
  `26.19`), queue, bans (once per game), and per player: team, win, champion, `teamPosition`,
  spells, full rune page, skill level-ups and net purchases (undos removed) from the timeline.
  No PUUIDs or names are kept. Skipped: other queues, remakes (< 5 min or early surrender),
  ranked games without one of each role per team. A game counts in the bracket of the ladder
  player who surfaced it first (Match-V5 has no rank); brackets publish cumulatively
  (`emeraldPlus` ⊇ `diamondPlus` ⊇ `masterPlus`).
- **Aggregates** (`aggregate::Dataset`, per patch × queue × seed bracket): champion × role
  games/wins (pick counts, role odds), bans, lane-relevant opponents (same role, laner vs enemy
  jungler, bottom vs support), same-team duos (all 10 role pairs), and builds per champion ×
  role: rune pages, keystones, spell pairs, skill max order and first four points, starting
  items (< 1:30), core (first three completed legendaries in order), first upgraded boots, and
  the 4th/5th/6th legendary. Items are classified with the patch's Data Dragon `item.json`.
  Every count is a sum, so `merge` is commutative and results don't depend on game order
  (property-tested); build options are bounded by `compact` (top N + a tail count).
- **Published files** (`aggregate::publish`, types in `crates/domain/src/stats.rs`, exported to
  TS): compact keys (`g` games, `w` wins), raw counts next to every derived number.

| Path under `STATS_DIR` | Type | Contents |
| --- | --- | --- |
| `v1/index.json` | `StatsIndex` | patches (newest first) with games per `{queue, bracket}`, `current` (newest patch with ≥ 20k Emerald+ ranked games, else the previous) |
| `v1/{patch}/{queue}/{bracket}/champions.json` | `ChampionsFile` | per champion: games, wins, bans, roles (g/w, previous patch g/w); draft priors τ/k per pair type (DerSimonian–Laird via `stats::draft::estimate_tau`) |
| `…/tierlist.json` | `TierList` | champion × role: score = shrunk win rate − 50 % (k = 1000), grade S–D, games, pick/ban rates |
| `…/matchups/{championId}.json` | `MatchupsFile` | ranked only; per role: lane, vs enemy jungler, duos — g/w and the shrunk delta `d` in points |
| `…/builds/{championId}.json` | `BuildsFile` | per role: runes, keystones, spells, skills, skill start, starts, core, boots, item 4/5/6 — each `{ n, top: [{ ids, g, w }] }` |

`{bracket}` is `emeraldPlus`, `diamondPlus` or `masterPlus`. Each patch directory is replaced
atomically on publication; the index is written last.

**Next (not built):** upload `STATS_DIR` to Cloudflare R2 behind a CDN after each publish
(credentials only on the VPS, never in the repo) and point the app at it; a schedule (cron /
systemd timer) for crawl + publish; per-platform crawls merged for more volume.

## Crates
| Crate | Role |
| --- | --- |
| `domain` | UI-facing types (serde + ts-rs) |
| `lcu` | League client: discovery, pinned TLS, REST, WAMP events, connector lifecycle |
| `mock-lcu` | fake League client for tests and development |
| `companion` | Tauri-free core: client status, champ select → `DraftView`, settings, automations |
| `static-data` | Data Dragon download + per-patch cache + offline fallback |
| `stats` | statistics and the draft model |
| `aggregate` | stats pipeline core: Match-V5 → facts → mergeable aggregates → published JSON |
| `riot-api` | Riot Web API client for the backend (rate limits, retries) |
| `players` | Riot data → `PlayerProfile` / `ScoutCard` (behind a `RiotSource` trait the backend caches) |
| `apps/desktop` | Tauri shell: window, tray, commands, event bridge |
| `apps/backend` | `mvp-backend` HTTP service: player lookups, scouting, published stats files (key server-side), app updates, remote config, crash reports, admin CLI |
| `apps/crawler` | `mvp-crawler`: crawl (Riot API → SQLite) and publish (→ `stats/v1/…`) |
