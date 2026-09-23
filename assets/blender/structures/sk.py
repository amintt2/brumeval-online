"""Structures toolkit (group-specific helpers on top of assets/blender/kit).

Parts are separate objects built at real size in their OWN local frame (never scaled), so the kit's procedural
materials (OBJECT coordinates) follow each part: wood grain runs along every beam, planks along every board.
Each part's mesh is also shifted by a random local offset (compensated by the object matrix) so identical parts
never show identical texture. Everything is baked into one atlas per texture group, then joined.

    P = Parts(seed=3)
    P.box("Door", (1.0, 0.08, 2.0), (0, -3, 1.0), mat=MAT.wood("Z"))
    P.beam((0, 0, 0), (0, 0, 3), 0.2, 0.2, MAT.wood("Z"))
    stones = stone_wall(P, [((-3, -3), (3, -3))], 0.0, 0.7, ...)   # GN-instanced irregular stones
    finish("house", P.objs, budget="building", expected=(6, 6, 5.5), size=2048, args=args)
"""
import math
import os
import random

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils import Matrix, Vector

import common as C
from kit import bake, export, gn, lod, qa, render
from kit import materials as M
from kit.nodes import NB, sock

V = Vector


# =============================================================================== materials
class Mats:
    """Lazily created village materials (one instance per model; C.reset() wipes the file)."""

    def __init__(self):
        self.c = {}

    def _get(self, key, fn):
        if key not in self.c:
            self.c[key] = fn()
        return self.c[key]

    # --- wood --------------------------------------------------------------------------------------------------
    def wood(self, axis="Z", tone="dark"):
        pal = {"dark": ("#5a4030", "#2e1f14", 0.35), "old": ("#6e5c49", "#3a2c20", 0.6),
               "red": ("#6a3c26", "#351c10", 0.25), "fresh": ("#8a6440", "#4d3520", 0.1)}[tone]
        return self._get(("wood", axis, tone), lambda: M.wood(f"Wood_{tone}_{axis}", color=pal[0], color2=pal[1],
                                                                axis=axis, weathered=pal[2], wear=0.5, dirt=0.55,
                                                                seed=len(self.c)))

    def planks(self, axis="X", tone="old", plank=(1.6, 0.2)):
        pal = {"dark": ("#5a4030", "#2e1f14"), "old": ("#6e5c49", "#3a2c20"), "red": ("#6a3c26", "#351c10")}[tone]
        return self._get(("planks", axis, tone), lambda: M.wood_planks(f"Planks_{tone}_{axis}", color=pal[0],
                                                                       color2=pal[1], axis=axis, plank=plank,
                                                                       weathered=0.45, wear=0.4, dirt=0.6))

    # --- stone -------------------------------------------------------------------------------------------------
    def stone(self, tone="grey", moss=0.35):
        pal = {"grey": ("#7b776d", "#57534b"), "warm": ("#857a68", "#5c5345"), "dark": ("#5e5c58", "#3d3b38"),
               "pale": ("#9a958a", "#6f6b62")}[tone]
        return self._get(("stone", tone, moss), lambda: M.rock(f"Stone_{tone}_{int(moss * 100)}", color=pal[0], color2=pal[1],
                                                               strata=0.15, moss=moss, lichen=0.3, wear=0.2,
                                                               dirt=0.7, scale=1.6, seed=5))

    def mortar(self):
        return self._get("mortar", lambda: M.plaster("Mortar", color="#5b5347", stain="#3b342b", cracks=0.2,
                                                    dirt=0.8, scale=3.0, ground_dirt=0.4))

    def blocks(self, block=(0.55, 0.3)):
        return self._get(("blocks", block), lambda: M.stone_blocks(f"Ashlar_{int(block[0] * 100)}_{int(block[1] * 100)}", color="#7d786d", color2="#5d5950",
                                                                   block=block, moss=0.25, wear=0.5, dirt=0.7))

    def plaster(self):
        return self._get("plaster", lambda: M.plaster("Plaster", color="#b4a386", stain="#6a563d", cracks=0.6,
                                                     dirt=0.6, ground_dirt=0.7, moss=0.05))

    def cobble(self):
        return self._get("cobble", lambda: M.cobblestone("Cobble", stone=0.16, moss=0.3))

    # --- metal -------------------------------------------------------------------------------------------------
    def iron(self, rust=0.55):
        return self._get(("iron", rust), lambda: M.metal(f"Iron_{int(rust * 100)}", kind="iron", rust=rust, grime=0.6,
                                                         wear=0.35, seed=3))

    def blackiron(self):
        return self._get("blackiron", lambda: M.metal("BlackIron", kind="blackiron", rust=0.35, grime=0.55, wear=0.3))

    def bronze(self):
        return self._get("bronze", lambda: M.metal("Bronze", kind="bronze", rust=0.35, grime=0.5, wear=0.7))

    def engraved(self, pattern="filigree", kind="steel", glow=None):
        return self._get(("eng", pattern, kind, glow), lambda: M.engraved_metal(f"Engraved_{pattern}_{kind}",
                                                                                kind=kind, pattern=pattern, glow=glow))

    # --- misc --------------------------------------------------------------------------------------------------
    def rope(self):
        return self._get("rope", lambda: M.cloth("Rope", color="#8a7658", kind="burlap", dirt=0.6, hem_dirt=0.0))

    def leather(self, color="#4d3220"):
        return self._get(("leather", color), lambda: M.leather(f"Leather_{color[1:]}", color=color))

    def glow(self, color="#ffae52", strength=5.0, name="GlowWindow"):
        def mk():
            m = M.emissive(name, color=color, strength=strength)
            m["kit_group"] = "Glow"
            return m
        return self._get(("glow", name), mk)

    def ember(self):
        """Glowing coals / furnace mouth: dark crust with hot cracks (emissive, own 'Glow' texture set)."""
        def mk():
            m, nb, bsdf = M._new("GlowEmber", "ember")
            v = M.coords(nb, "OBJECT", 6.0, 3)
            cr = nb.voronoi(v, 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
            hot = nb.maprange(cr, 0.0, 0.12, 1.0, 0.0, "SMOOTHSTEP")
            n = nb.noise(nb.vmath("SCALE", v, scale=0.5), 1.0, 4.0).outputs["Fac"]
            hot = nb.clamp01(nb.add(hot, nb.maprange(n, 0.55, 0.8, 0.0, 0.6)))
            col = nb.mix("#1a1411", "#3a2418", n)
            emis = M._pal(nb, hot, ["#000000", "#b3260a", "#ff7a1a", "#ffd27a"], [0.0, 0.35, 0.7, 1.0])
            m["kit_group"] = "Glow"
            return M._finish(m, nb, bsdf, col, 0.9, nb.mul(hot, -0.3), emission=emis, emit_strength=6.0, vec=v)
        return self._get("ember", mk)

    def shingles(self, kind="wood"):
        return self._get(("shingle", kind), lambda: shingle_material(kind))

    def cloth(self, name, color, kind="wool", stripes=None, emblem=None, hem_dirt=0.0):
        def mk():
            m = M.cloth(name, color=color, kind=kind, dirt=0.5, wear=0.35, hem_dirt=hem_dirt)
            if stripes:
                add_stripes(m, stripes[0], stripes[1], stripes[2] if len(stripes) > 2 else "X")
            if emblem:
                add_emblem(m, emblem)
            return m
        return self._get(("cloth", name), mk)

    def moss(self):
        return self._get("moss", lambda: M.moss("MossClump", seed=3))

    def flat(self, name, color, rough=0.8, metal=0.0):
        return self._get(("flat", name), lambda: M.flat(name, color, rough, metal))


def _base_socket(mat):
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    col_in = sock(bsdf.inputs, "Base Color")
    prev = col_in.links[0].from_socket if col_in.is_linked else tuple(col_in.default_value)
    return NB(mat.node_tree), bsdf, col_in, prev


def add_stripes(mat, color2, width=0.25, axis="X"):
    """Woven stripes (market canvas): alternate the base colour every `width` metres along `axis`."""
    nb, bsdf, col_in, prev = _base_socket(mat)
    p = nb.sep(nb.node("ShaderNodeTexCoord").outputs["Object"])[{"X": 0, "Y": 1, "Z": 2}[axis]]
    s = nb.math("SINE", nb.mul(p, math.pi / width))
    band = nb.maprange(s, -0.08, 0.08)
    stripe = nb.mix(color2, nb.mix(color2, "#000000", 0.35), nb.maprange(nb.math("FRACT", nb.mul(p, 23.0)), 0.0, 1.0,
                                                                          0.0, 0.1))
    nb.feed(col_in, nb.mix(prev, nb.mix(prev, stripe, 0.85, "MIX"), band))
    return mat


def add_emblem(mat, emblem):
    """Heraldic emblem painted on a banner. emblem = dict(color, center=(x,z), size) in the object's XZ plane."""
    nb, bsdf, col_in, prev = _base_socket(mat)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    cx, cz = emblem.get("center", (0.0, 1.5))
    sz = emblem.get("size", 0.3)
    x = nb.math("ABSOLUTE", nb.sub(s[0], cx))
    z = nb.sub(s[2], cz)
    # stylised sword/tree: vertical bar + crossguard + diamond pommel, with ring
    bar = nb.mul(nb.maprange(x, sz * 0.09, sz * 0.06), nb.mul(nb.maprange(z, -sz * 1.05, -sz * 1.0), nb.maprange(z, sz * 0.95, sz * 0.9)))
    guard = nb.mul(nb.maprange(x, sz * 0.55, sz * 0.5), nb.maprange(nb.math("ABSOLUTE", nb.sub(z, sz * 0.45)), sz * 0.08, sz * 0.05))
    dist = nb.math("SQRT", nb.add(nb.mul(x, x), nb.mul(z, z)))
    ring = nb.maprange(nb.math("ABSOLUTE", nb.sub(dist, sz * 1.25)), sz * 0.08, sz * 0.05)
    dia = nb.maprange(nb.add(x, nb.math("ABSOLUTE", nb.sub(z, sz * 0.75))), sz * 0.2, sz * 0.16)
    mask = nb.math("MAXIMUM", nb.math("MAXIMUM", bar, guard), nb.math("MAXIMUM", ring, dia))
    worn = nb.noise(nb.vmath("SCALE", tc, scale=18.0), 1.0, 5.0, 0.6).outputs["Fac"]
    mask = nb.mul(mask, nb.maprange(worn, 0.25, 0.45, 0.35, 1.0))
    nb.feed(col_in, nb.mix(prev, emblem["color"], mask))
    return mat


def add_runes(mat, color="#59c7ff", strength=6.0, cell=(0.13, 0.17), column=True, zrange=None, sides_only=True,
              depth=0.6):
    """Carve glowing rune glyphs into `mat` (emission + dark grooves + height). The glyph grid is projected on the
    dominant face plane (X faces -> (y, z), Y faces -> (x, z), Z faces -> (x, y)), so the runes read as real glyphs
    on every side instead of the streaks a single planar projection gives on vertical faces.
    column=True: one vertical column of glyphs centred on the object's local axis (standing stones);
    zrange=(z0, z1) limits the glyphs in local Z."""
    nb, bsdf, col_in, prev = _base_socket(mat)
    tc = nb.node("ShaderNodeTexCoord")
    p = nb.sep(tc.outputs["Object"])
    an = nb.sep(nb.vmath("ABSOLUTE", tc.outputs["Normal"]))
    cz = nb.math("GREATER_THAN", an[2], nb.math("MAXIMUM", an[0], an[1]))
    cx = nb.math("GREATER_THAN", an[0], an[1])
    u = nb.mixf(p[0], p[1], cx)                      # horizontal coordinate on the face
    w = nb.mixf(p[2], p[1], cz)                      # vertical coordinate (y on top faces)
    u = nb.mixf(u, p[0], cz)
    v = nb.xyz(nb.add(nb.math("DIVIDE", u, cell[0]), 0.5), nb.math("DIVIDE", w, cell[1]), 0.0)
    mask = M._rune_mask(nb, v)
    if column:
        mask = nb.mul(mask, nb.maprange(nb.math("ABSOLUTE", u), cell[0] * 0.5, cell[0] * 0.5 - 0.004))
    if zrange:
        mask = nb.mul(mask, nb.mul(nb.maprange(p[2], zrange[0], zrange[0] + 0.01),
                                   nb.maprange(p[2], zrange[1], zrange[1] - 0.01)))
    if sides_only:
        mask = nb.mul(mask, nb.sub(1.0, cz))
    nb.feed(col_in, nb.mix(prev, "#0d1114", mask))
    em = sock(bsdf.inputs, "Emission Color")
    # unlinked Principled emission colour defaults to WHITE (strength 0): start from black then
    eprev = em.links[0].from_socket if em.is_linked else (0.0, 0.0, 0.0, 1.0)
    nb.feed(em, nb.mix(eprev, color, mask))
    sock(bsdf.inputs, "Emission Strength").default_value = strength
    rin = sock(bsdf.inputs, "Roughness")
    rprev = rin.links[0].from_socket if rin.is_linked else rin.default_value
    nb.feed(rin, nb.mixf(rprev, 0.9, mask))
    # grooves: push the kit's height (bump) input down along the strokes when the material exposes one
    bump = next((n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBump"), None)
    if bump is not None and depth > 0:
        hin = bump.inputs["Height"]
        if hin.is_linked:
            nb.feed(hin, nb.sub(hin.links[0].from_socket, nb.mul(mask, depth)))
    mat["kit_emissive"] = 1
    return mat


# =============================================================================== shingles (custom shader)
def shingle_material(kind="wood"):
    """Roof shingles/slates driven by the attributes written by roof_rows(): sh_u (0 at shingle borders, 1 in the
    middle), sh_v (0 at the lower edge -> 1 at the top) and sh_rnd (random per shingle, face domain)."""
    name = {"wood": "RoofShingle", "slate": "RoofSlate", "red": "RoofShingleRed"}[kind]
    m, nb, bsdf = M._new(name, "shingles_" + kind)
    u = M._attr(nb, "sh_u")
    vv = M._attr(nb, "sh_v")
    r = M._attr(nb, "sh_rnd")
    obj = M.coords(nb, "OBJECT", 1.0, 7)
    # per-shingle local frame: grain runs along the slope (v); rnd offsets the pattern for every shingle
    lv = nb.xyz(nb.add(nb.mul(u, 0.12), nb.mul(r, 31.0)), nb.add(vv, nb.mul(r, 17.0)), nb.mul(r, 11.0))
    gap = nb.maprange(nb.math("ABSOLUTE", nb.sub(u, 0.5)), 0.47, 0.5, 0.0, 1.0, "SMOOTHSTEP")
    tip = nb.maprange(vv, 0.0, 0.06, 1.0, 0.0)
    if kind == "slate":
        c1, c2, c3 = "#3c4247", "#565d61", "#2a2e31"
        fine = nb.noise(nb.vmath("MULTIPLY", lv, (18.0, 18.0, 18.0)), 1.0, 8.0, 0.65).outputs["Fac"]
        layers = nb.wave(nb.vmath("MULTIPLY", lv, (3.0, 9.0, 3.0)), 1.0, 6.0, 3.0, "BANDS", "Y", "SAW").outputs["Fac"]
        chip = nb.maprange(nb.noise(nb.vmath("MULTIPLY", lv, (6.0, 6.0, 6.0)), 1.0, 4.0).outputs["Fac"], 0.55, 0.7)
        h = nb.add(nb.mul(fine, 0.25), nb.mul(layers, 0.2))
        h = nb.sub(h, nb.mul(nb.mul(chip, tip), 0.4))
        col = M._pal(nb, nb.add(nb.mul(r, 0.7), nb.mul(fine, 0.3)), [c3, c1, c2, "#6b6258"], [0.0, 0.4, 0.8, 1.0])
        col = nb.mix(col, "#7a8468", nb.mul(nb.maprange(fine, 0.6, 0.75), 0.25))          # lichen specks
        rough = nb.maprange(fine, 0.0, 1.0, 0.6, 0.85)
    else:
        c1, c2 = ("#5c4430", "#2f2217") if kind == "wood" else ("#6d3a26", "#3b1c12")
        grain = nb.noise(nb.vmath("MULTIPLY", lv, (60.0, 3.0, 60.0)), 1.0, 6.0, 0.7).outputs["Fac"]
        split = nb.maprange(nb.noise(nb.vmath("MULTIPLY", lv, (25.0, 1.5, 25.0)), 1.0, 3.0).outputs["Fac"], 0.66, 0.7)
        h = nb.add(nb.mul(grain, 0.35), 0.4)
        h = nb.sub(h, nb.mul(split, 0.3))
        col = nb.mix(c2, c1, nb.add(nb.mul(r, 0.6), nb.mul(grain, 0.5)))
        col = nb.mix(col, "#77706a", nb.mul(nb.maprange(nb.noise(obj, 0.8, 3.0).outputs["Fac"], 0.45, 0.7), 0.45))   # sun-bleached
        col = nb.mix(col, "#140d08", nb.mul(split, 0.7))
        rough = nb.maprange(grain, 0.0, 1.0, 0.75, 0.95)
    # gaps between shingles, darker exposed lower edge, water streaks
    h = nb.sub(h, nb.mul(gap, 0.6))
    col = nb.mix(col, "#0d0a08", nb.mul(gap, 0.85))
    streak = nb.noise(nb.vmath("MULTIPLY", obj, (6.0, 6.0, 0.6)), 1.0, 4.0, 0.6).outputs["Fac"]
    col = nb.mix(col, "#1d1a16", nb.mul(nb.maprange(streak, 0.5, 0.8), 0.35))
    col = nb.mix(col, nb.mix(col, "#000000", 0.4), nb.maprange(vv, 0.55, 1.0))     # tucked under the next row
    return M._finish(m, nb, bsdf, col, rough, h, bump=1.0, bump_dist=0.012, dirt=0.6, wear=0.25, moss=0.22,
                     moss_color="#3c4620", vec=obj, cavity_dist=0.15, edge_radius=0.01)


# =============================================================================== bmesh helpers
def _smooth(me, angle=35.0):
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(angle))
    except Exception:
        pass


def bm_box(bm, sx, sy, sz, bevel=0.0, seg=1, center=(0, 0, 0), long_only=False, outer_only=False):
    """Box; bevel chamfers every edge, only the 4 edges along Z when long_only (beams: 28 instead of 44 tris), or
    only the 2 edges along Z on the +Y side when outer_only (wall timbers: only their outer edges are ever seen)."""
    geom = bmesh.ops.create_cube(bm, size=1.0)
    verts = geom["verts"]
    for v in verts:
        v.co = V((v.co.x * sx + center[0], v.co.y * sy + center[1], v.co.z * sz + center[2]))
    if bevel > 0:
        edges = list({e for v in verts for e in v.link_edges})
        if long_only or outer_only:
            edges = [e for e in edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
        if outer_only:
            edges = [e for e in edges if e.verts[0].co.y > center[1] and e.verts[1].co.y > center[1]]
        bmesh.ops.bevel(bm, geom=edges, offset=min(bevel, 0.45 * min(sx, sy, sz)), segments=seg, profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    return bm


class Parts:
    """Collect separate part objects (see module doc)."""

    def __init__(self, seed=0, prefix="P"):
        self.rnd = random.Random(seed)
        self.objs = []
        self.prefix = prefix
        self.n = 0

    # ------------------------------------------------------------------ core
    def add_bm(self, bm, mat, matrix=Matrix(), name=None, smooth=35.0, offset=True, mats=None):
        """Turn a bmesh (built in the part's local frame) into an object placed by `matrix`."""
        self.n += 1
        name = name or f"{self.prefix}{self.n:03d}"
        me = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o_off = V((self.rnd.uniform(-3, 3), self.rnd.uniform(-3, 3), self.rnd.uniform(-3, 3))) if offset else V()
        bmesh.ops.translate(bm, verts=bm.verts, vec=o_off)
        bm.to_mesh(me)
        bm.free()
        if mats:
            for m in mats:
                me.materials.append(m)
        elif mat is not None:
            me.materials.append(mat)
        if smooth:
            _smooth(me, smooth)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.matrix_world = matrix @ Matrix.Translation(-o_off)
        self.objs.append(ob)
        return ob

    def add_obj(self, ob):
        self.objs.append(ob)
        return ob

    # ------------------------------------------------------------------ primitives
    def box(self, size, loc, mat, rot=(0, 0, 0), bevel=0.015, seg=1, name=None, smooth=35.0):
        bm = bmesh.new()
        bm_box(bm, *size, bevel=bevel, seg=seg)
        return self.add_bm(bm, mat, Matrix.Translation(loc) @ mathutils.Euler(rot).to_matrix().to_4x4(), name, smooth)

    def beam(self, p0, p1, w, h, mat, bevel=0.02, up=(0, 0, 1), jitter=0.0, name=None, extend=0.0, outer=False):
        """Rectangular beam from p0 to p1 (w across, h along `up`), built along local Z (wood grain along Z)."""
        p0, p1 = V(p0), V(p1)
        d = p1 - p0
        L = d.length + 2 * extend
        z = d.normalized()
        upv = V(up)
        if abs(z.dot(upv.normalized())) > 0.95:
            upv = V((0, 1, 0)) if abs(z.y) < 0.9 else V((1, 0, 0))
        x = upv.cross(z).normalized()
        y = z.cross(x).normalized()
        R = Matrix((x, y, z)).transposed().to_4x4()
        bm = bmesh.new()
        bm_box(bm, w, h, L, bevel=bevel, center=(0, 0, 0), long_only=L > 2.5 * max(w, h), outer_only=outer)
        if jitter:
            for v in bm.verts:
                v.co += V((self.rnd.uniform(-jitter, jitter), self.rnd.uniform(-jitter, jitter), 0))
        mid = (p0 + p1) / 2
        return self.add_bm(bm, mat, Matrix.Translation(mid) @ R, name)

    def cyl(self, r, depth, loc, mat, rot=(0, 0, 0), n=12, r2=None, bevel=0.0, caps=True, name=None, smooth=50.0):
        """Cylinder / cone along local Z, base at loc (not centred)."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=n, radius1=r, radius2=r if r2 is None else r2,
                              depth=depth)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, depth / 2))
        if bevel > 0:
            ring = [e for e in bm.edges if not e.is_boundary and len(e.link_faces) == 2 and
                    abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
            bmesh.ops.bevel(bm, geom=ring, offset=bevel, segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
        return self.add_bm(bm, mat, Matrix.Translation(loc) @ mathutils.Euler(rot).to_matrix().to_4x4(), name, smooth)

    def lathe(self, profile, loc, mat, n=16, rot=(0, 0, 0), name=None, cap_top=True, cap_bottom=True, smooth=40.0,
              mats=None, mat_index=None):
        """Surface of revolution around local Z. profile = [(r, z), ...] bottom -> top."""
        bm = bmesh.new()
        rings = []
        for (r, z) in profile:
            ring = []
            for i in range(n):
                a = 2 * math.pi * i / n
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)) if r > 1e-5 else None)
            if r <= 1e-5:
                ring = [bm.verts.new((0, 0, z))] * n
            rings.append(ring)
        for j in range(len(rings) - 1):
            a, b = rings[j], rings[j + 1]
            for i in range(n):
                k = (i + 1) % n
                vs = [a[i], a[k], b[k], b[i]]
                uniq = []
                for v in vs:
                    if v not in uniq:
                        uniq.append(v)
                if len(uniq) >= 3:
                    f = bm.faces.new(uniq)
                    if mat_index:
                        f.material_index = mat_index(j)
        if cap_bottom and profile[0][0] > 1e-5:
            bm.faces.new(list(reversed(rings[0])))
        if cap_top and profile[-1][0] > 1e-5:
            f = bm.faces.new(rings[-1])
            if mat_index:
                f.material_index = mat_index(len(rings) - 1)
        return self.add_bm(bm, mat, Matrix.Translation(loc) @ mathutils.Euler(rot).to_matrix().to_4x4(), name, smooth,
                           mats=mats)

    def poly_prism(self, pts2d, z0, z1, mat, loc=(0, 0, 0), rot=(0, 0, 0), name=None, bevel=0.0, smooth=35.0):
        """Extruded polygon (pts in the local XY plane, CCW) from z0 to z1."""
        bm = bmesh.new()
        vs = [bm.verts.new((x, y, z0)) for x, y in pts2d]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        top = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
        for v in top:
            v.co.z = z1
        if bevel:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, profile=0.5, affect="EDGES",
                            clamp_overlap=True)
        return self.add_bm(bm, mat, Matrix.Translation(loc) @ mathutils.Euler(rot).to_matrix().to_4x4(), name, smooth)

    def mesh(self, verts, faces, mat, loc=(0, 0, 0), rot=(0, 0, 0), name=None, smooth=35.0, offset=True):
        bm = bmesh.new()
        bv = [bm.verts.new(v) for v in verts]
        for f in faces:
            try:
                bm.faces.new([bv[i] for i in f])
            except ValueError:
                pass
        return self.add_bm(bm, mat, Matrix.Translation(loc) @ mathutils.Euler(rot).to_matrix().to_4x4(), name, smooth,
                           offset=offset)

    def stone(self, size, loc, mat, rot=(0, 0, 0), seed=0, rough=0.18, name=None):
        """One irregular stone (subdivided cube, rounded + jittered)."""
        bm = stone_bm(size, seed, rough)
        return self.add_bm(bm, mat, Matrix.Translation(loc) @ mathutils.Euler(rot).to_matrix().to_4x4(), name, 180.0)

    def nail_heads(self, pts, normals, mat, r=0.012, h=0.006, name=None):
        """Many little domed nail/rivet heads in one part (5-sided, closed)."""
        bm = bmesh.new()
        for p, nrm in zip(pts, normals):
            nrm = V(nrm).normalized()
            q = nrm.to_track_quat("Z", "Y").to_matrix().to_4x4()
            geom = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=5, radius1=r, radius2=r * 0.55,
                                         depth=h)
            bmesh.ops.transform(bm, matrix=Matrix.Translation(V(p) + nrm * (h / 2 - 0.001)) @ q, verts=geom["verts"])
        return self.add_bm(bm, mat, Matrix(), name, 60.0, offset=False)


    # ------------------------------------------------------------------ curves (Geometry Nodes)
    def tube(self, pts, radius, mat, res=6, kind="NURBS", taper=None, caps=True, name="Tube", smooth=True):
        """Curve -> mesh sweep (GN, kit.gn.curve_to_mesh). pts = [(x, y, z[, r]), ...]."""
        cu = gn.make_curve([pts], name, kind=kind)
        gn.curve_to_mesh(cu, radius=radius, profile_res=res, taper=taper, fill_caps=caps, smooth=smooth)
        o = gn.apply(cu)
        o.data.materials.clear()
        o.data.materials.append(mat)
        _smooth(o.data, 60 if smooth else 0)
        return self.add_obj(o)

    def chain(self, pts, mat, link=0.06, wire=0.009, kind="NURBS", name="Chain"):
        """Chain of alternating links instanced along a curve (GN instance_on_curve, alternate=90)."""
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, segments=8, radius=1.0)
        tpl_me = bpy.data.meshes.new("_link")
        # oval torus link along X
        verts, faces = [], []
        seg, rseg = 8, 4
        L, W = link * 0.5, link * 0.28
        for i in range(seg):
            a = 2 * math.pi * i / seg
            c = V((math.cos(a) * L, math.sin(a) * W, 0))
            tng = V((-math.sin(a) * L, math.cos(a) * W, 0)).normalized()
            nrm = V((tng.y, -tng.x, 0))
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                verts.append(c + (nrm * math.cos(b) + V((0, 0, 1)) * math.sin(b)) * wire)
        for i in range(seg):
            for j in range(rseg):
                a0 = i * rseg + j
                a1 = i * rseg + (j + 1) % rseg
                b0 = ((i + 1) % seg) * rseg + j
                b1 = ((i + 1) % seg) * rseg + (j + 1) % rseg
                faces.append((a0, b0, b1, a1))
        bm.free()
        tpl_me.from_pydata([tuple(v) for v in verts], [], faces)
        tpl_me.materials.append(mat)
        tpl = bpy.data.objects.new("_link", tpl_me)
        bpy.context.scene.collection.objects.link(tpl)
        cu = gn.make_curve([pts], name, kind=kind)
        gn.instance_on_curve(cu, tpl, spacing=link * 0.78, alternate=90)
        o = gn.apply(cu)
        gn.remove(tpl)
        if not o.data.materials:
            o.data.materials.append(mat)
        _smooth(o.data, 180)
        return self.add_obj(o)

    def ico(self, r, loc, mat, subdiv=1, scale=(1, 1, 1), rot=(0, 0, 0), jitter=0.0, name=None, smooth=180.0):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
        for v in bm.verts:
            v.co = V((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
            if jitter:
                v.co += V((self.rnd.uniform(-jitter, jitter), self.rnd.uniform(-jitter, jitter),
                           self.rnd.uniform(-jitter, jitter)))
        return self.add_bm(bm, mat, Matrix.Translation(loc) @ mathutils.Euler(rot).to_matrix().to_4x4(), name, smooth)

    def torus(self, R, r, loc, mat, rot=(0, 0, 0), seg=16, rseg=6, name=None):
        verts, faces = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                verts.append(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
        for i in range(seg):
            for j in range(rseg):
                a0, a1 = i * rseg + j, i * rseg + (j + 1) % rseg
                b0, b1 = ((i + 1) % seg) * rseg + j, ((i + 1) % seg) * rseg + (j + 1) % rseg
                faces.append((a0, b0, b1, a1))
        return self.mesh(verts, faces, mat, loc, rot, name, smooth=180)

    def planks(self, origin, u_dir, v_dir, width, height, n, mat, thick=0.03, gap=0.008, jitter=0.004, bevel=0.005,
               along="u", ragged=0.0):
        """A panel of n separate boards in the plane (u_dir, v_dir) starting at origin (corner), boards run along
        `along` (u or v); thickness grows along u x v. Every board is its own part (grain along its length)."""
        o, U, Vv = V(origin), V(u_dir).normalized(), V(v_dir).normalized()
        Nn = U.cross(Vv).normalized()
        out = []
        for i in range(n):
            if along == "u":
                bw = height / n
                c = o + Vv * (bw * (i + 0.5)) + U * (width / 2)
                L = width + self.rnd.uniform(-ragged, ragged)
                a, b = c - U * L / 2, c + U * L / 2
                w_, dirw = bw - gap, Vv
            else:
                bw = width / n
                c = o + U * (bw * (i + 0.5)) + Vv * (height / 2)
                L = height + self.rnd.uniform(-ragged, ragged)
                a, b = c - Vv * L / 2, c + Vv * L / 2
                w_, dirw = bw - gap, U
            off = Nn * (thick / 2 + self.rnd.uniform(-jitter, jitter))
            out.append(self.beam(a + off, b + off, w_, thick, mat, bevel=bevel, up=Nn))
        return out


def stone_bm(size, seed=0, rough=0.18, cuts=1, roundness=0.3, chips=3):
    """Irregular stone: subdivided cube pushed towards a sphere (roundness), jittered, then chipped by `chips`
    random planes (flat fractured facets)."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        c = v.co
        # round the corners (cube -> pillow) then jitter
        n = c.normalized()
        c = c.lerp(n * 1.2, roundness)
        c += V((rnd.uniform(-rough, rough), rnd.uniform(-rough, rough), rnd.uniform(-rough, rough)))
        v.co = V((c.x * size[0] / 2, c.y * size[1] / 2, c.z * size[2] / 2))
    # random chipped flat facets
    for _ in range(chips):
        nrm = V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 1))).normalized()
        d = max(v.co.dot(nrm) for v in bm.verts) * rnd.uniform(0.75, 0.9)
        for v in bm.verts:
            e = v.co.dot(nrm) - d
            if e > 0:
                v.co -= nrm * e
    return bm


# =============================================================================== Geometry Nodes: instance on points
def gn_instances(name, points, variants, rots=None, scales=None, ids=None, seed=0):
    """GN-instance `variants` (list of template objects, ~unit size centred at origin) on `points`.
    Per point: euler rotation (rots), vector scale (scales) and variant index (ids; random if None).
    The points live in a mesh object whose Geometry Nodes modifier does Instance on Points (pick from
    collection) + Realize Instances. Returns the (unapplied) object; gn.apply() it."""
    rnd = random.Random(seed)
    n = len(points)
    rots = rots or [(0, 0, 0)] * n
    scales = scales or [(1, 1, 1)] * n
    ids = ids or [rnd.randrange(len(variants)) for _ in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in points], [], [])
    a = me.attributes.new("rot", "FLOAT_VECTOR", "POINT")
    a.data.foreach_set("vector", [c for r in rots for c in r])
    s = me.attributes.new("scl", "FLOAT_VECTOR", "POINT")
    s.data.foreach_set("vector", [c for r in scales for c in r])
    i = me.attributes.new("vid", "INT", "POINT")
    i.data.foreach_set("value", list(ids))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    col = gn.template_collection(list(variants), f"_tpl_{name}")
    ng = bpy.data.node_groups.new(name + "_GN", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nb = NB(ng)
    gi = nb.node("NodeGroupInput")
    go = nb.node("NodeGroupOutput")
    ar = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT_VECTOR"}, Name="rot")
    asc = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT_VECTOR"}, Name="scl")
    aid = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "INT"}, Name="vid")
    e2r = nb.node("FunctionNodeEulerToRotation")
    nb.feed(e2r.inputs[0], sock(ar.outputs, "Attribute", "VECTOR"))
    ci = nb.node("GeometryNodeCollectionInfo", {"transform_space": "ORIGINAL"})
    ci.inputs["Collection"].default_value = col
    ci.inputs["Separate Children"].default_value = True
    ci.inputs["Reset Children"].default_value = True
    mp = nb.node("GeometryNodeMeshToPoints", Mesh=gi.outputs[0])
    iop = nb.node("GeometryNodeInstanceOnPoints", Points=mp.outputs[0], Instance=ci.outputs[0], Rotation=e2r.outputs[0])
    nb.feed(sock(iop.inputs, "Scale"), sock(asc.outputs, "Attribute", "VECTOR"))
    iop.inputs["Pick Instance"].default_value = True
    nb.feed(iop.inputs["Instance Index"], sock(aid.outputs, "Attribute", "INT"))
    rl = nb.node("GeometryNodeRealizeInstances", Geometry=iop.outputs[0])
    nb.link(rl.outputs[0], go.inputs[0])
    md = ob.modifiers.new(name, "NODES")
    md.node_group = ng
    return ob, col


