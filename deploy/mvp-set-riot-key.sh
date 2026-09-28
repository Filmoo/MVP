#!/bin/bash
# Sets the Riot API key on the server: `sudo mvp-set-riot-key`, then paste the key (hidden).
# It checks that the paste is exactly one key and that Riot accepts it before saving anything,
# writes it for the backend and the crawler (root only), and restarts the backend with it. The key
# never shows on screen, in the shell history or in the repository. Installed by hand as
# /usr/local/sbin/mvp-set-riot-key (deploy/README.md).
set -euo pipefail

read -rsp "Riot API key (hidden): " key
echo
key=$(printf '%s' "$key" | tr -d '[:space:]')
if ! printf '%s' "$key" | grep -Eqx 'RGAPI-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'; then
  echo "That isn't exactly one Riot key (RGAPI- and 36 more characters). Nothing changed." >&2
  exit 1
fi
status=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Riot-Token: $key" https://euw1.api.riotgames.com/lol/status/v4/platform-data)
if [ "$status" != 200 ]; then
  echo "Riot refused this key (HTTP $status). Nothing changed." >&2
  exit 1
fi

install -d -m 700 /etc/mvp
umask 077
matches=$(sed -n 's/^CRAWL_MAX_MATCHES=//p' /etc/mvp/crawler.env 2>/dev/null || true)
printf 'RIOT_API_KEY=%s\nCRAWL_MAX_MATCHES=%s\n' "$key" "${matches:-2000}" >/etc/mvp/crawler.env
printf 'RIOT_API_KEY=%s\n' "$key" >/etc/mvp/backend.env
unset key

# A container reads its env file when it is created: make it again, from the same image.
image=$(docker inspect --format '{{.Config.Image}}' mvp-backend 2>/dev/null || echo mvp-backend)
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "Key saved and working. No backend yet: \`mvp-deploy vX.Y.Z\` starts it."
  exit 0
fi
docker stop mvp-backend >/dev/null 2>&1 || true
docker rm mvp-backend >/dev/null 2>&1 || true
docker run -d --name mvp-backend --restart unless-stopped -p 127.0.0.1:8787:8787 \
  -v mvp-data:/data -e STATS_DIR=/data/stats --env-file /etc/mvp/backend.env "$image" >/dev/null
curl -fsS --retry 20 --retry-connrefused --retry-delay 1 http://127.0.0.1:8787/health >/dev/null
echo "Key saved and working: the backend restarted with it, the crawler uses it from its next run."
