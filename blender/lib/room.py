"""
Realistic room builder: a PBR-textured room filled with hand-picked,
photoscanned Poly Haven furniture and clutter (all CC0), lit by an HDRI plus a
key light, framed by a 16:9 and a 9:16 camera. Scenes only list their assets
(see blender/scenes/s00x_*.py).

Placement:
  1. Furniture is lined up against the back wall, then the side walls.
  2. Wall decor (frames, clocks, mirrors...) hangs on the free back wall.
  3. Clutter is dropped onto real surfaces found by ray casts from several
     heights, so every shelf level and table top gets filled, with clearance
     and spacing checks so nothing intersects.
  4. Floor clutter stays out of the camera's foreground.
"""
from __future__ import annotations

import math
import os
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
    floor_tex: tuple = ("wood_floor",)
    wall_tex: tuple = ("beige_wall_001",)
    floor_tex_scale: float = 0.5
    wall_tex_scale: float = 0.4
    big: tuple = ()
    small: tuple = ()
    floor_small: tuple = ()
    wall_decor: tuple = ()
    hdri: tuple = ("small_empty_room_1",)
    n_big: int = 8
    clutter: int = 170
    floor_clutter: int = 26
    max_per_template: int = 6
    key_rot: tuple = (48, 0, -32)
    key_strength: float = 3.0
    key_color: tuple = (1.0, 0.93, 0.82)
    hdri_strength: float = 1.0
    extra: dict = field(default_factory=dict)


def _size(root):
    lo, hi = assets.bounds(root)
    return hi - lo


def _walk(root):
    stack = [root]
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        yield o


def _hide(root):
    for o in _walk(root):
        o.hide_render = True
        o.hide_viewport = True


def _try_import(aid, **kw):
    try:
        return assets.import_model(aid, **kw)
    except Exception as e:  # an asset without a usable download must not sink the scene
        print(f"[room] import failed for {aid}: {e}")
        return None


def _available(ids, kind="models"):
    cat = assets.catalog(kind)
    missing = [i for i in ids if i not in cat]
    if missing:
        print(f"[room] not on Poly Haven (skipped): {', '.join(missing)}")
    return [i for i in ids if i in cat]


def build_shell(t: Theme, rng: random.Random):
    W, D, H = t.room
    fl = _available(t.floor_tex, "textures")
    wl = _available(t.wall_tex, "textures")
    floor_m = assets.pbr_material(rng.choice(fl), scale=t.floor_tex_scale) if fl else fm.mat_solid("floor", (0.4, 0.3, 0.2))
    wall_m = assets.pbr_material(rng.choice(wl), scale=t.wall_tex_scale) if wl else fm.mat_solid("wall", (0.8, 0.78, 0.74))
    fm.box("floor", (W + 2, D + 2, 0.05), (0, D / 2, -0.025), floor_m)
    fm.box("back_wall", (W + 2, 0.1, H), (0, D + 0.05, H / 2), wall_m)
    fm.box("left_wall", (0.1, D + 2, H), (-W / 2 - 0.05, D / 2, H / 2), wall_m)
    fm.box("right_wall", (0.1, D + 2, H), (W / 2 + 0.05, D / 2, H / 2), wall_m)
    ceil = fm.box("ceiling", (W + 2, D + 2, 0.1), (0, D / 2, H + 0.05), fm.mat_solid("ceil", (0.85, 0.84, 0.82), 0.9),
                  role=fm.ROLE_FORBIDDEN)
    # the key light ("sun through a skylight") passes the ceiling so the room gets real directional light
    ceil.visible_shadow = False
    sk = fm.mat_solid("skirting", (0.82, 0.8, 0.76), 0.4)
    fm.box("skirt_back", (W, 0.02, 0.1), (0, D - 0.01, 0.05), sk, 0.003)
    for sx in (-1, 1):
        fm.box("skirt_side", (0.02, D, 0.1), (sx * (W / 2 - 0.01), D / 2, 0.05), sk, 0.003)


def _move_bbox(root, cx=None, cy=None):
    lo, hi = assets.bounds(root)
    if cx is not None:
        root.location.x += cx - (lo.x + hi.x) / 2
    if cy is not None:
        root.location.y += cy - (lo.y + hi.y) / 2
    bpy.context.view_layer.update()


