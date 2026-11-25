"""
Map 01 — Japanese Apartment / شقة يابانية. A walkable 3D level for the real-time game.

Tatami floor, cedar walls, hand-modelled shoji screens, low tables, cushions, shelves
and lots of photoscanned clutter (Poly Haven, CC0), exported as glTF for Three.js.

    blender -b --factory-startup --python blender/maps/m01_japanese_apartment.py -- --out build/art [--preview]

Output: build/art/3d/maps/m01_japanese_apartment/{map.glb, map.json, preview.png, credits.json}
Developed by Mohsen ~ Danial. © 2026 MD Studio.
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import bpy  # type: ignore

import assets  # noqa: E402
import fm  # noqa: E402
import room  # noqa: E402

MAP_ID = "m01_japanese_apartment"
SEED = 2101

THEME = room.Theme(
    scene_id=MAP_ID,
    title_en="Japanese Apartment",
    title_ar="شقة يابانية",
    theme="japanese_apartment",
    seed=SEED,
    room=(8.0, 6.5, 2.7),
    floor_tex=("tatami_mat",),
    wall_tex=("japanese_cedar_planks", "bamboo_wall"),
    floor_tex_scale=0.7,
    wall_tex_scale=0.5,
    big=("chinese_tea_table", "chinese_cabinet", "painted_wooden_shelves", "wooden_display_shelves_01", "chinese_sofa",
         "modern_wooden_cabinet", "vintage_wooden_drawer_01", "wooden_table_02", "coffee_table_round_01", "chinese_stool",
         "side_table_tall_01"),
    small=("tea_set_01", "Lantern_01", "rubber_duck_toy", "ceramic_vase_01", "ceramic_vase_02", "ceramic_vase_03",
           "ceramic_vase_04", "antique_ceramic_vase_01", "brass_vase_01", "wooden_bowl_01", "wooden_bowl_02", "jug_01",
           "book_encyclopedia_set_01", "decorative_book_set_01", "binder_notebook", "alarm_clock_01", "mantel_clock_01",
           "standing_picture_frame_01", "standing_picture_frame_02", "carved_wooden_elephant", "concrete_cat_statue",
           "gamepad", "cassette_player", "food_apple_01", "food_pomegranate_01", "bananas", "lemon", "wicker_basket_01",
           "planter_box_01", "anthurium_botany_01", "calathea_orbifolia_01", "throw_pillows_01", "brass_candleholders",
           "wooden_candlestick", "vintage_pocket_watch", "round_spectacles", "magnifying_glass_01", "chess_set",
           "plastic_thermos", "russian_food_cans_01", "lambis_shell", "sungka_board"),
    floor_small=("throw_pillows_01", "wicker_basket_02", "planter_pot_clay", "Ottoman_01", "vintage_suitcase", "wooden_stool_02",
                 "planter_box_02", "folding_wooden_stool", "treasure_chest", "wooden_bucket_01", "wicker_basket_01"),
    wall_decor=("fancy_picture_frame_01", "hanging_picture_frame_01", "hanging_picture_frame_02", "hanging_picture_frame_03",
                "wall_clock", "ornate_mirror_01"),
    hdri=("comfy_cafe",),
    n_big=11,
    clutter=150,
    floor_clutter=30,
)


def shoji(name, x, y, width, height, rot_z, mats):
    """A sliding paper screen: real cedar frame with a lattice, translucent paper."""
    frame_m, paper_m = mats
    parts = []
    t = 0.035
    c, s = math.cos(rot_z), math.sin(rot_z)

    def at(lx, lz):
        return (x + lx * c, y + lx * s, lz)

    parts.append(fm.box(f"{name}_paper", (width - t, 0.006, height - t), at(0, height / 2), paper_m, rotation=(0, 0, rot_z)))
    for sx in (-1, 1):
        parts.append(fm.box(f"{name}_stile", (t, 0.04, height), at(sx * (width / 2 - t / 2), height / 2), frame_m, 0.004,
                            rotation=(0, 0, rot_z)))
    for z in (t / 2, height - t / 2):
        parts.append(fm.box(f"{name}_rail", (width, 0.04, t), at(0, z), frame_m, 0.004, rotation=(0, 0, rot_z)))
    cols, rows = 3, 6
    for i in range(1, cols):
        lx = -width / 2 + i * width / cols
        parts.append(fm.box(f"{name}_kumiko_v", (0.012, 0.02, height - 2 * t), at(lx, height / 2), frame_m, 0.002,
                            rotation=(0, 0, rot_z)))
    for j in range(1, rows):
        z = t + j * (height - 2 * t) / rows
        parts.append(fm.box(f"{name}_kumiko_h", (width - 2 * t, 0.02, 0.012), at(0, z), frame_m, 0.002, rotation=(0, 0, rot_z)))
    return parts


def build(rng):
    W, D, H = THEME.room
    room.build_shell(THEME, rng)
    # walkable level: close the room with a front wall (the shell is open toward the old photo camera)
    front = bpy.data.objects["back_wall"].copy()
    front.data = bpy.data.objects["back_wall"].data.copy()
    front.name = "front_wall"
    bpy.context.scene.collection.objects.link(front)
    front.location = (0, -0.05, H / 2)
    # shoji wall on the right, split by a cedar post
    cedar = assets.pbr_material("japanese_cedar_planks", scale=1.5, name="cedar_frame") if "japanese_cedar_planks" in assets.catalog("textures") else fm.mat_solid("cedar", (0.55, 0.36, 0.2), 0.5)
    paper = fm.mat_solid("shoji_paper", (0.96, 0.94, 0.88), rough=0.85)
    try:
        b = paper.node_tree.nodes["Principled BSDF"]
        b.inputs["Transmission Weight"].default_value = 0.25
    except KeyError:
        pass
    for i in range(4):
        shoji(f"shoji_{i}", W / 2 - 0.03, 0.8 + i * 0.95, 0.92, 2.0, math.pi / 2, (cedar, paper))
    # low tables / kotatsu area in the middle: from the furniture list placed by room, plus a central low table
    room.place_furniture(THEME, rng)
    room.hang_decor(THEME, rng, n=7)
    room.scatter(THEME, rng, THEME.small, THEME.clutter)
    room.scatter(THEME, rng, THEME.floor_small, THEME.floor_clutter, floor_only=True)


def export(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    n = 0
    for o in bpy.context.scene.objects:
        if o.type in ("MESH", "EMPTY") and not o.hide_render and abs(o.location.y) < 40:
            o.select_set(True)
            n += 1
    want = dict(
        filepath=os.path.join(out_dir, "map.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_lights=False,
        export_cameras=False,
        export_animations=False,
    )
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in known})
    print(f"[map] exported {n} objects")


def main():
    args = fm.parse_args()
    rng = random.Random(SEED)
    scene = fm.reset_scene()
    build(rng)
    W, D, H = THEME.room
    sun = room.light(THEME, rng)
    out = os.path.join(args.out, "3d", "maps", MAP_ID)
    # review render from the doorway
    cam = fm.add_camera("review", (0.3, 0.45, 1.55), (-0.2, D * 0.8, 0.5), focal_mm=18)
    scene.camera = cam
    fm.set_color_management(scene)
    w, h = (960, 540) if args.preview else (1920, 1080)
    fm.configure_render(scene, w, h, 32 if args.preview else 128)
    scene.use_nodes = False
    fm.render_still(scene, os.path.join(out, "preview.png"))
    export(out)
    meta = {
        "id": MAP_ID,
        "title": {"en": THEME.title_en, "ar": THEME.title_ar},
        "size": [W, D, H],
        "spawn": {"hiders": [[0, D * 0.5, 0.05], [-1.5, D * 0.6, 0.05], [1.5, D * 0.4, 0.05]], "seekers": [[0, 0.5, 0.05]]},
        "sun": {"dirWorld": list(fm.sun_direction_world(sun)), "color": list(sun.data.color), "strength": sun.data.energy},
        "hdri": [k for k, v in assets.USED.items() if v["type"] == "hdris"],
        "credit": fm.CREDIT,
    }
    with open(os.path.join(out, "map.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    assets.write_credits(os.path.join(out, "credits.json"))


if __name__ == "__main__":
    main()
