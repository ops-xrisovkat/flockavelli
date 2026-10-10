#!/usr/bin/env bash
# Pull the latest code and redeploy. Run on the server.
# Auto-deploy: have a cron job run this every minute (see README) so that
# whenever new code is pushed to the repo, the server rebuilds itself.
set -euo pipefail
cd "$(dirname "$0")/.."

before=$(git rev-parse HEAD 2>/dev/null || echo none)
git fetch --quiet origin
git reset --hard --quiet origin/main
after=$(git rev-parse HEAD)

if [ "$before" != "$after" ]; then
  echo "[$(date -u +%FT%TZ)] new code $before -> $after, rebuilding"
  docker compose up -d --build
  docker image prune -f >/dev/null 2>&1 || true
else
  echo "[$(date -u +%FT%TZ)] up to date ($after)"
fi
