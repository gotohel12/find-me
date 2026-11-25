"""
FIND ME 3D hider — rigged, UV-unwrapped for painting, animated. Exported as glTF.

    blender -b --factory-startup --python blender/character/hider3d.py -- --out build/art [--preview]

Output:
    build/art/3d/hider.glb          mesh + armature + every animation as a separate action
    build/art/3d/hider_poses.png    contact sheet of all poses (for review)

Design (original, made here): a round, faceless, soft white figure with stubby
limbs and a little antenna. One continuous mesh (skin modifier + subdivision),
so paint flows over the whole body without gaps.

Painting support:
  - UV map "UVMap": smart-projected, large islands, packed with margin.
    The game paints in 3D (texels are stamped by distance in bind pose), so UV
    seams never show brush edges.
  - Vertex colour "part": R = body part id / 10 (1 head, 2 torso, 3 arm L,
    4 arm R, 5 leg L, 6 leg R, 7 antenna) for the bucket tool.
  - The rest pose is kept so the game can stamp in bind-pose space.
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import bpy  # type: ignore
from mathutils import Euler, Vector  # type: ignore

import fm  # noqa: E402

# ------------------------------------------------------------------ skeleton graph (metres, +Y = back, -Y = front)
# name: (position, skin radius x, skin radius y)
J = {
    "pelvis": ((0, 0, 0.140), 0.080, 0.070),
    "belly": ((0, 0, 0.185), 0.088, 0.078),
    "chest": ((0, 0, 0.235), 0.078, 0.070),
    "neck": ((0, 0, 0.275), 0.050, 0.048),
    "head": ((0, 0, 0.345), 0.105, 0.098),
    "head_top": ((0, 0, 0.410), 0.075, 0.070),
    "ant_base": ((0.0, 0.0, 0.445), 0.010, 0.010),
    "ant_tip": ((0.012, 0.0, 0.488), 0.018, 0.018),
    "shoulder.L": ((0.080, 0, 0.240), 0.034, 0.032),
    "elbow.L": ((0.118, 0, 0.190), 0.030, 0.029),
    "hand.L": ((0.132, 0, 0.140), 0.032, 0.030),
    "shoulder.R": ((-0.080, 0, 0.240), 0.034, 0.032),
    "elbow.R": ((-0.118, 0, 0.190), 0.030, 0.029),
    "hand.R": ((-0.132, 0, 0.140), 0.032, 0.030),
    "hip.L": ((0.045, 0, 0.115), 0.042, 0.040),
    "knee.L": ((0.048, 0, 0.068), 0.036, 0.036),
    "foot.L": ((0.050, -0.012, 0.026), 0.040, 0.046),
    "hip.R": ((-0.045, 0, 0.115), 0.042, 0.040),
    "knee.R": ((-0.048, 0, 0.068), 0.036, 0.036),
    "foot.R": ((-0.050, -0.012, 0.026), 0.040, 0.046),
}
EDGES = [
    ("pelvis", "belly"), ("belly", "chest"), ("chest", "neck"),
    ("chest", "shoulder.L"), ("shoulder.L", "elbow.L"), ("elbow.L", "hand.L"),
    ("chest", "shoulder.R"), ("shoulder.R", "elbow.R"), ("elbow.R", "hand.R"),
    ("pelvis", "hip.L"), ("hip.L", "knee.L"), ("knee.L", "foot.L"),
    ("pelvis", "hip.R"), ("hip.R", "knee.R"), ("knee.R", "foot.R"),
]
# bones: name -> (head joint, tail joint, parent)
BONES = {
    "root": ("pelvis", "belly", None),
    "spine": ("belly", "chest", "root"),
    "neck": ("chest", "neck", "spine"),
    "head": ("neck", "head_top", "neck"),
    "antenna": ("ant_base", "ant_tip", "head"),
    "upper_arm.L": ("shoulder.L", "elbow.L", "spine"),
    "forearm.L": ("elbow.L", "hand.L", "upper_arm.L"),
    "upper_arm.R": ("shoulder.R", "elbow.R", "spine"),
    "forearm.R": ("elbow.R", "hand.R", "upper_arm.R"),
    "thigh.L": ("hip.L", "knee.L", "root"),
    "shin.L": ("knee.L", "foot.L", "thigh.L"),
    "thigh.R": ("hip.R", "knee.R", "root"),
    "shin.R": ("knee.R", "foot.R", "thigh.R"),
}
PART_OF_BONE = {
    "head": 1, "neck": 1, "antenna": 7, "root": 2, "spine": 2,
    "upper_arm.L": 3, "forearm.L": 3, "upper_arm.R": 4, "forearm.R": 4,
    "thigh.L": 5, "shin.L": 5, "thigh.R": 6, "shin.R": 6,
}


SKIN_JOINTS = [n for n in J if n not in ("head", "head_top", "ant_base", "ant_tip")]


def build_mesh():
    names = SKIN_JOINTS
    me = bpy.data.meshes.new("hider")
    me.from_pydata([J[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
    obj = bpy.data.objects.new("hider", me)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    skin = obj.modifiers.new("skin", "SKIN")
    skin.use_smooth_shade = True
    skin.branch_smoothing = 1.0
    for i, n in enumerate(names):
        sv = me.skin_vertices[0].data[i]
        sv.radius = (J[n][1], J[n][2])
        sv.use_root = n == "pelvis"
    sub = obj.modifiers.new("subd", "SUBSURF")
    sub.levels = 4  # dense, then an even decimate: ~30k triangles, smooth in close-up paint mode
    sub.render_levels = 4
    for m in ("skin", "subd"):
        bpy.ops.object.modifier_apply(modifier=m)
    bpy.ops.object.shade_smooth()
    # gentle relax for a soft, toy-like surface
    sm = obj.modifiers.new("smooth", "SMOOTH")
    sm.factor = 0.5
    sm.iterations = 4
    bpy.ops.object.modifier_apply(modifier="smooth")
    dec = obj.modifiers.new("dec", "DECIMATE")
    dec.ratio = 0.72
    bpy.ops.object.modifier_apply(modifier="dec")
    # round head + antenna as their own smooth shells, joined into the same object
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=40, radius=0.108, location=(0, 0, 0.338))
    head = bpy.context.active_object
    head.scale = (1.0, 0.95, 0.93)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.0055, depth=0.05, location=(0.004, 0, 0.455),
                                        rotation=(0, math.radians(12), 0))
    stalk = bpy.context.active_object
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=0.017, location=(0.011, 0, 0.484))
    tip = bpy.context.active_object
    for o in (head, stalk, tip):
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        bpy.ops.object.shade_smooth()
    bpy.ops.object.select_all(action="DESELECT")
    for o in (obj, head, stalk, tip):
        o.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    return obj


def build_armature():
    arm = bpy.data.armatures.new("rig")
    rig = bpy.data.objects.new("rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, parent) in BONES.items():
        b = arm.edit_bones.new(name)
        b.head = Vector(J[h][0])
        b.tail = Vector(J[t][0])
        b.roll = 0
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skin_to(rig, obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def uv_unwrap(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.01, area_weight=1.0, scale_to_bounds=True)
    bpy.ops.uv.pack_islands(margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")


def part_colors(obj):
    """Vertex colour 'part' from the strongest bone weight (bucket-fill masks)."""
    me = obj.data
    attr = me.color_attributes.new("part", "BYTE_COLOR", "POINT")
    gid = {g.index: g.name for g in obj.vertex_groups}
    for v in me.vertices:
        best, w = "root", -1.0
        for g in v.groups:
            if g.weight > w and gid.get(g.group) in PART_OF_BONE:
                best, w = gid[g.group], g.weight
        p = PART_OF_BONE[best]
        attr.data[v.index].color = (p / 10.0, 0.0, 0.0, 1.0)
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.find("part")
    except Exception:
        pass


def material(obj):
    m = fm.mat_solid("hider_white", (0.92, 0.92, 0.91), rough=0.55)
    b = m.node_tree.nodes["Principled BSDF"]
    for k, v in (("Sheen Weight", 0.35), ("Sheen Roughness", 0.4), ("Subsurface Weight", 0.05)):
        try:
            b.inputs[k].default_value = v  # soft vinyl-toy feel
        except KeyError:
            pass
    me = obj.data
    me.calc_loop_triangles()
    print(f"[hider3d] triangles: {len(me.loop_triangles)}")
    obj.data.materials.clear()
    obj.data.materials.append(m)


# ------------------------------------------------------------------ animation
D = math.radians


def key_pose(rig, frame, pose: dict, loc=(0, 0, 0)):
    """pose: bone -> (x, y, z) degrees, local Euler XYZ. Unlisted bones return to rest."""
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        r = pose.get(pb.name, (0, 0, 0))
        if pb.name.endswith((".L", ".R")):
            # pose tables use "+Z = swing away from the body"; Blender's limb bones swing inward for +Z
            r = (r[0], r[1], -r[2])
        pb.rotation_euler = Euler((D(r[0]), D(r[1]), D(r[2])), "XYZ")
        pb.keyframe_insert("rotation_euler", frame=frame)
    root = rig.pose.bones["root"]
    root.location = Vector(loc)
    root.keyframe_insert("location", frame=frame)


def action(rig, name, frames, loop=True):
    """frames: list of (frame, pose dict, root offset)."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    for f, pose, loc in frames:
        key_pose(rig, f, pose, loc)
    act.use_cyclic = loop
    act.use_frame_range = True
    act.frame_range = (frames[0][0], frames[-1][0])
    rig.animation_data.action = None
    return act


