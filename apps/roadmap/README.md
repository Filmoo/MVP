# mvp-roadmap: MVP's roadmap at dev.mvpgg.com

Every feature of MVP by version, Claude's proposals waiting for the owner, and a log of every
change. Three views: a **Board** (a column per version with its progress, status lanes, drag and
drop), a **Roadmap** (versions as stations along a track, each feature a node coloured by area)
and a **List**. Keyboard first: Ctrl+K opens the command palette, `?` lists the shortcuts.

The code is public like the rest of the repository; **the roadmap itself is not**. It lives in
the server's SQLite file, and only two kinds of callers get in:

- **The repository's admins** (the owner), signed in with GitHub. At sign-in the server asks
  GitHub whether the login is an admin of `Filmoo/MVP`
  (`GET /repos/Filmoo/MVP/collaborators/{login}/permission`), and asks again every ten minutes
  while the session is used. Anyone else gets a 403 page, and the refusal is logged.
- **Claude**, with a machine token made on the server (`mvp-roadmap token create --name claude`).
  Claude reads everything, proposes features (always as proposals), comments, and moves the
  features the owner accepted between accepted, in progress and done (with links to its commits).
  Accepting and rejecting proposals, editing, ordering and removing are the owner's.

```text
apps/roadmap/
├── src/           the service (axum + SQLite): api.rs routes, auth.rs sign-in, policy.rs rights,
│                  store.rs the database and its audit log, seed.rs, github.rs, crypto.rs
├── web/           the page (SolidJS, the app's design tokens), built into web/dist
├── seed/roadmap.json   the roadmap as the docs described it (imported into an empty database)
├── deploy/        systemd units, the Caddy site block, the env file's template
├── tests/         Rust: sign-in, sessions, CSRF, tokens' rights, CRUD, order, undo, seed, audit
└── Dockerfile     the image the server runs
```

## Try it locally

```sh
pnpm install
pnpm roadmap --dev-login        # builds the page, serves http://127.0.0.1:8790, DB in .cache/roadmap/
```

`--dev-login` signs whoever opens the page in as a fake admin (`dev-admin`), without GitHub. It
only exists in debug builds and only listens on a loopback address; the server refuses to start
otherwise. The first start imports `seed/roadmap.json` into the empty database.

- `pnpm --filter @scout/roadmap dev`: the page with hot reload on http://127.0.0.1:1445 (it
  proxies the API to the service on 8790, so run `pnpm roadmap --dev-login` beside it).
- `pnpm --filter @scout/roadmap test`: the UI suite (Playwright) against a real service on
  127.0.0.1:4272 (`MVP_ROADMAP_TEST_PORT` moves it), reset to `web/tests/fixtures/seed.json`
  before each test. `node scripts/check.mjs roadmap` runs the same as a gate (also in `full`).
- `pnpm --filter @scout/roadmap shots`: screenshots in `reports/roadmap/` for design review.
- `cargo test -p mvp-roadmap`: the service's tests (a fake GitHub on a local port).
- Real GitHub sign-in on your PC: make a second OAuth App with the callback
  `http://127.0.0.1:8790/auth/callback`, then `ROADMAP_PUBLIC_URL=http://127.0.0.1:8790
  ROADMAP_GITHUB_CLIENT_ID=… ROADMAP_GITHUB_CLIENT_SECRET=… ROADMAP_SESSION_KEY=$(cargo run -q -p
  mvp-roadmap -- key) pnpm roadmap`.

## Claude's command line

