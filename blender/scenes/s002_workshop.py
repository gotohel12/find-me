"""
Scene 002_workshop — Workshop / الورشة. Photoscanned Poly Haven models and PBR textures (CC0),
arranged by blender/lib/room.py, rendered in Cycles. Developed by Mohsen ~ Danial.

    blender -b --factory-startup --python blender/scenes/s002_workshop.py -- --out build/art [--preview]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from room import Theme, build_and_export  # noqa: E402

THEME = Theme(
    scene_id="s002_workshop",
    title_en="Workshop",
    title_ar="الورشة",
    theme="garage",
    seed=1102,
    room=(5.6, 4.4, 3.0),
    floor_words=('concrete', 'asphalt_floor', 'garage'),
    wall_words=('brick', 'concrete_wall', 'plaster'),
    big_words=('workbench', 'bench', 'shelf', 'shelves', 'cabinet', 'table', 'drawer', 'rack', 'locker'),
    small_words=('tool', 'hammer', 'wrench', 'screwdriver', 'drill', 'saw', 'pliers', 'can', 'paint', 'bottle', 'box', 'jar', 'tape', 'brush', 'oil', 'spray', 'clamp', 'lamp', 'bolt', 'helmet', 'gloves'),
    floor_small_words=('crate', 'barrel', 'bucket', 'tire', 'tyre', 'box', 'canister', 'jerrycan', 'toolbox', 'cone'),
    hdri_words=('garage', 'industrial', 'workshop', 'warehouse', 'interior'),
)

if __name__ == "__main__":
    build_and_export(THEME)
