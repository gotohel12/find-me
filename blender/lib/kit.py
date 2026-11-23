"""
Prop kit — reusable procedural props for FIND ME scenes.

Every prop takes an rng so scenes are reproducible, and returns the objects it
created. Sizes are real-world metres; the hider is ~0.37 m tall, so props are
built at "toy among toys" scale around it.
"""
from __future__ import annotations

import math
import random

import bpy  # type: ignore

import fm
from fm import box, cone, cylinder, hsv, mat_pattern, mat_solid, random_pattern, sphere, torus

_cache: dict = {}


def wood(rng: random.Random, tone: float = 0.08, dark: float = 0.45):
    key = ("wood", round(tone, 2), round(dark, 2))
    if key not in _cache:
        _cache[key] = mat_pattern(
            f"wood_{len(_cache)}", "grain",
            [hsv(tone, 0.55, dark), hsv(tone + 0.01, 0.5, dark + 0.18)], scale=6.0, rough=0.55,
        )
    return _cache[key]


def shelf_unit(rng, x, y, width=1.2, height=2.1, depth=0.4, shelves=5, rot_z=0.0, mat=None):
    """Open shelving with side panels and a back board. Returns (objects, shelf top z list)."""
    m = mat or wood(rng)
    back = mat_pattern(f"shelfback_{x}_{y}", "stripes",
                       [hsv(rng.random(), 0.25, 0.85), hsv(rng.random(), 0.3, 0.95)], scale=14)
    objs = []
    t = 0.03
    c, s = math.cos(rot_z), math.sin(rot_z)

    def place(lx, ly, z):
        return (x + lx * c - ly * s, y + lx * s + ly * c, z)

    for side in (-1, 1):
        objs.append(box("shelf_side", (t, depth, height), place(side * width / 2, 0, height / 2), m, 0.004,
                        rotation=(0, 0, rot_z)))
    objs.append(box("shelf_back", (width, 0.01, height), place(0, depth / 2, height / 2), back, rotation=(0, 0, rot_z)))
    tops = []
    for i in range(shelves):
        z = 0.08 + i * (height - 0.12) / (shelves - 1) if shelves > 1 else 0.08
        objs.append(box("shelf_board", (width, depth, t), place(0, 0, z), m, 0.004, rotation=(0, 0, rot_z)))
        tops.append(z + t / 2)
    return objs, tops


def toy_box(rng, loc, size=None, rot_z=0.0):
    sx, sy, sz = size or (rng.uniform(0.12, 0.3), rng.uniform(0.1, 0.25), rng.uniform(0.12, 0.35))
    m = random_pattern(rng, "toybox")
    return [box("toy_box", (sx, sy, sz), (loc[0], loc[1], loc[2] + sz / 2), m, 0.006, rotation=(0, 0, rot_z))]


def ball(rng, loc, r=None):
    r = r or rng.uniform(0.05, 0.16)
    kind = rng.choice(["stripes", "dots", "stars", "checker"])
    m = mat_pattern("ball", kind, [hsv(rng.random(), 0.8, 0.95), hsv(rng.random(), 0.6, 1.0)],
                    scale=rng.uniform(8, 20), rough=0.3)
    return [sphere("ball", r, (loc[0], loc[1], loc[2] + r), m)]


def block_stack(rng, loc, n=None, size=0.07):
    n = n or rng.randint(2, 5)
    objs = []
    z = loc[2]
    for i in range(n):
        m = mat_solid("block", hsv(rng.random(), 0.75, 0.9), rough=0.4)
        off = (rng.uniform(-0.01, 0.01), rng.uniform(-0.01, 0.01))
        objs.append(box("block", (size, size, size), (loc[0] + off[0], loc[1] + off[1], z + size / 2), m, 0.004,
                        rotation=(0, 0, rng.uniform(-0.3, 0.3))))
        z += size
    return objs


def plush(rng, loc, s=None):
    """A round plush creature: body, head, two ears, belly patch. Original design."""
    s = s or rng.uniform(0.7, 1.3)
    h = rng.random()
    fur = mat_pattern("plush", "noise", [hsv(h, 0.55, 0.75), hsv(h, 0.45, 0.9)], scale=60, rough=0.9)
    belly = mat_solid("plush_belly", hsv(h + 0.05, 0.2, 0.98), rough=0.9)
    x, y, z = loc
    objs = [
        sphere("plush_body", 0.09 * s, (x, y, z + 0.085 * s), fur, scale=(1, 0.9, 0.95)),
        sphere("plush_head", 0.075 * s, (x, y - 0.01 * s, z + 0.2 * s), fur),
        sphere("plush_belly", 0.055 * s, (x, y - 0.055 * s, z + 0.08 * s), belly, scale=(1, 0.5, 1)),
    ]
    ear = rng.choice(["round", "long"])
    for sx in (-1, 1):
        if ear == "round":
            objs.append(sphere("plush_ear", 0.03 * s, (x + sx * 0.055 * s, y, z + 0.27 * s), fur, scale=(1, 0.5, 1)))
        else:
            objs.append(sphere("plush_ear", 0.025 * s, (x + sx * 0.035 * s, y, z + 0.3 * s), fur, scale=(0.7, 0.5, 2.2)))
    return objs