def _decimate_mesh(me, ratio):
    if ratio >= 0.999:
        return
    ob = bpy.data.objects.new("_dec", me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new("d", "DECIMATE")
    md.ratio = ratio
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="d")
    bpy.data.objects.remove(ob, do_unlink=True)


def stone_variants(n=6, seed=0, mat=None, rough=0.16, name="StoneV", decimate=0.55):
    """Unit-size irregular stone templates (for gn_instances)."""
    out = []
    for i in range(n):
        bm = stone_bm((1.0, 1.0, 1.0), seed * 31 + i, rough)
        # ~26 tris instead of 48: stones are many, their silhouette survives a collapse decimation
        bmesh.ops.triangulate(bm, faces=bm.faces)
        me = bpy.data.meshes.new(f"{name}{i}")
        bm.to_mesh(me)
        bm.free()
        _decimate_mesh(me, decimate)
        _smooth(me, 180)
        if mat:
            me.materials.append(mat)
        ob = bpy.data.objects.new(f"_{name}{i}", me)
        bpy.context.scene.collection.objects.link(ob)
        out.append(ob)
    return out


def stone_wall(P, segments, z0, z1, mat, seed=0, course=(0.26, 0.34), length=(0.35, 0.7), depth=0.3,
               protrude=0.04, name="Stones", variants=None, gap=0.012):
    """Irregular stone facing on straight wall segments [((x0,y0),(x1,y1)), ...] (outward = right-hand side
    of p0->p1 ... i.e. wall faces towards -normal where normal=(dy,-dx)). Stones are GN-instanced."""
    rnd = random.Random(seed)
    pts, rots, scls = [], [], []
    for si, (a, b) in enumerate(segments):
        a, b = V((*a, 0)), V((*b, 0))
        d = b - a
        L = d.length
        t = d.normalized()
        nrm = V((t.y, -t.x, 0))                # outward normal
        yaw = math.atan2(t.y, t.x)
        z = z0
        row = 0
        while z < z1 - 0.05:
            h = min(rnd.uniform(*course), z1 - z)
            if z1 - (z + h) < 0.1:
                h = z1 - z
            s = -rnd.uniform(0.0, 0.25) if row % 2 else -0.1
            while s < L:
                ln = rnd.uniform(*length)
                if L - (s + ln) < 0.15:
                    ln = L - s + 0.12
                c = a + t * (s + ln / 2) + nrm * (protrude - depth / 2 + rnd.uniform(-0.012, 0.012))
                pts.append((c.x, c.y, z + h / 2))
                rots.append((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.04, 0.04), yaw + rnd.uniform(-0.03, 0.03)))
                scls.append((ln - gap, depth, h - gap))
                s += ln
            z += h
            row += 1
    variants = variants or stone_variants(6, seed, mat)
    ob, col = gn_instances(name, pts, variants, rots, scls, seed=seed)
    ob.data.materials.append(mat)
    gn.apply(ob)
    gn.remove(col)
    _smooth(ob.data, 180)
    return P.add_obj(ob)


