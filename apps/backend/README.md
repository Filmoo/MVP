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

Later: published per-patch aggregates go to Cloudflare R2 (the crawler is not built yet).
