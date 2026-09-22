"""Low-poly construction kit for the "structures" asset group (Blender 5.0, headless).

Every model is assembled into ONE bmesh (one mesh object, several material slots) so the client can
instance it cheaply: one InstancedMesh per material. All helpers are deterministic (seeded RNG).

Axes (Blender): X = right, -Y = FRONT of the model, Z = up. 1 unit = 1 m. Ground at z = 0.
"""
import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

import common as C

# --------------------------------------------------------------------------- palette
# name: (hex colour, roughness, metallic, emission hex or None, emission strength, double sided)
PALETTE = {
    # stone & earth
    "Stone":       ("#9a9186", 0.92, 0.0, None, 0, False),
    "StoneDark":   ("#5f5a54", 0.95, 0.0, None, 0, False),
    "StoneGrave":  ("#8e8c86", 0.95, 0.0, None, 0, False),
    "Carving":     ("#3f3d3b", 0.95, 0.0, None, 0, False),
    "Moss":        ("#5d7b34", 0.95, 0.0, None, 0, False),
    "Dirt":        ("#6a5842", 0.97, 0.0, None, 0, False),
    "Ash":         ("#2c2724", 0.98, 0.0, None, 0, False),
    # wood
    "Timber":      ("#4a3121", 0.85, 0.0, None, 0, False),
    "Wood":        ("#87572f", 0.85, 0.0, None, 0, False),
    "WoodLight":   ("#b3834f", 0.85, 0.0, None, 0, False),
    "WoodDark":    ("#5b3b25", 0.88, 0.0, None, 0, False),
    "LogBark":     ("#5a3f2a", 0.95, 0.0, None, 0, False),
    # house
    "Plaster":     ("#ecdfc2", 0.92, 0.0, None, 0, False),
    "Roof":        ("#93402c", 0.85, 0.0, None, 0, False),
    "RoofSlate":   ("#56606e", 0.8, 0.0, None, 0, False),
    "Flowers":     ("#e0506a", 0.8, 0.0, None, 0, False),
    # metal
    "Iron":        ("#2f2e33", 0.5, 0.65, None, 0, False),
    "Rope":        ("#b59a6a", 0.95, 0.0, None, 0, False),
    # glowing (names start with "Glow" so the client can modulate them at night)
    "GlowWindow":  ("#ffc766", 0.5, 0.0, "#ff9d3a", 2.2, False),
    "GlowLantern": ("#ffdc80", 0.4, 0.0, "#ffaa45", 3.0, False),
    "GlowFlame":   ("#ff7a1c", 0.6, 0.0, "#ff5a0a", 2.2, True),
    "GlowFlameCore": ("#ffd84a", 0.6, 0.0, "#ffc02a", 2.8, True),
    "GlowEmber":   ("#ff5a14", 0.6, 0.0, "#ff400a", 2.0, False),
    # water
    "Water":       ("#1c3a47", 0.12, 0.0, None, 0, False),
    # camp
    "HideLight":   ("#c9a577", 0.95, 0.0, None, 0, True),
    "HideMid":     ("#8d6a44", 0.95, 0.0, None, 0, True),
    "HideDark":    ("#57402c", 0.95, 0.0, None, 0, True),
    "Bone":        ("#e2d6b8", 0.8, 0.0, None, 0, False),
    "Shadow":      ("#1a1410", 1.0, 0.0, None, 0, True),
    # market
    "CanvasRed":   ("#b83a2e", 0.9, 0.0, None, 0, True),
    "CanvasWhite": ("#f0e6cf", 0.9, 0.0, None, 0, True),
    "Apple":       ("#c8261e", 0.45, 0.0, None, 0, False),
    "Leaf":        ("#5b8a2f", 0.8, 0.0, None, 0, False),
    "Glass":       ("#3f8c6a", 0.15, 0.1, None, 0, False),
    "ClothBlue":   ("#3867a6", 0.9, 0.0, None, 0, False),
    "ClothGold":   ("#d7a23a", 0.85, 0.0, None, 0, False),
}


def mat(name):
    """Palette material (created once per scene; C.reset() clears it)."""
    col, rough, metal, emit, strength, double = PALETTE[name]
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = C.material(name, C.hex_color(col), rough=rough, metal=metal,
                   emit=C.hex_color(emit) if emit else None, emit_strength=strength or 1.0)
    # single-sided unless the piece is a thin sheet (flames, canvas, hides)
    m.use_backface_culling = not double
    return m


# --------------------------------------------------------------------------- transforms
def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    if not isinstance(scale, (tuple, list, Vector)):
        scale = (scale, scale, scale)
    if isinstance(rot, Quaternion):
        r = rot.to_matrix().to_4x4()
    else:
        r = Euler(rot).to_matrix().to_4x4()
    return Matrix.Translation(Vector(loc)) @ r @ Matrix.Diagonal(Vector((*scale, 1.0)))


def aim(d, up=(0, 0, 1)):
    """Rotation quaternion mapping local +X onto direction d (roll keeps local +Z close to `up`)."""
    d = Vector(d).normalized()
    upv = Vector(up)
    if abs(d.dot(upv.normalized())) > 0.995:
        upv = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    x = d
    y = upv.cross(x).normalized()
    z = x.cross(y).normalized()
    mtx = Matrix((x, y, z)).transposed()
    return mtx.to_quaternion()


