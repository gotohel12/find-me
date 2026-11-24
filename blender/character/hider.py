"""
The hider — FIND ME's little white figure — and all its poses.

Run:
    blender -b --factory-startup --python blender/character/hider.py -- --out build/art [--preview] [--poses stand,sit]

Output per pose and angle (build/art/character/<pose>/<angle>/):
    shade.png   white figure, studio lit (menus, thumbnails, 3D-looking UI)
    uv.npy      float32 HxWx2  paint-texture UV per pixel
    part.npy    uint8   HxW    body part id (1 head, 2 body, 3 arms, 4 legs, 5 antenna)
    normal.npy  float16 HxWx3  camera-space normals (scene-matched relighting in the shader)
    ao.npy      float16 HxW    ambient occlusion
    alpha.npy   float16 HxW    coverage
    meta.json   pixels-per-metre, anchor hints, pose + angle

Design: the figure is built from rigid smooth parts (head, body, two arms, two
legs, antenna) hung on joint empties. Each part owns a fixed rectangle of the
shared 256×256 paint texture, so paint lands on the same spot of the body
in every pose and every angle.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import bpy  # type: ignore
import numpy as np
from mathutils import Vector  # type: ignore

import fm  # noqa: E402

# ---------------------------------------------------------------- atlas
# part -> (part id, UV rect u0, v0, u1, v1) inside the paint texture
ATLAS = {
    "head": (1, 0.00, 0.50, 0.50, 1.00),
    "body": (2, 0.50, 0.50, 1.00, 1.00),
    "arm_l": (3, 0.00, 0.25, 0.25, 0.50),
    "arm_r": (3, 0.25, 0.25, 0.50, 0.50),
    "leg_l": (4, 0.50, 0.25, 0.75, 0.50),
    "leg_r": (4, 0.75, 0.25, 1.00, 0.50),
    "antenna": (5, 0.00, 0.00, 0.25, 0.25),
}
PART_NAMES = {1: "head", 2: "body", 3: "arms", 4: "legs", 5: "antenna"}

# ---------------------------------------------------------------- dimensions (metres)
HEAD_R = 0.075
HEAD_Z = 0.215
BODY = (0.062, 0.052, 0.068)  # ellipsoid radii
BODY_Z = 0.105
ARM = (0.022, 0.022, 0.056)
LEG = (0.027, 0.027, 0.036)
SHOULDER = (0.058, 0.0, 0.140)
HIP = (0.030, 0.0, 0.050)
NECK = (0.0, 0.0, 0.160)
ANT_BASE = (0.0, 0.0, HEAD_Z + HEAD_R - 0.006)

ANGLES = {"front": 0, "q_left": 45, "side": 90, "q_right": -45, "back": 180}

# Joint rotations in degrees (X = swing forward(+)/back(-), Y = out to the side, Z = twist).
# root: whole-body rotation; lean: body+head about the hips; neck: head about the neck.
POSES = {
    "stand": {},
    "sit": {"leg_l": (85, 6, 0), "leg_r": (85, -6, 0), "arm_l": (20, 10, 0), "arm_r": (20, -10, 0)},
    "ball": {"lean": (35, 0, 0), "neck": (25, 0, 0), "leg_l": (110, 0, 0), "leg_r": (110, 0, 0),
             "arm_l": (95, -20, 0), "arm_r": (95, 20, 0)},
    "lying": {"root": (-90, 0, 0), "arm_l": (0, 25, 0), "arm_r": (0, -25, 0)},
    "wall": {"arm_l": (0, 70, 0), "arm_r": (0, -70, 0), "leg_l": (0, 12, 0), "leg_r": (0, -12, 0)},
    "peek": {"lean": (0, -28, 0), "neck": (0, -12, 0), "arm_l": (0, 40, 0), "arm_r": (30, -10, 0)},
    "arms_up": {"arm_l": (0, 160, 0), "arm_r": (0, -160, 0)},
    "hug_knees": {"lean": (20, 0, 0), "leg_l": (140, 0, 0), "leg_r": (140, 0, 0),
                  "arm_l": (75, -35, 0), "arm_r": (75, 35, 0)},
    "kneel": {"leg_l": (-90, 0, 0), "leg_r": (-90, 0, 0), "arm_l": (10, 8, 0), "arm_r": (10, -8, 0)},
    "stretch": {"arm_l": (180, 0, 0), "arm_r": (180, 0, 0), "leg_l": (0, 18, 0), "leg_r": (0, -18, 0)},
    "upside_down": {"root": (0, 180, 0), "arm_l": (0, 150, 0), "arm_r": (0, -150, 0)},
    # arms curve out and back in like handles, legs pressed together like a base
    "vase": {"arm_l": (-15, 40, 25), "arm_r": (-15, -40, -25), "leg_l": (0, -6, 0), "leg_r": (0, 6, 0),
             "neck": (-8, 0, 0)},
}

PX = 1024  # render size; the packer downsamples 2x with proper anti-aliasing
ORTHO = 0.62  # metres covered by the frame
CAM_PITCH = 12  # degrees looking down, matches typical scene cameras


def parse(p):
    p.add_argument("--poses", default="all")
    p.add_argument("--angles", default="all")


def build_figure():
    white = fm.mat_solid("hider_white", (0.92, 0.92, 0.91), rough=0.45)
    try:
        b = white.node_tree.nodes["Principled BSDF"]
        b.inputs["Subsurface Weight"].default_value = 0.08
        b.inputs["Subsurface Radius"].default_value = (0.02, 0.02, 0.02)
    except KeyError:
        pass

    def empty(name, loc, parent=None):
        e = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(e)
        e.location = loc
        if parent:
            e.parent = parent
        return e

    root = empty("root", (0, 0, 0))
    hips = empty("hips", (0, 0, HIP[2]), root)  # 'lean' pivot
    neck = empty("neck", (0, 0, NECK[2] - HIP[2]), hips)
    parts = {}

    def part(name, radii, world_loc, parent, segs=48):
        o = fm.sphere(name, 1.0, (0, 0, 0), white, scale=radii, segments=segs)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
        o.location = world_loc
        pid, u0, v0, u1, v1 = ATLAS[name]
        o.pass_index = pid
        remap_uv(o, u0, v0, u1, v1)
        parts[name] = o
        return o

    bpy.context.view_layer.update()
    part("body", BODY, (0, 0, BODY_Z), hips)
    part("head", (HEAD_R, HEAD_R * 0.96, HEAD_R * 0.94), (0, 0, HEAD_Z), neck)

    joints = {}
    for side, sx in (("l", 1), ("r", -1)):
        sh = empty(f"shoulder_{side}", (sx * SHOULDER[0], 0, SHOULDER[2] - HIP[2]), hips)
        hp = empty(f"hip_{side}", (sx * HIP[0], 0, 0), hips)
        bpy.context.view_layer.update()
        part(f"arm_{side}", ARM, sh.matrix_world @ Vector((0, 0, -ARM[2] * 0.75)), sh, 32)
        part(f"leg_{side}", LEG, hp.matrix_world @ Vector((0, 0, -LEG[2] * 0.95)), hp, 32)
        joints[f"arm_{side}"] = sh
        joints[f"leg_{side}"] = hp

    # Antenna: a thin stalk with a little bent tip and a ball — the figure's one signature detail.
    ant = empty("antenna_base", (0, 0, ANT_BASE[2] - NECK[2]), neck)
    bpy.context.view_layer.update()
    stalk = fm.cylinder("antenna", 0.0042, 0.045, (0, 0, 0), white, vertices=16)
    stalk.parent = ant
    stalk.matrix_parent_inverse = ant.matrix_world.inverted()
    stalk.location = ant.matrix_world @ Vector((0.004, 0, 0.022))
    stalk.rotation_euler = (0, math.radians(10), 0)
    tip = fm.sphere("antenna_tip", 0.012, (0, 0, 0), white, segments=24)
    tip.parent = ant
    tip.matrix_parent_inverse = ant.matrix_world.inverted()
    tip.location = ant.matrix_world @ Vector((0.010, 0, 0.048))
    aid, u0, v0, u1, v1 = ATLAS["antenna"]
    um = (u0 + u1) / 2
    stalk.pass_index = tip.pass_index = aid
    remap_uv(stalk, u0, v0, um, v1)  # left half of the antenna rect
    remap_uv(tip, um, v0, u1, v1)  # right half
    parts["antenna"] = stalk
    parts["antenna_tip"] = tip
    joints.update({"root": root, "lean": hips, "neck": neck})
    return root, joints, parts


def remap_uv(obj, u0, v0, u1, v1):
    """Squeeze an object's own UVs into its atlas rectangle (with a 2 px margin)."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    n = len(uv)
    arr = np.empty(n * 2, dtype=np.float32)
    uv.foreach_get("uv", arr)
    arr = arr.reshape(n, 2)
    lo = arr.min(axis=0)
    hi = arr.max(axis=0)
    span = np.maximum(hi - lo, 1e-6)
    m = 2.0 / 256.0
    arr = (arr - lo) / span
    arr[:, 0] = u0 + m + arr[:, 0] * (u1 - u0 - 2 * m)
    arr[:, 1] = v0 + m + arr[:, 1] * (v1 - v0 - 2 * m)
    uv.foreach_set("uv", arr.reshape(-1))


