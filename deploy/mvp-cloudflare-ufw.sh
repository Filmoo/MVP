#!/bin/sh
# MVP server: allow ports 80/443 only from Cloudflare's published ranges. Safe to rerun.
# /usr/local/sbin/mvp-cloudflare-ufw, linked from /etc/cron.monthly/ so new ranges are added.
set -e
v4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)
v6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)
[ -n "$v4" ] && [ -n "$v6" ] || { echo "could not fetch Cloudflare ranges" >&2; exit 1; }
for ip in $v4 $v6; do ufw allow proto tcp from "$ip" to any port 80,443 comment cloudflare >/dev/null; done
ufw delete allow 80,443/tcp >/dev/null 2>&1 || true
