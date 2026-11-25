"""
Free asset fetcher for FIND ME scenes — Poly Haven (all CC0).

Models are imported as glTF, HDRIs as .hdr, textures as PBR maps
(diffuse, normal-GL, roughness, AO). Everything is cached on disk
(FINDME_ASSET_CACHE, default build/asset_cache) and every asset used is
recorded so CREDITS.md and the in-game credits list it with its licence.

Poly Haven asks API users to send an identifying User-Agent; we do.
"""
from __future__ import annotations

import json
import os
import random
import time
import urllib.request

import bpy  # type: ignore

API = "https://api.polyhaven.com"
UA = "FIND-ME-game-art-pipeline/1.0 (Mohsen ~ Danial; MD Studio)"
CACHE = os.environ.get("FINDME_ASSET_CACHE", os.path.join(os.getcwd(), "build", "asset_cache"))
USED: dict[str, dict] = {}  # id -> {name, type, license, url}


def _get(url: str, dest: str | None = None, tries: int = 4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if dest:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                tmp = dest + ".part"
                with open(tmp, "wb") as f:
                    f.write(data)
                os.replace(tmp, dest)
                return dest
            return data
        except Exception as e:  # network hiccup: back off and retry
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"download failed: {url}: {last}")


def _json(url: str, cache_name: str, max_age_h: float = 24.0):
    path = os.path.join(CACHE, "_api", cache_name)
    if os.path.isfile(path) and (time.time() - os.path.getmtime(path)) < max_age_h * 3600:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    data = json.loads(_get(url))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return data


def catalog(kind: str) -> dict:
    """kind: models | hdris | textures -> {id: info}"""
    return _json(f"{API}/assets?t={kind}", f"assets_{kind}.json")


def files(asset_id: str) -> dict:
    return _json(f"{API}/files/{asset_id}", f"files_{asset_id}.json", max_age_h=24 * 30)


def _record(asset_id: str, kind: str, info: dict | None = None):
    info = info or catalog(kind).get(asset_id, {})
    USED[asset_id] = {
        "name": info.get("name", asset_id),
        "type": kind,
        "source": "Poly Haven",
        "license": "CC0 1.0",
        "url": f"https://polyhaven.com/a/{asset_id}",
        "authors": list((info.get("authors") or {}).keys()),
    }


def find(kind: str, *, categories=(), tags=(), exclude_tags=(), name_has=(), limit=None) -> list[str]:
    """Asset ids matching ALL categories, ANY tag/name word, NONE of exclude_tags. Sorted for reproducibility."""
    out = []
    for aid, info in catalog(kind).items():
        cats = set(info.get("categories", []))
        tg = set(info.get("tags", []))
        name = info.get("name", "").lower()
        if categories and not set(categories) <= cats:
            continue
        if tags or name_has:
            hit = bool(tg & set(tags)) or any(w in name or w in aid for w in name_has)
            if not hit:
                continue
        if tg & set(exclude_tags):
            continue
        out.append(aid)
    out.sort()
    return out[:limit] if limit else out


# ------------------------------------------------------------------ models
def import_model(asset_id: str, res: str = "1k", location=(0, 0, 0), rot_z: float = 0.0, scale: float = 1.0, role: int = 1):
    """Download (cached) and import a Poly Haven model. Returns the new root object."""
    f = files(asset_id)
    before = set(bpy.data.objects)
    if "gltf" in f:
        g = f["gltf"].get(res) or f["gltf"][sorted(f["gltf"])[0]]
        entry = g["gltf"]
        base = os.path.join(CACHE, "models", asset_id, res)
        main = os.path.join(base, os.path.basename(entry["url"]))
        if not os.path.isfile(main):
            _get(entry["url"], main)
            for rel, inc in (entry.get("include") or {}).items():
                _get(inc["url"], os.path.join(base, rel))
        bpy.ops.import_scene.gltf(filepath=main)
    elif "fbx" in f:
        g = f["fbx"].get(res) or f["fbx"][sorted(f["fbx"])[0]]
        entry = g["fbx"]
        base = os.path.join(CACHE, "models", asset_id, res + "_fbx")
        main = os.path.join(base, os.path.basename(entry["url"]))
        if not os.path.isfile(main):
            _get(entry["url"], main)
            for rel, inc in (entry.get("include") or {}).items():
                _get(inc["url"], os.path.join(base, rel))
        bpy.ops.import_scene.fbx(filepath=main)
    else:
        raise LookupError(f"{asset_id}: no glTF/FBX download")
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        o.pass_index = role
    roots = [o for o in new if o.parent is None or o.parent not in new]
    if len(roots) == 1:
        root = roots[0]
    else:
        root = bpy.data.objects.new(f"{asset_id}_root", None)
        bpy.context.scene.collection.objects.link(root)
        for o in roots:
            o.parent = root
    root.location = location
    root.rotation_euler = (0, 0, rot_z)
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    _record(asset_id, "models")
    return root


def bounds(root):
    """World-space AABB of a hierarchy: (min xyz, max xyz)."""
    from mathutils import Vector  # type: ignore

    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    stack = [root]
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def drop_to(root, z: float):
    """Move a model so its lowest point sits at height z."""
    lo, _ = bounds(root)
    root.location.z += z - lo.z
    bpy.context.view_layer.update()


# ------------------------------------------------------------------ HDRI
def use_hdri(asset_id: str, res: str = "2k", strength: float = 1.0, rotation: float = 0.0):
    f = files(asset_id)
    url = f["hdri"][res]["hdr"]["url"]
    path = os.path.join(CACHE, "hdris", f"{asset_id}_{res}.hdr")
    if not os.path.isfile(path):
        _get(url, path)
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(path)
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value[2] = rotation
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    bg = nt.nodes["Background"]
    bg.inputs["Strength"].default_value = strength
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    _record(asset_id, "hdris")
    return w


# ------------------------------------------------------------------ PBR textures
def pbr_material(asset_id: str, res: str = "1k", scale: float = 1.0, name: str | None = None):
    """Principled material from a Poly Haven texture set.

    Uses the mesh UVs (give hand-built meshes world-scale UVs with fm.world_uv) and a
    Mapping scale, which the glTF exporter writes as KHR_texture_transform, so the
    game shows exactly what Blender renders.
    """
    f = files(asset_id)

    def grab(key, fmt="jpg"):
        m = f.get(key)
        if not m:
            return None
        r = m.get(res) or m[sorted(m)[0]]
        e = r.get(fmt) or r.get("png") or next(iter(r.values()))
        p = os.path.join(CACHE, "textures", asset_id, os.path.basename(e["url"]))
        if not os.path.isfile(p):
            _get(e["url"], p)
        return p

    mat = bpy.data.materials.new(name or f"pbr_{asset_id}")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])

    def tex(path, colorspace):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(path)
        t.image.colorspace_settings.name = colorspace
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        return t

    diff = grab("Diffuse")
    if diff:
        nt.links.new(tex(diff, "sRGB").outputs["Color"], b.inputs["Base Color"])
    rough = grab("Rough")
    if rough:
        nt.links.new(tex(rough, "Non-Color").outputs["Color"], b.inputs["Roughness"])
    nor = grab("nor_gl")
    if nor:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex(nor, "Non-Color").outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    _record(asset_id, "textures")
    return mat


# ------------------------------------------------------------------ credits
def write_credits(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(USED, f, indent=2, ensure_ascii=False)


def pick(rng: random.Random, ids: list[str], k: int) -> list[str]:
    if not ids:
        return []
    if k >= len(ids):
        out = ids[:]
        rng.shuffle(out)
        return out
    return rng.sample(ids, k)
