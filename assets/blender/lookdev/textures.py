"""Shared small textures (client/public/textures/): grass_blades (alpha atlas), water_normal, foam, cloud_noise,
detail_noise. Periodic patterns come from 4D torus-mapped noise/voronoi shader nodes rendered top-down
(tile exactly); the grass atlas is real blade geometry (curved tapered strips) rendered side-on.
"""
import json
import math
import os

import bpy
import numpy as np

import ld_scene as S
from ld_common import (PREVIEWS, TEX_DIR, NB, checker_bg, label, lin_to_srgb, load_image, log, new_scene,
                       normal_from_height, pnoise, pvoronoi, render, resize, save_png, save_webp, sheet, tile3,
                       tile_seam_error, world_color)

KEYS = ["grass_blades", "water_normal", "foam", "cloud_noise", "detail_noise"]


# =============================================================================== periodic pattern plane
def pattern_render(fn, res, samples=16, name="pattern"):
    """fn(nb, pos) -> colour/vector socket (values rendered as-is). pos in 0..1 (period 1)."""
    sc = new_scene((res, res), samples)
    world_color(sc, (0, 0, 0), 0.0)
    sc.cycles.max_bounces = 0
    m = bpy.data.materials.new("Pattern")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    nb = NB(nt)
    out = nb.node("ShaderNodeOutputMaterial")
    em = nb.node("ShaderNodeEmission", Strength=1.0)
    nb.link(em.outputs[0], out.inputs["Surface"])
    pos = nb.node("ShaderNodeNewGeometry").outputs["Position"]
    nb.link(fn(nb, pos), em.inputs["Color"])
    bpy.ops.mesh.primitive_plane_add(size=1.5, location=(0.5, 0.5, 0))
    bpy.context.object.data.materials.append(m)
    S.ortho_topdown(sc, 1.0, res, height=5.0)
    arr = render(sc, name, samples=samples)
    log(f"{name}: {samples} spp on {render.last[0]} {render.last[1]:.1f}s")
    return arr


def _n(nb, p, f, det=4.0, rgh=0.55, sd=0, dist=0.0):
    return pnoise(nb, p, f, det, rgh, dist=dist, seed=sd).outputs["Fac"]


# =============================================================================== water / foam / noises
def build_water_normal(res=1024):
    """Height = sum of directional wave trains (integer wave numbers -> periodic) + periodic noise chop."""
    def fn(nb, p):
        s = nb.sep(p)
        h = None
        waves = [((3, 1), 0.35, 0.3), ((-2, 4), 0.25, 1.1), ((5, -2), 0.18, 2.0), ((1, 7), 0.12, 0.7),
                 ((-8, 3), 0.08, 2.6), ((9, 8), 0.05, 1.9)]
        warp = nb.mul(nb.sub(_n(nb, p, 3, 3, 0.5, 5), 0.5), 1.2)
        for (kx, ky), a, ph in waves:
            arg = nb.add(nb.mul(nb.add(nb.mul(s[0], kx), nb.mul(s[1], ky)), 2 * math.pi), nb.add(warp, ph))
            # trochoid-ish sharp crests: 1 - |sin|
            w = nb.mul(nb.sub(0.7, nb.math("ABSOLUTE", nb.math("SINE", nb.mul(arg, 0.5)))), a)
            h = w if h is None else nb.add(h, w)
        chop = nb.mul(_n(nb, p, 18, 4, 0.6, 7), 0.22)
        ripple = nb.mul(_n(nb, p, 48, 3, 0.5, 9), 0.08)
        h = nb.add(nb.add(h, chop), ripple)
        return nb.xyz(h, h, h)
    arr = pattern_render(fn, res, 16, "water_height")
    h = arr[..., 0]
    h = (h - h.mean()) / (h.std() + 1e-6)
    n = normal_from_height(h, strength=res / 1024 * 0.9 * 1.0)
    out = n * 0.5 + 0.5
    sz = save_webp(out, os.path.join(TEX_DIR, "water_normal.webp"), 92)
    return {"file": "textures/water_normal.webp", "bytes": sz, "seam_ratio": round(tile_seam_error(out), 3),
            "note": "tangent-space OpenGL normal, tileable; scroll two copies at different scales/directions"}, out