# =============================================================================== roofs
def roof_rows(P, mat, p_eave, p_ridge, width_dir, width, exposure=0.24, sh_w=0.34, thick=0.035, tip=0.05,
              seed=0, name="Roof", start_offset=0.0, jitter=0.012, overlap=1.7, taper=None, pointed=True):
    """Rows of shingles on one planar roof slope.
    p_eave: point at the middle of the eave line; p_ridge: point on the ridge above it; width_dir: unit vector
    along the eave; width: eave length. Every row is ONE continuous strip (top + lower-edge face); pointed=True
    gives every shingle a rounded/pointed tip (wood), False straight slates (4 tris per shingle). Attributes for
    shingle_material(): sh_u (face corner: 0..1 across each shingle), sh_v (0 at the lower edge -> 1 at the top),
    sh_rnd (random per shingle, face domain). taper=(w_eave, w_ridge) narrows the rows (hips / pyramids)."""
    rnd = random.Random(seed)
    pe, pr, wd = V(p_eave), V(p_ridge), V(width_dir).normalized()
    up_slope = (pr - pe)
    S = up_slope.length
    sd = up_slope.normalized()
    nrm = wd.cross(sd).normalized()
    if nrm.z < 0:
        nrm = -nrm
    bm = bmesh.new()
    lay_u = bm.loops.layers.float.new("sh_u")
    lay_v = bm.verts.layers.float.new("sh_v")
    lay_r = bm.faces.layers.float.new("sh_rnd")
    rows = int(math.ceil((S - start_offset) / exposure))
    lift = thick * 1.05

    def P3(x, s, h):
        return pe + wd * x + sd * s + nrm * h

    def face(vs, us, rv):
        f = bm.faces.new(vs)
        for lp, u in zip(f.loops, us):
            lp[lay_u] = u
        f[lay_r] = rv
        return f

    for ri in range(rows):
        s0 = start_offset + ri * exposure
        s1 = min(S + thick, s0 + exposure * overlap)
        if s0 >= S:
            break
        wscale = 1.0 if not taper else taper[0] + (taper[1] - taper[0]) * (s0 / S)
        w = width * wscale
        nsh = max(1, int(round(w / sh_w)))
        sw = w / nsh
        shift = (0.5 * sw if ri % 2 else 0.0)
        cols = []
        for i in range(nsh + 1):
            xx = -w / 2 + i * sw + (shift if 0 < i < nsh else 0.0)
            cols.append(max(-w / 2, min(w / 2, xx)))
        top_lo, top_hi, bot_lo = [], [], []
        for x in cols:
            j = rnd.uniform(-jitter, jitter)
            vlo = bm.verts.new(P3(x, s0, lift + j))
            vhi = bm.verts.new(P3(x, s1, 0.004))
            vb = bm.verts.new(P3(x, s0, lift + j - thick))
            vlo[lay_v] = 0.0
            vb[lay_v] = 0.0
            vhi[lay_v] = 1.0
            top_lo.append(vlo)
            top_hi.append(vhi)
            bot_lo.append(vb)
        for i in range(nsh):
            rv = rnd.random()
            if pointed:
                xm = (cols[i] + cols[i + 1]) / 2
                t = tip * rnd.uniform(0.5, 1.3)
                j = rnd.uniform(-jitter, jitter) * 1.5
                ml = bm.verts.new(P3(xm, s0 - t, lift + j))
                mh = bm.verts.new(P3(xm, s1, 0.004))
                mb = bm.verts.new(P3(xm, s0 - t, lift + j - thick))
                ml[lay_v] = 0.0
                mb[lay_v] = 0.0
                mh[lay_v] = 1.0
                face((top_lo[i], ml, mh, top_hi[i]), (0.0, 0.5, 0.5, 0.0), rv)
                face((ml, top_lo[i + 1], top_hi[i + 1], mh), (0.5, 1.0, 1.0, 0.5), rv)
                face((bot_lo[i], mb, ml, top_lo[i]), (0.0, 0.5, 0.5, 0.0), rv)
                face((mb, bot_lo[i + 1], top_lo[i + 1], ml), (0.5, 1.0, 1.0, 0.5), rv)
            else:
                face((top_lo[i], top_lo[i + 1], top_hi[i + 1], top_hi[i]), (0.0, 1.0, 1.0, 0.0), rv)
                face((bot_lo[i], bot_lo[i + 1], top_lo[i + 1], top_lo[i]), (0.0, 1.0, 1.0, 0.0), rv)
        for (tl, th, tb) in ((top_lo[0], top_hi[0], bot_lo[0]), (top_lo[-1], top_hi[-1], bot_lo[-1])):
            try:
                face((tb, tl, th), (0.0, 0.0, 0.0), 0.5)
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    _smooth(me, 50)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    _orient_up(ob, nrm)
    return P.add_obj(ob)


