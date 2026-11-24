"""
Scene 003 — Living Room / غرفة المعيشة. Hand-picked photoscanned Poly Haven models and PBR
textures (all CC0), arranged by blender/lib/room.py, rendered in Cycles.
Developed by Mohsen ~ Danial. © 2026 MD Studio.

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
    theme='living_room',
    seed=1103,
    room=(5.4, 4.3, 2.8),
    floor_tex=('diagonal_parquet', 'herringbone_parquet', 'wood_floor_worn'),
    wall_tex=('beige_wall_002', 'clay_plaster', 'blue_plaster_wall'),
    big=('sofa_02', 'sofa_03', 'Sofa_01', 'chinese_sofa', 'painted_wooden_shelves', 'wooden_display_shelves_01', 'chinese_cabinet', 'ClassicConsole_01', 'vintage_cabinet_01', 'GothicCommode_01', 'side_table_tall_01', 'vintage_grandfather_clock_01', 'ArmChair_01'),
    small=('book_encyclopedia_set_01', 'decorative_book_set_01', 'binder_notebook', 'antique_ceramic_vase_01', 'ceramic_vase_01', 'ceramic_vase_02', 'ceramic_vase_03', 'ceramic_vase_04', 'brass_vase_01', 'brass_vase_02', 'brass_vase_03', 'brass_vase_04', 'brass_candleholders', 'wooden_candlestick', 'vintage_oil_lamp', 'mantel_clock_01', 'alarm_clock_01', 'chess_set', 'carved_wooden_elephant', 'concrete_cat_statue', 'horse_statue_01', 'marble_bust_01', 'bronze_ray_statue', 'bronze_whale_statue', 'standing_picture_frame_01', 'standing_picture_frame_02', 'rubber_duck_toy', 'gamepad', 'cassette_player', 'tea_set_01', 'jug_01', 'wooden_bowl_01', 'lambis_shell', 'postcard_set_01', 'sungka_board', 'vintage_pocket_watch', 'round_spectacles', 'magnifying_glass_01', 'throw_pillows_01', 'planter_box_01', 'anthurium_botany_01', 'calathea_orbifolia_01', 'garden_gnome', 'brass_diya_lantern'),
    floor_small=('Ottoman_01', 'wicker_basket_02', 'planter_pot_clay', 'throw_pillows_01', 'vintage_suitcase', 'baseball_01', 'wooden_stool_02', 'planter_box_02', 'treasure_chest', 'folding_wooden_stool'),
    wall_decor=('fancy_picture_frame_01', 'fancy_picture_frame_02', 'hanging_picture_frame_01', 'hanging_picture_frame_02', 'hanging_picture_frame_03', 'ornate_mirror_01', 'wall_clock', 'lion_head', 'horse_head'),
    hdri=('comfy_cafe', 'decor_shop', 'old_room'),
)

if __name__ == "__main__":
    build_and_export(THEME)
