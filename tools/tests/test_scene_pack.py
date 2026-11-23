"""Tests for tools/scene_pack.py on synthetic render passes (no Blender needed)."""
import json
import os
import sys
import tempfile
import unittest


def dump(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import scene_pack as sp  # noqa: E402


def make_scene(root, sid="s999_test", w=640, h=360):
    d = os.path.join(root, "scenes", sid, "landscape")
    os.makedirs(d)
    rng = np.random.default_rng(1)
    # busy, colourful image so compression has real work to do
    img = (rng.random((h, w, 3)) * 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(d, "beauty.png"))
    yy, xx = np.mgrid[0:h, 0:w]
    depth = (2.0 + 3.0 * yy / h).astype(np.float32)
    depth[:20] = 1e10  # background / sky
    np.save(os.path.join(d, "depth.npy"), depth)
    idx = np.ones((h, w), np.uint8)
    idx[:20] = 0
    idx[100:120, 100:140] = 2  # a lamp
    np.save(os.path.join(d, "index.npy"), idx)
    n = np.zeros((h, w, 3), np.float16)
    n[..., 2] = 1
    np.save(os.path.join(d, "normal.npy"), n)
    dump({"sceneId": sid, "title": {"en": "Test", "ar": "تجربة"}, "width": w, "height": h, "focalPx": 600.0},
         os.path.join(d, "meta.json"))
    return d


def make_sprite(root, pose="stand", angle="front", px=128):
    d = os.path.join(root, "character", pose, angle)
    os.makedirs(d)
    yy, xx = np.mgrid[0:px, 0:px]
    # a body ellipse (part 2) with a head circle (part 1) on top
    body = ((xx - 64) / 24.0) ** 2 + ((yy - 90) / 28.0) ** 2 <= 1
    head = ((xx - 64) / 20.0) ** 2 + ((yy - 45) / 20.0) ** 2 <= 1
    part = np.zeros((px, px), np.uint8)
    part[body] = 2
    part[head] = 1
    alpha = (part > 0).astype(np.float16)
    uv = np.zeros((px, px, 2), np.float32)
    uv[head] = (0.25, 0.75)
    uv[body] = (0.75, 0.75)
    n = np.zeros((px, px, 3), np.float16)
    n[..., 2] = 1
    np.save(os.path.join(d, "uv.npy"), uv)
    np.save(os.path.join(d, "part.npy"), part)
    np.save(os.path.join(d, "normal.npy"), n)
    np.save(os.path.join(d, "ao.npy"), np.ones((px, px), np.float16) * 0.8)
    np.save(os.path.join(d, "alpha.npy"), alpha)
    Image.fromarray((np.dstack([alpha * 230] * 3 + [alpha * 255])).astype(np.uint8), "RGBA").save(os.path.join(d, "shade.png"))
    dump({"pose": pose, "angle": angle, "size": px, "pixelsPerMetre": 400.0}, os.path.join(d, "meta.json"))
    dump({"poses": [pose], "angles": [angle], "atlas": {}, "parts": {}, "paintTextureSize": 256},
         os.path.join(root, "character", "index.json"))


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class PackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.art = os.path.join(self.tmp.name, "art")
        self.out = os.path.join(self.tmp.name, "out")
        make_scene(self.art)
        make_sprite(self.art)
        os.makedirs(os.path.join(self.art, "ui"))
        Image.new("RGB", (1024, 1024), (90, 60, 200)).save(os.path.join(self.art, "ui", "app_icon.png"))
        self.manifest = sp.pack_all(self.art, self.out)

    def tearDown(self):
        self.tmp.cleanup()

    def test_scene_assets_and_budget(self):
        d = os.path.join(self.out, "scenes", "s999_test", "landscape")
        for f in ("beauty.webp", "thumb.webp", "data.png", "normal.webp", "meta.json"):
            self.assertTrue(os.path.isfile(os.path.join(d, f)), f)
        self.assertLessEqual(os.path.getsize(os.path.join(d, "beauty.webp")), sp.BUDGET_BYTES)
        meta = load(os.path.join(d, "meta.json"))
        self.assertEqual(meta["title"]["ar"], "تجربة")
        self.assertEqual(meta["credit"], "Mohsen ~ Danial")

    def test_budget_forces_downscale(self):
        rng = np.random.default_rng(2)
        noisy = Image.fromarray((rng.random((900, 1600, 3)) * 255).astype(np.uint8))
        data, size = sp.fit_budget(noisy, "WEBP", budget=150 * 1024)
        self.assertLessEqual(len(data), 150 * 1024)

    def test_depth_roundtrip_and_forbidden(self):
        d = os.path.join(self.out, "scenes", "s999_test", "landscape")
        meta = load(os.path.join(d, "meta.json"))
        with Image.open(os.path.join(d, "data.png")) as im:
            rgba = np.array(im)
        self.assertEqual(rgba.shape[:2], (180, 320))
        depth = sp.decode_depth(rgba, meta["data"]["near"], meta["data"]["far"])
        # row 100 (half-res) ~ full-res row 200 -> depth 2 + 3*200/360 (min of block = row 200)
        self.assertAlmostEqual(float(depth[100, 50]), 2.0 + 3.0 * 200 / 360, places=2)
        self.assertTrue((rgba[:10, :, 2] == 255).all(), "sky is forbidden")
        self.assertTrue((rgba[50:60, 50:70, 2] == 255).all(), "lamp is forbidden")
        self.assertTrue((rgba[120:, :, 2] == 0).all(), "floor is open")

    def test_sprite_parts_never_blend(self):
        d = os.path.join(self.out, "character", "stand", "front")
        with Image.open(os.path.join(d, "uvp.png")) as im:
            uvp = np.array(im)
        covered = uvp[..., 3] > 0
        parts = set(np.unique(uvp[..., 2][covered]).tolist())
        self.assertEqual(parts, {40, 80})  # head and body only, no in-between ids
        us = set(np.unique(uvp[..., 0][covered]).tolist())
        self.assertEqual(us, {64, 191})  # exact atlas values, no blended UVs
        # edges are anti-aliased
        self.assertTrue(((uvp[..., 3] > 0) & (uvp[..., 3] < 255)).any())

    def test_anchor_at_feet(self):
        m = load(os.path.join(self.out, "character", "stand", "front", "meta.json"))
        ax, ay = m["anchor"]
        self.assertAlmostEqual(ax, 32, delta=1.5)
        self.assertAlmostEqual(ay, 59, delta=1.5)  # body bottom at full-res row 118 -> 59
        self.assertEqual(m["pixelsPerMetre"], 200.0)
        self.assertIn("stand/front", self.manifest["character"]["sprites"])

    def test_icons(self):
        icons = os.path.join(self.tmp.name, "icons")
        self.assertEqual(len(self.manifest["icons"]), 5)
        with Image.open(os.path.join(icons, "icon-192.png")) as im:
            self.assertEqual(im.size, (192, 192))
        self.assertTrue(os.path.isfile(os.path.join(icons, "icon-maskable-512.png")))


if __name__ == "__main__":
    unittest.main()