def _orient_up(ob, nrm):
    """Flip the whole strip if most face normals point into the roof."""
    me = ob.data
    tot = sum(p.normal.dot(nrm) * p.area for p in me.polygons)
    if tot < 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()


# =============================================================================== finishing pipeline
def export_lods_named(key, objs, out_dir, ratios=(0.30, 0.08), tex_scale=(0.5, 0.25)):
    """Like kit.lod.export_lods but the LOD copies keep the ORIGINAL object names (client finds 'Sails'/'Lid')."""
    infos = []
    for i, r in enumerate(ratios, start=1):
        names = {o: o.name for o in objs}
        for o in objs:
            o.name = "__l0_" + o.name
        copies = lod.decimated_copies(objs, r, f"_lod{i}")
        for o, c in zip(objs, copies):
            c.name = names[o]
            c.data.name = names[o] + f"_lod{i}"
            c.location = o.location
        made = lod.downscale_materials(copies, tex_scale[i - 1], f"_lod{i}")
        info = export.export_glb(key, out_dir, objects=copies, budget=None, animations=False, suffix=f"_lod{i}")
        info["ratio"] = r
        infos.append(info)
        for c in copies:
            me = c.data
            bpy.data.objects.remove(c, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)
        for mc in made[0]:
            bpy.data.materials.remove(mc)
        for im in made[1]:
            bpy.data.images.remove(im)
        for o in objs:
            o.name = names[o]
    return infos


