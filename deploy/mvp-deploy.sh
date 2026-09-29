#!/bin/sh
# Deploys a release of MVP on the server: `sudo mvp-deploy v0.2.1`.
# Only a `v*` tag that GitHub has and that points at a commit of `main` is deployed: the server
# never runs a branch, so it only runs reviewed code. Installed by hand, after reading it, as
# /usr/local/sbin/mvp-deploy (deploy/README.md); the copy in a checkout is never run from there.
set -eu

tag="${1:-}"
case "$tag" in
  v[0-9]*) ;;
  *) echo "usage: mvp-deploy vX.Y.Z (a release tag of main)" >&2; exit 64 ;;
esac

cd /opt/mvp
git fetch --quiet --prune --prune-tags --tags origin main
commit=$(git rev-parse --verify --quiet "refs/tags/$tag^{commit}") || { echo "GitHub has no tag $tag" >&2; exit 1; }
git merge-base --is-ancestor "$commit" origin/main || { echo "$tag is not on main: not deploying it" >&2; exit 1; }
git -c advice.detachedHead=false checkout --quiet --force "$tag"

# Both images first: a failed build leaves the server as it was.
docker build --quiet --pull -f apps/backend/Dockerfile -t mvp-backend:next . >/dev/null
docker build --quiet --pull -f apps/crawler/Dockerfile -t mvp-crawler:next . >/dev/null

start() {
  docker run -d --name mvp-backend --restart unless-stopped -p 127.0.0.1:8787:8787 \
    -v mvp-data:/data -e STATS_DIR=/data/stats --env-file /etc/mvp/backend.env "$1" >/dev/null
}
stop() {
  # `docker stop` gives the backend time to save its Riot cache snapshot (`rm -f` would not).
  docker stop mvp-backend >/dev/null 2>&1 || true
  docker rm mvp-backend >/dev/null 2>&1 || true
}

previous=$(docker inspect --format '{{.Image}}' mvp-backend 2>/dev/null || true)
stop
start mvp-backend:next
if curl -fsS --retry 20 --retry-connrefused --retry-delay 1 http://127.0.0.1:8787/health >/dev/null; then
  docker tag mvp-backend:next mvp-backend:latest
  docker tag mvp-crawler:next mvp-crawler:latest # the crawl timer's next run uses it
  docker image prune --force >/dev/null
  echo "Deployed $tag: $(git log --oneline -1)"
else
  echo "The new backend doesn't answer /health: back to the previous one." >&2
  stop
  if [ -n "$previous" ]; then start "$previous"; fi
  exit 1
fi