def place_furniture(t: Theme, rng: random.Random) -> list:
    W, D, H = t.room
    ids = _available(t.big)
    rng.shuffle(ids)
    placed = []
    back = -W / 2 + 0.12
    side = {-1: 1.0, 1: 1.0}  # y cursor along each side wall (keeps the front 1 m clear)
    for aid in ids:
        if len(placed) >= t.n_big:
            break
        root = _try_import(aid)
        if root is None:
            continue
        s = _size(root)
        if not (0.3 <= s.z <= H - 0.25 and max(s.x, s.y) <= 2.8):
            print(f"[room] furniture {aid} rejected, size {s.x:.2f}x{s.y:.2f}x{s.z:.2f}")
            _hide(root)
            continue
        # back of the model against the wall: shallow side along y
        if s.y > s.x:
            root.rotation_euler.z += math.pi / 2
            bpy.context.view_layer.update()
            s = _size(root)
        if back + s.x <= W / 2 - 0.12:
            _move_bbox(root, back + s.x / 2, D - 0.02 - s.y / 2)
            back += s.x + rng.uniform(0.02, 0.12)
        else:
            sd = rng.choice((-1, 1))
            if side[sd] + s.x > D - 0.25:
                sd = -sd
            if side[sd] + s.x > D - 0.25:
                _hide(root)
                continue
            root.rotation_euler.z += math.pi / 2 * sd
            bpy.context.view_layer.update()
            s = _size(root)
            _move_bbox(root, sd * (W / 2 - 0.02 - s.x / 2), side[sd] + s.y / 2)
            side[sd] += s.y + rng.uniform(0.04, 0.15)
        assets.drop_to(root, 0.0)
        placed.append(root)
    print(f"[room] furniture placed: {len(placed)}")
    return placed


def _instance(template, location, rot_z):
    """Linked duplicate of a hierarchy (shares meshes and materials)."""
    mapping = {}
    order = list(_walk(template))
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
    bpy.context.view_layer.update()
    return root


def _templates(ids, rng, max_dim):
    out = []
    for k, aid in enumerate(_available(ids)):
        root = _try_import(aid, location=(0, -60 - k * 2.5, 0))
        if root is None:
            continue
        s = _size(root)
        if max(s.x, s.y, s.z) > max_dim or max(s.x, s.y, s.z) < 0.03:
            print(f"[room] prop {aid} rejected, size {s.x:.2f}x{s.y:.2f}x{s.z:.2f}")
            _hide(root)
            continue
        assets.drop_to(root, 0.0)
        lo, hi = assets.bounds(root)
        _hide(root)
        out.append({"root": root, "r": max(s.x, s.y) / 2, "h": s.z, "id": aid, "n": 0})
    rng.shuffle(out)
    return out


def scatter(t: Theme, rng: random.Random, ids, n: int, *, floor_only=False):
    W, D, H = t.room
    tpls = _templates(ids, rng, 0.95 if floor_only else 0.55)
    if not tpls:
        return 0
    scene = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    down = Vector((0, 0, -1))
    up = Vector((0, 0, 1))
    taken: list[tuple[float, float, float, float]] = []
    count = 0
    tries = 0
    levels = (H - 0.12, 2.0, 1.6, 1.25, 0.95, 0.7, 0.45)
    while count < n and tries < n * 40:
        tries += 1
        choices = [p for p in tpls if p["n"] < t.max_per_template] or tpls
        tp = rng.choice(choices)
        r = tp["r"]
        x = rng.uniform(-W / 2 + 0.1, W / 2 - 0.1)
        if floor_only:
            # keep the foreground clear so the scene reads from the camera
            y = rng.uniform(1.5 if tp["h"] > 0.25 else 1.0, D - 0.15)
            z0 = 0.4
        else:
            y = rng.uniform(0.3, D - 0.05)
            z0 = rng.choice(levels)
        hit, loc, nor, *_ = scene.ray_cast(deps, Vector((x, y, z0)), down)
        if not hit or nor.z < 0.93:
            continue
        on_floor = loc.z < 0.02
        if floor_only != on_floor:
            continue
        # headroom: nothing above for the prop's height (shelf boards above)
        h2, l2, *_ = scene.ray_cast(deps, loc + Vector((0, 0, 0.003)), up, distance=tp["h"] + 0.02)
        if h2:
            continue
        if any(abs(loc.z - z) < 0.15 and math.hypot(loc.x - px, loc.y - py) < r + pr + 0.01 for px, py, z, pr in taken):
            continue
        ok = True
        for a in range(6):
            px = loc.x + math.cos(a * math.pi / 3) * r * 0.9
            py = loc.y + math.sin(a * math.pi / 3) * r * 0.9
            h3, l3, *_ = scene.ray_cast(deps, Vector((px, py, loc.z + 0.05)), down, distance=0.1)
            if not h3 or abs(l3.z - loc.z) > 0.012:
                ok = False
                break
        if not ok:
            continue
        _instance(tp["root"], (loc.x, loc.y, loc.z + 0.001), rng.uniform(0, math.tau))
        tp["n"] += 1
        taken.append((loc.x, loc.y, loc.z, r))
        count += 1
        if count % 8 == 0:
            deps = bpy.context.evaluated_depsgraph_get()
    return count


