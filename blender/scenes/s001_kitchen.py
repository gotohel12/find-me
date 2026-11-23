"""
Scene 001_kitchen — Kitchen / المطبخ. Photoscanned Poly Haven models and PBR textures (CC0),
arranged by blender/lib/room.py, rendered in Cycles. Developed by Mohsen ~ Danial.

    blender -b --factory-startup --python blender/scenes/s001_kitchen.py -- --out build/art [--preview]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from room import Theme, build_and_export  # noqa: E402

THEME = Theme(
    scene_id="s001_kitchen",
    title_en="Kitchen",
    title_ar="المطبخ",
    theme="kitchen",
    seed=1101,
    room=(5.2, 4.0, 2.7),
    floor_words=('tile', 'tiles', 'marble'),
    wall_words=('plaster', 'painted_plaster', 'wall'),
    big_words=('kitchen', 'cabinet', 'table', 'shelf', 'counter', 'drawer', 'cupboard', 'dresser'),
    small_words=('jar', 'bottle', 'pot', 'pan', 'plate', 'bowl', 'cup', 'mug', 'kettle', 'fruit', 'apple', 'orange', 'lemon', 'bread', 'vegetable', 'tomato', 'pepper', 'basket', 'board', 'spoon', 'can', 'tin'),
    floor_small_words=('basket', 'crate', 'bucket', 'stool', 'box', 'pumpkin', 'watermelon', 'sack'),
    hdri_words=('kitchen', 'interior', 'room', 'studio'),
)

if __name__ == "__main__":
    build_and_export(THEME)
