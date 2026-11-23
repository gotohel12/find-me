"""
App icon — the hider peeking over a paint splash, rendered in Cycles.

    blender -b --factory-startup --python blender/ui/app_icon.py -- --out build/art [--preview]

Writes build/art/ui/app_icon.png (1024², full-bleed, safe for maskable icons:
the figure stays inside the central 80 % circle). tools/scene_pack.py turns it
into favicon / PWA / Apple icon sizes.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
sys.path.insert(0, os.path.join(HERE, "..", "character"))

import bpy  # type: ignore  # noqa: E402
from mathutils import Vector  # type: ignore  # noqa: E402

import fm  # noqa: E402
import hider  # noqa: E402


def splash(z=-0.02):
    """Flat paint splash: a disc ringed with droplets, behind the figure."""
    pink = fm.mat_solid("splash_pink", fm.hsv(0.94, 0.75, 1.0), rough=0.35)
    yellow = fm.mat_solid("splash_yellow", fm.hsv(0.13, 0.8, 1.0), rough=0.35)
    fm.cylinder("splash", 0.2, 0.01, (0, 0.12, 0.2), pink, rotation=(math.pi / 2, 0, 0), vertices=64)
    for i in range(9):
        a = i / 9 * math.tau + 0.3
        r = 0.2 + (0.035 if i % 2 else 0.06)
        s = 0.03 if i % 2 else 0.045
        fm.cylinder("drop", s, 0.01, (math.cos(a) * r, 0.12, 0.2 + math.sin(a) * r),
                    yellow if i % 3 == 0 else pink, rotation=(math.pi / 2, 0, 0), vertices=32)


def main():
    args = fm.parse_args()
    scene = fm.reset_scene()
    fm.set_color_management(scene, "AgX - Punchy")
    cam = hider.setup_studio(scene)
    fm.set_world(fm.hsv(0.7, 0.65, 0.35), 1.0)
    root, joints, parts = hider.build_figure()
    hider.apply_pose(joints, hider.POSES["peek"])
    joints["root"].rotation_euler.z = math.radians(-20)
    hider.ground(root, parts)
    splash()
    # frame tighter than the sprite camera, centred on the figure
    cam.data.ortho_scale = 0.5
    fm.look_at(cam, Vector((0, 0, 0.2)))
    px = 256 if args.preview else 1024
    fm.configure_render(scene, px, px, 32 if args.preview else 512)
    scene.use_nodes = False
    fm.render_still(scene, os.path.join(args.out, "ui", "app_icon.png"))
    print("[icon] done")


if __name__ == "__main__":
    main()