def build_foam(res=1024):
    def fn(nb, p):
        v1 = pvoronoi(nb, p, 38, "DISTANCE_TO_EDGE", seed=3)
        v2 = pvoronoi(nb, p, 90, "DISTANCE_TO_EDGE", seed=4)
        e1 = nb.maprange(v1.outputs["Distance"], 0.0, 0.09, 1.0, 0.0, "SMOOTHSTEP")
        e2 = nb.maprange(v2.outputs["Distance"], 0.0, 0.12, 1.0, 0.0, "SMOOTHSTEP")
        bub = nb.math("MAXIMUM", e1, nb.mul(e2, 0.7))
        br = _n(nb, p, 6, 5, 0.6, 5, dist=0.5)
        mask = nb.maprange(br, 0.42, 0.62, 0.0, 1.0, "SMOOTHSTEP")
        streak = nb.maprange(_n(nb, p, 14, 4, 0.6, 6), 0.5, 0.7, 0.0, 0.6)
        f = nb.mul(nb.math("MAXIMUM", bub, streak), mask)
        f = nb.math("MAXIMUM", f, nb.mul(nb.maprange(br, 0.62, 0.8, 0.0, 1.0), 0.85))
        return nb.xyz(f, f, f)
    arr = pattern_render(fn, res, 16, "foam")
    f = np.clip(arr[..., 0], 0, 1)
    sz = save_webp(np.dstack([f, f, f]), os.path.join(TEX_DIR, "foam.webp"), 88)
    return {"file": "textures/foam.webp", "bytes": sz, "seam_ratio": round(tile_seam_error(f), 3),
            "note": "grayscale foam mask (use .r), tileable; threshold it with shoreline distance"}, np.dstack([f, f, f])


def build_cloud_noise(res=512):
    def fn(nb, p):
        r = _n(nb, p, 4, 6, 0.55, 11)
        g = _n(nb, p, 9, 6, 0.6, 12)
        w = pvoronoi(nb, p, 7, seed=13)
        w2 = pvoronoi(nb, p, 15, seed=14)
        b = nb.sub(1.0, nb.add(nb.mul(w.outputs["Distance"], 0.65), nb.mul(w2.outputs["Distance"], 0.35)))
        return nb.xyz(r, g, b)
    arr = pattern_render(fn, res, 16, "cloud_noise")
    out = arr[..., :3].copy()
    for c in range(3):  # stretch each channel to 0..1
        lo, hi = np.percentile(out[..., c], 0.5), np.percentile(out[..., c], 99.5)
        out[..., c] = np.clip((out[..., c] - lo) / max(hi - lo, 1e-6), 0, 1)
    sz = save_webp(out, os.path.join(TEX_DIR, "cloud_noise.webp"), 92)
    return {"file": "textures/cloud_noise.webp", "bytes": sz, "seam_ratio": round(tile_seam_error(out), 3),
            "note": "R fbm 4/tile, G fbm 9/tile, B inverted worley (billows); tileable, linear data"}, out


def build_detail_noise(res=512):
    def fn(nb, p):
        r = _n(nb, p, 32, 5, 0.6, 21)
        v = pvoronoi(nb, p, 24, seed=22)
        g = nb.bw(v.outputs["Color"])
        b = _n(nb, p, 110, 2, 0.5, 23)
        return nb.xyz(r, g, b)
    arr = pattern_render(fn, res, 16, "detail_noise")
    out = arr[..., :3].copy()
    for c in range(3):
        lo, hi = np.percentile(out[..., c], 0.5), np.percentile(out[..., c], 99.5)
        out[..., c] = np.clip((out[..., c] - lo) / max(hi - lo, 1e-6), 0, 1)
    sz = save_webp(out, os.path.join(TEX_DIR, "detail_noise.webp"), 92)
    return {"file": "textures/detail_noise.webp", "bytes": sz, "seam_ratio": round(tile_seam_error(out), 3),
            "note": "R fine fbm 32/tile, G voronoi cell ids 24/tile, B grain 110/tile; tileable, linear data "
                    "(macro/micro variation, dithering, breakup of tiling)"}, out


# =============================================================================== grass blade atlas
TUFTS = [
    # (label, n_blades, length range, width, bend range, colours, extras)
    ("meadow", 9, (0.55, 0.95), 0.030, (0.15, 0.55), ["#4c5a2a", "#56632f", "#607033", "#44512a"], {}),
    ("dense", 16, (0.35, 0.7), 0.024, (0.2, 0.8), ["#465426", "#51602c", "#5a6630", "#3d4a22"], {}),
    ("seed", 7, (0.6, 0.98), 0.022, (0.1, 0.4), ["#5f6634", "#6b6e3a", "#57602f"], {"seeds": "#a39463"}),
    ("dry", 11, (0.45, 0.9), 0.026, (0.25, 0.9), ["#8a7b4b", "#7a6c40", "#9a8a58", "#6b6a3c"], {}),
    ("short", 18, (0.25, 0.5), 0.028, (0.3, 1.0), ["#3f4d24", "#4a5a2a", "#56642f"], {}),
    ("fern", 6, (0.55, 0.9), 0.020, (0.3, 0.7), ["#3e5024", "#48592a"], {"fronds": True}),
    ("flower", 8, (0.45, 0.85), 0.024, (0.15, 0.5), ["#4a5828", "#55632e", "#434f25"], {"flowers": "#c9c2d6"}),
    ("dead", 10, (0.4, 0.85), 0.026, (0.4, 1.3), ["#5e4f35", "#6b5a3c", "#4f4430", "#75653f"], {}),
]


