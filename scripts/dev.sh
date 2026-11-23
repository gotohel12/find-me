#!/usr/bin/env bash
# One command local run: Postgres + Redis (Docker), API on :8787, web on :5173.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v pnpm >/dev/null || { echo "Install pnpm: corepack enable"; exit 1; }
command -v docker >/dev/null || { echo "Docker is needed for local Postgres/Redis"; exit 1; }

docker start findme-pg >/dev/null 2>&1 || docker run -d --name findme-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=findme -p 5432:5432 postgres:16 >/dev/null
docker start findme-redis >/dev/null 2>&1 || docker run -d --name findme-redis -p 6379:6379 redis:7 >/dev/null
until docker exec findme-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done

export DATABASE_URL=postgres://postgres@localhost:5432/findme REDIS_URL=redis://localhost:6379
export WEB_ORIGIN=http://localhost:5173 ASSET_BASE=http://localhost:5173/assets
pnpm install
pnpm --filter @findme/api daily        # migrate + publish this week's scenes
[ -f web/public/assets/manifest.json ] || echo "⚠ No art yet: run 'pnpm art:preview' (needs Blender 4.2) or download the art workflow's web-assets artifact."

trap 'kill 0' EXIT
pnpm --filter @findme/api dev &
pnpm --filter @findme/web dev &
wait