# --------------------------------------------------------------------------- builder
class Builder:
    """Accumulates pieces in one bmesh; each piece gets one material and optional jitter."""

    def __init__(self, seed=1):
        self.bm = bmesh.new()
        self.mats = []
        self.rng = random.Random(seed)

    # ---- internals
    def _mi(self, material):
        if material not in self.mats:
            self.mats.append(material)
        return self.mats.index(material)

    def _finish(self, verts, material, jitter=0.0, recalc=True):
        verts = list(verts)
        faces = list(dict.fromkeys(f for v in verts for f in v.link_faces))   # deterministic order
        mi = self._mi(material)
        for f in faces:
            f.material_index = mi
            f.smooth = False
        if jitter:
            r = self.rng
            for v in verts:
                v.co += Vector((r.uniform(-jitter, jitter), r.uniform(-jitter, jitter), r.uniform(-jitter, jitter)))
        if recalc and faces:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        return verts

    def rand(self, a=0.0, b=1.0):
        return self.rng.uniform(a, b)

    # ---- primitives
    def box(self, size, loc=(0, 0, 0), rot=(0, 0, 0), material=None, jitter=0.0):
        """Axis box of `size` (sx,sy,sz) centred at loc, rotated by euler `rot` (or Quaternion)."""
        res = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M(loc, rot, size))
        return self._finish(res["verts"], material, jitter)

    def box_minmax(self, mn, mx, material, jitter=0.0):
        size = tuple(mx[i] - mn[i] for i in range(3))
        loc = tuple((mx[i] + mn[i]) / 2 for i in range(3))
        return self.box(size, loc, material=material, jitter=jitter)

    def beam(self, p0, p1, w, h=None, material=None, jitter=0.0, up=(0, 0, 1), extend=0.0):
        """Rectangular beam from p0 to p1, cross-section w (local Y) x h (local Z)."""
        h = w if h is None else h
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        length = d.length + 2 * extend
        q = aim(d, up)
        return self.box((length, w, h), (p0 + p1) / 2, q, material, jitter)

    def cyl(self, r, depth, loc=(0, 0, 0), rot=(0, 0, 0), segments=8, material=None, r2=None,
            jitter=0.0, scale=(1, 1, 1)):
        """Cylinder / truncated cone along local Z, centred at loc."""
        r2 = r if r2 is None else r2
        mtx = M(loc, rot, scale)
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segments,
                                    radius1=r, radius2=r2, depth=depth, matrix=mtx)
        return self._finish(res["verts"], material, jitter)

    def cyl_between(self, p0, p1, r, segments=8, material=None, r2=None, jitter=0.0):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = d.to_track_quat("Z", "X" if abs(d.normalized().y) > 0.9 else "Y")
        return self.cyl(r, d.length, (p0 + p1) / 2, q, segments, material, r2, jitter)

    def cone(self, r, depth, loc=(0, 0, 0), rot=(0, 0, 0), segments=8, material=None, jitter=0.0,
             scale=(1, 1, 1)):
        """Cone along local Z (base at loc - depth/2, tip at loc + depth/2)."""
        mtx = M(loc, rot, scale)
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=True, segments=segments,
                                    radius1=r, radius2=0.0, depth=depth, matrix=mtx)
        return self._finish(res["verts"], material, jitter)

    def ico(self, r, loc=(0, 0, 0), subdiv=1, material=None, scale=(1, 1, 1), rot=(0, 0, 0), jitter=0.0):
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=r, matrix=M(loc, rot, scale))
        return self._finish(res["verts"], material, jitter)

    def sphere(self, r, loc=(0, 0, 0), u=8, v=5, material=None, scale=(1, 1, 1), rot=(0, 0, 0), jitter=0.0):
        """Low-poly UV sphere: u segments around, v rings from pole to pole (built as a lathe)."""
        prof = [(0.0, -r)]
        for k in range(1, v):
            a = -math.pi / 2 + math.pi * k / v
            prof.append((math.cos(a) * r, math.sin(a) * r))
        prof.append((0.0, r))
        return self.lathe(prof, u, loc=loc, material=material, rot=rot, scale=scale, jitter=jitter)

    def prism(self, pts, y0, y1, material=None, mtx=None, jitter=0.0):
        """Extrude a 2D polygon given in the XZ plane [(x,z),...] from y=y0 to y=y1 (closed solid)."""
        mtx = mtx or Matrix.Identity(4)
        front = [self.bm.verts.new(mtx @ Vector((x, y0, z))) for x, z in pts]
        back = [self.bm.verts.new(mtx @ Vector((x, y1, z))) for x, z in pts]
        n = len(pts)
        self.bm.faces.new(front)
        self.bm.faces.new(list(reversed(back)))
        for i in range(n):
            j = (i + 1) % n
            self.bm.faces.new((front[i], front[j], back[j], back[i]))
        return self._finish(front + back, material, jitter)

    def loft(self, rings, material=None, cap_bottom=True, cap_top=True, jitter=0.0, closed=False,
             face_mat=None, recalc=True):
        """Solid through a list of rings (lists of 3D points, same count; a ring of ONE point is an apex).
        closed=True also joins the last ring to the first (torus-like, no caps).
        face_mat(seg, band) -> material overrides the material of individual faces."""
        vr = [[self.bm.verts.new(Vector(p)) for p in ring] for ring in rings]
        n = max(len(r) for r in rings)
        pairs = list(zip(vr[:-1], vr[1:]))
        if closed:
            pairs.append((vr[-1], vr[0]))
        custom = []
        for band, (a, b) in enumerate(pairs):
            for i in range(n):
                j = (i + 1) % n
                if len(a) == 1:
                    f = self.bm.faces.new((a[0], b[j], b[i]))
                elif len(b) == 1:
                    f = self.bm.faces.new((a[i], a[j], b[0]))
                else:
                    f = self.bm.faces.new((a[i], a[j], b[j], b[i]))
                if face_mat is not None:
                    custom.append((f, face_mat(i, band)))
        if not closed:
            if cap_bottom and len(vr[0]) > 2:
                self.bm.faces.new(list(reversed(vr[0])))
            if cap_top and len(vr[-1]) > 2:
                self.bm.faces.new(vr[-1])
        allv = [v for ring in vr for v in ring]
        out = self._finish(allv, material, jitter, recalc=recalc)
        for f, m in custom:
            if m is not None:
                f.material_index = self._mi(m)
        return out

    def lathe(self, profile, segments=12, loc=(0, 0, 0), material=None, cap_bottom=True, cap_top=True,
              rot=(0, 0, 0), phase=0.0, jitter=0.0, closed=False, face_mat=None, scale=(1, 1, 1), recalc=True):
        """Surface of revolution around local Z from a profile [(radius, z), ...] (bottom to top).
        A radius of 0 at either end makes a pointed apex."""
        mtx = M(loc, rot, scale)
        rings = []
        for r, z in profile:
            if r == 0:
                rings.append([mtx @ Vector((0, 0, z))])
                continue
            ring = []
            for i in range(segments):
                a = phase + 2 * math.pi * i / segments
                ring.append(mtx @ Vector((math.cos(a) * r, math.sin(a) * r, z)))
            rings.append(ring)
        return self.loft(rings, material, cap_bottom, cap_top, jitter, closed, face_mat, recalc)

    def poly(self, pts, material=None):
        """One flat polygon (for double-sided sheet materials)."""
        vs = [self.bm.verts.new(Vector(p)) for p in pts]
        self.bm.faces.new(vs)
        return self._finish(vs, material, recalc=False)

    def sheet(self, pts, thickness, material=None, jitter=0.0):
        """Thin closed slab from a planar polygon, extruded along its normal by `thickness`."""
        pts = [Vector(p) for p in pts]
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0]).normalized()
        off = n * thickness
        a = [self.bm.verts.new(p) for p in pts]
        b = [self.bm.verts.new(p + off) for p in pts]
        self.bm.faces.new(list(reversed(a)))
        self.bm.faces.new(b)
        k = len(pts)
        for i in range(k):
            j = (i + 1) % k
            self.bm.faces.new((a[i], a[j], b[j], b[i]))
        return self._finish(a + b, material, jitter)

    # ---- output
    def build(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        for p in me.polygons:
            p.use_smooth = False
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# --------------------------------------------------------------------------- composite helpers
def stepped_roof(b, half_len, ridge_z, half_span, pitch_deg, rows, material, thickness=0.1, lift=0.07,
                 overlap=0.1, along="y"):
    """Gable roof made of overlapping shingle rows, ridge (underside) at z = ridge_z, running along
    `along` ("y": slopes fall towards +-X, "x": slopes fall towards +-Y). Returns the eave height."""
    th = math.radians(pitch_deg)
    cos_, sin_ = math.cos(th), math.sin(th)
    D = half_span / cos_
    mtx = None if along == "y" else M(rot=(0, 0, math.radians(90)))
    for s in (-1, 1):
        ux, uz = s * cos_, -sin_
        nx, nz = s * sin_, cos_
        for i in range(rows):
            d0 = i * D / rows - (overlap if i else 0.0)
            d1 = (i + 1) * D / rows
            ax, az = ux * d0, ridge_z + uz * d0
            bx, bz = ux * d1 + nx * lift, ridge_z + uz * d1 + nz * lift
            pts = [(ax, az), (bx, bz), (bx + nx * thickness, bz + nz * thickness),
                   (ax + nx * thickness, az + nz * thickness)]
            e = 0.015 * (i % 2)
            b.prism(pts, -half_len - e, half_len + e, material, mtx=mtx)
    return ridge_z - half_span * math.tan(th)


def ring_band(b, r_in, r_out, z0, z1, segments, material, phase=0.0, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Closed annulus (metal band, coping ring...) around local Z."""
    return b.lathe([(r_in, z0), (r_out, z0), (r_out, z1), (r_in, z1)], segments, loc=loc, rot=rot,
                   material=material, closed=True, phase=phase)