# Bone local axes: bones point from head to tail. For limbs hanging down/outward,
# X rotation swings forward/back. Arms: positive X swings the arm forward (toward -Y).
def arms(lx=0, lz=0, rx=0, rz=0, ly=0, ry=0):
    return {"upper_arm.L": (lx, ly, lz), "upper_arm.R": (rx, ry, rz)}


def legs(lx=0, rx=0, lz=0, rz=0):
    return {"thigh.L": (lx, 0, lz), "thigh.R": (rx, 0, rz)}


POSES = {
    "stand": {},
    "t_pose": {**arms(lz=55, rz=-55)},
    "arms_up": {**arms(lz=125, rz=-125)},
    "sit": {**legs(lx=-85, rx=-85), "shin.L": (80, 0, 0), "shin.R": (80, 0, 0), **arms(lx=-25, rx=-25)},
    "ball": {"spine": (-35, 0, 0), "neck": (-25, 0, 0), **legs(lx=-110, rx=-110), "shin.L": (130, 0, 0), "shin.R": (130, 0, 0),
             **arms(lx=-80, rx=-80, lz=-20, rz=20)},
    "lie_face_down": {"root": (-90, 0, 0)},
    "lie_back": {"root": (90, 0, 0), **arms(lz=30, rz=-30)},
    "wall_flat": {**arms(lz=80, rz=-80), **legs(lz=10, rz=-10)},
    "hug_knees": {"spine": (-20, 0, 0), **legs(lx=-140, rx=-140), "shin.L": (150, 0, 0), "shin.R": (150, 0, 0),
                  **arms(lx=-75, rx=-75, lz=-30, rz=30), "forearm.L": (-40, 0, 0), "forearm.R": (-40, 0, 0)},
    "kneel": {**legs(lx=-90, rx=-90), "shin.L": (170, 0, 0), "shin.R": (170, 0, 0), **arms(lx=-10, rx=-10)},
    "crouch_tiny": {"spine": (-25, 0, 0), "neck": (-20, 0, 0), **legs(lx=-120, rx=-120), "shin.L": (150, 0, 0),
                    "shin.R": (150, 0, 0), **arms(lx=-60, rx=-60)},
    "plank_stiff": {**arms(lz=8, rz=-8)},
    "lean": {"root": (0, 18, 0), "spine": (0, 10, 0), **arms(lz=40, rz=-10)},
    "stretched": {**arms(lz=175, rz=-175), **legs(lz=4, rz=-4), "spine": (-8, 0, 0)},
    "upside_down": {"root": (0, 180, 0), **arms(lz=120, rz=-120)},
    "be_a_lamp": {**arms(lz=150, rz=-150), "forearm.L": (0, 0, 60), "forearm.R": (0, 0, -60), "neck": (15, 0, 0)},
    "be_a_vase": {**arms(lz=40, rz=-40, lx=-15, rx=-15), "forearm.L": (0, 0, -70), "forearm.R": (0, 0, 70), **legs(lz=-4, rz=4)},
}
# root drop so seated/curled poses rest on the floor (metres)
POSE_DROP = {"sit": -0.07, "ball": -0.06, "hug_knees": -0.07, "kneel": -0.05, "crouch_tiny": -0.07,
             "lie_face_down": -0.10, "lie_back": -0.10, "upside_down": 0.22}


