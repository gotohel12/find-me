#!/usr/bin/env python3
"""
Review sheets for the art checkpoint: one JPEG per scene view, plus a grid of
every hider pose × angle. Written to <out>/ (default build/review).

    python3 tools/contact_sheet.py --art build/art --out build/review
"""
import argparse
import glob
import json
import os

from PIL import Image, ImageDraw

CREDIT = "Developed by Mohsen ~ Danial · © 2026 MD Studio"


def scene_sheets(art: str, out: str) -> list[str]:
    made = []
    for p in sorted(glob.glob(os.path.join(art, "scenes", "*", "*", "beauty.png"))):
        orient = os.path.basename(os.path.dirname(p))
        sid = os.path.basename(os.path.dirname(os.path.dirname(p)))
        with Image.open(p) as im:
            img = im.convert("RGB")
        dst = os.path.join(out, f"{sid}_{orient}.jpg")
        img.save(dst, quality=88)
        made.append(dst)
    return made


def character_sheet(art: str, out: str) -> str | None:
    idx = os.path.join(art, "character", "index.json")
    if not os.path.isfile(idx):
        return None
    with open(idx) as f:
        index = json.load(f)
    poses, angles = index["poses"], index["angles"]
    cell = 220
    sheet = Image.new("RGB", (cell * len(angles) + 140, cell * len(poses) + 40), (232, 228, 240))
    d = ImageDraw.Draw(sheet)
    for j, a in enumerate(angles):
        d.text((140 + j * cell + 8, 10), a, fill=(40, 30, 80))
    for i, pose in enumerate(poses):
        d.text((8, 40 + i * cell + cell // 2), pose, fill=(40, 30, 80))
        for j, a in enumerate(angles):
            p = os.path.join(art, "character", pose, a, "shade.png")
            if not os.path.isfile(p):
                continue
            with Image.open(p) as im:
                sp = im.convert("RGBA").resize((cell, cell), Image.LANCZOS)
            sheet.paste(sp, (140 + j * cell, 40 + i * cell), sp)
    d.text((8, sheet.height - 16), CREDIT, fill=(90, 80, 120))
    dst = os.path.join(out, "character_sheet.jpg")
    sheet.save(dst, quality=88)
    return dst


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--art", default="build/art")
    ap.add_argument("--out", default="build/review")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    made = scene_sheets(a.art, a.out)
    c = character_sheet(a.art, a.out)
    for p in glob.glob(os.path.join(a.art, "3d", "maps", "*", "preview*.png")):
        with Image.open(p) as im:
            im.convert("RGB").save(os.path.join(a.out, f"map_{os.path.basename(os.path.dirname(p))}_{os.path.splitext(os.path.basename(p))[0]}.jpg"), quality=88)
    poses = sorted(glob.glob(os.path.join(a.art, "3d", "poses", "*.png")))
    if poses:
        cell = 200
        cols = 6
        rows = (len(poses) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * (cell + 18)), (232, 228, 240))
        d = ImageDraw.Draw(sheet)
        for i, p in enumerate(poses):
            with Image.open(p) as im:
                t = im.convert("RGBA").resize((cell, cell), Image.LANCZOS)
            x, y = (i % cols) * cell, (i // cols) * (cell + 18)
            sheet.paste(t, (x, y), t)
            d.text((x + 6, y + cell + 2), os.path.splitext(os.path.basename(p))[0], fill=(40, 30, 80))
        sheet.save(os.path.join(a.out, "hider3d_poses.jpg"), quality=88)
    icon = os.path.join(a.art, "ui", "app_icon.png")
    if os.path.isfile(icon):
        with Image.open(icon) as im:
            im.convert("RGB").save(os.path.join(a.out, "app_icon.jpg"), quality=90)
    print("review sheets:", len(made) + (1 if c else 0))


if __name__ == "__main__":
    main()