def hang_decor(t: Theme, rng: random.Random, n: int = 6):
    """Frames, clocks, mirrors on the back wall above furniture."""
    W, D, H = t.room
    ids = _available(t.wall_decor)
    if not ids:
        return 0
    scene = bpy.context.scene
    count = 0
    slots = sorted(rng.uniform(-W / 2 + 0.4, W / 2 - 0.4) for _ in range(n * 3))
    used: list[tuple[float, float]] = []
    bag: list[str] = []
    for x in slots:
        if count >= n:
            break
        if not bag:  # every decor piece once before any repeats
            bag = ids[:]
            rng.shuffle(bag)
        aid = bag.pop()
        root = _try_import(aid)
        if root is None:
            continue
        s = _size(root)
        if max(s.x, s.y, s.z) > 1.3:
            _hide(root)
            continue
        if s.y > s.x:  # thin side against the wall
            root.rotation_euler.z += math.pi / 2
            bpy.context.view_layer.update()
            s = _size(root)
        # highest furniture top under this x, so decor hangs above it
        deps = bpy.context.evaluated_depsgraph_get()
        hit, loc, *_ = scene.ray_cast(deps, Vector((x, D - 0.08, H - 0.12)), Vector((0, 0, -1)))
        base = loc.z if hit else 0
        zc = max(base + s.z / 2 + 0.12, 1.45)
        if zc + s.z / 2 > H - 0.1 or any(abs(x - ux) < (s.x + uw) / 2 + 0.1 for ux, uw in used):
            _hide(root)
            continue
        _move_bbox(root, x, D - 0.005 - s.y / 2)
        lo, hi = assets.bounds(root)
        root.location.z += zc - (lo.z + hi.z) / 2
        used.append((x, s.x))
        count += 1
    return count


def light(t: Theme, rng: random.Random):
    hd = _available(t.hdri, "hdris")
    if hd:
        assets.use_hdri(rng.choice(hd), strength=t.hdri_strength, rotation=rng.uniform(0, math.tau))
    else:
        fm.set_world((0.7, 0.72, 0.78), 0.8)
    sun = fm.add_sun("key_sun", t.key_rot, strength=t.key_strength, color=t.key_color, angle_deg=3)
    W, D, H = t.room
    fm.add_area("ceiling_soft", (0, D / 2, H - 0.06), (0, D / 2, 0), size=min(W, D) * 0.7,
                power=55 * W * D, color=(1.0, 0.96, 0.9))
    fm.add_area("front_fill", (0, -1.6, 1.7), (0, D * 0.6, 0.8), size=2.8, power=260, color=(0.93, 0.96, 1.0))
    return sun


def cameras(t: Theme):
    W, D, H = t.room
    return {
        "landscape": fm.add_camera("cam_landscape", (0.0, -0.25, 1.5), (0.0, D * 0.78, 0.85), focal_mm=24),
        "portrait": fm.add_camera("cam_portrait", (0.25, 0.35, 1.4), (0.05, D * 0.85, 0.8), focal_mm=22),
    }


def build_and_export(t: Theme):
    args = fm.parse_args()
    seed = args.seed if args.seed is not None else t.seed
    rng = random.Random(seed)
    scene = fm.reset_scene()
    build_shell(t, rng)
    place_furniture(t, rng)
    nd = hang_decor(t, rng)
    n1 = scatter(t, rng, t.small, t.clutter)
    n2 = scatter(t, rng, t.floor_small or t.small, t.floor_clutter, floor_only=True)
    print(f"[room] {t.scene_id}: {n1} surface props, {n2} floor props, {nd} wall decor, {len(assets.USED)} assets")
    sun = light(t, rng)
    spec = fm.SceneSpec(
        scene_id=t.scene_id, title_en=t.title_en, title_ar=t.title_ar, theme=t.theme, seed=seed,
        key_light=sun, ambient=(0.62, 0.64, 0.68), cameras=cameras(t), character_height_m=0.37,
    )
    fm.export_scene(scene, spec, args)
    assets.write_credits(os.path.join(args.out, "scenes", t.scene_id, "credits.json"))