def drop_hidden_bottoms(objs, z=0.002):
    """Delete faces lying on the ground plane facing down (never visible, wastes atlas space)."""
    for o in objs:
        if o.type != "MESH":
            continue
        mw = o.matrix_world
        bm = bmesh.new()
        bm.from_mesh(o.data)
        kill = []
        for f in bm.faces:
            nw = (mw.to_3x3() @ f.normal).normalized()
            if nw.z < -0.95 and all((mw @ v.co).z < z for v in f.verts):
                kill.append(f)
        if kill:
            bmesh.ops.delete(bm, geom=kill, context="FACES")
            bm.to_mesh(o.data)
            o["kit_open"] = 1
        bm.free()


def triangulate(ob):
    """Triangulate after the bake (UVs kept) so the exporter can write tangents for the normal maps."""
    md = ob.modifiers.new("Tri", "TRIANGULATE")
    md.quad_method = "BEAUTY"
    md.ngon_method = "BEAUTY"
    md.keep_custom_normals = True
    gn.apply(ob)


def set_origin(ob, point):
    """Move the object's origin to world `point` without moving its geometry."""
    point = V(point)
    mw = ob.matrix_world.copy()
    local = mw.inverted() @ point
    ob.data.transform(Matrix.Translation(-local))
    ob.matrix_world = mw @ Matrix.Translation(local)


