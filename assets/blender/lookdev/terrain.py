"""Tileable PBR terrain sets (1024^2 WebP): <name>_albedo / _normal / _orm (+ _height) in client/public/textures/terrain/.

Each set is a real 3D ground patch built with Geometry Nodes (periodic displacement + periodic scatter of pebbles,
leaves, twigs, blades, setts...), shaded with procedural shader nodes and rendered top-down (see ld_scene).
Dark-fantasy palette: desaturated, earthy, rich micro detail.
"""
import json
import math
import os

import bpy
import numpy as np

import ld_scene as S
from ld_common import (NB, PREVIEWS, TERRAIN_DIR, TMP, label, lin_to_srgb, load_image, log, new_scene, pnoise,  # noqa: F401
                       pvoronoi, render, resize, save_png, save_webp, sheet, srgb_to_lin, tile3, tile_seam_error,
                       world_color, sock)

RES = 1024
TERRAINS = ["grass", "forest_floor", "dirt", "road", "cobble", "rock", "snow", "sand", "mud", "ash"]


# =============================================================================== small node helpers
def hsum(nb, pos, T, layers):
    """Periodic height: sum of layers (freq_per_tile, amp_m, detail, rough, seed[, kind])."""
    h = None
    for L in layers:
        f, a, det, rgh, sd = L[:5]
        kind = L[5] if len(L) > 5 else "noise"
        if kind == "noise":
            v = nb.sub(pnoise(nb, pos, f, det, rgh, seed=sd, period=T).outputs["Fac"], 0.5)
        elif kind == "ridge":
            v = nb.sub(0.25, nb.math("ABSOLUTE", nb.sub(pnoise(nb, pos, f, det, rgh, seed=sd, period=T).outputs["Fac"], 0.5)))
        elif kind == "cells":  # voronoi F1 distance (bumps)
            v = nb.sub(0.5, pvoronoi(nb, pos, f, seed=sd, period=T).outputs["Distance"])
        elif kind == "cracks":  # 0 on crack lines, 1 elsewhere
            e = pvoronoi(nb, pos, f, "DISTANCE_TO_EDGE", seed=sd, period=T).outputs["Distance"]
            v = nb.sub(nb.maprange(e, 0.0, 0.045, 0.0, 1.0, "SMOOTHSTEP"), 1.0)
        v = nb.mul(v, a * 2.0)
        h = v if h is None else nb.add(h, v)
    return h


def pal(nb, fac, colors, interp="LINEAR"):
    n = len(colors)
    return nb.ramp(fac, [(i / (n - 1), c) for i, c in enumerate(colors)], interp)


def pn(nb, pos, T, f, det=4.0, rgh=0.55, sd=0, dist=0.0):
    return pnoise(nb, pos, f, det, rgh, dist=dist, seed=sd, period=T).outputs["Fac"]


def rnd_col(cm, colors, name="rnd"):
    """Instance colour from a palette by the per-instance random."""
    return pal(cm.nb, cm.rnd(name), colors, "CONSTANT" if len(colors) > 2 else "LINEAR")


def local_noise(cm, scale, det=4.0, rgh=0.55, sd=0.0):
    nb = cm.nb
    v = nb.vmath("ADD", nb.vmath("SCALE", cm.obj, scale=scale), nb.vmath("SCALE", (1.7, 3.1, 5.3), scale=nb.mul(cm.rnd(), 37.0 + sd)))
    return nb.noise(v, 1.0, det, rgh).outputs["Fac"]


# =============================================================================== instance materials
def stone_mat(name, colors, rough=(0.55, 0.85), moss=0.0, wet=0.0):
    cm = S.CM(name)
    nb = cm.nb
    base = rnd_col(cm, colors)
    n1 = local_noise(cm, 60.0, 5.0, 0.6)
    n2 = local_noise(cm, 250.0, 3.0, 0.5, 5.0)
    base = nb.mix(base, nb.mix(base, "#222018", 0.6), nb.maprange(n1, 0.35, 0.75, 0.25, 0.0))
    base = nb.mix(base, nb.mix(base, "#d6d0c2", 0.35), nb.maprange(n2, 0.6, 0.8, 0.0, 0.35))
    # grime at the base (instance-local z)
    zl = nb.sep(cm.obj)[2]
    base = nb.mix(base, "#2a2219", nb.maprange(zl, 0.0, 0.012, 0.55, 0.0, "SMOOTHSTEP"))
    if moss:
        mm = nb.mul(nb.maprange(local_noise(cm, 40.0, 4.0, 0.6, 9.0), 0.55, 0.7, 0.0, moss), nb.smooth(nb.sep(cm.geo.outputs["Normal"])[2], 0.4, 0.9))
        base = nb.mix(base, "#4a5428", mm)
    r = nb.maprange(n1, 0.2, 0.8, rough[0], rough[1])
    if wet:
        r = nb.mul(r, 1.0 - 0.5 * wet)
        base = nb.mix(base, nb.vmath("SCALE", base, scale=0.6), wet)
    micro = nb.add(nb.mul(n2, 0.6), nb.mul(n1, 0.4))
    cm.finish(base, r, micro, micro_dist=0.0015, ao_dist=0.03)
    return cm.m


