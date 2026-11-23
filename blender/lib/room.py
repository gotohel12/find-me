"""
Realistic room builder: a PBR-textured room filled with photoscanned Poly Haven
furniture and clutter, lit by an HDRI plus a key light, framed by a 16:9 and a
9:16 camera. Scenes only describe their theme (see blender/scenes/s00x_*.py).

Placement:
  1. Furniture ("big" models) is lined up against the back and side walls.
  2. Clutter ("small" models) is dropped onto real surfaces found by ray casts
     from above (table tops, counters, shelf tops, the floor), with spacing so
     nothing intersects.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

import assets
import fm


@dataclass
class Theme:
    scene_id: str
    title_en: str
    title_ar: str
    theme: str
    seed: int
    room: tuple = (5.0, 4.2, 2.8)  # width (x), depth (y), height (z)
    floor_words: tuple = ("wood_floor", "planks")
    wall_words: tuple = ("plaster", "painted")
    big_words: tuple = ("table", "shelf", "cabinet")
    small_words: tuple = ("bottle", "jar", "box")
    floor_small_words: tuple = ()
    hdri_words: tuple = ("interior",)
    n_big: int = 6
    n_small_types: int = 18
    clutter: int = 70
    floor_clutter: int = 14
    key_rot: tuple = (50, 0, -35)
    key_strength: float = 2.2
    key_color: tuple = (1.0, 0.93, 0.82)
    hdri_strength: float = 0.9
    extra: dict = field(default_factory=dict)


def _size(root):
    lo, hi = assets.bounds(root)
    return hi - lo


def _hide(root):
    stack = [root]
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        o.hide_render = True
        o.hide_viewport = True


def _models(words, rng, k, *, min_dim=0.0, max_dim=99.0, exclude=("tree", "rock", "cliff", "terrain")):
    ids = assets.find("models", name_has=words, exclude_tags=exclude)
    rng.shuffle(ids)
    return ids[: k * 3]  # extra candidates: some get rejected by size


def build_shell(t: Theme, rng: random.Random):
    W, D, H = t.room
    fl = assets.find("textures", name_has=t.floor_words)
    wl = assets.find("textures", name_has=t.wall_words)
    floor_m = assets.pbr_material(rng.choice(fl), scale=0.6) if fl else fm.mat_solid("floor", (0.4, 0.3, 0.2))
    wall_m = assets.pbr_material(rng.choice(wl), scale=0.5) if wl else fm.mat_solid("wall", (0.8, 0.78, 0.74))
    fm.box("floor", (W + 2, D + 2, 0.05), (0, D / 2, -0.025), floor_m)
    fm.box("back_wall", (W + 2, 0.1, H), (0, D + 0.05, H / 2), wall_m)
    fm.box("left_wall", (0.1, D + 2, H), (-W / 2 - 0.05, D / 2, H / 2), wall_m)
    fm.box("right_wall", (0.1, D + 2, H), (W / 2 + 0.05, D / 2, H / 2), wall_m)
    fm.box("ceiling", (W + 2, D + 2, 0.1), (0, D / 2, H + 0.05), fm.mat_solid("ceil", (0.85, 0.84, 0.82), 0.9),
           role=fm.ROLE_FORBIDDEN)
    # skirting boards: a real-room detail that also gives a crisp floor line
    sk = fm.mat_solid("skirting", (0.82, 0.8, 0.76), 0.4)
    fm.box("skirt_back", (W, 0.02, 0.1), (0, D - 0.01, 0.05), sk, 0.003)
    for sx in (-1, 1):
        fm.box("skirt_side", (0.02, D, 0.1), (sx * (W / 2 - 0.01), D / 2, 0.05), sk, 0.003)


def place_furniture(t: Theme, rng: random.Random) -> list:
    W, D, H = t.room
    placed = []
    # slots: along back wall (facing camera = rot 0 means model front is -Y in glTF? Poly Haven models face +Y/-Y
    # inconsistently, so we pick the rotation that puts the long side along the wall)
    cursor_back = -W / 2 + 0.15
    cursor_left = 0.6
    cursor_right = 0.6
    for aid in _models(t.big_words, rng, t.n_big):
        if len(placed) >= t.n_big:
            break
        root = assets.import_model(aid)
        s = _size(root)
        if not (0.45 <= s.z <= H - 0.3 and max(s.x, s.y) <= 2.6 and min(s.x, s.y) >= 0.25):
            _hide(root)
            continue
        # long side along the wall
        if s.y > s.x:
            root.rotation_euler.z += math.pi / 2
            bpy.context.view_layer.update()
            s = _size(root)
        if cursor_back + s.x <= W / 2 - 0.15:
            x = cursor_back + s.x / 2
            cursor_back += s.x + rng.uniform(0.03, 0.15)
            lo, hi = assets.bounds(root)
            root.location.x += x - (lo.x + hi.x) / 2
            root.location.y += (D - 0.03 - s.y / 2) - (lo.y + hi.y) / 2
        else:
            side = rng.choice((-1, 1))
            cur = cursor_left if side < 0 else cursor_right
            if cur + s.x > D - 0.6:
                _hide(root)
                continue
            root.rotation_euler.z += math.pi / 2
            bpy.context.view_layer.update()
            s = _size(root)
            lo, hi = assets.bounds(root)
            y = cur + s.y / 2
            root.location.y += y - (lo.y + hi.y) / 2
            root.location.x += side * (W / 2 - 0.03 - s.x / 2) - (lo.x + hi.x) / 2
            if side < 0:
                cursor_left += s.y + 0.1
            else:
                cursor_right += s.y + 0.1
        assets.drop_to(root, 0.0)
        placed.append(root)
    return placed


def _instance(template, location, rot_z, scale=1.0):
    """Linked duplicate of a hierarchy (cheap, shares meshes/materials)."""
    mapping = {}
    stack = [template]
    order = []
    while stack:
        o = stack.pop()
        order.append(o)
        stack.extend(o.children)
    for o in order:
        n = o.copy()
        n.hide_render = False
        n.hide_viewport = False
        bpy.context.scene.collection.objects.link(n)
        mapping[o] = n
    for o in order:
        if o.parent in mapping:
            mapping[o].parent = mapping[o.parent]
    root = mapping[template]
    root.location = location
    root.rotation_euler = (0, 0, rot_z)
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    return root


def scatter_clutter(t: Theme, rng: random.Random, n: int, words, *, floor_only=False):
    W, D, H = t.room
    templates = []
    for aid in _models(words, rng, t.n_small_types):
        if len(templates) >= t.n_small_types:
            break
        root = assets.import_model(aid, location=(0, -50 - len(templates) * 3, 0))
        s = _size(root)
        if max(s.x, s.y, s.z) > (0.9 if floor_only else 0.5) or max(s.x, s.y, s.z) < 0.04:
            _hide(root)
            continue
        assets.drop_to(root, 0.0)
        _hide(root)
        templates.append((root, max(s.x, s.y) / 2))
    if not templates:
        return 0
    deps = bpy.context.evaluated_depsgraph_get()
    taken: list[tuple[float, float, float, float]] = []  # x, y, z, r
    count = 0
    tries = 0
    while count < n and tries < n * 30:
        tries += 1
        tpl, r = rng.choice(templates)
        x = rng.uniform(-W / 2 + 0.15, W / 2 - 0.15)
        y = rng.uniform(0.6 if floor_only else 0.25, D - 0.1)
        hit, loc, nor, *_ = bpy.context.scene.ray_cast(deps, Vector((x, y, H - 0.15)), Vector((0, 0, -1)))
        if not hit or nor.z < 0.92:
            continue
        on_floor = loc.z < 0.02
        if floor_only != on_floor:
            continue
        if any(abs(loc.z - z) < 0.2 and math.hypot(loc.x - px, loc.y - py) < r + pr + 0.015 for px, py, z, pr in taken):
            continue
        # keep the whole footprint on the surface: probe 4 points at radius r
        ok = True
        for a in range(4):
            px = loc.x + math.cos(a * math.pi / 2) * r
            py = loc.y + math.sin(a * math.pi / 2) * r
            h2, l2, n2, *_ = bpy.context.scene.ray_cast(deps, Vector((px, py, H - 0.15)), Vector((0, 0, -1)))
            if not h2 or abs(l2.z - loc.z) > 0.01:
                ok = False
                break
        if not ok:
            continue
        _instance(tpl, (loc.x, loc.y, loc.z + 0.001), rng.uniform(0, math.tau))
        taken.append((loc.x, loc.y, loc.z, r))
        count += 1
        if count % 10 == 0:
            deps = bpy.context.evaluated_depsgraph_get()
    return count


def light(t: Theme, rng: random.Random):
    hd = assets.find("hdris", name_has=t.hdri_words)
    if hd:
        assets.use_hdri(rng.choice(hd), strength=t.hdri_strength, rotation=rng.uniform(0, math.tau))
    else:
        fm.set_world((0.7, 0.72, 0.78), 0.8)
    sun = fm.add_sun("key_sun", t.key_rot, strength=t.key_strength, color=t.key_color, angle_deg=4)
    W, D, H = t.room
    fm.add_area("ceiling_soft", (0, D / 2, H - 0.05), (0, D / 2, 0), size=min(W, D) * 0.8,
                power=120 * W * D / 20, color=(1.0, 0.96, 0.9))
    fm.add_area("front_fill", (0, -1.5, 1.6), (0, D * 0.6, 0.8), size=2.5, power=220, color=(0.92, 0.95, 1.0))
    return sun


def cameras(t: Theme):
    W, D, H = t.room
    return {
        "landscape": fm.add_camera("cam_landscape", (0.0, -0.35, 1.45), (0.0, D * 0.75, 0.75), focal_mm=24),
        "portrait": fm.add_camera("cam_portrait", (0.2, 0.15, 1.35), (0.1, D * 0.8, 0.7), focal_mm=24),
    }


def build_and_export(t: Theme):
    args = fm.parse_args()
    seed = args.seed if args.seed is not None else t.seed
    rng = random.Random(seed)
    scene = fm.reset_scene()
    build_shell(t, rng)
    place_furniture(t, rng)
    n1 = scatter_clutter(t, rng, t.clutter, t.small_words)
    n2 = scatter_clutter(t, rng, t.floor_clutter, t.floor_small_words or t.small_words, floor_only=True)
    print(f"[room] {t.scene_id}: {n1} surface props, {n2} floor props, {len(assets.USED)} assets")
    sun = light(t, rng)
    spec = fm.SceneSpec(
        scene_id=t.scene_id, title_en=t.title_en, title_ar=t.title_ar, theme=t.theme, seed=seed,
        key_light=sun, ambient=(0.62, 0.64, 0.68), cameras=cameras(t), character_height_m=0.37,
    )
    fm.export_scene(scene, spec, args)
    import os

    assets.write_credits(os.path.join(args.out, "scenes", t.scene_id, "credits.json"))
