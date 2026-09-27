# mvp-backend

The HTTP service the desktop app calls for Riot-backed data. **The Riot API key lives only
here** (never in the app, see `docs/policy.md`). Axum + Tokio, reusing `crates/riot-api`
(routing, header-driven rate limits, retries) and `crates/players` (mapping to domain types).

## Routes

JSON, camelCase. Types come from `crates/domain` and are exported to
`ui/src/data/generated/*.ts`.

| Route | Answer |
| --- | --- |
| `GET /health` | `Health` `{ ok, version, riotKey }` |
| `GET /v1/players/{platform}/{gameName}/{tagLine}` | `PlayerProfile` (last 20 games) |
| `POST /v1/players/batch` `{ platform, puuids: [1–10] }` | `ScoutCard[]`, in request order |
| `GET /v1/stats/index` | `StatsIndex`: published patches and the `current` one |
| `GET /v1/stats/{patch}/{queue}/{file…}` | a published stats file, e.g. `16.19/420/emeraldPlus/builds/103.json` |

Stats routes serve the files `mvp-crawler publish` wrote under `STATS_DIR` (layout and types:
`docs/architecture.md`, Stats pipeline). They need no Riot key, answer with an `ETag` (send
`If-None-Match` → `304`) and `Cache-Control` (index 5 min, patch files 1 h), and 404 when the
file (or `STATS_DIR`) is absent.

- `platform` is a Riot platform id: `euw1`, `eun1`, `na1`, `kr`, `br1`, `jp1`, `la1`, `la2`,
  `me1`, `oc1`, `ru`, `sg2`, `tr1`, `tw2`, `vn2`.
- Scout cards come from the last 20 ranked solo/duo games: Riot ID (stored next to the PUUID),
  solo queue rank, top 3 champions (games, wins, KDA), last 10 results, main roles and
  **positive/neutral tags only**: `otp` (≥ 70 % of ≥ 10 games on one champion), `mainRole`
  (≥ 60 % of ≥ 5 games), `hotStreak` (≥ 4 wins in a row), `veteran` (≥ 100 ranked games this
  season). PUUIDs our key doesn't know get no card.
- Errors are `ApiError` `{ error, message, retryAfter? }`:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `badPlatform` / `badRequest` | unknown platform, malformed body, 0 or > 10 PUUIDs |
| 404 | `notFound` | no such Riot ID / route |
| 429 | `rateLimited` | Riot's limit reached; `retryAfter` seconds (also a `Retry-After` header) |
| 502 / 504 | `upstream` | Riot refused (bad key), failed, or took > 30 s |
| 503 | `riotKeyMissing` | the server runs without `RIOT_API_KEY` |

### Caching
In memory, per process: profiles and scout cards 2 min, account lookups 1 day, match documents
forever (compacted to the fields we read, LRU-bounded to 20,000). Concurrent identical lookups
share one upstream call, so scouting the same lobby twice costs no Riot calls.

## Configuration (environment)

| Variable | Default | |
| --- | --- | --- |
| `RIOT_API_KEY` | — | Required for Riot-backed routes (they answer 503 without it). |
| `BIND` | `127.0.0.1:8787` | Listen address (`0.0.0.0:8787` in the Docker image). |
| `ALLOWED_ORIGINS` | `tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://127.0.0.1:1420` | CORS allow-list, comma-separated. |
| `STATS_DIR` | — | Published stats root (e.g. `.cache/crawler/stats`); stats routes 404 without it. |
| `RUST_LOG` | `info` | Log filter (`tracing`). |

## Run locally

```sh
RIOT_API_KEY=RGAPI-… cargo run -p mvp-backend      # or: pnpm backend
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/v1/players/euw1/Name/TAG
curl -X POST http://127.0.0.1:8787/v1/players/batch \
  -H 'content-type: application/json' -d '{"platform":"euw1","puuids":["…"]}'
```

A development key (developer.riotgames.com) expires every 24 h and must never back a public
app: production needs the registered product's key.

