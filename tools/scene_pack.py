#!/usr/bin/env python3
"""
Pack Blender render outputs into web assets.

    python3 tools/scene_pack.py --art build/art --out web/public/assets

Input (written by blender/lib/fm.py and blender/character/hider.py):
    build/art/scenes/<id>/<orient>/{beauty.png, depth.npy, normal.npy, index.npy, meta.json}
    build/art/character/<pose>/<angle>/{shade.png, uv.npy, part.npy, normal.npy, ao.npy, alpha.npy, meta.json}

Output:
    assets/scenes/<id>/<orient>/
        beauty.avif, beauty.webp   full resolution, each under the size budget
        thumb.webp                 480 px on the long side
        data.png                   half-res, lossless. R,G = depth (16-bit, near..far),
                                   B = 255 where hiding is forbidden, A = 255
        normal.webp                half-res camera-space normals
        meta.json
    assets/character/<pose>/<angle>/
        uvp.png    R = U, G = V (paint texture coords), B = part id × 40, A = coverage
        nao.png    RGB = camera-space normal, A = ambient occlusion
        shade.webp studio render for menus
        meta.json  anchor point, pixels-per-metre, bbox
    assets/manifest.json

Only needs numpy + Pillow.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image, features

BUDGET_BYTES = 600 * 1024
FORBIDDEN_ROLES = {0, 2}
CREDIT = "Mohsen ~ Danial"


# ----------------------------------------------------------------- image encoding
def encode_under_budget(img: Image.Image, fmt: str, budget: int = BUDGET_BYTES, q_hi: int = 90, q_lo: int = 35) -> bytes:
    """Highest quality (binary search) that fits the byte budget."""
    def enc(q: int) -> bytes:
        buf = io.BytesIO()
        kw = {"quality": q}
        if fmt == "WEBP":
            kw["method"] = 6
        if fmt == "AVIF":
            kw["speed"] = 6
        img.save(buf, fmt, **kw)
        return buf.getvalue()

    best = enc(q_lo)
    if len(best) > budget:
        return best  # caller decides (it will downscale)
    lo, hi = q_lo, q_hi
    while lo <= hi:
        mid = (lo + hi) // 2
        data = enc(mid)
        if len(data) <= budget:
            best, lo = data, mid + 1
        else:
            hi = mid - 1
    return best


def fit_budget(img: Image.Image, fmt: str, budget: int = BUDGET_BYTES) -> tuple[bytes, tuple[int, int]]:
    cur = img
    for _ in range(6):
        data = encode_under_budget(cur, fmt, budget)
        if len(data) <= budget:
            return data, cur.size
        cur = cur.resize((int(cur.width * 0.85), int(cur.height * 0.85)), Image.LANCZOS)
    raise RuntimeError(f"cannot fit {fmt} under {budget} bytes")


def has_avif() -> bool:
    try:
        return bool(features.check("avif"))
    except Exception:
        return False


def _write(path: str, data: bytes) -> None:
    with open(path, "wb") as f:
        f.write(data)


# ----------------------------------------------------------------- scene data
def downsample2(a: np.ndarray, how: str = "mean") -> np.ndarray:
    h, w = a.shape[:2]
    a = a[: h - h % 2, : w - w % 2]
    blocks = a.reshape(h // 2, 2, w // 2, 2, *a.shape[2:])
    if how == "min":
        return blocks.min(axis=(1, 3))
    if how == "max":
        return blocks.max(axis=(1, 3))
    return blocks.mean(axis=(1, 3))


def encode_depth(depth: np.ndarray, forbidden: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Depth -> RG 16-bit. Near/far from the finite surface pixels."""
    d = depth.astype(np.float64)
    valid = np.isfinite(d) & (d > 0) & (d < 1e4) & ~forbidden
    if not valid.any():
        valid = np.isfinite(d) & (d > 0) & (d < 1e4)
    near = float(np.percentile(d[valid], 0.1)) * 0.98
    far = float(np.percentile(d[valid], 99.9)) * 1.02
    norm = np.clip((np.where(np.isfinite(d), d, far) - near) / (far - near), 0, 1)
    q = np.rint(norm * 65535).astype(np.uint16)
    rgba = np.zeros((*d.shape, 4), dtype=np.uint8)
    rgba[..., 0] = q >> 8
    rgba[..., 1] = q & 0xFF
    rgba[..., 2] = np.where(forbidden, 255, 0)
    rgba[..., 3] = 255
    return rgba, near, far


def decode_depth(rgba: np.ndarray, near: float, far: float) -> np.ndarray:
    q = (rgba[..., 0].astype(np.uint32) << 8) | rgba[..., 1]
    return near + (q / 65535.0) * (far - near)