def toy_car(rng, loc, rot_z=0.0):
    m = mat_solid("car", hsv(rng.random(), 0.85, 0.9), rough=0.25, coat=0.6)
    tyre = mat_solid("tyre", (0.03, 0.03, 0.03), rough=0.7)
    x, y, z = loc
    c, s = math.cos(rot_z), math.sin(rot_z)
    objs = [
        box("car_body", (0.18, 0.08, 0.05), (x, y, z + 0.045), m, 0.01, rotation=(0, 0, rot_z)),
        box("car_top", (0.09, 0.07, 0.04), (x - 0.01 * c, y - 0.01 * s, z + 0.09), m, 0.012, rotation=(0, 0, rot_z)),
    ]
    for lx in (-0.055, 0.055):
        for ly in (-0.042, 0.042):
            objs.append(cylinder("wheel", 0.022, 0.016, (x + lx * c - ly * s, y + lx * s + ly * c, z + 0.022), tyre,
                                 rotation=(math.pi / 2, 0, rot_z), vertices=20))
    return objs


def jar(rng, loc):
    r = rng.uniform(0.035, 0.06)
    hgt = rng.uniform(0.08, 0.18)
    glass = mat_solid("jar", hsv(rng.random(), 0.5, 0.9), rough=0.15)
    lid = mat_solid("lid", hsv(rng.random(), 0.8, 0.8), rough=0.3, metal=0.6)
    x, y, z = loc
    return [cylinder("jar", r, hgt, (x, y, z + hgt / 2), glass, bevel=0.004),
            cylinder("jar_lid", r * 1.05, 0.02, (x, y, z + hgt + 0.01), lid)]


def spinning_top(rng, loc):
    m = mat_pattern("top", "stripes", [hsv(rng.random(), 0.8, 0.95), (0.95, 0.95, 0.9)], scale=30, rough=0.3)
    x, y, z = loc
    return [cone("top", 0.06, 0.005, 0.08, (x, y, z + 0.06), m, rotation=(math.pi, 0, 0)),
            cylinder("top_stem", 0.008, 0.05, (x, y, z + 0.115), m)]


def ring_stack(rng, loc):
    """Stacking-rings toy."""
    x, y, z = loc
    objs = [cylinder("ring_post", 0.01, 0.2, (x, y, z + 0.1), wood(rng, 0.09, 0.6))]
    for i in range(5):
        r = 0.065 - i * 0.009
        objs.append(torus("ring", r, 0.018, (x, y, z + 0.02 + i * 0.034), mat_solid("ring", hsv(i / 5.0, 0.8, 0.95), 0.35)))
    return objs


def book_row(rng, x0, x1, y, z, depth=0.16):
    objs = []
    x = x0
    while x < x1 - 0.03:
        w = rng.uniform(0.018, 0.045)
        h = rng.uniform(0.15, 0.26)
        lean = rng.uniform(-0.04, 0.04)
        m = random_pattern(rng, "book") if rng.random() < 0.3 else mat_solid("book", hsv(rng.random(), 0.6, rng.uniform(0.4, 0.9)), 0.5)
        objs.append(box("book", (w, depth, h), (x + w / 2, y, z + h / 2), m, 0.002, rotation=(0, lean, 0)))
        x += w + 0.002
    return objs


def rug(rng, loc, size=(1.6, 1.1)):
    m = mat_pattern("rug", rng.choice(["plaid", "waves", "dots", "stripes"]),
                    [hsv(rng.random(), 0.6, 0.75), hsv(rng.random(), 0.5, 0.95), hsv(rng.random(), 0.4, 0.6)],
                    scale=rng.uniform(4, 9), rough=0.95)
    return [box("rug", (size[0], size[1], 0.012), (loc[0], loc[1], loc[2] + 0.006), m, 0.004)]


def scatter_on_shelf(rng, x0, x1, y, z, makers, gap=0.02):
    """Fill a shelf from left to right with random props."""
    objs = []
    x = x0 + 0.04
    while x < x1 - 0.08:
        maker = rng.choice(makers)
        made = maker(rng, (x, y + rng.uniform(-0.04, 0.04), z))
        objs += made
        bpy.context.view_layer.update()
        width = max(o.dimensions.x for o in made)
        x += width + gap + rng.uniform(0, 0.05)
    return objs


def pendant_lamp(rng, loc, color=(1.0, 0.85, 0.6), power=40.0):
    shade = mat_solid("lamp_shade", hsv(rng.random(), 0.6, 0.9), rough=0.4)
    bulb = mat_solid("bulb", (1, 1, 1), emission=color, emission_strength=12)
    x, y, z = loc
    objs = [
        cylinder("lamp_cord", 0.004, 0.8, (x, y, z + 0.45), mat_solid("cord", (0.05, 0.05, 0.05)), role=fm.ROLE_FORBIDDEN),
        cone("lamp_shade", 0.2, 0.05, 0.16, (x, y, z), shade, role=fm.ROLE_FORBIDDEN),
        sphere("bulb", 0.04, (x, y, z - 0.06), bulb, role=fm.ROLE_FORBIDDEN),
    ]
    fm.add_point("lamp_light", (x, y, z - 0.12), power=power, color=color, radius=0.06)
    return objs