def build_actions(rig):
    # idle: gentle breathing
    action(rig, "idle", [
        (1, {"spine": (2, 0, 0), **arms(lz=3, rz=-3)}, (0, 0, 0)),
        (30, {"spine": (-2, 0, 0), **arms(lz=6, rz=-6)}, (0, 0, 0.003)),
        (60, {"spine": (2, 0, 0), **arms(lz=3, rz=-3)}, (0, 0, 0)),
    ])
    # walk: 24-frame cycle, opposite arms and legs, small bounce
    def walk_frame(f, amp, bounce, lean):
        s = math.sin(f / 24 * math.tau)
        return (f + 1, {"root": (lean, 0, 0), **legs(lx=-amp * s, rx=amp * s),
                        "shin.L": (max(0, amp * s) * 0.8, 0, 0), "shin.R": (max(0, -amp * s) * 0.8, 0, 0),
                        **arms(lx=amp * 0.8 * s, rx=-amp * 0.8 * s, lz=8, rz=-8)},
                (0, 0, abs(s) * bounce))
    action(rig, "walk", [walk_frame(f, 32, 0.012, -4) for f in range(0, 25, 3)])
    action(rig, "run", [walk_frame(f, 55, 0.025, -12) for f in range(0, 17, 2)])
    action(rig, "jump", [
        (1, {**legs(lx=-30, rx=-30), "shin.L": (40, 0, 0), "shin.R": (40, 0, 0), **arms(lz=20, rz=-20)}, (0, 0, -0.02)),
        (6, {**arms(lz=110, rz=-110), **legs(lx=-10, rx=-10)}, (0, 0, 0)),
        (14, {**arms(lz=60, rz=-60), **legs(lx=-25, rx=-15)}, (0, 0, 0)),
    ], loop=False)
    action(rig, "paint_idle", [
        (1, {"neck": (-10, 0, 25), **arms(lx=-70, lz=20)}, (0, 0, 0)),
        (40, {"neck": (-14, 0, 20), **arms(lx=-75, lz=24)}, (0, 0, 0)),
    ])
    action(rig, "found", [
        (1, {**arms(lz=150, rz=-150)}, (0, 0, 0)),
        (8, {**arms(lz=160, rz=-160)}, (0, 0, 0.06)),
        (18, {**arms(lz=60, rz=-60)}, (0, 0, 0)),
    ], loop=False)
    for name, pose in POSES.items():
        drop = POSE_DROP.get(name, 0.0)
        action(rig, f"pose_{name}", [(1, pose, (0, 0, drop)), (2, pose, (0, 0, drop))], loop=False)