def pack_scene(src: str, dst: str) -> dict:
    with open(os.path.join(src, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    os.makedirs(dst, exist_ok=True)
    beauty = Image.open(os.path.join(src, "beauty.png")).convert("RGB")

    files = {}
    webp, size = fit_budget(beauty, "WEBP")
    _write(os.path.join(dst, "beauty.webp"), webp)
    files["webp"] = {"file": "beauty.webp", "bytes": len(webp), "width": size[0], "height": size[1]}
    if has_avif():
        avif, size = fit_budget(beauty, "AVIF")
        _write(os.path.join(dst, "beauty.avif"), avif)
        files["avif"] = {"file": "beauty.avif", "bytes": len(avif), "width": size[0], "height": size[1]}
    thumb = beauty.copy()
    thumb.thumbnail((480, 480), Image.LANCZOS)
    thumb.save(os.path.join(dst, "thumb.webp"), "WEBP", quality=80, method=6)

    depth = np.load(os.path.join(src, "depth.npy"))
    index = np.load(os.path.join(src, "index.npy"))
    normal = np.load(os.path.join(src, "normal.npy")).astype(np.float32)
    forbidden = np.isin(index, list(FORBIDDEN_ROLES))
    # Half resolution: nearest depth wins (safer occlusion), any forbidden pixel forbids the block.
    d2 = downsample2(np.where(np.isfinite(depth), depth, 1e9), "min")
    f2 = downsample2(forbidden.astype(np.uint8), "max").astype(bool)
    rgba, near, far = encode_depth(d2, f2)
    Image.fromarray(rgba, "RGBA").save(os.path.join(dst, "data.png"), optimize=True)

    n2 = downsample2(normal)
    n2 /= np.maximum(np.linalg.norm(n2, axis=-1, keepdims=True), 1e-6)
    Image.fromarray(np.rint((n2 * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8), "RGB").save(
        os.path.join(dst, "normal.webp"), "WEBP", quality=85, method=6)

    out_meta = {
        **meta,
        "images": files,
        "thumb": "thumb.webp",
        "data": {"file": "data.png", "scale": 0.5, "near": near, "far": far,
                 "encoding": "R,G = depth 16-bit big-endian over near..far; B = 255 forbidden"},
        "normal": {"file": "normal.webp", "scale": 0.5},
        "forbiddenFrac": float(forbidden.mean()),
        "credit": CREDIT,
    }
    with open(os.path.join(dst, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(out_meta, f, indent=2, ensure_ascii=False)
    return out_meta


# ----------------------------------------------------------------- character
def pack_sprite(src: str, dst: str) -> dict:
    with open(os.path.join(src, "meta.json")) as f:
        meta = json.load(f)
    os.makedirs(dst, exist_ok=True)
    uv = np.load(os.path.join(src, "uv.npy")).astype(np.float32)
    part = np.load(os.path.join(src, "part.npy"))
    normal = np.load(os.path.join(src, "normal.npy")).astype(np.float32)
    ao = np.load(os.path.join(src, "ao.npy")).astype(np.float32)
    alpha = np.load(os.path.join(src, "alpha.npy")).astype(np.float32)

    cov = (alpha > 0.5) & (part > 0)
    # 2x supersampled -> anti-aliased coverage; data from a covered sample (never blended across parts)
    a2 = downsample2(cov.astype(np.float32))
    h, w = a2.shape
    pick_uv = np.zeros((h, w, 2), np.float32)
    pick_part = np.zeros((h, w), np.uint8)
    taken = np.zeros((h, w), bool)
    for dy in (0, 1):
        for dx in (0, 1):
            c = cov[dy::2, dx::2][:h, :w]
            new = c & ~taken
            pick_uv[new] = uv[dy::2, dx::2][:h, :w][new]
            pick_part[new] = part[dy::2, dx::2][:h, :w][new]
            taken |= c
    wsum = np.maximum(a2, 1e-6)[..., None]
    n2 = downsample2(normal * cov[..., None]) / wsum
    n2 /= np.maximum(np.linalg.norm(n2, axis=-1, keepdims=True), 1e-6)
    ao2 = downsample2(ao * cov) / wsum[..., 0]

    uvp = np.zeros((h, w, 4), np.uint8)
    uvp[..., 0] = np.rint(pick_uv[..., 0].clip(0, 1) * 255)
    uvp[..., 1] = np.rint(pick_uv[..., 1].clip(0, 1) * 255)
    uvp[..., 2] = pick_part * 40
    uvp[..., 3] = np.rint(a2 * 255)
    Image.fromarray(uvp, "RGBA").save(os.path.join(dst, "uvp.png"), optimize=True)

    nao = np.zeros((h, w, 4), np.uint8)
    nao[..., :3] = np.rint((n2 * 0.5 + 0.5).clip(0, 1) * 255)
    nao[..., 3] = np.rint(np.where(a2 > 0, ao2, 0).clip(0, 1) * 255)
    Image.fromarray(nao, "RGBA").save(os.path.join(dst, "nao.png"), optimize=True)

    shade = Image.open(os.path.join(src, "shade.png")).convert("RGBA")
    shade = shade.resize((w, h), Image.LANCZOS)
    shade.save(os.path.join(dst, "shade.webp"), "WEBP", quality=85, method=6)

    anchor, bbox = find_anchor(a2 > 0.5)
    out = {**meta, "size": w, "pixelsPerMetre": meta["pixelsPerMetre"] / 2, "anchor": anchor, "bbox": bbox,
           "files": {"uvp": "uvp.png", "nao": "nao.png", "shade": "shade.webp"}}
    with open(os.path.join(dst, "meta.json"), "w") as f:
        json.dump(out, f, indent=2)
    return out


def find_anchor(mask: np.ndarray) -> tuple[list[float], list[int]]:
    """Contact point = centre of the lowest covered rows; bbox = [x0, y0, x1, y1]."""
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        raise ValueError("empty sprite")
    y1 = int(ys.max())
    band = ys >= y1 - 2
    ax = float(xs[band].mean())
    return [round(ax, 2), float(y1 + 1)], [int(xs.min()), int(ys.min()), int(xs.max()) + 1, y1 + 1]


# ----------------------------------------------------------------- icons
ICON_SIZES = {"favicon-32.png": 32, "icon-180.png": 180, "icon-192.png": 192, "icon-512.png": 512}


def pack_icons(art: str, icons_out: str) -> list[str]:
    """build/art/ui/app_icon.png -> favicon, Apple touch, PWA and maskable icons."""
    src = os.path.join(art, "ui", "app_icon.png")
    if not os.path.isfile(src):
        return []
    os.makedirs(icons_out, exist_ok=True)
    with Image.open(src) as im:
        base = im.convert("RGB")
    made = []
    for name, size in ICON_SIZES.items():
        base.resize((size, size), Image.LANCZOS).save(os.path.join(icons_out, name), optimize=True)
        made.append(name)
    # The render is full-bleed with the figure inside the safe circle, so it is maskable as-is.
    base.resize((512, 512), Image.LANCZOS).save(os.path.join(icons_out, "icon-maskable-512.png"), optimize=True)
    made.append("icon-maskable-512.png")
    return made


# ----------------------------------------------------------------- driver
def pack_all(art: str, out: str, icons_out: str | None = None) -> dict:
    manifest = {"credit": CREDIT, "scenes": {}, "character": None}
    sroot = os.path.join(art, "scenes")
    for sid in sorted(os.listdir(sroot)) if os.path.isdir(sroot) else []:
        manifest["scenes"][sid] = {}
        for orient in ("landscape", "portrait"):
            src = os.path.join(sroot, sid, orient)
            if os.path.isfile(os.path.join(src, "meta.json")):
                m = pack_scene(src, os.path.join(out, "scenes", sid, orient))
                manifest["scenes"][sid][orient] = {"title": m["title"], "bytes": m["images"]["webp"]["bytes"]}
        # 8K masters stay in build/art for marketing; they are never shipped to players.
    croot = os.path.join(art, "character")
    if os.path.isfile(os.path.join(croot, "index.json")):
        with open(os.path.join(croot, "index.json")) as f:
            index = json.load(f)
        sprites = {}
        for pose in index["poses"]:
            for angle in index["angles"]:
                src = os.path.join(croot, pose, angle)
                if os.path.isfile(os.path.join(src, "meta.json")):
                    m = pack_sprite(src, os.path.join(out, "character", pose, angle))
                    sprites[f"{pose}/{angle}"] = {"anchor": m["anchor"], "bbox": m["bbox"], "ppm": m["pixelsPerMetre"]}
        manifest["character"] = {**index, "sprites": sprites}
    manifest["icons"] = pack_icons(art, icons_out or os.path.join(os.path.dirname(os.path.abspath(out)), "icons"))
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    return manifest


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--art", default="build/art")
    ap.add_argument("--out", default="web/public/assets")
    ap.add_argument("--icons", default=None, help="default: <out>/../icons")
    ap.add_argument("--clean", action="store_true")
    a = ap.parse_args(argv)
    if a.clean and os.path.isdir(a.out):
        shutil.rmtree(a.out)
    m = pack_all(a.art, a.out, a.icons)
    n_s = sum(len(v) for v in m["scenes"].values())
    n_c = len(m["character"]["sprites"]) if m["character"] else 0
    print(f"packed {n_s} scene views, {n_c} character sprites, {len(m['icons'])} icons -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
