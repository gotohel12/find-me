"""
Scene 003_living_room — Living Room / غرفة المعيشة. Photoscanned Poly Haven models and PBR textures (CC0),
arranged by blender/lib/room.py, rendered in Cycles. Developed by Mohsen ~ Danial.

    blender -b --factory-startup --python blender/scenes/s003_living_room.py -- --out build/art [--preview]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from room import Theme, build_and_export  # noqa: E402

THEME = Theme(
    scene_id="s003_living_room",
    title_en="Living Room",
    title_ar="غرفة المعيشة",
    theme="living_room",
    seed=1103,
    room=(5.4, 4.4, 2.8),
    floor_words=('wood_floor', 'parquet', 'planks', 'laminate'),
    wall_words=('wallpaper', 'plaster', 'painted'),
    big_words=('sofa', 'couch', 'armchair', 'chair', 'table', 'shelf', 'bookcase', 'cabinet', 'dresser', 'sideboard'),
    small_words=('book', 'vase', 'lamp', 'candle', 'plant', 'pot', 'clock', 'frame', 'bowl', 'cup', 'mug', 'remote', 'figurine', 'statue', 'box', 'basket', 'pillow', 'cushion', 'jar', 'bottle'),
    floor_small_words=('basket', 'plant', 'pouf', 'ottoman', 'stool', 'box', 'pillow', 'cushion', 'toy', 'ball'),
    hdri_words=('living', 'interior', 'room', 'lounge'),
)

if __name__ == "__main__":
    build_and_export(THEME)
