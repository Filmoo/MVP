# The server

MVP's backend and crawler run on one small Linux server behind Cloudflare, at
`https://api.mvpgg.com`. It holds the only copy of the Riot API key. This page is how it is set
up, kept safe and updated. The files next to it are the server's configuration, identical to what
runs there. None of them holds a secret or the server's address, and neither may any change to them.

## What runs where

| Piece | Where |
| --- | --- |
| Host | An OVHcloud VPS (4 vCores, 8 GB), Ubuntu 24.04, admin user `ubuntu` |
| Code | `/opt/mvp`: a checkout of a release tag of `main`, never a branch |
| Backend | Docker container `mvp-backend` on `127.0.0.1:8787`, data in the `mvp-data` volume |
| Crawler | `mvp-crawl.timer`: crawl and publish every 3 hours (`apps/crawler/deploy/`), store in the `mvp-crawl` volume |
| HTTPS | Caddy ([`Caddyfile`](Caddyfile)) with a Cloudflare origin certificate (`/etc/caddy/origin.*`); Cloudflare's SSL mode is Full (strict) |
| Secrets | `/etc/mvp/backend.env` and `/etc/mvp/crawler.env`: the Riot API key, root only |

## How it is kept safe

- **Only Cloudflare reaches the web ports.** The firewall (`ufw`) opens 80 and 443 to Cloudflare's
  address ranges only ([`mvp-cloudflare-ufw.sh`](mvp-cloudflare-ufw.sh), rerun monthly). The
  server's own IP address is never published: keep every DNS record proxied (orange cloud).
- **SSH with keys only**: no passwords, no root login ([`sshd-hardening.conf`](sshd-hardening.conf)).
- **Updates install themselves**: Ubuntu's security updates and Docker, with a restart at 04:00 UTC
  when an update needs one ([`unattended-upgrades.conf`](unattended-upgrades.conf)). Every service
  comes back on its own after a restart.
- **Small attack surface**: the containers run as an unprivileged user in distroless images, the
  backend and Caddy's admin port only listen on the loopback, `/metrics` is off.
- **GitHub has no way in.** No deploy key, no server secret in Actions: the server pulls public
  code, and only tags of `main` ([`mvp-deploy.sh`](mvp-deploy.sh)).

## Deploy a release

After a release tag `vX.Y.Z` is pushed on `main`:

```sh
ssh mvp sudo mvp-deploy vX.Y.Z
```

It refuses a tag that isn't on `main` and builds both images before touching anything (a failed
build changes nothing). Then it swaps the backend, checks `/health`, and goes back to the
previous backend if the new one doesn't answer. The crawler uses its new image from its next run.

Installed apps ask this server for updates first, and its answer decides, so a new app version
only reaches players once it is offered here. The release workflow's summary prints the command:
run it with `sudo` in front, with a small `--rollout` first, then widen it with
`release promote` (or stop it with `release block`).

## Everyday tasks

- **Change the Riot key**, every day while it is a development key: `ssh mvp`, then
  `sudo mvp-set-riot-key` and paste the key once. Nothing shows; the key is checked with Riot
  before it is saved, and the backend restarts with it.
- **Logs**: `docker logs -f mvp-backend`, `journalctl -u mvp-crawl -f`, `journalctl -u caddy`.
- **Status**: `docker ps`, `systemctl list-timers mvp-crawl.timer`, and
  `https://api.mvpgg.com/health` from anywhere.

## Set up a server from scratch

On Ubuntu 24.04, as root (`sudo -i`), with the owner's SSH key installed:

1. `apt-get update && apt-get -y upgrade`, then `ufw allow OpenSSH && ufw --force enable`.
2. Docker from docker.com (`curl -fsSL https://get.docker.com | sh`).
3. `git clone https://github.com/Filmoo/MVP.git /opt/mvp`, then install the scripts, after
   reading them: `install -m 755 /opt/mvp/deploy/mvp-deploy.sh /usr/local/sbin/mvp-deploy`, the
   same for `mvp-set-riot-key.sh` and `mvp-cloudflare-ufw.sh`.
4. `mvp-cloudflare-ufw` and `ln -s /usr/local/sbin/mvp-cloudflare-ufw /etc/cron.monthly/`.
5. `sshd-hardening.conf` → `/etc/ssh/sshd_config.d/00-mvp-hardening.conf`, then `sshd -t` and
   `systemctl reload ssh`. Check that a new key login works before you close the session.
6. `unattended-upgrades.conf` → `/etc/apt/apt.conf.d/52mvp-unattended-upgrades`.
7. The crawler's units: `apps/crawler/deploy/mvp-crawl.{service,timer}` →
   `/etc/systemd/system/`, without the optional R2 upload at the end of the service, then
   `systemctl daemon-reload`.
8. `mvp-set-riot-key`, then `mvp-deploy vX.Y.Z` (the images and the backend), then
   `systemctl enable --now mvp-crawl.timer`.
9. Caddy: `apt-get install caddy`. Create an origin certificate in Cloudflare (SSL/TLS → Origin
   Server) and paste it into `/etc/caddy/origin.pem` and its key into `/etc/caddy/origin.key`
   (`chown caddy:caddy`, key mode 600). Then install the `Caddyfile` and `systemctl reload caddy`.
10. In Cloudflare: a proxied `A` record `api` to the server, SSL/TLS Full (strict), Always Use
    HTTPS, minimum TLS 1.2, a cache rule for `/v1/stats/`, and Bot Fight Mode off, since it would
    block the app.