def apply_pose(joints, pose: dict):
    for name, e in joints.items():
        e.rotation_euler = (0, 0, 0)
    joints["root"].location = (0, 0, 0)
    for name, rot in pose.items():
        e = joints[name]
        e.rotation_euler = tuple(math.radians(a) for a in rot)
    bpy.context.view_layer.update()


def ground(root, parts):
    """Shift the figure so its lowest point touches z = 0."""
    bpy.context.view_layer.update()
    zmin = min((o.matrix_world @ v.co).z for o in parts.values() for v in o.data.vertices)
    root.location.z -= zmin
    bpy.context.view_layer.update()


def setup_studio(scene):
    fm.set_world((0.85, 0.87, 0.92), 0.55)
    key = fm.add_area("key", (0.6, -0.9, 0.9), (0, 0, 0.15), size=0.6, power=60, color=(1.0, 0.97, 0.92))
    fill = fm.add_area("fill", (-0.8, -0.6, 0.4), (0, 0, 0.15), size=0.8, power=25, color=(0.85, 0.9, 1.0))
    rim = fm.add_area("rim", (0.0, 0.8, 0.7), (0, 0, 0.2), size=0.5, power=35)
    cam_data = bpy.data.cameras.new("sprite_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ORTHO
    cam = bpy.data.objects.new("sprite_cam", cam_data)
    scene.collection.objects.link(cam)
    pitch = math.radians(CAM_PITCH)
    centre = Vector((0, 0, 0.26))
    cam.location = centre + Vector((0, -3 * math.cos(pitch), 3 * math.sin(pitch)))
    fm.look_at(cam, centre)
    scene.camera = cam
    return cam


def main():
    args = fm.parse_args(parse)
    scene = fm.reset_scene()
    fm.set_color_management(scene, "None")
    cam = setup_studio(scene)
    root, joints, parts = build_figure()

    poses = list(POSES) if args.poses == "all" else args.poses.split(",")
    angles = list(ANGLES) if args.angles == "all" else args.angles.split(",")
    px = PX // 4 if args.preview else PX
    ppm = px / ORTHO

    vl = scene.view_layers[0]
    index = {"poses": poses, "angles": angles, "atlas": {k: list(v[1:]) for k, v in ATLAS.items()},
             "parts": PART_NAMES, "paintTextureSize": 256, "credit": fm.CREDIT}
    for pose_name in poses:
        pose = POSES[pose_name]
        for angle_name in angles:
            apply_pose(joints, pose)
            joints["root"].rotation_euler.z = math.radians(ANGLES[angle_name]) + joints["root"].rotation_euler.z
            ground(root, parts)
            out = os.path.join(args.out, "character", pose_name, angle_name)
            os.makedirs(out, exist_ok=True)

            # 1) pretty studio render (menus, pose picker)
            fm.configure_render(scene, px, px, 24 if args.preview else 96, transparent=True)
            enable_passes(vl, False)
            scene.use_nodes = False
            fm.render_still(scene, os.path.join(out, "shade.png"))

            # 2) data render: no pixel filter -> exact UV / part ids
            fm.configure_render(scene, px, px, 8 if args.preview else 32, transparent=True, data_only=True)
            fm.enable_passes(vl, depth=False, normal=True, index=True, uv=True, ao=True)
            fm.setup_pass_outputs(scene, out, ["uv", "index", "normal", "ao", "alpha"])
            fm.render_still(scene, None)
            uv = fm.collect_pass(out, "uv", 3)[..., :2]
            idx = fm.collect_pass(out, "index", 1)
            nrm = fm.collect_pass(out, "normal", 3)
            ao = fm.collect_pass(out, "ao", 3).mean(axis=-1)
            alpha = fm.collect_pass(out, "alpha", 1)
            rot = np.array(cam.matrix_world.to_3x3().normalized().inverted())
            ncam = (nrm.reshape(-1, 3) @ rot.T).reshape(nrm.shape)
            np.save(os.path.join(out, "uv.npy"), uv.astype(np.float32))
            np.save(os.path.join(out, "part.npy"), np.rint(idx).clip(0, 255).astype(np.uint8))
            np.save(os.path.join(out, "normal.npy"), ncam.astype(np.float16))
            np.save(os.path.join(out, "ao.npy"), ao.astype(np.float16))
            np.save(os.path.join(out, "alpha.npy"), alpha.astype(np.float16))
            with open(os.path.join(out, "meta.json"), "w") as f:
                json.dump({"pose": pose_name, "angle": angle_name, "size": px, "pixelsPerMetre": ppm,
                           "cameraPitchDeg": CAM_PITCH}, f, indent=2)
            print(f"[hider] {pose_name}/{angle_name} done")

    with open(os.path.join(args.out, "character", "index.json"), "w") as f:
        json.dump(index, f, indent=2)


def enable_passes(vl, on):
    fm.enable_passes(vl, depth=on, normal=on, index=on, uv=on, ao=on)


if __name__ == "__main__":
    main()