Tests run against a fake Riot API (`tests/api.rs`, no network): `cargo test -p mvp-backend`.

## Deploy (VPS + Docker + Caddy)

Build from the **repository root** (the service uses workspace crates):

```sh
docker build -f apps/backend/Dockerfile -t mvp-backend .
docker run -d --name mvp-backend --restart unless-stopped \
  -p 127.0.0.1:8787:8787 --env-file /etc/mvp-backend.env mvp-backend
```

`/etc/mvp-backend.env` (mode 600, never committed) holds `RIOT_API_KEY=…`. The container
publishes only on loopback; Caddy terminates HTTPS in front of it (`/etc/caddy/Caddyfile`):

```caddy
api.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}
```

Health: the image's `HEALTHCHECK` runs `mvp-backend healthcheck` (probes `GET /health`);
`docker inspect --format '{{.State.Health.Status}}' mvp-backend` shows it, and an external
uptime monitor can poll `https://api.example.com/health` (`riotKey: false` means the key is
missing). Caches are in memory: a restart only costs a few extra Riot calls.

## Stats pipeline: crawl and publish (`apps/crawler`)

`mvp-crawler` fills the stats the app downloads (champion records, tier list, matchups,
builds, draft priors): Emerald+ ladders → recent ranked solo (420) and ARAM (450) games →
per-game facts in SQLite → per-patch JSON. Same key rules as the backend: server-side only.

```sh
# Crawl (resumable; stop anytime, run again to continue). A dev key works, slowly:
RIOT_API_KEY=RGAPI-… cargo run --release -p mvp-crawler -- crawl --platform euw1 --max-matches 500
# Publish the two newest patches from what was crawled (no Riot calls; Data Dragon for items):
cargo run --release -p mvp-crawler -- publish
# What's stored:
cargo run --release -p mvp-crawler -- status
# Serve them:
STATS_DIR=.cache/crawler/stats RIOT_API_KEY=RGAPI-… cargo run -p mvp-backend
curl http://127.0.0.1:8787/v1/stats/index
```

| Flag (env) | Default | |
| --- | --- | --- |
| `--data-dir` (`CRAWL_DATA_DIR`) | `.cache/crawler` | `crawl.sqlite`, the Data Dragon cache and `stats/` (never committed) |
| `--platform` (`CRAWL_PLATFORM`) | `euw1` | platform whose ladders are crawled |
| `--max-matches` (`CRAWL_MAX_MATCHES`) | `500` | matches fetched by this run (counted or not) |
| `--players-per-bracket` | `300` | ladder players seeded per bracket (emerald, diamond, master = Master+) |
| `--brackets` | `emerald,diamond,master` | brackets to crawl |
| `--since-days` / `--ids-per-player` | `14` / `20` | match-id window and page size per player and queue |
| `--concurrency` | `4` | matches in flight (the rate limiter still paces every call) |
| `--no-timelines` | off | skip timelines (halves requests; no skill order or items) |
| `publish --out` | `{data dir}/stats` | stats root (what `STATS_DIR` points to) |
| `publish --patch 16.19` (repeatable) | two newest | patches to publish |
| `publish --min-role-games / --min-pair-games / --min-current-games` | `50 / 10 / 20000` | publication thresholds |
| `publish --ddragon URL` or `off` | Riot's CDN | item classes source (`off`: builds without items) |

Budget: each counted game costs 2 requests (match + timeline) plus one match-id list per
player and queue. A development key (100 requests / 2 min) does ~2,000 games a day; volumes
worth publishing (≥ 20k ranked games per patch for `current`) need the production key.
Idempotent by construction: a match id is stored once, and publishing always recomputes from
the stored facts (so fixing an aggregation bug only needs a republish, never a recrawl).

**TODO (next step):** upload `{data dir}/stats/v1` to Cloudflare R2 after each publish (e.g.
`rclone sync`, credentials only in the VPS environment, never in this repo), put the CDN URL
in the app, and schedule crawl + publish (systemd timer or cron). Until then the backend
serves the files itself.
