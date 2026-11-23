"""
Scene 002 — Workshop / الورشة. Hand-picked photoscanned Poly Haven models and PBR
textures (all CC0), arranged by blender/lib/room.py, rendered in Cycles.
Developed by Mohsen ~ Danial. © 2026 MD Studio.

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
    theme='garage',
    seed=1102,
    room=(5.6, 4.2, 3.0),
    floor_tex=('concrete_floor_painted', 'concrete_floor_worn_001'),
    wall_tex=('red_brick', 'brick_wall_02', 'concrete_block_wall'),
    big=('steel_frame_shelves_01', 'steel_frame_shelves_02', 'steel_frame_shelves_03', 'worn_metal_rack', 'metal_tool_chest', 'tool_cart', 'industrial_storage_cart', 'metal_office_desk', 'drawer_cabinet', 'WoodenTable_03', 'wooden_bookshelf_worn', 'drill_press_01'),
    small=('Drill_01', 'adjustable_wrench', 'combination_wrench', 'cross_pein_hammer', 'flathead_screwdriver', 'screwdriver', 'screwdrivers_02', 'pliers', 'tongue_groove_pliers', 'ratchet_wrench', 'pipe_wrench', 'measuring_tape_01', 'hand_plane_no4', 'handsaw_wood', 'rusted_hacksaw', 'bolt_cutters_01', 'bench_vice_01', 'small_oil_can_01', 'lubricant_spray', 'spray_paint_bottles', 'spray_paint_bottles_02', 'leather_cleaner_can', 'cleaner_tin_01', 'can_rusted', 'drain_cleaner', 'metal_toolbox', 'retro_multimeter', 'propane_torch', 'propane_torch_02', 'brass_blowtorch', 'vintage_hand_drill', 'medical_tape', 'pastic_torch_6v', 'small_plastic_torch', 'vintage_flashlight', 'lightbulb_01', 'garden_gloves_01', 'power_box_01', 'tire_pump', 'wooden_hammer_01', 'cardboard_box_01', 'industrial_pastic_container', 'binoculars', 'Camera_01', 'cassette_player', 'plastic_thermos'),
    floor_small=('plastic_crate_01', 'plastic_crate_02', 'plastic_crate_03', 'cardboard_box_01', 'metal_jerrycan', 'metal_jerrycan_green', 'plastic_jerrycan', 'propane_tank', 'small_lpg_tank', 'cement_bag', 'compost_bag_02', 'wooden_crate_02', 'wooden_military_crate', 'ammo_box', 'metal_trash_can', 'rusted_wheel_rim_01', 'rusted_wheel_rim_02', 'watering_can_metal_01', 'plastic_bottle_gallon'),
    wall_decor=('dartboard', 'garden_hose_wall_mounted_01', 'fire_alarm', 'lifebuoy', 'vintage_telephone_wall_clock', 'wall_clock'),
    hdri=('garage', 'autoshop_01', 'carpentry_shop_01'),
)

if __name__ == "__main__":
    build_and_export(THEME)