def finish(key, args, parts, budget, expected, size=1024, separate=None, pivots=None, group_sizes=None,
           ao_samples=64, lods=True, open_ok=True, extrusion=0.04, hero_yaw=35.0, hero_pitch=16.0, uv_margin=0.006):
    """bake -> join -> export -> LODs -> QA -> sheets. separate = {"Lid": [objs]} kept as named objects;
    pivots = {"Lid": (x, y, z)} world pivot of those objects."""
    import time
    t0 = time.time()
    separate = separate or {}
    everything = list(parts) + [o for v in separate.values() for o in v]
    gn.remove_templates()
    tex_dir = os.environ.get("ST_TEXDIR")
    res = bake.bake_asset(everything, key, size=size, samples=16, ao_samples=ao_samples, group_sizes=group_sizes,
                          extrusion=extrusion, ao_in_base=0.0, uv_margin=uv_margin, tex_dir=tex_dir)
    tb = time.time() - t0
    main = C.join(list(parts), key)
    finals = [main]
    for nm, objs in separate.items():
        o = C.join(list(objs), nm)
        if pivots and nm in pivots:
            set_origin(o, pivots[nm])
        finals.append(o)
    for o in finals:
        triangulate(o)
        if open_ok:
            o["kit_open"] = 1
    info = export.export_glb(key, args.out, objects=finals, budget=budget)
    lod_infos = export_lods_named(key, finals, args.out) if lods else []
    rep = qa.run(key, finals, budget=budget, expected=expected, glb=info, open_ok=open_ok)
    rep["info"]["bake_s"] = round(tb, 1)
    rep["info"]["lods"] = [(os.path.basename(l["path"]), l["tris"], l["bytes"]) for l in lod_infos]
    rep["info"]["groups"] = {g: r["size"] for g, r in res.items()}
    qa.save(rep, args.previews)
    if not args.no_preview:
        render.qa_sheets(key, finals, args.previews, poses=False)
    print(f"[structures] {key}: {info['tris']} tris, {info['bytes'] / 1024:.0f} KB, LODs "
          f"{[(l['tris'], round(l['bytes'] / 1024)) for l in lod_infos]}, total {time.time() - t0:.0f}s", flush=True)
    return finals, rep