def leaf_mat(name, colors, rough=(0.55, 0.8), veins=True):
    cm = S.CM(name)
    nb = cm.nb
    base = rnd_col(cm, colors)
    o = nb.sep(cm.obj)
    # midrib + side veins (instance-local coordinates, leaf along +Y)
    ax = nb.math("ABSOLUTE", o[0])
    mid = nb.maprange(ax, 0.0, 0.0012, 1.0, 0.0, "SMOOTHSTEP")
    side = nb.math("ABSOLUTE", nb.math("SINE", nb.add(nb.mul(o[1], 260.0), nb.mul(ax, -330.0))))
    sv = nb.mul(nb.maprange(side, 0.93, 1.0, 0.0, 1.0), nb.maprange(ax, 0.0, 0.03, 1.0, 0.2))
    vein = nb.math("MAXIMUM", mid, nb.mul(sv, 0.6)) if veins else nb.mul(mid, 0.0)
    spots = local_noise(cm, 90.0, 4.0, 0.6, 3.0)
    decay = nb.maprange(spots, 0.58, 0.72, 0.0, 0.7)
    base = nb.mix(base, nb.mix(base, "#2b1d12", 0.7), decay)
    base = nb.mix(base, nb.mix(base, "#c8b48a", 0.25), nb.mul(vein, 0.7))
    edge = nb.maprange(local_noise(cm, 25.0, 2.0, 0.5, 7.0), 0.3, 0.7, 0.0, 0.3)
    base = nb.mix(base, "#3a2716", edge)
    r = nb.maprange(spots, 0.3, 0.7, rough[0], rough[1])
    micro = nb.sub(1.0, nb.mul(vein, 0.8))
    cm.finish(base, r, micro, micro_dist=0.0006, ao_dist=0.03)
    return cm.m


