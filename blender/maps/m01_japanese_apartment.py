"""
Map 01 — Japanese Apartment / شقة يابانية. A walkable, real-scale 1R apartment in Tokyo.

Hand-authored layout, not random: every object has a reason to be where it is.

  y=6.5  ┌──────────── back wall: two real windows (frames, glass, sill), daylight comes in ─┐
         │ [futon + plushies]  window A   [tansu]     │ desk   window B             fridge   │
         │ [oshiire closet]                           │                       kitchen counter │
         │ TATAMI (16 mats)  chabudai + 4 zabuton     │ WOOD   rug  ottoman       upper cabs  │
         │ [shelves full of things]                   │                                       │
  y=0    └──── front wall: posters ──── side table, cabinet ───── genkan door ───────────────┘
        x=-4                                        x=0                                      x=4

Real sizes: ceiling 2.4 m, chabudai 0.33 m high, fridge 1.72 m, counter 0.87 m, door 2.02 m.
Poly Haven (CC0) photoscans for the hero props and clutter; hand-modelled architecture, kitchen,
fridge, futon, closet, cushions and plushies. Real window light (sun through the glass) + HDRI.

    blender -b --factory-startup --python blender/maps/m01_japanese_apartment.py -- --out build/art [--preview]

Output: build/art/3d/maps/m01_japanese_apartment/{map.glb, map.json, preview.png, preview2.png, credits.json}
Developed by Mohsen ~ Danial. © 2026 MD Studio.
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import bpy  # type: ignore
import numpy as np  # type: ignore

import assets  # noqa: E402
import fm  # noqa: E402
import room  # noqa: E402

MAP_ID = "m01_japanese_apartment"
SEED = 2101
W, D, H = 8.0, 6.5, 2.4
X0, X1 = -W / 2, W / 2
TATAMI_X1 = -0.12  # tatami room spans x X0..TATAMI_X1, wood floor beyond

THEME = room.Theme(scene_id=MAP_ID, title_en="Japanese Apartment", title_ar="شقة يابانية", theme="japanese_apartment",
                   seed=SEED, room=(W, D, H), max_per_template=3)

HAND: list = []  # hand-built meshes that get world-scale UVs
LIGHTS: list = []  # runtime point lights for the game (Blender coords)


def tex_or(ids, scale, fallback, name):
    have = assets.catalog("textures")
    for i in ids:
        if i in have:
            try:
                return assets.pbr_material(i, scale=scale, name=name)
            except Exception as e:  # noqa: BLE001
                print(f"[m01] texture {i} failed: {e}")
    return fm.mat_solid(name, fallback[0], fallback[1])


def B(name, size, loc, mat, bevel=0.0, rot=(0, 0, 0), uv=True):
    o = fm.box(name, size, loc, mat, bevel, rot)
    if uv:
        HAND.append(o)
    return o


def C(name, r, depth, loc, mat, rot=(0, 0, 0), verts=32, bevel=0.0):
    o = fm.cylinder(name, r, depth, loc, mat, rot, verts, bevel=bevel)
    HAND.append(o)
    return o


# ------------------------------------------------------------------ procedural images (original art)
def img_rug(n=512):
    y, x = np.mgrid[0:n, 0:n] / n
    base = np.zeros((n, n, 3)) + np.array([0.16, 0.22, 0.38])
    edge = np.minimum.reduce([x, y, 1 - x, 1 - y])
    border = edge < 0.08
    inner = (edge < 0.1) & ~border
    base[border] = [0.86, 0.80, 0.68]
    base[inner] = [0.70, 0.30, 0.22]
    cx = (x * 8) % 1 - 0.5
    cy = (y * 8) % 1
    r = np.hypot(cx, cy)
    rings = (np.sin(r * 40) > 0.6) & (r < 0.5) & (edge >= 0.1)
    base[rings] = base[rings] * 0.6 + np.array([0.86, 0.80, 0.68]) * 0.4
    return np.clip(base + np.random.default_rng(3).normal(0, 0.025, (n, n, 1)), 0, 1)


def img_duvet(n=512):
    y, x = np.mgrid[0:n, 0:n] / n
    base = np.zeros((n, n, 3)) + np.array([0.95, 0.91, 0.84])
    cx, cy = (x * 10) % 1 - 0.5, (y * 10) % 1 - 0.5
    base[np.hypot(cx, cy) < 0.16] = [0.93, 0.55, 0.62]
    base[(y * 10) % 2 < 0.12] = [0.55, 0.70, 0.86]
    return np.clip(base + np.random.default_rng(4).normal(0, 0.015, (n, n, 1)), 0, 1)


def img_poster(kind, w=360, h=512):
    y, x = np.mgrid[0:h, 0:w]
    u, v = x / w, y / h
    img = np.zeros((h, w, 3))
    if kind == 0:  # sunset over hills
        img[:] = np.array([0.98, 0.62, 0.38]) * (1 - v[..., None]) + np.array([0.48, 0.22, 0.52]) * v[..., None]
        img[np.hypot(u - 0.5, v - 0.42) < 0.17] = [1.0, 0.88, 0.55]
        img[v > 0.62 + 0.06 * np.sin(u * 9)] = [0.18, 0.15, 0.32]
        img[v > 0.72 + 0.05 * np.sin(u * 13 + 1)] = [0.10, 0.09, 0.2]
    elif kind == 1:  # waves
        img[:] = [0.93, 0.89, 0.80]
        for k in range(7):
            band = np.abs(v - (0.2 + k * 0.1) - 0.03 * np.sin(u * 14 + k)) < 0.022
            img[band] = [0.12, 0.28, 0.55] if k % 2 else [0.35, 0.62, 0.78]
    elif kind == 2:  # retro rings
        img[:] = [0.12, 0.12, 0.16]
        r = np.hypot(u - 0.5, v - 0.45)
        for k, c in enumerate([(1.0, 0.36, 0.54), (1.0, 0.79, 0.24), (0.18, 0.83, 0.72), (0.98, 0.95, 0.9)]):
            img[np.abs(r - (0.34 - k * 0.075)) < 0.03] = c
    else:  # a sleeping cat on a cushion (original silhouette)
        img[:] = [0.98, 0.86, 0.72]
        img[(np.abs(u - 0.5) < 0.32) & (np.abs(v - 0.74) < 0.07)] = [0.80, 0.30, 0.30]
        body = np.hypot((u - 0.5) / 0.22, (v - 0.6) / 0.14) < 1
        head = np.hypot(u - 0.36, v - 0.46) < 0.1
        ear1 = (v < 0.4) & (v > 0.33) & (np.abs(u - 0.31) < (v - 0.33) * 0.6)
        ear2 = (v < 0.4) & (v > 0.33) & (np.abs(u - 0.42) < (v - 0.33) * 0.6)
        img[body | head | ear1 | ear2] = [0.2, 0.18, 0.2]
    img[(u < 0.035) | (u > 0.965) | (v < 0.025) | (v > 0.975)] = [0.97, 0.96, 0.93]
    return np.clip(img + np.random.default_rng(kind).normal(0, 0.012, (h, w, 1)), 0, 1)


def img_fusuma(n=256):
    y, x = np.mgrid[0:n, 0:n] / n
    base = np.zeros((n, n, 3)) + np.array([0.90, 0.86, 0.76])
    base[np.sin(x * 9 + np.sin(y * 7) * 2) * np.sin(y * 5) > 0.75] = [0.82, 0.74, 0.56]
    return np.clip(base + np.random.default_rng(5).normal(0, 0.02, (n, n, 1)), 0, 1)


# ------------------------------------------------------------------ architecture
def wall_x(name, y, x0, x1, holes, mat, t=0.12):
    """Wall along x at depth y with rectangular openings [(a0, a1, z0, z1)]."""
    cur = x0
    for a0, a1, z0, z1 in sorted(holes):
        if a0 > cur:
            B(f"{name}_s", (a0 - cur, t, H), ((cur + a0) / 2, y, H / 2), mat)
        if z0 > 0:
            B(f"{name}_below", (a1 - a0, t, z0), ((a0 + a1) / 2, y, z0 / 2), mat)
        B(f"{name}_above", (a1 - a0, t, H - z1), ((a0 + a1) / 2, y, (H + z1) / 2), mat)
        cur = a1
    if cur < x1:
        B(f"{name}_s", (x1 - cur, t, H), ((cur + x1) / 2, y, H / 2), mat)


def window(name, x0, x1, z0, z1, y, m):
    w, h = x1 - x0, z1 - z0
    cx = (x0 + x1) / 2
    f = 0.045
    for sx in (x0 + f / 2, x1 - f / 2, cx):
        B(f"{name}_mullion", (f, 0.07, h), (sx, y, z0 + h / 2), m["alu"], 0.004)
    for z in (z0 + f / 2, z1 - f / 2):
        B(f"{name}_rail", (w, 0.07, f), (cx, y, z), m["alu"], 0.004)
    for k, (a, b) in enumerate(((x0, cx), (cx, x1))):
        g = B(f"{name}_glass{k}", (b - a - f, 0.008, h - f), ((a + b) / 2, y + (0.012 if k else -0.012), z0 + h / 2), m["glass"],
              uv=False)
        g.visible_shadow = False  # sunlight passes the glass in Cycles
    B(f"{name}_sill", (w + 0.12, 0.2, 0.035), (cx, y - 0.11, z0 - 0.018), m["trim"], 0.006)
    C(f"{name}_curtain_rod", 0.012, w + 0.5, (cx, y - 0.16, z1 + 0.12), m["alu"], rot=(0, math.pi / 2, 0), verts=16)
    for sx in (-1, 1):  # short curtains pulled to the sides
        cur = B(f"{name}_curtain", (0.32, 0.05, h + 0.25), (cx + sx * (w / 2 + 0.1), y - 0.17, z0 + h / 2 - 0.05), m["curtain"],
                0.02)
        cur.modifiers.new("soft", "SUBSURF").levels = 1


def door(cx, y, m):
    w, h = 0.86, 2.02
    B("door_leaf", (w, 0.045, h), (cx, y + 0.01, h / 2), m["door"], 0.006)
    for sx in (-1, 1):
        B("door_jamb", (0.06, 0.14, h + 0.06), (cx + sx * (w / 2 + 0.03), y, (h + 0.06) / 2), m["trim"], 0.005)
    B("door_head", (w + 0.12, 0.14, 0.06), (cx, y, h + 0.03), m["trim"], 0.005)
    C("door_lever", 0.012, 0.12, (cx + w / 2 - 0.09, y + 0.07, 1.0), m["steel"], rot=(0, math.pi / 2, 0), verts=16)
    C("door_rose", 0.03, 0.012, (cx + w / 2 - 0.13, y + 0.04, 1.0), m["steel"], rot=(math.pi / 2, 0, 0))
    C("door_peephole", 0.01, 0.02, (cx, y + 0.04, 1.55), m["steel"], rot=(math.pi / 2, 0, 0), verts=16)
    # genkan: a tiled step inside the door where shoes go
    B("genkan", (1.3, 0.95, 0.02), (cx, 0.48, 0.0), m["tile_genkan"])


def shell(m):
    # tatami room: 16 mats with real seams over a dark base
    cols, rows = 4, 4
    mw = (TATAMI_X1 - X0) / cols
    mh = D / rows
    for i in range(cols):
        for j in range(rows):
            B(f"tatami_{i}{j}", (mw - 0.012, mh - 0.012, 0.05), (X0 + mw * (i + 0.5), mh * (j + 0.5), 0.0), m["tatami"], 0.01)
    B("tatami_base", (TATAMI_X1 - X0, D, 0.04), ((X0 + TATAMI_X1) / 2, D / 2, -0.03), m["border"])
    B("tatami_edge", (0.05, D, 0.055), (TATAMI_X1 + 0.02, D / 2, 0.0), m["trim"], 0.005)
    B("wood_floor", (X1 - TATAMI_X1 - 0.05, D, 0.05), ((TATAMI_X1 + 0.05 + X1) / 2, D / 2, 0.0), m["wood"])
    B("subfloor", (W + 1, D + 1, 0.05), (0, D / 2, -0.06), m["border"], uv=False)

    wall_x("back_wall", D + 0.06, X0 - 0.12, X1 + 0.12, [(-3.3, -1.3, 0.85, 2.05), (0.9, 2.6, 0.95, 2.05)], m["wall"])
    wall_x("front_wall", -0.06, X0 - 0.12, X1 + 0.12, [(2.67, 3.53, 0.0, 2.02)], m["wall"])
    B("left_wall", (0.12, D + 0.24, H), (X0 - 0.06, D / 2, H / 2), m["wall"])
    B("right_wall", (0.12, D + 0.24, H), (X1 + 0.06, D / 2, H / 2), m["wall"])
    ceil = B("ceiling", (W + 0.24, D + 0.24, 0.08), (0, D / 2, H + 0.04), m["ceiling"])
    ceil.pass_index = fm.ROLE_FORBIDDEN
    for y in (0.01, D - 0.01):
        B("skirting", (W, 0.02, 0.07), (0, y, 0.035), m["trim"], 0.003)
        B("mawaribuchi", (W, 0.035, 0.035), (0, y, H - 0.018), m["trim"], 0.003)
    for x in (X0 + 0.01, X1 - 0.01):
        B("skirting", (0.02, D, 0.07), (x, D / 2, 0.035), m["trim"], 0.003)
        B("mawaribuchi", (0.035, D, 0.035), (x, D / 2, H - 0.018), m["trim"], 0.003)
    B("nageshi", (0.1, D, 0.12), (TATAMI_X1, D / 2, H - 0.06), m["trim"], 0.006)  # beam over the tatami/wood border
    for y in (0.06, D - 0.06):
        B("hashira", (0.11, 0.11, H), (TATAMI_X1, y, H / 2), m["trim"], 0.006)

    window("winA", -3.3, -1.3, 0.85, 2.05, D + 0.02, m)
    window("winB", 0.9, 2.6, 0.95, 2.05, D + 0.02, m)
    door(3.1, -0.04, m)
    # outside: balcony rail and a sky/city backdrop seen through the windows
    for k in range(18):
        C("balcony_bar", 0.012, 1.0, (-4 + k * 0.48, D + 1.1, 0.5), m["alu"], verts=12)
    B("balcony_rail", (W + 1, 0.05, 0.05), (0, D + 1.1, 1.02), m["alu"], 0.01)
    B("balcony_floor", (W + 1, 1.3, 0.08), (0, D + 0.75, -0.04), m["border"])
    sky = fm.mat_solid("sky_backdrop", (0.62, 0.76, 0.95), rough=1, emission=(0.62, 0.76, 0.95), emission_strength=1.6)
    bd = fm.plane("sky", (24, 6), (0, D + 7, 2.5), sky, rotation=(math.pi / 2, 0, 0))
    bd.visible_shadow = False
    rng = random.Random(7)
    bmat = fm.mat_solid("far_buildings", (0.42, 0.48, 0.58), rough=0.9)
    for k in range(14):
        hgt = rng.uniform(2.5, 7)
        B("building", (rng.uniform(0.9, 2.2), 0.6, hgt), (-11 + k * 1.7, D + 6.2, hgt / 2 - 0.8), bmat).visible_shadow = False


# ------------------------------------------------------------------ furniture built by hand
def kitchen(m):
    # counter along the right wall: y 2.0 .. 4.55, 0.65 deep, 0.87 high
    y0, y1 = 2.0, 4.55
    xf = X1 - 0.65
    n = 4
    B("k_carcass", (0.6, y1 - y0, 0.78), (X1 - 0.31, (y0 + y1) / 2, 0.47), m["cabinet"], 0.004)
    B("k_plinth", (0.56, y1 - y0, 0.08), (X1 - 0.33, (y0 + y1) / 2, 0.04), m["dark"])
    for k in range(n):
        yy = y0 + (k + 0.5) * (y1 - y0) / n
        B("k_door", (0.02, (y1 - y0) / n - 0.012, 0.66), (xf + 0.04, yy, 0.47), m["cabinet"], 0.004)
        B("k_handle", (0.02, 0.14, 0.015), (xf + 0.025, yy, 0.76), m["steel"], 0.004)
    B("k_top", (0.66, y1 - y0 + 0.02, 0.035), (X1 - 0.33, (y0 + y1) / 2, 0.878), m["steel"], 0.004)
    B("k_sink", (0.42, 0.55, 0.02), (X1 - 0.34, 3.5, 0.888), m["steel_dark"], 0.01)
    C("k_faucet", 0.014, 0.3, (X1 - 0.12, 3.5, 1.04), m["steel"], verts=16)
    C("k_spout", 0.012, 0.22, (X1 - 0.22, 3.5, 1.18), m["steel"], rot=(0, math.pi / 2, 0), verts=16)
    B("k_hob", (0.5, 0.56, 0.008), (X1 - 0.33, 2.45, 0.898), m["glass_black"], 0.004)
    for dy in (-0.13, 0.13):
        C("k_ring", 0.09, 0.002, (X1 - 0.33, 2.45 + dy, 0.903), m["ring"], verts=40)
    B("k_upper", (0.36, y1 - y0, 0.6), (X1 - 0.18, (y0 + y1) / 2, 1.85), m["cabinet"], 0.004)
    for k in range(n):
        yy = y0 + (k + 0.5) * (y1 - y0) / n
        B("k_udoor", (0.015, (y1 - y0) / n - 0.012, 0.56), (X1 - 0.365, yy, 1.85), m["cabinet"], 0.003)
    B("k_hood", (0.5, 0.6, 0.18), (X1 - 0.26, 2.45, 1.47), m["steel"], 0.01)
    B("k_backsplash", (0.01, y1 - y0, 0.68), (X1 - 0.005, (y0 + y1) / 2, 1.23), m["tile_white"])


def fridge(m):
    x, y = X1 - 0.36, 5.0
    B("fridge_body", (0.62, 0.66, 1.72), (x, y, 0.86), m["enamel"], 0.03)
    B("fridge_gap", (0.005, 0.64, 0.004), (x - 0.31, y, 1.15), m["dark"])
    B("fridge_door_hi", (0.03, 0.64, 0.56), (x - 0.325, y, 1.43), m["enamel"], 0.012)
    B("fridge_door_lo", (0.03, 0.64, 1.0), (x - 0.325, y, 0.6), m["enamel"], 0.012)
    for z0, z1 in ((1.2, 1.6), (0.75, 1.1)):
        B("fridge_handle", (0.025, 0.03, z1 - z0), (x - 0.35, y - 0.27, (z0 + z1) / 2), m["steel"], 0.008)
    for k, c in enumerate([(0.9, 0.2, 0.25), (0.2, 0.6, 0.9), (1.0, 0.8, 0.2)]):
        C("magnet", 0.018, 0.012, (x - 0.346, y - 0.15 + k * 0.12, 1.5 - k * 0.05), fm.mat_solid(f"magnet{k}", c, 0.3),
          rot=(0, math.pi / 2, 0), verts=16)
    B("fridge_note", (0.002, 0.1, 0.13), (x - 0.343, y + 0.12, 1.36), fm.mat_solid("note", (0.98, 0.95, 0.7), 0.9))


def futon(m):
    cx, cy = -2.45, 5.6  # under window A
    B("futon_shikibuton", (1.95, 1.02, 0.09), (cx, cy, 0.07), m["futon_white"], 0.04)
    duvet = B("futon_kakebuton", (1.45, 1.06, 0.12), (cx + 0.24, cy, 0.17), m["duvet"], 0.05, uv=False)
    duvet.modifiers.new("soft", "SUBSURF").levels = 2
    HAND.append(fm.sphere("futon_pillow", 0.25, (cx - 0.72, cy, 0.17), m["pillow"], scale=(0.75, 1.3, 0.38)))


def oshiire(m):
    y0, y1 = 3.3, 5.0  # closet with fusuma sliding doors on the left wall
    B("oshiire_frame_top", (0.06, y1 - y0 + 0.1, 0.06), (X0 + 0.03, (y0 + y1) / 2, 1.82), m["trim"], 0.004)
    B("oshiire_frame_bot", (0.06, y1 - y0 + 0.1, 0.05), (X0 + 0.03, (y0 + y1) / 2, 0.025), m["trim"], 0.004)
    for y in (y0 - 0.025, y1 + 0.025):
        B("oshiire_post", (0.06, 0.05, 1.85), (X0 + 0.03, y, 0.925), m["trim"], 0.004)
    half = (y1 - y0) / 2
    for k in range(2):
        yy = y0 + half * (k + 0.5)
        xx = X0 + 0.055 + k * 0.022
        B("fusuma", (0.022, half - 0.01, 1.72), (xx, yy, 0.92), m["fusuma"], 0.003, uv=False)
        for z in (1.78, 0.06):
            B("fusuma_frame", (0.03, half, 0.025), (xx, yy, z), m["lacquer"], 0.003)
        C("fusuma_pull", 0.028, 0.006, (xx + 0.016, yy + (half / 2 - 0.08) * (1 if k else -1), 0.9), m["brass"], rot=(0, math.pi / 2, 0))


def cushions(m, cx, cy):
    for k, (dx, dy, rot) in enumerate(((0, -0.72, 0), (0, 0.72, 0), (-0.85, 0, math.pi / 2), (0.85, 0, math.pi / 2))):
        z = B(f"zabuton_{k}", (0.55, 0.6, 0.07), (cx + dx, cy + dy, 0.06), m["zabuton"][k % 2], 0.03, rot=(0, 0, rot + 0.06 * (k - 1.5)))
        z.modifiers.new("soft", "SUBSURF").levels = 1


def plush(name, x, y, z, s, color, m):
    fur = fm.mat_solid(f"{name}_fur", color, rough=1.0)
    try:
        fur.node_tree.nodes["Principled BSDF"].inputs["Sheen Weight"].default_value = 0.8
    except KeyError:
        pass
    parts = [
        fm.sphere(f"{name}_body", 0.11 * s, (x, y, z + 0.1 * s), fur, scale=(1, 0.9, 1.1)),
        fm.sphere(f"{name}_head", 0.085 * s, (x, y, z + 0.27 * s), fur),
        fm.sphere(f"{name}_ear", 0.032 * s, (x - 0.06 * s, y, z + 0.34 * s), fur),
        fm.sphere(f"{name}_ear", 0.032 * s, (x + 0.06 * s, y, z + 0.34 * s), fur),
        fm.sphere(f"{name}_muzzle", 0.035 * s, (x, y - 0.075 * s, z + 0.25 * s), m["plush_muzzle"], scale=(1.2, 0.8, 0.9)),
        fm.sphere(f"{name}_eye", 0.011 * s, (x - 0.032 * s, y - 0.078 * s, z + 0.29 * s), m["plush_eye"]),
        fm.sphere(f"{name}_eye", 0.011 * s, (x + 0.032 * s, y - 0.078 * s, z + 0.29 * s), m["plush_eye"]),
    ]
    for sx in (-1, 1):
        parts.append(fm.sphere(f"{name}_arm", 0.038 * s, (x + sx * 0.1 * s, y - 0.02 * s, z + 0.14 * s), fur, scale=(1, 1, 1.4)))
        parts.append(fm.sphere(f"{name}_leg", 0.045 * s, (x + sx * 0.06 * s, y - 0.06 * s, z + 0.035 * s), fur, scale=(1, 1.3, 0.9)))
    HAND.extend(parts)


def posters(m):
    # (x, y, z, rot_z, w, h, art): front wall facing into the room, one on the right wall by the kitchen
    for k, (x, y, z, rz, w, h, kind) in enumerate((
        (-3.0, 0.008, 1.55, 0.0, 0.42, 0.6, 0),
        (-2.35, 0.008, 1.5, 0.0, 0.36, 0.5, 3),
        (1.7, 0.008, 1.6, 0.0, 0.42, 0.6, 1),
        (X1 - 0.008, 1.2, 1.55, -math.pi / 2, 0.42, 0.6, 2),
    )):
        fm.plane(f"poster_{k}", (w, h), (x, y, z), fm.image_material(f"poster_{k}", img_poster(kind), rough=0.55),
                 rotation=(math.pi / 2, 0, rz))


def lamps(m):
    shade = fm.mat_solid("washi_lamp", (0.98, 0.93, 0.8), rough=0.9, emission=(1.0, 0.84, 0.6), emission_strength=4.0)
    fm.sphere("pendant_shade", 0.24, (-2.0, 2.8, 1.85), shade, scale=(1, 1, 0.8), segments=40)
    C("pendant_cord", 0.004, 0.42, (-2.0, 2.8, 2.19), m["dark"], verts=8)
    C("pendant_rose", 0.05, 0.03, (-2.0, 2.8, H - 0.015), m["trim"])
    ceil_l = fm.mat_solid("ceiling_light", (1, 1, 1), rough=0.6, emission=(1.0, 0.96, 0.9), emission_strength=6.0)
    C("ceiling_light", 0.3, 0.06, (1.9, 3.3, H - 0.03), ceil_l, verts=48, bevel=0.02)
    LIGHTS.append({"pos": [-2.0, 2.8, 1.7], "color": [1.0, 0.82, 0.6], "intensity": 3.0, "distance": 5.5})
    LIGHTS.append({"pos": [1.9, 3.3, 2.2], "color": [1.0, 0.96, 0.9], "intensity": 3.5, "distance": 6.5})
    fm.add_point("pendant_glow", (-2.0, 2.8, 1.82), power=60, color=(1.0, 0.8, 0.55), radius=0.2)
    fm.add_area("ceiling_light_area", (1.9, 3.3, H - 0.07), (1.9, 3.3, 0), size=0.55, power=150, color=(1.0, 0.95, 0.88),
                shape="DISK")


# ------------------------------------------------------------------ Poly Haven props, placed by hand
def _centroid(root):
    """Mean of the mesh vertices in world space (the back panel of a shelf pulls it backwards)."""
    from mathutils import Vector  # type: ignore

    acc = Vector((0, 0, 0))
    n = 0
    for o in room._walk(root):
        if o.type != "MESH":
            continue
        mw = o.matrix_world
        vs = o.data.vertices
        step = max(1, len(vs) // 4000)
        for i in range(0, len(vs), step):
            acc += mw @ vs[i].co
            n += 1
    return acc / max(n, 1)


def orient_to_wall(root, wall):
    """Turn a cabinet/shelf so its back (the heavier side) faces the wall: wall = (dx, dy) unit vector."""
    best, best_score = 0.0, -1e9
    for k in range(4):
        root.rotation_euler.z = k * math.pi / 2
        bpy.context.view_layer.update()
        lo, hi = assets.bounds(root)
        depth = (hi.x - lo.x) if wall[0] else (hi.y - lo.y)
        width = (hi.y - lo.y) if wall[0] else (hi.x - lo.x)
        c = _centroid(root)
        mid = (lo + hi) / 2
        score = ((c.x - mid.x) * wall[0] + (c.y - mid.y) * wall[1]) / max(depth, 1e-3) + (0.5 if depth <= width else 0)
        if score > best_score:
            best, best_score = k * math.pi / 2, score
    return best


def put(aid, x, y, rot=0.0, z=0.0, fit=None, fit_axis="z", wall=None):
    """Import a photoscan, turn it, centre its footprint on (x, y), stand it on z.
    fit: scale so its size along fit_axis is this many metres (keeps real-world scale)."""
    if aid not in assets.catalog("models"):
        print(f"[m01] model {aid} not on Poly Haven, skipped")
        return None
    root = room._try_import(aid)
    if root is None:
        return None
    root.rotation_euler.z = orient_to_wall(root, wall) if wall else rot
    bpy.context.view_layer.update()
    if fit:
        lo, hi = assets.bounds(root)
        size = {"x": hi.x - lo.x, "y": hi.y - lo.y, "z": hi.z - lo.z}[fit_axis]
        if size > 1e-4:
            root.scale = tuple(v * fit / size for v in root.scale)
            bpy.context.view_layer.update()
    room._move_bbox(root, x, y)
    assets.drop_to(root, z)
    return root


def place_props(m):
    p = {}
    p["chabudai"] = put("chinese_tea_table", -2.0, 2.8, 0, fit=0.33)
    cushions(m, -2.0, 2.8)
    p["shelf_a"] = put("painted_wooden_shelves", X0 + 0.22, 1.1, fit=1.6, wall=(-1, 0))
    p["shelf_b"] = put("wooden_display_shelves_01", X0 + 0.22, 2.3, fit=1.2, wall=(-1, 0))
    p["tansu"] = put("vintage_wooden_drawer_01", -0.75, D - 0.3, fit=0.9, wall=(0, 1))
    p["desk"] = put("wooden_table_02", 1.75, D - 0.42, 0, fit=0.72)
    put("wooden_stool_02", 1.75, D - 1.05, 0.3, fit=0.45)
    p["cabinet"] = put("modern_wooden_cabinet", 0.75, 0.32, fit=0.55, wall=(0, -1))
    p["side"] = put("side_table_tall_01", -0.75, 0.3, 0, fit=0.62)
    put("planter_pot_clay", X0 + 0.3, D - 0.3, 0)
    put("calathea_orbifolia_01", 3.6, 0.85, 0, fit=0.8)
    put("wicker_basket_02", -0.6, 4.6, 0.4, fit=0.3)
    put("Ottoman_01", 1.25, 2.3, 0.2, fit=0.42)
    put("vintage_suitcase", 2.3, 0.4, 1.4, fit=0.2)
    put("throw_pillows_01", -3.3, 2.9, 0.6, fit=0.25)
    rug = fm.plane("rug", (2.0, 1.4), (1.4, 2.6, 0.004), fm.image_material("rug", img_rug(), rough=0.95, sheen=0.6))
    rug.modifiers.new("thick", "SOLIDIFY").thickness = 0.008
    plush("bear_pink", -2.1, 5.3, 0.22, 1.0, (0.93, 0.62, 0.7), m)
    plush("bear_tan", -1.8, 5.75, 0.22, 0.8, (0.78, 0.6, 0.42), m)
    plush("bear_mint", -2.0, 2.04, 0.095, 0.9, (0.55, 0.85, 0.78), m)
    return p


def fill(rng, p):
    """Shelves full of things, the table set, a real kitchen counter."""
    deco = room.templates(("book_encyclopedia_set_01", "decorative_book_set_01", "ceramic_vase_01", "ceramic_vase_03",
                           "brass_vase_01", "wooden_bowl_01", "alarm_clock_01", "standing_picture_frame_01",
                           "standing_picture_frame_02", "carved_wooden_elephant", "concrete_cat_statue",
                           "Lantern_01", "gamepad", "cassette_player", "chess_set", "lambis_shell", "binder_notebook",
                           "brass_candleholders", "anthurium_botany_01", "round_spectacles", "vintage_pocket_watch"), rng, 0.42)
    food = room.templates(("food_apple_01", "bananas", "lemon", "jug_01", "wooden_bowl_02", "plastic_thermos", "tea_set_01",
                           "russian_food_cans_01", "food_pomegranate_01"), rng, 0.4)
    n = 0
    for key, count in (("shelf_a", 34), ("shelf_b", 24), ("tansu", 5), ("desk", 7), ("cabinet", 5), ("side", 2)):
        root = p.get(key)
        if root is None:
            continue
        lo, hi = assets.bounds(root)
        n += room.scatter(THEME, rng, (), count, region=(lo.x + 0.04, hi.x - 0.04, lo.y + 0.04, hi.y - 0.04, lo.z + 0.1, hi.z + 0.05),
                          tpls=deco)
    if p.get("chabudai"):
        lo, hi = assets.bounds(p["chabudai"])
        n += room.scatter(THEME, rng, (), 4, region=(lo.x + 0.06, hi.x - 0.06, lo.y + 0.06, hi.y - 0.06, hi.z, hi.z + 0.1), tpls=food)
    n += room.scatter(THEME, rng, (), 8, region=(X1 - 0.6, X1 - 0.08, 3.85, 4.5, 0.95, 1.0), tpls=food)
    print(f"[m01] props on surfaces: {n}")


def materials():
    m = {}
    m["tatami"] = tex_or(("tatami_mat",), 1.0, ((0.72, 0.68, 0.45), 0.8), "tatami")
    m["wood"] = tex_or(("wood_floor", "laminate_floor_02", "wood_floor_deck"), 1.0, ((0.55, 0.38, 0.24), 0.45), "wood_floor")
    m["wall"] = tex_or(("painted_plaster_wall", "beige_wall_001", "plastered_wall_03"), 0.8, ((0.88, 0.86, 0.8), 0.9), "wall")
    m["trim"] = tex_or(("japanese_cedar_planks", "wood_planks_grey"), 2.0, ((0.55, 0.38, 0.22), 0.5), "cedar_trim")
    m["ceiling"] = tex_or(("japanese_cedar_planks", "wood_planks_grey"), 0.8, ((0.8, 0.72, 0.6), 0.7), "ceiling_wood")
    m["cabinet"] = tex_or(("plywood", "wood_cabinet_worn_long"), 1.5, ((0.82, 0.7, 0.55), 0.5), "cabinet")
    m["door"] = tex_or(("wood_cabinet_worn_long", "plywood"), 1.0, ((0.42, 0.3, 0.2), 0.5), "door")
    m["tile_white"] = tex_or(("white_tiles", "tiles_white", "ceramic_tiles_02"), 3.0, ((0.92, 0.92, 0.9), 0.2), "backsplash")
    m["tile_genkan"] = tex_or(("floor_tiles_06", "grey_tiles", "concrete_floor_02"), 2.0, ((0.55, 0.53, 0.5), 0.6), "genkan_tile")
    m["border"] = fm.mat_solid("dark_wood", (0.12, 0.09, 0.07), 0.6)
    m["alu"] = fm.mat_solid("aluminium", (0.78, 0.78, 0.76), 0.35, metal=1.0)
    m["steel"] = fm.mat_solid("steel", (0.8, 0.8, 0.8), 0.22, metal=1.0)
    m["steel_dark"] = fm.mat_solid("steel_dark", (0.5, 0.5, 0.5), 0.3, metal=1.0)
    m["glass_black"] = fm.mat_solid("glass_black", (0.02, 0.02, 0.02), 0.05, coat=1.0)
    m["ring"] = fm.mat_solid("hob_ring", (0.25, 0.25, 0.25), 0.3)
    m["enamel"] = fm.mat_solid("fridge_enamel", (0.9, 0.9, 0.88), 0.18, coat=0.6)
    m["dark"] = fm.mat_solid("dark", (0.05, 0.05, 0.05), 0.5)
    m["brass"] = fm.mat_solid("brass", (0.85, 0.65, 0.3), 0.3, metal=1.0)
    m["lacquer"] = fm.mat_solid("black_lacquer", (0.03, 0.025, 0.02), 0.15, coat=1.0)
    m["curtain"] = fm.mat_solid("curtain_linen", (0.82, 0.78, 0.68), 0.95)
    m["futon_white"] = fm.mat_solid("futon_white", (0.92, 0.9, 0.86), 0.95)
    m["pillow"] = fm.mat_solid("pillow", (0.6, 0.72, 0.85), 0.95)
    m["zabuton"] = [fm.mat_solid("zabuton_indigo", (0.12, 0.17, 0.35), 0.9), fm.mat_solid("zabuton_red", (0.55, 0.12, 0.12), 0.9)]
    m["plush_muzzle"] = fm.mat_solid("plush_muzzle", (0.96, 0.9, 0.82), 1.0)
    m["plush_eye"] = fm.mat_solid("plush_eye", (0.02, 0.02, 0.02), 0.1)
    m["duvet"] = fm.image_material("duvet", img_duvet(), rough=0.95, sheen=0.5)
    m["fusuma"] = fm.image_material("fusuma_paper", img_fusuma(), rough=0.9)
    glass = fm.mat_solid("window_glass", (0.85, 0.92, 0.95), rough=0.03)
    glass.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.12
    try:
        glass.surface_render_method = "BLENDED"
    except AttributeError:
        glass.blend_method = "BLEND"
    m["glass"] = glass
    return m


def build(rng):
    m = materials()
    shell(m)
    kitchen(m)
    fridge(m)
    futon(m)
    oshiire(m)
    posters(m)
    lamps(m)
    fm.world_uv(HAND)
    p = place_props(m)
    fill(rng, p)


def light():
    """Daylight: sun from behind the windows, a sky fill in each window, HDRI for reflections."""
    hd = [h for h in ("comfy_cafe", "small_empty_room_1", "lebombo") if h in assets.catalog("hdris")]
    if hd:
        assets.use_hdri(hd[0], strength=0.45)
    sun = fm.add_sun("key_sun", (58, 0, 196), strength=4.5, color=(1.0, 0.93, 0.8), angle_deg=1.5)
    for name, (x0, x1, z0, z1) in (("winA", (-3.3, -1.3, 0.85, 2.05)), ("winB", (0.9, 2.6, 0.95, 2.05))):
        fm.add_area(f"{name}_sky", ((x0 + x1) / 2, D - 0.05, (z0 + z1) / 2), ((x0 + x1) / 2, 0, 0.4), size=x1 - x0,
                    power=380, color=(0.85, 0.92, 1.0), size_y=z1 - z0)
    LIGHTS.append({"pos": [-2.3, D - 0.6, 1.4], "color": [0.9, 0.95, 1.0], "intensity": 2.0, "distance": 6})
    LIGHTS.append({"pos": [1.75, D - 0.6, 1.5], "color": [0.9, 0.95, 1.0], "intensity": 2.0, "distance": 6})
    return sun


def export(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    n = 0
    for o in bpy.context.scene.objects:
        if o.type in ("MESH", "EMPTY") and not o.hide_render and abs(o.location.y) < 40:
            o.select_set(True)
            n += 1
    want = dict(filepath=os.path.join(out_dir, "map.glb"), export_format="GLB", use_selection=True, export_apply=True,
                export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="JPEG",
                export_jpeg_quality=88, export_lights=False, export_cameras=False, export_animations=False)
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in known})
    tris = 0
    deps = bpy.context.evaluated_depsgraph_get()
    for o in bpy.context.selected_objects:
        if o.type == "MESH":
            ev = o.evaluated_get(deps)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
            ev.to_mesh_clear()
    print(f"[map] exported {n} objects, {tris} triangles")
    return tris


def main():
    args = fm.parse_args()
    rng = random.Random(SEED)
    scene = fm.reset_scene()
    build(rng)
    sun = light()
    out = os.path.join(args.out, "3d", "maps", MAP_ID)
    fm.set_color_management(scene)
    w, h = (960, 540) if args.preview else (1920, 1080)
    fm.configure_render(scene, w, h, 48 if args.preview else 160)
    scene.use_nodes = False
    # review renders: from the genkan looking in, and from the tatami corner toward the kitchen
    scene.camera = fm.add_camera("review", (3.0, 0.7, 1.35), (-1.6, 4.6, 0.55), focal_mm=17)
    fm.render_still(scene, os.path.join(out, "preview.png"))
    scene.camera = fm.add_camera("review2", (-3.5, 1.0, 1.25), (2.5, 4.0, 0.7), focal_mm=17)
    fm.render_still(scene, os.path.join(out, "preview2.png"))
    tris = export(out)
    meta = {
        "id": MAP_ID,
        "title": {"en": THEME.title_en, "ar": THEME.title_ar},
        "size": [W, D, H],
        "spawn": {"hiders": [[1.4, 1.6, 0.05], [-1.0, 1.4, 0.05], [0.6, 4.4, 0.05]], "seekers": [[3.1, 0.9, 0.05]]},
        "sun": {"dirWorld": list(fm.sun_direction_world(sun)), "color": list(sun.data.color), "strength": sun.data.energy},
        "lights": LIGHTS,
        "triangles": tris,
        "hdri": [k for k, v in assets.USED.items() if v["type"] == "hdris"],
        "credit": fm.CREDIT,
    }
    with open(os.path.join(out, "map.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    assets.write_credits(os.path.join(out, "credits.json"))


if __name__ == "__main__":
    main()