def dry_preview(key, objs, out_dir, expected=None):
    """Development helper: tris / bbox / parts + an EEVEE turntable & normals sheet of the UNBAKED geometry."""
    os.makedirs(out_dir, exist_ok=True)
    gn.remove_templates()
    tris = export.triangles(objs)
    mn, mx = render.bbox(objs)
    d = mx - mn
    print(f"[dry] {key}: {tris} tris, {len(objs)} parts, bbox {d.x:.2f} x {d.y:.2f} x {d.z:.2f} "
          f"min {tuple(round(v, 2) for v in mn)} (expected {expected})", flush=True)
    by = {}
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH":
            continue
        me = o.evaluated_get(dg).to_mesh()
        for p in me.polygons:
            m = o.material_slots[p.material_index].material.name if o.material_slots and o.material_slots[p.material_index].material else "?"
            by[m] = by.get(m, 0) + len(p.vertices) - 2
        o.evaluated_get(dg).to_mesh_clear()
    print("[dry]   tris by material: " + ", ".join(f"{k}={v}" for k, v in sorted(by.items(), key=lambda kv: -kv[1])),
          flush=True)
    ext = []
    for o in objs:
        if o.type == "MESH" and o.data.vertices:
            m = max(max(abs((o.matrix_world @ v.co).x), abs((o.matrix_world @ v.co).y)) for v in o.data.vertices)
            ext.append((round(m, 2), o.name))
    print("[dry]   widest parts: " + str(sorted(ext, reverse=True)[:4]), flush=True)
    if os.environ.get("ST_DRY_NORENDER"):
        return
    import contextlib
    from kit import gpu
    gpu.lock_only = lambda wait=0: contextlib.nullcontext(False)     # dev previews: do not queue on the GPU lock
    render.qa_sheets(key, objs, out_dir, poses=False, hero_view=True, sheets=("turntable", "normals"))
