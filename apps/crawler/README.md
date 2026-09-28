# mvp-crawler

Builds the published stats server-side (the Riot API key never leaves the server): `crawl`
reads Emerald+ ladders and their ranked/ARAM games into a resumable SQLite store, `publish`
turns the stored facts into the per-patch JSON files the backend serves and the app downloads
(layout and types: `docs/architecture.md`, "Stats pipeline").

```sh
RIOT_API_KEY=RGAPI-… cargo run -p mvp-crawler -- crawl --platform euw1 --max-matches 500
cargo run -p mvp-crawler -- publish          # → .cache/crawler/stats/v1/…
cargo run -p mvp-crawler -- status
STATS_DIR=.cache/crawler/stats pnpm backend  # serve them on http://127.0.0.1:8787/v1/stats/…
```

`mvp-crawler --help` lists every option; `CRAWL_DATA_DIR`, `CRAWL_PLATFORM` and
`CRAWL_MAX_MATCHES` set the defaults from the environment. Every run can stop at any time: the
next one resumes, and a game is never counted twice.

## Scheduled on the VPS

The backend and the crawler run side by side on the VPS (Docker). The crawler never serves
anything: it writes into the backend's data volume, which serves `STATS_DIR=/data/stats`.

1. Build both images from the repository root:
   `docker build -f apps/backend/Dockerfile -t mvp-backend .` and
   `docker build -f apps/crawler/Dockerfile -t mvp-crawler .`
2. Run the backend with the stats dir set (plus its own settings, see `apps/backend/README.md`):
   `docker run -d --name mvp-backend -p 127.0.0.1:8787:8787 -v mvp-data:/data -e STATS_DIR=/data/stats --env-file /etc/mvp/backend.env mvp-backend`
3. Put the key in `/etc/mvp/crawler.env` (`chmod 600`, from `deploy/crawler.env.example`).
4. Install the timer: copy `deploy/mvp-crawl.service` and `deploy/mvp-crawl.timer` to
   `/etc/systemd/system/`, then `systemctl daemon-reload && systemctl enable --now mvp-crawl.timer`.
   Every 3 hours it crawls up to `CRAWL_MAX_MATCHES` new games, then publishes. Check it with
   `systemctl list-timers mvp-crawl.timer` and `journalctl -u mvp-crawl`.

A publication replaces each patch directory atomically and writes the index last, so the backend
never serves half a patch; the app revalidates the index at most every 5 minutes.

### Optional: a CDN copy on Cloudflare R2
The backend serving `/v1/stats/…` is enough to go live (files are small and cached by the app
with ETags). When traffic grows, mirror the files to an R2 bucket behind Cloudflare's CDN:
create the bucket and an R2 API token (object read & write on that bucket only), then write
`/etc/mvp/rclone.conf` on the VPS (`chmod 600`, never in the repo):

```ini
[r2]
type = s3
provider = Cloudflare
access_key_id = …
secret_access_key = …
endpoint = https://<account id>.r2.cloudflarestorage.com
```

The service's last step (`rclone sync … --checksum`) then uploads only what changed after each
publication; it is marked optional (`ExecStart=-…`): a failed upload never fails the cycle.
Pointing the app at the CDN is a later step (the core fetches stats through the backend's base
URL today).
