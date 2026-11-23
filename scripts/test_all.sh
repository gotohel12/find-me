#!/usr/bin/env bash
# Every test that runs without Blender. API tests need Postgres + Redis (DATABASE_URL / REDIS_URL).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== shared rules";  (cd shared && node --test test/*.test.ts)
echo "== web unit";      (cd web && node --test test/*.test.ts)
echo "== asset packer";  python3 -m unittest discover -s tools/tests
echo "== blender syntax"; python3 -m py_compile blender/lib/*.py blender/character/*.py blender/scenes/*.py blender/ui/*.py blender/build_all.py
echo "== art verify";    python3 blender/build_all.py --verify
if [ -d node_modules ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "== api";         npm run typecheck -w @findme/api && npm run test -w @findme/api
  echo "== web build";   npm run build -w @findme/web
else
  echo "(skipping api + web build: run 'npm install' and set DATABASE_URL/REDIS_URL)"
fi
echo "ALL GREEN"