def wood_mat(name, colors, rough=(0.7, 0.9), char=0.0):
    cm = S.CM(name)
    nb = cm.nb
    base = rnd_col(cm, colors)
    o = cm.obj
    grain = nb.noise(nb.vmath("MULTIPLY", o, (40.0, 400.0, 400.0)), 1.0, 5.0, 0.6).outputs["Fac"]
    base = nb.mix(base, nb.mix(base, "#1a130c", 0.6), nb.maprange(grain, 0.3, 0.7, 0.4, 0.0))
    r = nb.maprange(grain, 0.3, 0.7, rough[0], rough[1])
    if char:
        cr = nb.voronoi(nb.vmath("SCALE", o, 350.0), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
        crack = nb.maprange(cr, 0.0, 0.08, 1.0, 0.0)
        base = nb.mix(base, "#0d0b0a", nb.mul(crack, char))
        grain = nb.sub(grain, nb.mul(crack, 0.8))
    cm.finish(base, r, grain, micro_dist=0.0008, ao_dist=0.03)
    return cm.m


def blade_mat(name, colors, tip="#9a8a55", rough=(0.55, 0.75)):
    cm = S.CM(name)
    nb = cm.nb
    base = rnd_col(cm, colors)
    o = nb.sep(cm.obj)
    along = nb.maprange(nb.math("LENGTH", nb.xyz(o[1], o[2], 0.0)) if False else nb.add(o[1], o[2]), 0.0, 0.12, 0.0, 1.0)
    base = nb.mix(nb.mix(base, "#1c2210", 0.55), base, nb.maprange(along, 0.0, 0.35))
    base = nb.mix(base, tip, nb.mul(nb.maprange(along, 0.6, 1.0), nb.maprange(cm.rnd("r4"), 0.0, 1.0, 0.15, 0.6)))
    stripe = nb.math("ABSOLUTE", nb.math("SINE", nb.mul(o[0], 2500.0)))
    base = nb.mix(base, nb.vmath("SCALE", base, scale=0.8), nb.mul(stripe, 0.3))
    r = nb.maprange(cm.rnd("r3"), 0.0, 1.0, rough[0], rough[1])
    cm.finish(base, r, stripe, micro_dist=0.0003, ao_dist=0.04)
    return cm.m


# =============================================================================== ground materials
def ground_mat(name, T, layers, rough=(0.8, 0.95), micro=(260.0, 0.0012), extra=None):
    """layers: list of (palette, freq, threshold_lo, threshold_hi, seed) — first is the base, others are masked
    overlays. extra(cm, base, rough) -> (base, rough, micro, kwargs)."""
    cm = S.CM(name)
    nb = cm.nb
    p = cm.pos
    base = None
    for i, (cols, f, lo, hi, sd) in enumerate(layers):
        n = pn(nb, p, T, f, 5.0, 0.6, sd, dist=0.3)
        c = pal(nb, nb.maprange(pn(nb, p, T, f * 3.0, 4.0, 0.55, sd + 50), 0.3, 0.7), cols)
        if base is None:
            base = c
        else:
            base = nb.mix(base, c, nb.maprange(n, lo, hi, 0.0, 1.0, "SMOOTHSTEP"))
    fine = pn(nb, p, T, micro[0], 4.0, 0.6, 77)
    grain = pn(nb, p, T, micro[0] * 2.5, 2.0, 0.5, 78)
    base = nb.mix(base, nb.vmath("SCALE", base, scale=0.72), nb.maprange(fine, 0.35, 0.65, 0.5, 0.0))
    base = nb.mix(base, nb.vmath("SCALE", base, scale=1.2), nb.maprange(grain, 0.6, 0.75, 0.0, 0.35))
    r = nb.maprange(pn(nb, p, T, 9.0, 3.0, 0.5, 79), 0.3, 0.7, rough[0], rough[1])
    m = nb.add(nb.mul(fine, 0.7), nb.mul(grain, 0.3))
    kw = {}
    if extra:
        base, r, m, kw = extra(cm, base, r, m)
    cm.finish(base, r, m, micro_dist=micro[1], ao_dist=kw.pop("ao_dist", 0.05), **kw)
    return cm.m


# =============================================================================== terrain definitions
def _pebbles(prefix, n, colors, size=(0.01, 0.03), flat=0.55, moss=0.0, wet=0.0, seed=0, rough=0.28):
    mat = stone_mat(f"{prefix}_StoneMat", colors, moss=moss, wet=wet)
    return [S.pebble(f"{prefix}_peb{i}", mat, size=size[0] + (size[1] - size[0]) * i / max(1, n - 1),
                     flat=flat * (0.8 + 0.4 * ((i * 37) % 10) / 10), rough=rough, seed=seed + i) for i in range(n)]


def def_grass(T):
    def hf(nb, p):
        return hsum(nb, p, T, [(3, 0.03, 4, 0.5, 1), (11, 0.01, 3, 0.5, 2)])
    gm = ground_mat("GroundGrass", T, [(["#2e251b", "#3a2f22", "#2a2419"], 4, 0, 1, 1),
                                       (["#353b20", "#2c3219"], 6, 0.45, 0.62, 2)], rough=(0.85, 0.97))
    S.ground("Ground", T, hf, gm)
    bm = blade_mat("BladeMat", ["#4b5629", "#56602e", "#5f6534", "#434d24", "#6b6739", "#3d4722", "#7a6c45"],
                   tip="#a09358")
    blades = [S.blade(f"blade{i}", bm, length=0.05 + 0.015 * (i % 5), width=0.0045 + 0.0008 * (i % 3),
                      bend=0.9 + 0.25 * (i % 4), lie=0.35 + 0.12 * (i % 3), seed=i) for i in range(10)]
    S.scatter("Blades", T, hf, S.template_collection("C_blades", blades), 5200, seed=3, scale=(0.75, 1.3), tilt=0.25)
    lm = leaf_mat("CloverMat", ["#3c4a22", "#44522a", "#35401e"], veins=False)
    clov = [S.leaf(f"clov{i}", lm, length=0.014 + 0.003 * i, width=0.012 + 0.002 * i, curl=0.3, seed=i) for i in range(3)]
    S.scatter("Clover", T, hf, S.template_collection("C_clover", clov), 260, seed=5, scale=(0.8, 1.2), tilt=0.2,
              mask=lambda nb, p: nb.maprange(pn(nb, p, T, 5, 3, 0.5, 31), 0.45, 0.6))
    peb = _pebbles("g", 4, ["#5d574d", "#4d483f", "#696153"], (0.006, 0.018), seed=11)
    S.scatter("Pebbles", T, hf, S.template_collection("C_peb", peb), 25, seed=7, embed=0.3)
    return hf


def def_forest_floor(T):
    def hf(nb, p):
        return hsum(nb, p, T, [(3, 0.045, 4, 0.5, 3), (10, 0.012, 3, 0.5, 4)])

    def extra(cm, base, r, m):
        nb = cm.nb
        mo = pn(nb, cm.pos, T, 5, 5, 0.6, 12, dist=0.4)
        mm = nb.maprange(mo, 0.56, 0.64, 0.0, 1.0, "SMOOTHSTEP")
        mc = pal(nb, pn(nb, cm.pos, T, 60, 4, 0.6, 13), ["#27300f", "#39441c", "#4d5626"])
        base = nb.mix(base, mc, mm)
        m = nb.mixf(m, nb.add(0.5, nb.mul(pn(nb, cm.pos, T, 500, 3, 0.6, 14), 0.8)), mm)
        return base, r, m, {}
    gm = ground_mat("GroundForest", T, [(["#231a13", "#2d2219", "#1d1611"], 4, 0, 1, 5)], rough=(0.88, 0.97), extra=extra)
    S.ground("Ground", T, hf, gm)
    lm = leaf_mat("LeafMat", ["#5e4127", "#6f4d2b", "#4a3322", "#7c5329", "#806c38", "#56502c", "#3d2b1d", "#8a5e2e"])
    leaves = [S.leaf(f"leaf{i}", lm, length=0.05 + 0.012 * (i % 4), width=0.03 + 0.008 * (i % 3), lobes=(4 if i % 3 == 0 else 0),
                     curl=0.2 + 0.1 * (i % 3), seed=i) for i in range(8)]
    S.scatter("Leaves", T, hf, S.template_collection("C_leaves", leaves), 420, seed=11, scale=(0.75, 1.25), tilt=0.35,
              flip=True, mask=lambda nb, p: nb.maprange(pn(nb, p, T, 4, 3, 0.5, 21), 0.35, 0.6, 0.25, 1.0))
    nm = wood_mat("NeedleMat", ["#6b5230", "#7a6038", "#54402a"], rough=(0.5, 0.7))
    needles = [S.stick(f"needle{i}", nm, length=0.03 + 0.008 * i, radius=0.0007, bend=0.1, seed=i, segs=3, sides=4)
               for i in range(4)]
    S.scatter("Needles", T, hf, S.template_collection("C_needles", needles), 500, seed=13, tilt=0.2)
    tm = wood_mat("TwigMat", ["#3a2d22", "#4a3a2a", "#2f251c"])
    twigs = [S.stick(f"twig{i}", tm, length=0.12 + 0.06 * i, radius=0.003 + 0.0015 * i, bend=0.35, seed=i) for i in range(4)]
    S.scatter("Twigs", T, hf, S.template_collection("C_twigs", twigs), 7, seed=17, tilt=0.1, embed=0.2)
    peb = _pebbles("f", 3, ["#4d4a42", "#5b564b"], (0.01, 0.03), moss=0.6, seed=21)
    S.scatter("Pebbles", T, hf, S.template_collection("C_peb", peb), 5, seed=19, embed=0.3)
    return hf


def def_dirt(T):
    def hf(nb, p):
        return hsum(nb, p, T, [(2, 0.03, 4, 0.5, 5), (8, 0.01, 4, 0.55, 6), (12, 0.0035, 0, 0, 7, "cracks")])

    def extra(cm, base, r, m):
        nb = cm.nb
        e = pvoronoi(nb, cm.pos, 12, "DISTANCE_TO_EDGE", seed=7, period=T).outputs["Distance"]
        crack = nb.maprange(e, 0.0, 0.03, 1.0, 0.0, "SMOOTHSTEP")
        base = nb.mix(base, "#241a12", nb.mul(crack, 0.8))
        return base, r, m, {}
    gm = ground_mat("GroundDirt", T, [(["#4f3d2b", "#5d4832", "#46362a"], 3, 0, 1, 8),
                                      (["#6a5741", "#735f47"], 5, 0.5, 0.68, 9)], rough=(0.85, 0.97), extra=extra)
    S.ground("Ground", T, hf, gm)
    peb = _pebbles("d", 5, ["#6a6255", "#5a5246", "#7a6f60", "#4e463c"], (0.005, 0.02), seed=31)
    S.scatter("Pebbles", T, hf, S.template_collection("C_peb", peb), 90, seed=23, embed=0.35)
    clod_m = stone_mat("ClodMat", ["#4b3a29", "#56432f", "#3f3124"], rough=(0.88, 0.97))
    clods = [S.pebble(f"clod{i}", clod_m, size=0.012 + 0.006 * i, flat=0.35, rough=0.4, seed=40 + i) for i in range(3)]
    S.scatter("Clods", T, hf, S.template_collection("C_clod", clods), 45, seed=29, embed=0.4)
    tm = wood_mat("RootMat", ["#3a2b1f", "#4b3827"])
    twigs = [S.stick(f"twig{i}", tm, length=0.1 + 0.05 * i, radius=0.002 + 0.001 * i, bend=0.5, seed=i) for i in range(3)]
    S.scatter("Twigs", T, hf, S.template_collection("C_twigs", twigs), 2.5, seed=31, embed=0.5)
    return hf


def def_road(T):
    def hf(nb, p):
        return hsum(nb, p, T, [(2, 0.018, 3, 0.5, 9), (9, 0.006, 4, 0.5, 10)])

    def extra(cm, base, r, m):
        nb = cm.nb
        comp = nb.maprange(pn(nb, cm.pos, T, 4, 3, 0.5, 44), 0.45, 0.65, 0.0, 1.0)
        r = nb.mixf(r, 0.68, nb.mul(comp, 0.6))
        base = nb.mix(base, nb.vmath("SCALE", base, scale=0.85), nb.mul(comp, 0.4))
        return base, r, m, {}
    gm = ground_mat("GroundRoad", T, [(["#5f4f3c", "#6b5a45", "#574836"], 3, 0, 1, 11),
                                      (["#77664f", "#806d54"], 6, 0.5, 0.7, 12)], rough=(0.8, 0.93), extra=extra)
    S.ground("Ground", T, hf, gm)
    peb = _pebbles("r", 6, ["#6d665c", "#5a554d", "#7a6f5f", "#827a6c", "#4f4a43"], (0.025, 0.08), flat=0.42, seed=51, rough=0.2)
    S.scatter("Stones", T, hf, S.template_collection("C_stones", peb), 60, seed=37, dist_min=0.06, embed=0.55, tilt=0.08)
    gr = _pebbles("rg", 5, ["#77705f", "#5e584c", "#8a8272", "#4b463e"], (0.004, 0.011), seed=61)
    S.scatter("Gravel", T, hf, S.template_collection("C_gravel", gr), 520, seed=41, embed=0.3)
    return hf


def def_cobble(T):
    """Village plaza: rows of rounded granite setts with dirt/moss joints (python-placed, periodic rows)."""
    rows = 12
    rh = T / rows
    rng = np.random.default_rng(5)

    def hf(nb, p):
        return hsum(nb, p, T, [(3, 0.012, 3, 0.5, 13), (12, 0.003, 3, 0.5, 14)])

    def extra(cm, base, r, m):
        return base, r, m, {"ao_dist": 0.06}
    gm = ground_mat("GroundJoint", T, [(["#2e261d", "#3a3025", "#282119"], 5, 0, 1, 15),
                                       (["#353d1e", "#414a24"], 7, 0.45, 0.58, 16)], rough=(0.88, 0.98), extra=extra)
    S.ground("Ground", T, hf, gm, res_per_m=80)
    sm = S.CM("SettMat")
    nb = sm.nb
    rattr = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": "srnd"}).outputs["Fac"]
    base = pal(nb, rattr, ["#6f6a62", "#7c776d", "#645f58", "#857d6f", "#6b6153", "#5a5752", "#77736b"])
    p = sm.pos
    n1 = pn(nb, p, T, 60, 5, 0.6, 71)
    n2 = pn(nb, p, T, 300, 3, 0.55, 72)
    speck = pvoronoi(nb, p, 900, seed=73, period=T)
    base = nb.mix(base, nb.mix(base, "#1f1c18", 0.5), nb.maprange(n1, 0.3, 0.7, 0.3, 0.0))
    base = nb.mix(base, "#b5ad9d", nb.mul(nb.maprange(nb.bw(speck.outputs["Color"]), 0.85, 0.95), 0.35))
    z = nb.sep(p)[2]
    top = nb.smooth(nb.sep(sm.geo.outputs["Normal"])[2], 0.75, 0.97)
    base = nb.mix(base, "#2b241c", nb.maprange(z, 0.0, 0.035, 0.75, 0.0, "SMOOTHSTEP"))
    mossm = nb.mul(nb.maprange(pn(nb, p, T, 7, 4, 0.6, 16), 0.45, 0.6), nb.maprange(z, 0.0, 0.03, 1.0, 0.0))
    base = nb.mix(base, "#3b4420", nb.mul(mossm, 0.8))
    rr = nb.mixf(nb.maprange(n2, 0.3, 0.7, 0.72, 0.88), 0.5, nb.mul(top, 0.7))
    sm.finish(base, rr, nb.add(nb.mul(n2, 0.6), nb.mul(n1, 0.4)), micro_dist=0.0015, ao_dist=0.06)
    # build one mesh with every sett of the tile, then 9 linked copies
    import bmesh
    bm_all = bmesh.new()
    rlay = bm_all.faces.layers.float.new("srnd")
    k = 0
    for ri in range(rows):
        widths = []
        while sum(widths) < T - 0.3:
            widths.append(rng.uniform(0.15, 0.27))
        widths.append(T - sum(widths))
        if widths[-1] < 0.12:
            w_last = widths.pop()
            widths[-1] += w_last
        x = rng.uniform(0, T)
        for w in widths:
            gap = rng.uniform(0.012, 0.022)
            ob = S.rounded_box("_tmp", sm.m, dims=(w - gap, rh - gap * rng.uniform(0.9, 1.3), rng.uniform(0.07, 0.1)),
                               bevel=rng.uniform(0.28, 0.4), seed=1000 + k, dome=rng.uniform(0.1, 0.3), jitter=0.06)
            me = ob.data
            cx, cy = (x + w / 2) % T, (ri + 0.5) * rh + rng.uniform(-0.006, 0.006)
            rz = rng.uniform(-0.05, 0.05)
            cz = -0.035 + rng.uniform(-0.01, 0.006)
            tilt = rng.normal(0, 0.03, 2)
            from mathutils import Euler, Matrix, Vector
            M = Matrix.Translation(Vector((cx, cy, cz))) @ Euler((tilt[0], tilt[1], rz)).to_matrix().to_4x4()
            me.transform(M)
            bm_all.from_mesh(me)
            rv = float(rng.uniform())
            for f in bm_all.faces:
                if f[rlay] == 0.0:
                    f[rlay] = rv + 1e-4
            bpy.data.objects.remove(ob)
            bpy.data.meshes.remove(me)
            x += w
            k += 1
    me = bpy.data.meshes.new("Setts")
    bm_all.to_mesh(me)
    bm_all.free()
    for pl in me.polygons:
        pl.use_smooth = True
    me.materials.append(sm.m)
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            ob = bpy.data.objects.new(f"Setts_{i}_{j}", me)
            ob.location = (i * T, j * T, 0)
            bpy.context.scene.collection.objects.link(ob)
    gr = _pebbles("cg", 4, ["#5e584c", "#4b463e", "#6d665a"], (0.004, 0.01), seed=81)
    S.scatter("Grit", T, hf, S.template_collection("C_grit", gr), 160, seed=43, embed=0.3)
    return hf


def def_rock(T):
    """Cliff face strata (use triplanar on cliffs): layered ledges, fractures, lichen."""
    LAY = 7

    def strata(nb, p):
        s = nb.sep(p)
        dist = nb.mul(nb.sub(pn(nb, p, T, 2, 3, 0.5, 91), 0.5), 1.4)
        return nb.add(nb.mul(s[1], LAY / T), dist)

    def hf(nb, p):
        st = strata(nb, p)
        f = nb.math("FRACT", st)
        ledge = nb.mul(nb.add(nb.maprange(f, 0.0, 0.18, 0.0, 1.0, "SMOOTHSTEP"), nb.mul(f, -0.35)), 0.09)
        h = hsum(nb, p, T, [(2, 0.12, 4, 0.55, 92), (7, 0.03, 5, 0.55, 93, "ridge"), (6, 0.02, 0, 0, 94, "cracks"),
                            (28, 0.006, 4, 0.6, 95)])
        return nb.add(h, ledge)

    def extra(cm, base, r, m):
        nb = cm.nb
        st = strata(nb, cm.pos)
        band = nb.math("FRACT", nb.mul(nb.math("FLOOR", st), 0.618))
        bc = pal(nb, band, ["#6f6a62", "#5d5850", "#7b7264", "#4f4b45", "#6a6358", "#827a6d"], "CONSTANT")
        base = nb.mix(base, bc, 0.65)
        z = nb.sep(cm.pos)[2]
        base = nb.mix(base, "#2a251f", nb.maprange(z, -0.12, 0.0, 0.5, 0.0, "SMOOTHSTEP"))
        lich = nb.maprange(pn(nb, cm.pos, T, 9, 5, 0.65, 96, dist=0.5), 0.62, 0.68, 0.0, 1.0)
        lc = pal(nb, pn(nb, cm.pos, T, 40, 3, 0.5, 97), ["#6d7550", "#8b8b73", "#5a6340"])
        base = nb.mix(base, lc, nb.mul(lich, 0.75))
        e = pvoronoi(nb, cm.pos, 6, "DISTANCE_TO_EDGE", seed=94, period=T).outputs["Distance"]
        base = nb.mix(base, "#1c1915", nb.maprange(e, 0.0, 0.02, 0.8, 0.0, "SMOOTHSTEP"))
        return base, r, m, {"ao_dist": 0.15}
    gm = ground_mat("RockFace", T, [(["#66615a", "#57534c", "#6e675d"], 3, 0, 1, 98)], rough=(0.72, 0.9),
                    micro=(220.0, 0.002), extra=extra)
    S.ground("Ground", T, hf, gm, res_per_m=120)
    return hf


def def_snow(T):
    def hf(nb, p):
        s = nb.sep(p)
        q = nb.xyz(s[0], nb.mul(s[1], 4.0), 0.0)     # integer anisotropy keeps it periodic
        sast = nb.mul(nb.sub(pnoise(nb, q, 10, 3, 0.5, seed=101, period=T).outputs["Fac"], 0.5), 0.02)
        return nb.add(hsum(nb, p, T, [(2, 0.06, 3, 0.5, 102), (8, 0.01, 3, 0.5, 103)]), sast)

    def extra(cm, base, r, m):
        nb = cm.nb
        z = nb.sep(cm.pos)[2]
        base = nb.mix(base, "#c4d0e0", nb.maprange(z, -0.05, 0.02, 0.6, 0.0, "SMOOTHSTEP"))
        sp = pvoronoi(nb, cm.pos, 700, seed=104, period=T)
        glint = nb.maprange(nb.bw(sp.outputs["Color"]), 0.9, 0.97, 0.0, 1.0)
        r = nb.mixf(r, 0.18, glint)
        dirt = nb.maprange(pn(nb, cm.pos, T, 30, 3, 0.5, 105), 0.68, 0.75, 0.0, 0.25)
        base = nb.mix(base, "#8b8580", dirt)
        return base, r, m, {"ao_dist": 0.08}
    gm = ground_mat("GroundSnow", T, [(["#e3e8ee", "#d8dfe8", "#eef1f4"], 3, 0, 1, 106)], rough=(0.55, 0.78),
                    micro=(300.0, 0.0012), extra=extra)
    S.ground("Ground", T, hf, gm)
    peb = _pebbles("s", 3, ["#4a4642", "#3b3835"], (0.02, 0.05), seed=111)
    S.scatter("Stones", T, hf, S.template_collection("C_peb", peb), 1.5, seed=47, embed=0.6)
    tm = wood_mat("TwigMat", ["#2e241c", "#3b2e22"])
    twigs = [S.stick(f"twig{i}", tm, length=0.1 + 0.05 * i, radius=0.0025, bend=0.4, seed=i) for i in range(2)]
    S.scatter("Twigs", T, hf, S.template_collection("C_twigs", twigs), 0.6, seed=49, embed=0.4)
    return hf


def def_sand(T):
    K = 24

    def ripple(nb, p):
        s = nb.sep(p)
        ph = nb.add(nb.mul(s[0], K / T), nb.mul(nb.sub(pn(nb, p, T, 2, 3, 0.5, 121), 0.5), 2.5))
        f = nb.math("FRACT", ph)
        # asymmetric ripple: gentle stoss slope, steep lee
        return nb.math("MINIMUM", nb.math("DIVIDE", f, 0.75), nb.math("DIVIDE", nb.sub(1.0, f), 0.25))

    def hf(nb, p):
        rp = nb.mul(nb.sub(ripple(nb, p), 0.5), 0.012)
        return nb.add(rp, hsum(nb, p, T, [(1, 0.06, 3, 0.5, 122), (6, 0.008, 3, 0.5, 123)]))

    def extra(cm, base, r, m):
        nb = cm.nb
        rp = ripple(nb, cm.pos)
        base = nb.mix(base, "#8a765a", nb.maprange(rp, 0.0, 0.3, 0.45, 0.0))
        g = pvoronoi(nb, cm.pos, 1400, seed=124, period=T)
        base = nb.mix(base, pal(nb, nb.bw(g.outputs["Color"]), ["#6e604c", "#c9b793", "#9b8666", "#d8cbb0"]), 0.25)
        return base, r, m, {}
    gm = ground_mat("GroundSand", T, [(["#ab9370", "#b69e79", "#a08a69"], 2, 0, 1, 125)], rough=(0.86, 0.96),
                    micro=(420.0, 0.0008), extra=extra)
    S.ground("Ground", T, hf, gm, res_per_m=130)
    peb = _pebbles("sa", 4, ["#8b7d69", "#6f6555", "#a39580", "#5b5247"], (0.006, 0.02), seed=131)
    S.scatter("Pebbles", T, hf, S.template_collection("C_peb", peb), 6, seed=53, embed=0.4)
    return hf


def def_mud(T):
    WATER = -0.018

    def hf(nb, p):
        return hsum(nb, p, T, [(3, 0.04, 4, 0.55, 141), (9, 0.012, 4, 0.55, 142), (25, 0.003, 3, 0.5, 143)])

    def extra(cm, base, r, m):
        nb = cm.nb
        z = nb.sep(cm.pos)[2]
        wet = nb.maprange(z, WATER + 0.004, WATER - 0.001, 0.0, 1.0, "SMOOTHSTEP")
        damp = nb.maprange(z, WATER + 0.03, WATER, 0.0, 1.0)
        base = nb.mix(base, nb.vmath("SCALE", base, scale=0.6), damp)
        base = nb.mix(base, "#1c1812", nb.mul(wet, 0.85))
        r = nb.mixf(nb.mixf(r, 0.45, damp), 0.06, wet)
        m = nb.mixf(m, 0.5, wet)
        return base, r, m, {}
    gm = ground_mat("GroundMud", T, [(["#3b2f23", "#45372a", "#33291f"], 3, 0, 1, 144),
                                     (["#54442f", "#4d3f2e"], 5, 0.55, 0.7, 145)], rough=(0.6, 0.85), extra=extra)
    S.ground("Ground", T, hf, gm)
    # water sheet in the hollows (flat -> puddles have a flat height/normal)
    water = S.CM("MudWater")
    water.finish("#16130f", 0.05, None, ao_dist=0.03)
    bpy.ops.mesh.primitive_plane_add(size=T * 1.3, location=(T / 2, T / 2, WATER))
    bpy.context.object.data.materials.append(water.m)
    peb = _pebbles("m", 4, ["#4e463c", "#5b5246", "#3f3830"], (0.01, 0.035), wet=0.6, seed=151)
    S.scatter("Stones", T, hf, S.template_collection("C_peb", peb), 14, seed=59, embed=0.5)
    bm = blade_mat("DeadBladeMat", ["#5a4e32", "#4a4430", "#6a5a3a", "#3e4424"], tip="#7d6d48", rough=(0.4, 0.6))
    blades = [S.blade(f"blade{i}", bm, length=0.06 + 0.02 * i, width=0.004, bend=1.3, lie=1.0, seed=i) for i in range(4)]
    S.scatter("Straw", T, hf, S.template_collection("C_straw", blades), 70, seed=61, tilt=0.1)
    tm = wood_mat("TwigMat", ["#2e2319", "#3a2c1f"], rough=(0.45, 0.7))
    twigs = [S.stick(f"twig{i}", tm, length=0.12 + 0.05 * i, radius=0.003 + 0.001 * i, bend=0.4, seed=i) for i in range(3)]
    S.scatter("Twigs", T, hf, S.template_collection("C_twigs", twigs), 3, seed=67, embed=0.4)
    return hf


def def_ash(T):
    def hf(nb, p):
        return hsum(nb, p, T, [(3, 0.03, 3, 0.5, 161), (14, 0.006, 3, 0.5, 162)])

    def extra(cm, base, r, m):
        nb = cm.nb
        ch = nb.maprange(pn(nb, cm.pos, T, 6, 5, 0.6, 163, dist=0.3), 0.58, 0.66, 0.0, 1.0)
        base = nb.mix(base, "#211e1c", nb.mul(ch, 0.8))
        streak = nb.maprange(pn(nb, cm.pos, T, 4, 4, 0.55, 164), 0.55, 0.7, 0.0, 0.3)
        base = nb.mix(base, "#8a847c", streak)
        return base, r, m, {}
    gm = ground_mat("GroundAsh", T, [(["#57544f", "#4a4744", "#625e58"], 3, 0, 1, 165)], rough=(0.9, 0.98),
                    micro=(380.0, 0.0008), extra=extra)
    S.ground("Ground", T, hf, gm)
    cm_ = stone_mat("CinderMat", ["#2b2725", "#3a2a24", "#241f1d", "#4a3128"], rough=(0.45, 0.8))
    cinders = [S.pebble(f"cinder{i}", cm_, size=0.01 + 0.008 * i, flat=0.6, rough=0.45, seed=170 + i, subdiv=3) for i in range(4)]
    S.scatter("Cinders", T, hf, S.template_collection("C_cinder", cinders), 45, seed=71, embed=0.35)
    wm = wood_mat("CharMat", ["#141211", "#1d1917", "#262220"], rough=(0.35, 0.6), char=0.9)
    sticks = [S.stick(f"char{i}", wm, length=0.15 + 0.08 * i, radius=0.006 + 0.004 * i, bend=0.25, seed=i) for i in range(3)]
    S.scatter("Char", T, hf, S.template_collection("C_char", sticks), 3.5, seed=73, embed=0.35)
    return hf


DEFS = {
    "grass": (3.0, def_grass), "forest_floor": (3.0, def_forest_floor), "dirt": (3.0, def_dirt),
    "road": (3.0, def_road), "cobble": (2.0, def_cobble), "rock": (4.0, def_rock), "snow": (4.0, def_snow),
    "sand": (4.0, def_sand), "mud": (3.0, def_mud), "ash": (3.0, def_ash),
}


# =============================================================================== build one set
def build_terrain(name, res=RES, spp=None):
    T, fn = DEFS[name]
    sc = new_scene((res, res), 16)
    world_color(sc, (0, 0, 0), 0.0)
    S.reset_mats()
    fn(T)
    S.ortho_topdown(sc, T, res)
    sc.cycles.max_bounces = 0
    sc.cycles.diffuse_bounces = 0
    spp = spp or {"albedo": 16, "rough": 8, "height": 8, "normal": 16, "ao": 20}  # AO node: 16 rays per sample
    ch = {}
    for c in S.CHANNELS:
        S.set_pass(c)
        ch[c] = render(sc, f"terrain_{name}_{c}", samples=spp[c])
        log(f"terrain {name}: {c} {spp[c]} spp on {render.last[0]} {render.last[1]:.1f}s")
    alb_lin = ch["albedo"][..., :3]
    ao = np.clip(ch["ao"][..., 0], 0, 1)
    rough = np.clip(ch["rough"][..., 0], 0.03, 1)
    nrm = ch["normal"][..., :3] * 2 - 1
    nrm /= np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-6)
    nrm[..., 2] = np.maximum(nrm[..., 2], 0.05)
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    hgt = ch["height"][..., 0]
    lo, hi = np.percentile(hgt, 0.3), np.percentile(hgt, 99.7)
    hn = np.clip((hgt - lo) / max(hi - lo, 1e-6), 0, 1)
    # outputs
    alb = lin_to_srgb(alb_lin * (0.72 + 0.28 * ao[..., None]))        # a touch of cavity in the albedo
    orm = np.dstack([ao ** 0.85, rough, np.zeros_like(ao)])
    sizes = {}
    base = os.path.join(TERRAIN_DIR, name)
    sizes["albedo"] = save_webp(alb, base + "_albedo.webp", 88)
    sizes["normal"] = save_webp(nrm * 0.5 + 0.5, base + "_normal.webp", 88)
    sizes["orm"] = save_webp(orm, base + "_orm.webp", 85)
    sizes["height"] = save_webp(hn, base + "_height.webp", 80)
    seams = {k: round(tile_seam_error(v), 3) for k, v in (("albedo", alb), ("normal", nrm), ("ao", ao), ("rough", rough))}
    log(f"terrain {name}: seam ratio {seams} sizes {sum(sizes.values()) // 1024} KB")
    return {"tile_m": T, "files": {k: f"textures/terrain/{name}_{k}.webp" for k in ("albedo", "normal", "orm", "height")},
            "bytes": sizes, "seam_ratio": seams, "height_range_m": [round(float(lo), 4), round(float(hi), 4)],
            "mean_albedo_srgb": [round(float(x), 3) for x in alb.reshape(-1, 3).mean(0)]}


