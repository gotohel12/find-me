#!/usr/bin/env python3
"""
ONE command builds the whole art library.

    python3 blender/build_all.py                 # everything, full quality
    python3 blender/build_all.py --preview       # quick low-res pass (CI on every PR)
    python3 blender/build_all.py --only s001     # just matching jobs
    python3 blender/build_all.py --verify        # check every shipped asset has a generator

Runs each generator in its own headless Blender process (clean state, and a
crash in one scene can't poison another), then packs everything into
web/public/assets with tools/scene_pack.py.

Blender is found from $BLENDER, then PATH. Pinned version: 4.2 LTS.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import glob
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def find_blender() -> str:
    b = os.environ.get("BLENDER") or shutil.which("blender")
    if not b:
        sys.exit("Blender not found. Install Blender 4.2 LTS and put it on PATH, or set BLENDER=/path/to/blender")
    return b


def jobs() -> list[tuple[str, str]]:
    out = [("character", os.path.join(HERE, "character", "hider.py"))]
    for p in sorted(glob.glob(os.path.join(HERE, "scenes", "s[0-9][0-9][0-9]_*.py"))):
        out.append((os.path.splitext(os.path.basename(p))[0], p))
    for p in sorted(glob.glob(os.path.join(HERE, "ui", "*.py"))):
        out.append((f"ui_{os.path.splitext(os.path.basename(p))[0]}", p))
    return out


def run_job(blender: str, name: str, script: str, out: str, extra: list[str]) -> tuple[str, float, int, str]:
    t0 = time.time()
    cmd = [blender, "-b", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", "--out", out, *extra]
    p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    log = p.stdout[-4000:] + p.stderr[-4000:]
    return name, time.time() - t0, p.returncode, log


def verify() -> int:
    """Every shipped scene/character asset must have a generator script."""
    assets = os.path.join(REPO, "web", "public", "assets")
    manifest = os.path.join(assets, "manifest.json")
    if not os.path.isfile(manifest):
        print("no manifest yet: nothing shipped")
        return 0
    with open(manifest, encoding="utf-8") as f:
        m = json.load(f)
    scripts = {n for n, _ in jobs()}
    bad = [sid for sid in m.get("scenes", {}) if sid not in scripts]
    if m.get("character") and "character" not in scripts:
        bad.append("character")
    for sid in bad:
        print(f"BUG: asset '{sid}' has no generator script in blender/")
    print("verify:", "FAILED" if bad else "ok")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "build", "art"))
    ap.add_argument("--assets", default=os.path.join(REPO, "web", "public", "assets"))
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--master", action="store_true", help="also render 8K marketing masters")
    ap.add_argument("--only", default="", help="comma list of substrings to select jobs")
    ap.add_argument("-j", "--jobs", type=int, default=1, help="parallel Blender processes (GPU: keep 1)")
    ap.add_argument("--no-pack", action="store_true")
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.verify:
        return verify()

    blender = find_blender()
    todo = jobs()
    if a.only:
        keys = a.only.split(",")
        todo = [j for j in todo if any(k in j[0] for k in keys)]
    extra = (["--preview"] if a.preview else []) + (["--master"] if a.master else [])
    print(f"building {len(todo)} job(s) with {blender}")
    failed = []
    with cf.ThreadPoolExecutor(max_workers=max(1, a.jobs)) as ex:
        futs = [ex.submit(run_job, blender, n, s, a.out, extra) for n, s in todo]
        for f in cf.as_completed(futs):
            name, secs, code, log = f.result()
            print(f"  {'ok ' if code == 0 else 'ERR'} {name:<28} {secs:6.1f}s")
            if code != 0:
                failed.append(name)
                print(log)
    if failed:
        print("FAILED:", ", ".join(failed))
        return 1
    if not a.no_pack:
        sys.path.insert(0, os.path.join(REPO, "tools"))
        import scene_pack

        scene_pack.main(["--art", a.out, "--out", a.assets])
    return 0


if __name__ == "__main__":
    sys.exit(main())
