"""
Scene 001 — Toy Shop / محل الألعاب

A packed corner toy shop: three walls of shelves, a checkered floor, a rug
with a toy pile, plush creatures, stacking rings, toy cars and boxes in every
pattern. Two cameras: 16:9 landscape and 9:16 portrait.

    blender -b --factory-startup --python blender/scenes/s001_toy_shop.py -- --out build/art [--preview]
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import fm  # noqa: E402
import kit  # noqa: E402
from fm import ROLE_FORBIDDEN, box, hsv, mat_pattern, mat_solid  # noqa: E402

SCENE_ID = "s001_toy_shop"
SEED = 1001


def build(rng: random.Random):
    # --- room: 5 m wide, 5 m deep, 3 m high ------------------------------------
    floor = mat_pattern("floor", "checker", [hsv(0.08, 0.15, 0.92), hsv(0.58, 0.45, 0.55)], scale=2.5, rough=0.35)
    wall = mat_pattern("wallpaper", "dots", [hsv(0.12, 0.25, 0.97), hsv(0.95, 0.35, 0.95)], scale=9, rough=0.8)
    side_wall = mat_pattern("wall_side", "stripes", [hsv(0.48, 0.3, 0.9), hsv(0.48, 0.15, 0.98)], scale=6, rough=0.8)
    ceiling = mat_solid("ceiling", hsv(0.1, 0.05, 0.95), rough=0.9)
    box("floor", (6, 6, 0.02), (0, 2.0, -0.01), floor)
    box("back_wall", (6, 0.05, 3.2), (0, 4.6, 1.6), wall)
    box("left_wall", (0.05, 6, 3.2), (-2.7, 2.0, 1.6), side_wall)
    box("right_wall", (0.05, 6, 3.2), (2.7, 2.0, 1.6), side_wall)
    box("ceiling", (6, 6, 0.05), (0, 2.0, 3.05), ceiling, role=ROLE_FORBIDDEN)

    small = [kit.toy_box, kit.ball, kit.block_stack, kit.plush, kit.toy_car, kit.jar, kit.spinning_top, kit.ring_stack]

    # --- back wall: three shelf bays --------------------------------------------
    for bx in (-1.6, 0.0, 1.6):
        _, tops = kit.shelf_unit(rng, bx, 4.35, width=1.5, height=2.3, depth=0.42, shelves=5)
        for i, z in enumerate(tops):
            if i == 2 and bx == 0.0:
                kit.book_row(rng, bx - 0.7, bx + 0.7, 4.32, z)
            else:
                kit.scatter_on_shelf(rng, bx - 0.75, bx + 0.75, 4.3, z, small)

    # --- side shelves, angled toward the camera ------------------------------------
    for sx, rz in ((-2.45, math.radians(90)), (2.45, math.radians(-90))):
        _, tops = kit.shelf_unit(rng, sx, 2.6, width=2.4, height=2.0, depth=0.4, shelves=4, rot_z=rz)
        for z in tops:
            for k in range(7):
                py = 1.55 + k * 0.32 + rng.uniform(-0.04, 0.04)
                maker = rng.choice(small)
                maker(rng, (sx - math.copysign(0.02, sx), py, z))

    # --- floor: rug with a toy pile, toy chest, big balls ---------------------------------
    kit.rug(rng, (0.1, 2.6, 0), (2.0, 1.4))
    for _ in range(16):
        x, y = rng.uniform(-0.8, 0.9), rng.uniform(2.1, 3.2)
        rng.choice([kit.ball, kit.block_stack, kit.plush, kit.toy_car, kit.ring_stack, kit.toy_box])(rng, (x, y, 0.012))
    chest = mat_pattern("chest", "stripes", [hsv(0.0, 0.75, 0.8), hsv(0.12, 0.6, 0.95)], scale=8)
    box("toy_chest", (0.9, 0.5, 0.45), (-1.6, 3.4, 0.225), chest, 0.02)
    box("toy_chest_lid", (0.92, 0.52, 0.06), (-1.6, 3.38, 0.48), chest, 0.02, rotation=(math.radians(-8), 0, 0))
    for _ in range(6):
        kit.ball(rng, (rng.uniform(-1.9, -1.3), rng.uniform(3.2, 3.6), 0.5), rng.uniform(0.06, 0.1))
    kit.ball(rng, (1.5, 2.2, 0), 0.28)
    kit.ball(rng, (1.95, 2.8, 0), 0.2)
    for _ in range(4):
        kit.toy_box(rng, (rng.uniform(1.1, 2.2), rng.uniform(3.2, 3.9), 0), rot_z=rng.uniform(-0.4, 0.4))

    # --- hanging lamps (forbidden zone) + light -------------------------------------------
    for lx in (-1.4, 0.2, 1.6):
        kit.pendant_lamp(rng, (lx, 3.0, 2.55), power=35)


def main():
    args = fm.parse_args()
    seed = args.seed if args.seed is not None else SEED
    rng = random.Random(seed)
    scene = fm.reset_scene()
    fm.set_world((0.75, 0.82, 0.95), 0.35)
    build(rng)

    # Key light: warm afternoon sun through an (unseen) shop window, camera left.
    sun = fm.add_sun("key_sun", (52, 0, -38), strength=2.6, color=(1.0, 0.92, 0.8))
    fm.add_area("fill", (0, -0.5, 2.6), (0, 3, 0.8), size=3.0, power=420, color=(0.9, 0.95, 1.0))
    fm.add_area("bounce", (0, 2.5, 2.95), (0, 2.5, 0), size=4.0, power=260, color=(1.0, 0.96, 0.9))

    cams = {
        "landscape": fm.add_camera("cam_landscape", (0.25, -0.9, 1.45), (0.0, 3.6, 0.95), focal_mm=28),
        "portrait": fm.add_camera("cam_portrait", (0.5, 0.2, 1.35), (0.2, 4.3, 1.0), focal_mm=30),
    }
    spec = fm.SceneSpec(
        scene_id=SCENE_ID,
        title_en="Toy Shop",
        title_ar="محل الألعاب",
        theme="toy_shop",
        seed=seed,
        key_light=sun,
        ambient=(0.62, 0.66, 0.75),
        cameras=cams,
        character_height_m=0.37,
    )
    fm.export_scene(scene, spec, args)


if __name__ == "__main__":
    main()