`scripts/roadmap.mjs` talks to `MVP_ROADMAP_URL` (default https://dev.mvpgg.com) with the token
from `MVP_ROADMAP_TOKEN` or the git-ignored file `.cache/roadmap-token`:

```sh
node scripts/roadmap.mjs list [--version 0.4] [--status proposed,in_progress] [--area draft] [--json]
node scripts/roadmap.mjs show 12
node scripts/roadmap.mjs propose "Heatmaps" --area profile --version 0.4 --description "Where deaths happen."
node scripts/roadmap.mjs status 12 in_progress           # done, accepted; --link <commit URL> [--label]
node scripts/roadmap.mjs comment 12 "Built in 4d5f35b; the tests cover…"
node scripts/roadmap.mjs versions | areas
```

A proposal without `--version` goes to the last version (Later). Asking for something that is the
owner's (accepting a proposal, say) answers with the reason and exit code 1.

## Deploy (the owner's steps)

On the server that runs `api.mvpgg.com` (OVHcloud VPS, Docker, Caddy, Cloudflare; `deploy/README.md`
on the `claude/backend-url` branch). Nothing here has been run against the real server yet.

1. **The GitHub OAuth App** (github.com → Settings → Developer settings → OAuth Apps → New):
   name `MVP Roadmap`, homepage `https://dev.mvpgg.com`, authorization callback URL
   `https://dev.mvpgg.com/auth/callback`, no device flow. Generate a client secret. The app asks
   for no scope: it only reads the signed-in user and their permission on the repository.
2. **The image**, from the checkout the backend uses:
   ```sh
   cd /opt/mvp && git fetch --tags && git checkout <the release tag or branch with apps/roadmap>
   docker build -f apps/roadmap/Dockerfile -t mvp-roadmap .
   ```
3. **The env file**: `deploy/roadmap.env.example` → `/etc/mvp/roadmap.env` (`chmod 600`, root),
   with the client id and secret, `ROADMAP_PUBLIC_URL=https://dev.mvpgg.com`, and a session key
   from `docker run --rm mvp-roadmap key`.
4. **The service**: `deploy/mvp-roadmap.service` → `/etc/systemd/system/`, then
   `systemctl daemon-reload && systemctl enable --now mvp-roadmap`. `docker logs mvp-roadmap`
   should say "empty database: imported the seed" and "mvp-roadmap listening";
   `curl -s 127.0.0.1:8790/health` answers `{"ok":true,…}`.
5. **Caddy**: add `deploy/Caddyfile`'s block to `/etc/caddy/Caddyfile`,
   `caddy validate --config /etc/caddy/Caddyfile`, `systemctl reload caddy`. The origin
   certificate must cover `dev.mvpgg.com` (Cloudflare's default `*.mvpgg.com, mvpgg.com` does).
6. **Cloudflare DNS**: a proxied (orange cloud) `A` record `dev` → the server's address, like
   `api`. SSL/TLS stays Full (strict). Leave Bot Fight Mode off (it would challenge Claude's
   command line, as it would the app); a rate-limiting rule on `/auth/*` is optional (the service
   limits sign-ins itself: 10 per 10 minutes per address).
7. **Sign in** at https://dev.mvpgg.com with the account that administers `Filmoo/MVP`.
8. **Claude's token**: `docker exec -it mvp-roadmap mvp-roadmap token create --name claude`.
   It is shown once: put it in `.cache/roadmap-token` in the repository on the PC Claude works
   on (git-ignored), or in `MVP_ROADMAP_TOKEN`. `token list` shows when it was last used,
   `token revoke --name claude` ends it (then create a new one).
9. **Backups**: `deploy/mvp-roadmap-backup.{service,timer}` → `/etc/systemd/system/`, then
   `systemctl enable --now mvp-roadmap-backup.timer`: every night a consistent copy
   (`VACUUM INTO`) in the volume's `backups/`, the newest 14 kept. The service's second line
   copies them off the server with the crawler's rclone remote (R2) when it is set up; otherwise
   remove it and fetch one now and then
   (`docker cp mvp-roadmap:/data/backups ./roadmap-backups`). To restore: stop the service, copy a
   backup over `/data/roadmap.db` in the volume (`docker run --rm -v mvp-roadmap:/data -v
   $PWD:/in alpine cp /in/roadmap-….db /data/roadmap.db`, then `chown 65532:65532`), start it.

**Updating**: rebuild the image from the new checkout, `systemctl restart mvp-roadmap`. The
database stays in the volume; the seed is never imported again once a roadmap exists.

**If the owner is refused**: the 403 page says which permission GitHub reported; the log line
"sign-in refused: not an admin" too. Check the account is an admin of `Filmoo/MVP`
(Settings → Collaborators) and that it's the GitHub account the browser is signed in to.

## How it works

- **Sessions**: 32 random bytes in a `__Host-mvp_roadmap` cookie (`HttpOnly`, `Secure`,
  `SameSite=Strict`), kept in the database as HMAC-SHA-256 under a key derived from
  `ROADMAP_SESSION_KEY`; they end a week after sign-in or after two days unused. The user's
  GitHub token (no scope) is kept sealed (ChaCha20-Poly1305) to ask GitHub again every ten
  minutes; if GitHub doesn't answer, its last yes holds for an hour. The OAuth state is bound to
  the browser by a short `SameSite=Lax` cookie, with PKCE.
- **Changes** (`POST`, `PATCH`, `DELETE`) from a browser need the session's CSRF token in
  `X-CSRF-Token` (the page gets it from `/api/me`), and a foreign `Origin` is refused. Machine
  tokens (`Authorization: Bearer mvpr_…`) are stored as SHA-256; unknown ones are rate-limited.
- **Every change is in the audit log** (who, when, what, with the fields before and after),
  written in the same transaction as the change: the page's Activity panel and each feature's
  history show it. Sign-ins, refusals and tokens are logged too.
- **Order**: each feature has a position in its version; a move renumbers the versions it
  touches. Removing is a soft delete (undo restores it in place); the page's undo (Ctrl+Z and
  the toasts) replays the opposite change.
- **Every answer** carries `X-Robots-Tag: noindex`, a strict CSP (no inline script or style),
  `frame-ancestors 'none'`, `nosniff`; `/robots.txt` disallows everything.
- **Idle means idle**: no polling. The page reads the roadmap when it opens, after its own
  changes, and when the tab comes back after 30 s away.

API: `src/api.rs` has the table of routes; `GET /health` is public (for Docker and monitoring).
