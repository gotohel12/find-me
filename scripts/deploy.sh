#!/usr/bin/env bash
# Deploys happen on push to main (Render auto-deploy from the Blueprint).
# This script runs the gates first, then pushes.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/test_all.sh
git push origin main
echo "Pushed. Render deploys findme-web, findme-api and findme-daily from render.yaml."