def lit_preview(name, sun=(0.55, -0.35, 0.45), tiles=3, size=384):
    """Numpy-shaded preview (albedo x (ambient*AO + sun*N.L)) of a tiled set, from the saved WebPs."""
    base = os.path.join(TERRAIN_DIR, name)
    alb = resize(load_image(base + "_albedo.webp")[..., :3], size, size)
    nrm = resize(load_image(base + "_normal.webp")[..., :3], size, size) * 2 - 1
    orm = resize(load_image(base + "_orm.webp")[..., :3], size, size)
    L = np.array(sun) / np.linalg.norm(sun)
    ndl = np.clip((nrm * L).sum(-1), 0, 1)
    lin = srgb_to_lin(alb)
    col = lin * (0.35 * orm[..., :1] * np.array([0.75, 0.82, 1.0]) + 1.9 * ndl[..., None] * np.array([1.0, 0.9, 0.75]))
    col = lin_to_srgb(np.clip(col, 0, 1))
    return np.tile(col, (tiles, tiles, 1)), np.tile(alb, (tiles, tiles, 1))


def write_manifest(entries):
    path = os.path.join(TERRAIN_DIR, "manifest.json")
    data = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    data["_doc"] = ("Tileable PBR ground sets, 1024x1024 WebP, seamless (periodic geometry rendered top-down). "
                    "albedo = sRGB; normal = tangent space OpenGL (+Y up, same as glTF/three.js); orm = R ambient "
                    "occlusion, G roughness, B metalness (0); height = 0..1 relief (for height-based layer "
                    "blending / parallax). tile_m = metres covered by one repeat (set texture.repeat = "
                    "worldSize / tile_m). seam_ratio ~1 means the wrap edge is indistinguishable from any interior "
                    "pixel line.")
    data.update(entries)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return path


def preview(names):
    lit_tiles, alb_tiles = [], []
    for n in names:
        if not os.path.exists(os.path.join(TERRAIN_DIR, n + "_albedo.webp")):
            continue
        lit, alb = lit_preview(n, size=256)
        lit_tiles.append(label(lit, n.upper() + " LIT 3X3", 6, 6, 2))
        alb_tiles.append(label(alb, n.upper() + " ALBEDO 3X3", 6, 6, 2))
    if lit_tiles:
        save_png(sheet(lit_tiles, 5, "LOOKDEV TERRAIN - 3X3 TILED, LOW SUN (NORMAL+AO+ALBEDO)"),
                 os.path.join(PREVIEWS, "lookdev_terrain.png"))
        save_png(sheet(alb_tiles, 5, "LOOKDEV TERRAIN - 3X3 TILED ALBEDO"), os.path.join(PREVIEWS, "lookdev_terrain_albedo.png"))
    for n in names:
        if os.path.exists(os.path.join(TERRAIN_DIR, n + "_albedo.webp")):
            lit, _ = lit_preview(n, size=512, tiles=2)
            save_png(label(lit, n.upper() + " 2X2 LIT", 6, 6, 3), os.path.join(PREVIEWS, f"lookdev_terrain_{n}.png"))
