"""
FIND ME — shared Blender helpers (Blender 4.2 LTS, run headless).

Everything here is called from generator scripts as:
    blender -b --factory-startup --python blender/scenes/s001_toy_shop.py -- --out build/art --preview

Conventions
- Units are metres. +Z up. Cameras look roughly along +Y.
- Data passes are written by the compositor as single-layer float EXR, then
  re-loaded inside Blender and saved as .npy so the packer (plain Python +
  numpy) never needs an EXR library.
- Every random choice goes through a seeded random.Random, so a scene is
  reproducible from its script + seed.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import random
import sys
from dataclasses import dataclass, field

import bpy  # type: ignore
import numpy as np
from mathutils import Matrix, Vector  # type: ignore

CREDIT = "Mohsen ~ Danial"

# Object roles -> pass_index (read back from the IndexOB pass).
ROLE_SURFACE = 1  # normal scene geometry: can be hidden on / behind
ROLE_FORBIDDEN = 2  # sky, windows, lamps: no hiding here
# pass_index 0 = nothing rendered (world background) -> treated as forbidden


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def parse_args(extra=None) -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="build/art", help="output root")
    p.add_argument("--preview", action="store_true", help="low res + low samples, for quick checks")
    p.add_argument("--master", action="store_true", help="also render the 8K marketing master")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--orient", choices=["landscape", "portrait", "both"], default="both")
    if extra:
        extra(p)
    return p.parse_args(argv)


# --------------------------------------------------------------------------
# Scene / render setup
# --------------------------------------------------------------------------
def reset_scene() -> bpy.types.Scene:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.unit_settings.system = "METRIC"
    _enable_gpu(scene)
    return scene


def _enable_gpu(scene) -> None:
    """Use a GPU when one exists (local machines); CI falls back to CPU."""
    scene.cycles.device = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        return
    for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
        except Exception:
            continue
        gpus = [d for d in prefs.devices if d.type != "CPU"]
        if gpus:
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = "GPU"
            print(f"[fm] rendering on {kind}: {', '.join(d.name for d in gpus)}")
            return
    print("[fm] rendering on CPU")


def set_color_management(scene, look: str = "AgX - Punchy") -> None:
    vs = scene.view_settings
    vs.view_transform = "AgX"
    try:
        vs.look = look
    except TypeError:
        vs.look = "None"
    vs.exposure = 0.0
    vs.gamma = 1.0


def configure_render(scene, width: int, height: int, samples: int, *, transparent=False, data_only=False) -> None:
    r = scene.render
    r.resolution_x = width
    r.resolution_y = height
    r.resolution_percentage = 100
    r.film_transparent = transparent
    r.use_compositing = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA" if transparent else "RGB"
    r.image_settings.color_depth = "8"
    c = scene.cycles
    c.samples = samples
    c.use_adaptive_sampling = True
    c.use_denoising = not data_only
    if not data_only:
        try:
            c.denoiser = "OPENIMAGEDENOISE"
        except TypeError:
            pass
    c.max_bounces = 8
    c.diffuse_bounces = 4
    c.glossy_bounces = 4
    c.transparent_max_bounces = 8
    # Data renders: no pixel filter, so pass values are never blended across edges.
    c.filter_width = 0.01 if data_only else 1.5


def enable_passes(view_layer, *, depth=True, normal=True, index=True, uv=False, ao=False) -> None:
    view_layer.use_pass_z = depth
    view_layer.use_pass_normal = normal
    view_layer.use_pass_object_index = index
    view_layer.use_pass_uv = uv
    view_layer.use_pass_ambient_occlusion = ao


# --------------------------------------------------------------------------
# Compositor: write each requested pass as a float EXR
# --------------------------------------------------------------------------
PASS_SOCKETS = {
    "depth": ("Depth", "BW"),
    "normal": ("Normal", "RGB"),
    "index": ("IndexOB", "BW"),
    "uv": ("UV", "RGB"),
    "ao": ("AO", "RGB"),
    "alpha": ("Alpha", "BW"),
}


def setup_pass_outputs(scene, out_dir: str, passes: list[str]) -> None:
    scene.use_nodes = True
    tree = scene.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    rl = tree.nodes.new("CompositorNodeRLayers")
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], comp.inputs["Image"])

    fo = tree.nodes.new("CompositorNodeOutputFile")
    fo.base_path = out_dir
    fo.format.file_format = "OPEN_EXR"
    fo.format.color_depth = "32"
    fo.format.exr_codec = "ZIP"
    for i, name in enumerate(passes):
        socket_name, mode = PASS_SOCKETS[name]
        if i == 0:
            slot = fo.file_slots[0]
            slot.path = f"{name}_"
        else:
            slot = fo.file_slots.new(f"{name}_")
        slot.use_node_format = False
        slot.format.file_format = "OPEN_EXR"
        slot.format.color_depth = "32"
        slot.format.color_mode = mode
        tree.links.new(rl.outputs[socket_name], fo.inputs[i])


def load_exr(path: str, channels: int) -> np.ndarray:
    """Load an EXR through Blender itself -> float32 array, top row first."""
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    arr = buf.reshape(h, w, 4)[::-1]  # Blender stores bottom row first
    return np.ascontiguousarray(arr[..., :channels] if channels > 1 else arr[..., 0])


def collect_pass(out_dir: str, name: str, channels: int) -> np.ndarray:
    hits = sorted(glob.glob(os.path.join(out_dir, f"{name}_*.exr")))
    if not hits:
        raise RuntimeError(f"pass '{name}' was not written to {out_dir}")
    arr = load_exr(hits[-1], channels)
    for h in hits:
        os.remove(h)
    return arr


def render_still(scene, beauty_path: str | None) -> None:
    if beauty_path:
        os.makedirs(os.path.dirname(beauty_path), exist_ok=True)
        scene.render.filepath = beauty_path
        bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(write_still=False)


# --------------------------------------------------------------------------
# Cameras & light metadata
# --------------------------------------------------------------------------
def look_at(obj, target) -> None:
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def add_camera(name: str, location, target, focal_mm: float = 35.0, sensor_mm: float = 36.0):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = focal_mm
    cam_data.sensor_width = sensor_mm
    cam_data.sensor_fit = "AUTO"
    cam_data.clip_start = 0.05
    cam_data.clip_end = 200.0
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = location
    look_at(cam, target)
    return cam


def focal_px(cam, width: int, height: int) -> float:
    """Focal length in pixels (sensor_fit AUTO fits the larger dimension)."""
    d = cam.data
    return d.lens / d.sensor_width * max(width, height)


def to_camera_space(cam, v: Vector) -> list[float]:
    """World direction -> camera space (x right, y up, z toward viewer)."""
    r = cam.matrix_world.to_3x3().normalized().inverted()
    c = (r @ Vector(v)).normalized()
    return [round(c.x, 5), round(c.y, 5), round(c.z, 5)]


def sun_direction_world(sun) -> Vector:
    """Unit vector pointing from the scene toward the sun."""
    travel = sun.matrix_world.to_3x3() @ Vector((0, 0, -1))
    return (-travel).normalized()


# --------------------------------------------------------------------------
# Lighting rigs
# --------------------------------------------------------------------------
def add_sun(name, rotation_deg, strength=3.0, color=(1.0, 0.95, 0.88), angle_deg=3.0):
    d = bpy.data.lights.new(name, "SUN")
    d.energy = strength
    d.color = color
    d.angle = math.radians(angle_deg)
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = [math.radians(a) for a in rotation_deg]
    return o


def add_area(name, location, target, size=1.0, power=200.0, color=(1, 1, 1), shape="RECTANGLE", size_y=None):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.color = color
    d.shape = shape
    d.size = size
    if size_y is not None:
        d.size_y = size_y
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = location
    look_at(o, target)
    return o


def add_point(name, location, power=50.0, color=(1, 0.8, 0.5), radius=0.05):
    d = bpy.data.lights.new(name, "POINT")
    d.energy = power
    d.color = color
    d.shadow_soft_size = radius
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = location
    return o


def set_world(color=(0.6, 0.7, 0.85), strength=0.6) -> None:
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*color, 1.0)
    bg.inputs["Strength"].default_value = strength
    w.light_settings.distance = 0.2  # AO pass reach


# --------------------------------------------------------------------------
# Materials — a small procedural pattern library
# --------------------------------------------------------------------------
def hsv(h, s, v):
    import colorsys

    r, g, b = colorsys.hsv_to_rgb(h % 1.0, max(0, min(1, s)), max(0, min(1, v)))
    # sRGB -> linear, since Blender colour sockets are linear
    return tuple(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92 for c in (r, g, b))


def _principled(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    return nt, bsdf


def mat_solid(name, color, rough=0.5, metal=0.0, coat=0.0, emission=None, emission_strength=0.0):
    m = bpy.data.materials.new(name)
    nt, b = _principled(m)
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = emission_strength
    return m


def mat_pattern(name, kind, colors, scale=10.0, rough=0.5, rotation=0.0, extra=None):
    """
    kind: stripes | checker | dots | noise | bricks | waves | grain | tiles | plaid | stars
    colors: list of linear RGB tuples (2–3).
    """
    m = bpy.data.materials.new(name)
    nt, b = _principled(m)
    N = nt.nodes
    L = nt.links
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value[2] = rotation
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    L.new(tc.outputs["Object"], mp.inputs["Vector"])
    vec = mp.outputs["Vector"]
    c0, c1 = colors[0], colors[1]
    c2 = colors[2] if len(colors) > 2 else colors[0]

    def ramp(fac_socket, stops):
        cr = N.new("ShaderNodeValToRGB")
        el = cr.color_ramp.elements
        el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1)
        el[1].position, el[1].color = stops[1][0], (*stops[1][1], 1)
        for pos, col in stops[2:]:
            e = el.new(pos)
            e.color = (*col, 1)
        cr.color_ramp.interpolation = "CONSTANT"
        L.new(fac_socket, cr.inputs["Fac"])
        return cr.outputs["Color"]

    if kind == "stripes":
        w = N.new("ShaderNodeTexWave")
        w.wave_type = "BANDS"
        w.bands_direction = "X"
        w.inputs["Scale"].default_value = 1.0
        L.new(vec, w.inputs["Vector"])
        col = ramp(w.outputs["Fac"], [(0.0, c0), (0.5, c1)] + ([(0.8, c2)] if len(colors) > 2 else []))
    elif kind == "checker" or kind == "tiles":
        ch = N.new("ShaderNodeTexChecker")
        ch.inputs["Color1"].default_value = (*c0, 1)
        ch.inputs["Color2"].default_value = (*c1, 1)
        ch.inputs["Scale"].default_value = 1.0
        L.new(vec, ch.inputs["Vector"])
        col = ch.outputs["Color"]
        if kind == "tiles":
            br = N.new("ShaderNodeTexBrick")
            br.inputs["Color1"].default_value = (1, 1, 1, 1)
            br.inputs["Color2"].default_value = (1, 1, 1, 1)
            br.inputs["Mortar"].default_value = (*c2, 1)
            br.inputs["Scale"].default_value = 1.0
            br.inputs["Mortar Size"].default_value = 0.01
            br.offset = 0.0
            br.inputs["Brick Width"].default_value = 1.0
            br.inputs["Row Height"].default_value = 1.0
            L.new(vec, br.inputs["Vector"])
            mix = N.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            L.new(col, mix.inputs[6])
            L.new(br.outputs["Color"], mix.inputs[7])
            col = mix.outputs[2]
    elif kind == "dots":
        v = N.new("ShaderNodeTexVoronoi")
        v.feature = "DISTANCE_TO_EDGE" if extra == "cells" else "F1"
        v.inputs["Scale"].default_value = 1.0
        v.inputs["Randomness"].default_value = 0.0
        L.new(vec, v.inputs["Vector"])
        col = ramp(v.outputs["Distance"], [(0.0, c1), (0.28, c0)])
    elif kind == "noise":
        n = N.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Detail"].default_value = 6.0
        L.new(vec, n.inputs["Vector"])
        cr = N.new("ShaderNodeValToRGB")
        cr.color_ramp.elements[0].color = (*c0, 1)
        cr.color_ramp.elements[1].color = (*c1, 1)
        cr.color_ramp.elements[0].position = 0.35
        cr.color_ramp.elements[1].position = 0.65
        L.new(n.outputs["Fac"], cr.inputs["Fac"])
        col = cr.outputs["Color"]
    elif kind == "bricks":
        br = N.new("ShaderNodeTexBrick")
        br.inputs["Color1"].default_value = (*c0, 1)
        br.inputs["Color2"].default_value = (*c1, 1)
        br.inputs["Mortar"].default_value = (*c2, 1)
        br.inputs["Scale"].default_value = 1.0
        L.new(vec, br.inputs["Vector"])
        col = br.outputs["Color"]
    elif kind == "waves":
        w = N.new("ShaderNodeTexWave")
        w.wave_type = "RINGS" if extra == "rings" else "BANDS"
        w.inputs["Scale"].default_value = 1.0
        w.inputs["Distortion"].default_value = 4.0
        L.new(vec, w.inputs["Vector"])
        col = ramp(w.outputs["Fac"], [(0.0, c0), (0.5, c1)])
    elif kind == "grain":  # wood
        w = N.new("ShaderNodeTexWave")
        w.wave_type = "BANDS"
        w.bands_direction = "X"
        w.inputs["Scale"].default_value = 1.0
        w.inputs["Distortion"].default_value = 8.0
        w.inputs["Detail"].default_value = 4.0
        L.new(vec, w.inputs["Vector"])
        cr = N.new("ShaderNodeValToRGB")
        cr.color_ramp.elements[0].color = (*c0, 1)
        cr.color_ramp.elements[1].color = (*c1, 1)
        L.new(w.outputs["Fac"], cr.inputs["Fac"])
        col = cr.outputs["Color"]
    elif kind == "plaid":
        sep = N.new("ShaderNodeSeparateXYZ")
        L.new(vec, sep.inputs["Vector"])
        cols = []
        for axis in ("X", "Y"):
            mo = N.new("ShaderNodeMath")
            mo.operation = "PINGPONG"
            mo.inputs[1].default_value = 0.5
            L.new(sep.outputs[axis], mo.inputs[0])
            cols.append(mo.outputs[0])
        add = N.new("ShaderNodeMath")
        add.operation = "ADD"
        L.new(cols[0], add.inputs[0])
        L.new(cols[1], add.inputs[1])
        col = ramp(add.outputs[0], [(0.0, c0), (0.45, c1), (0.75, c2)])
    else:  # stars / fallback: magic texture
        mg = N.new("ShaderNodeTexMagic")
        mg.turbulence_depth = 2
        L.new(vec, mg.inputs["Vector"])
        col = ramp(mg.outputs["Fac"], [(0.0, c0), (0.5, c1)])

    L.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    return m


def random_pattern(rng: random.Random, name: str, palette_h=None):
    """A random cheerful patterned material."""
    h = rng.random() if palette_h is None else palette_h + rng.uniform(-0.06, 0.06)
    kinds = ["stripes", "checker", "dots", "noise", "waves", "plaid", "stars", "tiles"]
    kind = rng.choice(kinds)
    a = hsv(h, rng.uniform(0.45, 0.9), rng.uniform(0.6, 0.95))
    b = hsv(h + rng.choice([0.08, 0.33, 0.5, 0.58]), rng.uniform(0.3, 0.9), rng.uniform(0.7, 1.0))
    c = hsv(h + 0.15, 0.4, 0.95)
    return mat_pattern(name, kind, [a, b, c], scale=rng.uniform(6, 30), rough=rng.uniform(0.3, 0.7),
                       rotation=rng.choice([0, 0, math.pi / 4, math.pi / 2]))


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------
def link(obj, role=ROLE_SURFACE):
    if obj.name not in bpy.context.scene.collection.objects:
        try:
            bpy.context.scene.collection.objects.link(obj)
        except RuntimeError:
            pass
    obj.pass_index = role
    return obj


def box(name, size, location, mat=None, bevel=0.0, rotation=(0, 0, 0), role=ROLE_SURFACE):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = 3
        m.limit_method = "ANGLE"
    if mat:
        o.data.materials.append(mat)
    o.pass_index = role
    return o


def sphere(name, radius, location, mat=None, scale=(1, 1, 1), segments=32, role=ROLE_SURFACE):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=segments // 2, radius=radius, location=location)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.shade_smooth()
    if mat:
        o.data.materials.append(mat)
    o.pass_index = role
    return o


def cylinder(name, radius, depth, location, mat=None, rotation=(0, 0, 0), vertices=32, role=ROLE_SURFACE, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_smooth()
    if bevel > 0:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = 2
        m.limit_method = "ANGLE"
    if mat:
        o.data.materials.append(mat)
    o.pass_index = role
    return o


def torus(name, major, minor, location, mat=None, rotation=(0, 0, 0), role=ROLE_SURFACE):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_smooth()
    if mat:
        o.data.materials.append(mat)
    o.pass_index = role
    return o


def cone(name, r1, r2, depth, location, mat=None, rotation=(0, 0, 0), role=ROLE_SURFACE):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_smooth()
    if mat:
        o.data.materials.append(mat)
    o.pass_index = role
    return o


def plane(name, size, location, mat=None, rotation=(0, 0, 0), role=ROLE_SURFACE):
    bpy.ops.mesh.primitive_plane_add(size=1, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        o.data.materials.append(mat)
    o.pass_index = role
    return o


# --------------------------------------------------------------------------
# Scene export: beauty + data passes + metadata, per camera
# --------------------------------------------------------------------------
@dataclass
class SceneSpec:
    scene_id: str
    title_en: str
    title_ar: str
    theme: str
    seed: int
    key_light: object  # sun object
    ambient: tuple = (0.6, 0.65, 0.75)
    cameras: dict = field(default_factory=dict)  # orient -> camera object
    character_height_m: float = 0.34


RES = {
    "landscape": (2560, 1440),
    "portrait": (1440, 2560),
}


def export_scene(scene, spec: SceneSpec, args) -> None:
    root = os.path.join(args.out, "scenes", spec.scene_id)
    orients = ["landscape", "portrait"] if args.orient == "both" else [args.orient]
    set_color_management(scene)
    for orient in orients:
        cam = spec.cameras[orient]
        scene.camera = cam
        w, h = RES[orient]
        samples = 384
        if args.preview:
            w, h, samples = w // 4, h // 4, 32
        out = os.path.join(root, orient)
        os.makedirs(out, exist_ok=True)
        configure_render(scene, w, h, samples)
        enable_passes(scene.view_layers[0], depth=True, normal=True, index=True)
        setup_pass_outputs(scene, out, ["depth", "normal", "index"])
        render_still(scene, os.path.join(out, "beauty.png"))

        depth = collect_pass(out, "depth", 1)
        normal = collect_pass(out, "normal", 3)
        index = collect_pass(out, "index", 1)
        # World-space normals -> camera space
        rot = np.array(cam.matrix_world.to_3x3().normalized().inverted())
        ncam = normal.reshape(-1, 3) @ rot.T
        np.save(os.path.join(out, "depth.npy"), depth.astype(np.float32))
        np.save(os.path.join(out, "normal.npy"), ncam.reshape(normal.shape).astype(np.float16))
        np.save(os.path.join(out, "index.npy"), np.rint(index).clip(0, 255).astype(np.uint8))

        key = spec.key_light
        meta = {
            "sceneId": spec.scene_id,
            "title": {"en": spec.title_en, "ar": spec.title_ar},
            "theme": spec.theme,
            "seed": spec.seed,
            "orientation": orient,
            "width": w,
            "height": h,
            "focalPx": focal_px(cam, w, h),
            "characterHeightM": spec.character_height_m,
            "keyLight": {
                "dirCam": to_camera_space(cam, sun_direction_world(key)),
                "color": [round(c, 4) for c in key.data.color],
                "strength": key.data.energy,
            },
            "ambient": list(spec.ambient),
            "roles": {"0": "forbidden", str(ROLE_SURFACE): "surface", str(ROLE_FORBIDDEN): "forbidden"},
            "credit": CREDIT,
            "generator": os.path.relpath(sys.argv[sys.argv.index("--python") + 1]) if "--python" in sys.argv else "",
        }
        with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
        print(f"[fm] {spec.scene_id}/{orient}: {w}x{h} done")

    if args.master and not args.preview:
        scene.camera = spec.cameras["landscape"]
        configure_render(scene, 7680, 4320, 1024)
        scene.use_nodes = False
        render_still(scene, os.path.join(root, "master_8k.png"))