def _tuft_objects(idx, spec, x0, rng):
    label_, n, lr, wd, br, cols, ex = spec
    mat = bpy.data.materials.new(f"GrassTuft{idx}")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    nb = NB(nt)
    out = nb.node("ShaderNodeOutputMaterial")
    em = nb.node("ShaderNodeEmission", Strength=1.0)
    nb.link(em.outputs[0], out.inputs["Surface"])
    attr = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": "bcol"}).outputs["Color"]
    along = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": "along"}).outputs["Fac"]
    across = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": "across"}).outputs["Fac"]
    c = nb.mix(nb.vmath("SCALE", attr, scale=0.35), attr, nb.maprange(along, 0.0, 0.45, 0.0, 1.0, "SMOOTHSTEP"))
    c = nb.mix(c, nb.mix(attr, "#b3a46c", 0.45), nb.maprange(along, 0.7, 1.0, 0.0, 0.8))
    mid = nb.maprange(nb.math("ABSOLUTE", nb.sub(across, 0.5)), 0.0, 0.12, 1.0, 0.0)
    c = nb.mix(c, nb.vmath("SCALE", c, scale=1.25), nb.mul(mid, 0.35))
    nb.link(c, em.inputs["Color"])
    import bmesh
    bm = bmesh.new()
    lay_c = bm.verts.layers.float_color.new("bcol")
    lay_a = bm.verts.layers.float.new("along")
    lay_x = bm.verts.layers.float.new("across")

    def strip(root, length, width, bend, lean, col, segs=8, taper=0.9, wyaw=0.0):
        """Tapered curved strip; bend = total curvature (rad), lean = +1/-1 side (or an angle for flowers)."""
        pv = None
        x, y, z = root
        step = length / segs
        for i in range(segs + 1):
            t = i / segs
            w = width * max(0.02, (1 - t) ** taper) * 0.5
            dx, dy = math.cos(wyaw), math.sin(wyaw)
            a = bm.verts.new((x - w * dx, y - w * dy, z))
            b = bm.verts.new((x + w * dx, y + w * dy, z))
            for v, ac in ((a, 0.0), (b, 1.0)):
                v[lay_c] = (*col, 1.0)
                v[lay_a] = t
                v[lay_x] = ac
            if pv:
                bm.faces.new((pv[0], pv[1], b, a))
            pv = (a, b)
            ang = bend * t * t
            x += math.sin(ang) * step * math.cos(lean) if not isinstance(lean, int) else math.sin(ang) * step * lean
            y += math.sin(ang) * step * math.sin(lean) if not isinstance(lean, int) else 0.0
            z += math.cos(ang) * step
        return (x, y, z)

    from ld_common import srgb
    for k in range(n):
        col = srgb(cols[k % len(cols)])[:3]
        col = tuple(min(1.0, c_ * rng.uniform(0.85, 1.15)) for c_ in col)
        L = rng.uniform(*lr)
        rx = x0 + rng.normal(0, 0.035)
        lean = 1 if k % 2 else -1
        tip = strip((rx, rng.uniform(-0.05, 0.05), 0.0), L, wd * rng.uniform(0.8, 1.2), rng.uniform(*br), lean, col,
                    wyaw=rng.uniform(-0.6, 0.6))
        if ex.get("seeds") and k % 2 == 0:
            sc_ = srgb(ex["seeds"])[:3]
            for j in range(7):   # seed head: small spikelets along the top of the stem
                t = 0.72 + j * 0.035
                strip((tip[0] + rng.normal(0, 0.006), tip[1], tip[2] - (1 - t) * L * 0.9), 0.05, 0.016, 0.9, 1 if j % 2 else -1, sc_, segs=3, taper=0.5)
        if ex.get("flowers") and k % 3 == 0:
            fc = srgb(ex["flowers"])[:3]
            for j in range(5):
                a_ = j / 5 * math.tau
                strip((tip[0], tip[1], tip[2] - 0.01), 0.035, 0.022, 1.3, float(a_), fc, segs=2, taper=0.3, wyaw=a_ + 1.57)
        if ex.get("fronds"):
            for j in range(9):
                t = 0.2 + j * 0.085
                side = 1 if j % 2 else -1
                strip((rx + (tip[0] - rx) * t * t, 0.0, L * t * 0.95), 0.12 * (1 - t) + 0.03, 0.02, 1.2, side, col, segs=4)
    me = bpy.data.meshes.new(f"Tuft{idx}")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(f"Tuft{idx}", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_grass_blades(res=1024, cols=4, rows=2):
    """Atlas of 8 tuft variants: each cell 256x512 (res/cols x res/rows), root at the bottom centre of the cell,
    top of the tallest blade near the cell top; straight alpha (bled), rendered side-on (ortho, looking +Y)."""
    sc = new_scene((res, res), 32, transparent=True)
    world_color(sc, (0, 0, 0), 0.0)
    sc.cycles.max_bounces = 0
    rng = np.random.default_rng(42)
    cw = 1.0            # each cell is 1 m wide, 2 m tall in the render
    for i, spec in enumerate(TUFTS):
        c, r = i % cols, i // cols
        ob = _tuft_objects(i, spec, 0.0, rng)
        ob.scale = (1.85, 1.85, 1.85)          # specs are in 'cell = 1 x 1.08' units -> fill the 1 x 2 cell
        ob.location = (c * cw + cw / 2, 0, (rows - 1 - r) * 2.0 * cw + 0.02)
    cd = bpy.data.cameras.new("Side")
    cd.type = "ORTHO"
    cd.ortho_scale = cols * cw
    cam = bpy.data.objects.new("Side", cd)
    sc.collection.objects.link(cam)
    cam.location = (cols * cw / 2, -10, rows * cw)     # frames x in [0, 4], z in [0, 4]
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    arr = render(sc, "grass_blades", samples=32)
    log(f"grass_blades: on {render.last[0]} {render.last[1]:.1f}s")
    a = np.clip(arr[..., 3], 0, 1)
    rgb = arr[..., :3] / np.maximum(a[..., None], 1e-4)
    rgba = np.dstack([lin_to_srgb(np.clip(rgb, 0, 1)), a])
    rgba = _bleed(rgba)
    sz = save_webp(rgba, os.path.join(TEX_DIR, "grass_blades.webp"), 92)
    return {"file": "textures/grass_blades.webp", "bytes": sz, "cols": cols, "rows": rows,
            "variants": [t[0] for t in TUFTS],
            "note": "alpha-mask atlas (alphaTest ~0.4), sRGB; cell i at col i%4, row i//4 from the TOP; root at the "
                    "bottom centre of each cell, cell aspect 1:2 (w:h)"}, rgba


def _bleed(rgba, iters=12):
    out = rgba.copy()
    mask = out[..., 3] > 0.02
    for _ in range(iters):
        acc = np.zeros_like(out[..., :3])
        cnt = np.zeros(mask.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sm = np.roll(mask, (dy, dx), (0, 1))
            acc += np.roll(out[..., :3], (dy, dx), (0, 1)) * sm[..., None]
            cnt += sm
        grow = (~mask) & (cnt > 0)
        out[grow, :3] = acc[grow] / cnt[grow][:, None]
        mask |= grow
    return out


BUILDERS = {"grass_blades": build_grass_blades, "water_normal": build_water_normal, "foam": build_foam,
            "cloud_noise": build_cloud_noise, "detail_noise": build_detail_noise}


def preview(results):
    tiles = []
    for k in KEYS:
        if k not in results:
            p = os.path.join(TEX_DIR, k + ".webp")
            if not os.path.exists(p):
                continue
            img = load_image(p)
        else:
            img = results[k]
        if img.shape[2] == 3:
            img = np.dstack([img, np.ones(img.shape[:2], np.float32)])
        if k == "grass_blades":
            t = resize(img, 512, 512)
            bg = checker_bg(512, 512)
            t = np.dstack([t[..., :3] * t[..., 3:4] + bg * (1 - t[..., 3:4]), np.ones((512, 512), np.float32)])
        else:
            small = resize(img, 256, 256) if img.shape[0] >= 256 else img
            small = resize(small, 256, 256)
            t = tile3(small)[..., :4]
            t = resize(t, 512, 512) if t.shape[0] != 512 else t
            t = np.dstack([t[..., :3], np.ones(t.shape[:2], np.float32)])
        tiles.append(label(t.copy(), k.upper() + ("" if k == "grass_blades" else " 3X3"), 6, 6, 2))
    if tiles:
        save_png(sheet(tiles, 5, "LOOKDEV SHARED TEXTURES"), os.path.join(PREVIEWS, "lookdev_textures.png"))


def write_manifest(entries):
    path = os.path.join(TEX_DIR, "manifest.json")
    data = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    data.update(entries)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
