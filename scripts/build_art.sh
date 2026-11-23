#!/usr/bin/env bash
# Render the full art library with Blender 4.2 LTS and pack it into web/public/assets.
#   scripts/build_art.sh            full quality
#   scripts/build_art.sh --preview  quick check
set -euo pipefail
cd "$(dirname "$0")/.."
python3 blender/build_all.py "$@"
python3 blender/build_all.py --verify
