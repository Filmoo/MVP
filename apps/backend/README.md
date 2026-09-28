# mvp-backend

The HTTP service the desktop app calls for Riot-backed data, app updates, remote config and
opt-in crash reports. **The Riot API key lives only here** (never in the app, see
`docs/policy.md`). Axum + Tokio, reusing `crates/riot-api` (routing, header-driven rate limits,
retries) and `crates/players` (mapping to domain types).

## Routes

JSON, camelCase. Types come from `crates/domain` and are exported to
`ui/src/data/generated/*.ts`.

| Route | Answer |
| --- | --- |
| `GET /health` | `Health` `{ ok, version, riotKey }` |
| `GET /v1/players/{platform}/{gameName}/{tagLine}` | `PlayerProfile` (last 20 games) |
| `POST /v1/players/batch` `{ platform, players: [{ gameName, tagLine }] }` (1–10; older apps: `puuids`) | `ScoutCard[]`, in request order |
| `GET /v1/updates/{target}/{arch}/{currentVersion}?channel=&install_id=&lang=` | 204, or the Tauri updater manifest (see [App updates](#app-updates)) |
| `GET /v1/config?version=&channel=` | `RemoteConfig` + `ETag`; 304 on `If-None-Match` (see [Remote config](#remote-config)) |
| `POST /v1/reports` (`CrashReport`) | 202 (see [Crash reports](#crash-reports-and-privacy)) |
| `GET /metrics` | Prometheus text; only with `METRICS_TOKEN` (bearer) or on `ADMIN_BIND` |
| `GET /v1/stats/index` | `StatsIndex`: published patches and the `current` one |
| `GET /v1/stats/{patch}/{queue}/{file…}` | a published stats file, e.g. `16.19/420/emeraldPlus/builds/103.json` |

Stats routes serve the files `mvp-crawler publish` wrote under `STATS_DIR` (layout and types:
`docs/architecture.md`, Stats pipeline). They need no Riot key, answer with an `ETag` (send
`If-None-Match` → `304`) and `Cache-Control` (index 5 min, patch files 1 h), and 404 when the
file (or `STATS_DIR`) is absent. Like every `/v1/*` route they go through the per-install rate
limit (60 at once, then 120 a minute): the app keeps downloaded files and revalidates them
with `If-None-Match` rather than refetching a whole patch at once.

- `platform` is a Riot platform id: `euw1`, `eun1`, `na1`, `kr`, `br1`, `jp1`, `la1`, `la2`,
  `me1`, `oc1`, `ru`, `sg2`, `tr1`, `tw2`, `vn2`.
- Scouting batches name players by **Riot ID** (`players`, as the League client shows them):
  the client's PUUIDs are not our key's (Riot encrypts PUUIDs per API key), so each Riot ID is
  resolved with account-v1 (cached a day, like every account lookup) and the card is built
  from our key's PUUID. `puuids` (PUUIDs as *our key* sees them) is what apps up to 0.1.0
  sent and is still accepted; Riot IDs come first in the answer, then PUUIDs. Repeats count
  once (Riot IDs compare case-insensitively); at most 10 players across both lists.
- Scout cards come from the last 20 ranked solo/duo games: Riot ID (the account's own spelling,
  stored next to our key's PUUID; the app matches it back case-insensitively), solo queue
  rank, top 3 champions (games, wins, KDA), last 10 results, main roles and
  **positive/neutral tags only**: `otp` (≥ 70 % of ≥ 10 games on one champion), `mainRole`
  (≥ 60 % of ≥ 5 games), `hotStreak` (≥ 4 wins in a row), `veteran` (≥ 100 ranked games this
  season). A Riot ID nobody has, or a PUUID our key can't read (Riot answers 400 for another
  key's), gets no card; the rest of the batch still comes. League client PUUIDs (UUIDs, what
  0.1.0 apps sent) can never be read with our key and cost no Riot call.
- Every request should carry **`X-MVP-Install: <install id>`** (a random UUID the app makes
  once per install): it keys the rate limit and staged rollouts. Answers carry
  `X-Request-Id` (quote it in bug reports; a sane incoming `X-Request-Id` is kept).
- Errors are `ApiError` `{ error, message, retryAfter? }`:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `badPlatform` / `badRequest` | unknown platform, malformed body or Riot ID, 0 or > 10 players, bad version/channel |
| 404 | `notFound` | no such Riot ID / route |
| 413 | `badRequest` | body over the limit (16 KB; 40 KB for reports) |
| 429 | `rateLimited` | Riot's limit, or ours per client; `retryAfter` seconds (also a `Retry-After` header) |
| 502 / 504 | `upstream` | Riot refused (bad key), failed, or took > 30 s; any request over 45 s |
| 503 | `riotKeyMissing` | the server runs without `RIOT_API_KEY` |

### Caching
In memory, per process: profiles and scout cards 2 min, account lookups 1 day, match documents
forever (compacted to the fields we read, LRU-bounded to 20,000). Concurrent identical lookups
share one upstream call, so scouting the same lobby twice costs no Riot calls.
Accounts and matches are saved to `cache/riot-cache.json` on graceful shutdown and restored at
startup (accounts keep their age), so a deploy doesn't re-spend Riot calls. A JSON snapshot
rather than a database: the caches are bounded (tens of MB) and only a crash loses anything
(what was fetched since the last clean stop). `CACHE_SNAPSHOT=0` turns it off.

## Data dir

`DATA_DIR` (default `.cache/backend` locally, `/data` in the Docker image, a volume):

```text
data/
├── releases.json          app releases (edited with `mvp-backend release …`)
├── config.json            remote config (edited by hand, checked with `mvp-backend config check`)
├── reports/YYYY-MM-DD.jsonl   crash reports, one JSON object per line, 30 days
└── cache/riot-cache.json  Riot cache snapshot (written on shutdown)
```

`releases.json` and `config.json` are validated when the service starts (it refuses to start
on a broken file) and reloaded when they change: requests look at the file's mtime and size at
most every 2 s, no watcher and no polling. A broken edit is logged and the previous version
keeps being served. Missing files mean "no releases" and the default config.

## App updates

For the Tauri v2 updater plugin. `GET /v1/updates/windows/x86_64/0.2.0?channel=stable` answers
**204** when the app is up to date, else **200**:

```json
{
  "version": "0.3.0",
  "notes": "Faster draft helper",
  "pub_date": "2026-10-01T12:00:00Z",
  "platforms": { "windows-x86_64": { "signature": "dW50cnVzdGVk…", "url": "https://…/MVP_0.3.0_x64-setup.exe" } },
  "mandatory": false,
  "notesI18n": { "en": "Faster draft helper", "fr": "Assistant de draft plus rapide" }
}
```

`notes` is in `lang` (`en` default, `fr`); the plugin ignores `mandatory` and `notesI18n`, the
app reads them from `update.rawJson`. The install id comes from `install_id` or `X-MVP-Install`.

`releases.json`:

```json
{
  "releases": [
    {
      "version": "0.3.0",
      "channel": "stable",
      "pubDate": "2026-10-01T12:00:00Z",
      "notes": { "en": "Faster draft helper", "fr": "Assistant de draft plus rapide" },
      "platforms": {
        "windows-x86_64": { "url": "https://github.com/…/MVP_0.3.0_x64-setup.exe", "signature": "<.sig contents>" }
      },
      "rollout": 10,
      "forceBelow": "0.2.0",
      "blocked": false
    }
  ]
}
```

`rollout` (0–100, default 100), `forceBelow` and `blocked` are optional. Validation: unique
versions, pre-releases (`0.3.0-beta.1`) only on `beta`, RFC 3339 `pubDate`, English and French
notes, `https://` URLs, one-line signatures, `forceBelow` ≤ version, no unknown keys.

**Which release an install gets** (`src/updates.rs`):
1. Candidates: not `blocked`, on a channel the install follows (`stable` → stable; `beta` →
   beta **and** stable), with an artifact for `{target}-{arch}`, strictly newer than the
   install (semver precedence: build metadata ignored, `0.3.0-beta.1 < 0.3.0 < 0.10.0`).
2. Staged rollout: the install is in when `SHA-256(install id, version) mod 10000 < rollout ×
   100` — stable for a given install and release (the answer never flips), independent across
   releases, and widening a rollout keeps everyone already in. Without an install id only
   100 % releases are offered. The rollout is skipped for installs below the release's
   `forceBelow`, and for installs **on a blocked release**.
3. The newest candidate wins. `mandatory` is true when a candidate forces the install or the
   install runs a blocked release.
4. **No downgrades.** Blocking a release stops it spreading: installs below it get the previous
   good release. Installs already on it stay there until a newer fix ships — they get that fix
   first, whatever its rollout, flagged mandatory. (Tauri refuses older versions by default.)

**Admin CLI** (edits are validated and written atomically, with a lock file; the running
service picks them up; in Docker prefix with `docker exec mvp-backend`):

```sh
mvp-backend release add --version 0.3.0 --channel stable \
  --url https://github.com/<owner>/<repo>/releases/download/v0.3.0/MVP_0.3.0_x64-setup.exe \
  --signature-file MVP_0.3.0_x64-setup.exe.sig \
  --notes-en "Faster draft helper" --notes-fr "Assistant de draft plus rapide" \
  --rollout 10 [--force-below 0.2.0] [--platform windows-x86_64] [--pub-date RFC3339]
mvp-backend release promote --version 0.3.0 --rollout 50     # default 100; --channel stable
mvp-backend release block --version 0.3.0                    # unblock to undo
mvp-backend release list
```

`--signature '<.sig contents>'` replaces `--signature-file` (handy in `docker exec`, where the
file isn't in the container). Adding an existing version with another `--platform` merges it.

**Producing signed artifacts** (`.github/workflows/release.yml`, on a `v*` tag): the build
runs with `createUpdaterArtifacts` and the `TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets, so the bundler writes
`MVP_<version>_x64-setup.exe.sig` next to the NSIS installer; both go to a published GitHub
release with `latest.json` (version, installer URL, signature), which installed apps read while
this server doesn't serve updates. The job summary prints the `release add` command (URL +
signature filled in) for when it does.

**The signing key pair (once, by the owner).** Until it exists, builds don't update themselves
(Settings says "doesn't update itself (no update key in this build)") and the release workflow
refuses to run. `node scripts/setup-updates.mjs` does all of the below (the secrets with `gh` if
it is logged in, else it says what to paste where); by hand:

1. `pnpm tauri signer generate -w ~/.tauri/mvp.key` (pick a password). It writes the private
   key `~/.tauri/mvp.key` and the public key `~/.tauri/mvp.key.pub`.
2. **Private half** — never committed, never on the VPS: the contents of `mvp.key` go in the
   repository secret `TAURI_SIGNING_PRIVATE_KEY`, the password in
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (GitHub → Settings → Secrets and variables → Actions),
   and both in the owner's password manager. Losing them means installed apps can never be
   updated again (they only accept updates signed by this key).
3. **Public half** — committed: paste the contents of `mvp.key.pub` (one base64 line) as
   `plugins.updater.pubkey` in `apps/desktop/tauri.conf.json`. That is the one place the app
   reads it from; every build made after that verifies updates with it.

**Desktop app side** (`apps/desktop/src/updater.rs`, following `companion::updates::UpdatePlan`):
tauri-plugin-updater asking, in order, the build's backend when it is HTTPS
(`{MVP_BACKEND_URL}/v1/updates/{{target}}/{{arch}}/{{current_version}}?channel=stable`, with
`X-MVP-Install`), then the latest GitHub release's `latest.json` (no install id): the first that
answers decides. It checks 30 s after start and every 6 h (at once when the config says
`updateRequired`, or from Settings → About), downloads only while no ready check, champ select or
game is running (and stops if one starts), then asks the player ("Update ready — Restart");
otherwise the update installs when MVP quits, never during a game. `mandatory` makes the prompt
stay. Debug builds and plain-HTTP backends never update. `tauri.conf.json`:

```json
"plugins": { "updater": {
  "pubkey": "<contents of mvp.key.pub>",
  "windows": { "installMode": "passive" }
} }
```

## Remote config

`GET /v1/config?version=0.2.0&channel=stable` → `RemoteConfig`:

```json
{
  "features": { "scouting": true, "draftHelper": true, "playerSearch": true, "autoAccept": true,
                "runeImport": true, "itemSets": true, "summonerSpells": true },
  "killSwitches": { "autoAccept": false, "runeImport": false, "itemSets": false, "summonerSpells": false },
  "minVersion": { "version": "0.2.0", "message": { "en": "…", "fr": "…" } },
  "updateRequired": false,
  "banners": [ { "id": "patch-26.20", "severity": "info", "text": { "en": "…", "fr": "…" },
                 "link": "https://…", "startsAt": "2026-10-08T08:00:00Z", "endsAt": "2026-10-09T08:00:00Z" } ],
  "statsIndexUrl": "https://stats.example.com/index.json",
  "pollAfterSecs": 21600
}
```

`config.json` has the same shape without `updateRequired`; every key is optional (defaults:
features on, kill switches off, no banner, 6 h poll hint), and a banner may add
`"channels": ["beta"]`. The answer is computed per request: only banners whose
`[startsAt, endsAt)` window contains now (and whose channels include the caller's), and
`updateRequired` when `version` < `minVersion.version`. Validation rejects unknown keys (a
misspelled kill switch must not be silently ignored), bad semver, banner ids that repeat,
empty or > 300-character texts, non-`https` links, `startsAt ≥ endsAt`, and a poll hint outside
60 s–24 h. `mvp-backend config check` validates the file before you rely on the reload.

Answers carry a strong `ETag` (hash of the bytes) and `Cache-Control: no-cache`; send it back in
`If-None-Match` to get a bodiless 304.

A banner may also say `"dismissible": false` (default `true`) to stay up while it lasts, e.g.
during an outage.

**Desktop app side** (`companion::remote`, done): fetched at startup and after every
`pollAfterSecs` (one timer in the Rust core, not the UI — idle stays idle), with `X-MVP-Install`
and `If-None-Match`; the last answer is kept on disk (`remote-config.json`) and applies from the
next start, offline included. A kill switch wins over the user's setting immediately (auto-accept
stops even mid-delay); `scouting` and `playerSearch` turn those lookups off; `updateRequired`
blocks the UI behind `minVersion.message` (English for now) with the update button; banners
show at the top of the page and close by `id` when dismissible; their `link` opens in the
browser.

## Crash reports and privacy

`POST /v1/reports` with a `CrashReport`:
`{ appVersion, osVersion, kind: "panic" | "js" | "lcu", message, stack?, installId }` → 202.
**Only sent when the user opted in** (off by default, Settings → App → "Send crash reports").
The app (`companion::crash`) scrubs each report itself with the same rules (`crates/scrub`)
before it leaves, sends panics saved by its panic hook at the next start (5 at most per start)
and UI crashes once each per session; turning the setting off deletes reports not sent yet.

- **Limits:** body ≤ 40 KB (413 above), `message` ≤ 2 KB, `stack` ≤ 16 KB, `osVersion` ≤ 64
  printable characters, `appVersion` semver, `installId` 8–64 of `[A-Za-z0-9-]`; per install a
  burst of 5 then 10 an hour (429 + `Retry-After`); a day file stops growing at 64 MB.
- **Scrubbed before storage** (`src/scrub.rs`, errs on removing too much): Riot IDs
  (`Name#TAG`, URL-encoded, our `/v1/players/…/Name/TAG` and Riot's `by-riot-id/Name/TAG`
  paths, `gameName`/`tagLine`/`puuid`/… JSON fields and query parameters), PUUIDs and other long
  ids (UUIDs, 40+ character tokens), user names in paths (`C:\Users\<user>\…`, `/home/<user>`),
  e-mails, credentials in URLs and `Basic`/`Bearer` headers (the LCU's password), non-loopback
  IP addresses.
- **What we store:** receive time, install id, app and OS version, kind, scrubbed message and
  stack. **Not** the IP address, the Riot account, or anything else about the player.
- **Retention:** 30 days. Day files older than that are deleted at startup and daily, or with
  `mvp-backend reports prune [--days N]`.
- **Deletion (GDPR):** the app shows its install id in Settings ("Report ID", under the
  crash-reports switch once it's on); on request run
  `mvp-backend reports forget --install-id <id>` (rewrites the day files without that id's
  lines; a report arriving during the rewrite may be lost). Uninstalling the app removes the id.
- Logs keep method, route, status and duration per request, never bodies or the install id.

## Hardening

- **Rate limit** on `/v1/*` (not `/health`, not CORS preflights): a token bucket per
  `X-MVP-Install` (falling back to the client IP), 60 at once then 120 a minute by default,
  429 `rateLimited` + `Retry-After`. Behind Caddy set `TRUST_PROXY=1` (the Docker image does) so
  the IP is the last `X-Forwarded-For` hop; never expose the container directly with it on.
  An install id is self-declared: the limit protects against runaway clients, the Riot rate
  limiter and caches protect the key.
- **Body limits** 16 KB (40 KB for reports), **timeout** 45 s per request (Riot calls 30 s).
- **Logs:** `tracing`, one span per request with its id, method and route; `LOG_FORMAT=json` for
  one JSON object per line (the Docker image sets it).
- **Metrics:** `mvp_http_requests_total{route,method,status}`,
  `mvp_http_request_duration_seconds_{sum,count}{route}`, `mvp_riot_calls_total{result}`,
  `mvp_cache_{hits,misses}_total{cache}`, `mvp_cache_entries{cache}`,
  `mvp_rate_limited_total`, `mvp_reports_total{outcome}`, `mvp_build_info{version}`. Served on
  `ADMIN_BIND` (keep it private, e.g. `127.0.0.1:9100`) without auth, and/or on the public port
  to `Authorization: Bearer $METRICS_TOKEN` (≥ 16 characters). Neither set: no `/metrics`.
- **Graceful shutdown** on SIGTERM/Ctrl-C: stops accepting, finishes in-flight requests, then
  saves the cache snapshot.

## Configuration (environment)

| Variable | Default | |
| --- | --- | --- |
| `RIOT_API_KEY` | — | Required for Riot-backed routes (they answer 503 without it). |
| `BIND` | `127.0.0.1:8787` | Listen address (`0.0.0.0:8787` in the Docker image). |
| `ALLOWED_ORIGINS` | `tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://127.0.0.1:1420` | CORS allow-list, comma-separated. |
| `DATA_DIR` | `.cache/backend` | Data dir (`/data` in the image). |
| `ADMIN_BIND` | — | Private address serving `/metrics` without a token. |
| `METRICS_TOKEN` | — | Bearer token for `/metrics` on the public port. |
| `TRUST_PROXY` | off | Client IP from `X-Forwarded-For` (on in the image). |
| `RATE_LIMIT_BURST` / `RATE_LIMIT_PER_MINUTE` | `60` / `120` | Per install (or IP) on `/v1/*`. |
| `REQUEST_TIMEOUT_SECS` | `45` | Whole-request timeout. |
| `CACHE_SNAPSHOT` | on | `0` to skip saving/restoring the Riot caches. |
| `STATS_DIR` | — | Published stats root (e.g. `.cache/crawler/stats`); stats routes 404 without it. |
| `RUST_LOG` | `info` | Log filter (`tracing`). |
| `LOG_FORMAT` | text | `json` for JSON lines (set in the image). |

## Run locally

```sh
RIOT_API_KEY=RGAPI-… cargo run -p mvp-backend      # or: pnpm backend
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/v1/players/euw1/Name/TAG
curl -X POST http://127.0.0.1:8787/v1/players/batch \
  -H 'content-type: application/json' -d '{"platform":"euw1","players":[{"gameName":"Name","tagLine":"TAG"}]}'
curl -i 'http://127.0.0.1:8787/v1/config?version=0.1.0'
curl -i http://127.0.0.1:8787/v1/updates/windows/x86_64/0.1.0
cargo run -p mvp-backend -- release list            # admin commands use the same DATA_DIR
```

A development key (developer.riotgames.com) expires every 24 h and must never back a public
app: production needs the registered product's key.

Tests run without network (`cargo test -p mvp-backend`): `tests/api.rs` against a fake Riot API,
`tests/platform.rs` for updates, config, reports, rate limits, metrics and the cache snapshot.

## Deploy (VPS + Docker + Caddy)

Build from the **repository root** (the service uses workspace crates):

```sh
docker build -f apps/backend/Dockerfile -t mvp-backend .
docker run -d --name mvp-backend --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -p 127.0.0.1:9100:9100 -e ADMIN_BIND=0.0.0.0:9100 \
  -v mvp-data:/data --env-file /etc/mvp-backend.env mvp-backend
```

`/etc/mvp-backend.env` (mode 600, never committed) holds `RIOT_API_KEY=…`. The `mvp-data`
volume keeps `releases.json`, `config.json`, reports and the cache snapshot across deploys
(back up the first two). `docker stop` sends SIGTERM and waits 10 s: enough to save the
snapshot. The container publishes only on loopback; Caddy terminates HTTPS in front of it
(`/etc/caddy/Caddyfile`):

```caddy
api.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}
```

Health: the image's `HEALTHCHECK` runs `mvp-backend healthcheck` (probes `GET /health`);
`docker inspect --format '{{.State.Health.Status}}' mvp-backend` shows it, and an external
uptime monitor can poll `https://api.example.com/health` (`riotKey: false` means the key is
missing). Prometheus (or a Grafana agent) on the VPS scrapes `127.0.0.1:9100/metrics`.

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
in `config.json`'s `statsIndexUrl` (the app reads it from `RemoteConfig`), and schedule crawl + publish (systemd timer or cron). Until then the backend
serves the files itself.