def pose_thumbnails(rig, out_dir, preview):
    scene = bpy.context.scene
    fm.set_world((0.86, 0.87, 0.93), 0.7)
    fm.add_area("key", (0.6, -0.9, 0.9), (0, 0, 0.2), size=0.6, power=60)
    fm.add_area("fill", (-0.8, -0.6, 0.4), (0, 0, 0.2), size=0.8, power=25)
    cam = fm.add_camera("thumb_cam", (0.55, -1.0, 0.45), (0, 0, 0.2), focal_mm=50)
    scene.camera = cam
    px = 192 if preview else 384
    fm.configure_render(scene, px, px, 16 if preview else 64, transparent=True)
    scene.use_nodes = False
    os.makedirs(out_dir, exist_ok=True)
    rig.animation_data_create()
    for name in POSES:
        rig.animation_data.action = bpy.data.actions[f"pose_{name}"]
        scene.frame_set(1)
        fm.render_still(scene, os.path.join(out_dir, f"{name}.png"))
    rig.animation_data.action = None


def main():
    args = fm.parse_args()
    scene = fm.reset_scene()
    obj = build_mesh()
    uv_unwrap(obj)
    rig = build_armature()
    skin_to(rig, obj)
    part_colors(obj)
    material(obj)
    build_actions(rig)
    out = os.path.join(args.out, "3d")
    os.makedirs(out, exist_ok=True)
    pose_thumbnails(rig, os.path.join(out, "poses"), args.preview)
    # make sure the rest pose is what gets exported as the mesh
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    rig.select_set(True)
    want = dict(
        filepath=os.path.join(out, "hider.glb"),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_texcoords=True,
        export_normals=True,
        export_colors=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=True,
        export_apply=False,
        export_force_sampling=True,
    )
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in known})
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"[hider3d] exported: {len(obj.data.vertices)} verts, {tris} tris, {len(bpy.data.actions)} actions")


if __name__ == "__main__":
    main()
