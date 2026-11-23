"""
Scene 001 — Kitchen / المطبخ. Hand-picked photoscanned Poly Haven models and PBR
textures (all CC0), arranged by blender/lib/room.py, rendered in Cycles.
Developed by Mohsen ~ Danial. © 2026 MD Studio.

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
    theme='kitchen',
    seed=1101,
    room=(5.0, 3.9, 2.7),
    floor_tex=('floor_tiles_06', 'marble_tiles', 'herringbone_concrete_tile'),
    wall_tex=('beige_wall_001', 'clay_plaster', 'blue_plaster_wall'),
    big=('painted_wooden_shelves', 'wooden_display_shelves_01', 'vintage_cabinet_01', 'painted_wooden_cabinet', 'painted_wooden_cabinet_02', 'electric_stove', 'modern_wooden_cabinet', 'vintage_wooden_drawer_01', 'chinese_cabinet', 'wooden_table_02', 'dining_table', 'CoffeeCart_01'),
    small=('food_apple_01', 'food_avocado_01', 'food_ginger_01', 'food_kiwi_01', 'food_lime_01', 'food_lychee_01', 'food_pears_asian_01', 'food_pomegranate_01', 'bananas', 'lemon', 'yellow_onion', 'croissant', 'carrot_cake', 'strawberry_chocolate_cake', 'hamburger_buns', 'wooden_cutting_board', 'wooden_bowl_01', 'wooden_bowl_02', 'wooden_spoon', 'carved_wooden_plate', 'jug_01', 'metal_jug', 'ceramic_pot', 'pot_enamel_01', 'brass_pot_01', 'brass_pot_02', 'brass_pan_01', 'brass_goblets', 'tea_set_01', 'wine_bottles_01', 'russian_food_cans_01', 'long_life_food', 'plastic_thermos', 'vintage_electric_kettle', 'ceramic_vase_01', 'ceramic_vase_03', 'antique_ceramic_vase_01', 'wicker_basket_01', 'all_purpose_cleaner', 'bleach_bottle', 'plastic_container', 'CheeseBox_01', 'vintage_microwave'),
    floor_small=('wicker_basket_01', 'wicker_basket_02', 'wooden_bucket_01', 'wooden_bucket_02', 'wooden_crate_01', 'plastic_crate_01', 'plastic_bottle_gallon', 'planter_pot_clay', 'wooden_stool_01', 'chinese_stool', 'trashbag', 'watering_can_metal_01'),
    wall_decor=('wall_clock', 'hanging_picture_frame_01', 'hanging_picture_frame_02', 'hanging_picture_frame_03', 'fancy_picture_frame_01'),
    hdri=('abandoned_bakery', 'comfy_cafe', 'small_empty_room_2'),
)

if __name__ == "__main__":
    build_and_export(THEME)
