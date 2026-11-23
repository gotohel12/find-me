#!/usr/bin/env python3
"""Dump a compact Poly Haven catalogue (id, categories, tags) for picking scene assets."""
import json
import sys
import urllib.request

UA = "FIND-ME-game-art-pipeline/1.0 (Mohsen ~ Danial; MD Studio)"
out = sys.argv[1] if len(sys.argv) > 1 else "catalog.txt"
with open(out, "w", encoding="utf-8") as f:
    for kind in ("models", "textures", "hdris"):
        req = urllib.request.Request(f"https://api.polyhaven.com/assets?t={kind}", headers={"User-Agent": UA})
        data = json.loads(urllib.request.urlopen(req, timeout=60).read())
        f.write(f"### {kind} ({len(data)})\n")
        for aid in sorted(data):
            i = data[aid]
            f.write(f"{aid} | {','.join(i.get('categories', []))} | {','.join(i.get('tags', [])[:8])}\n")
print("catalog written:", out)
