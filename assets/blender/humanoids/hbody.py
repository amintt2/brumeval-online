"""Continuous-body generator for the `humanoids` group.

Pipeline for one body:
    g = Graph(); ... nodes/edges (skin-modifier skeleton: torso, limbs, fingers, nose, ears ...)
    base  = g.build("Base")                 # skin modifier + subsurf -> clean QUAD mesh following the limbs
                                            #   (used as the source of garments: hems follow edge loops)
    parts = [ellipsoid(...), capsule(...)]  # extra volumes (brow, cheekbones, horns, iliac wings ...)
    high  = fuse([base copy] + parts, voxel)   # voxel remesh -> ONE watertight continuous surface
    sculpt(high, [...])                      # gaussian dents / bumps (eye sockets, cheeks, ribs ...)
    low   = decimate_copy(high, tris)        # game mesh (continuous, manifold) ; high is kept to bake details

Garment helpers: region_shell (inflate base faces selected by a predicate), push_outside (collision against
the final body with a clearance), smooth (Laplacian), tube/loft builders.
"""
import math

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils.bvhtree import BVHTree

from kit import gn

V = mathutils.Vector


# =============================================================================== skin graph
class Graph:
    def __init__(self):
        self.co, self.r, self.e = [], [], []

    def v(self, co, r):
        if isinstance(r, (int, float)):
            r = (r, r)
        self.co.append(tuple(co))
        self.r.append(tuple(r))
        return len(self.co) - 1

    def link(self, a, b):
        self.e.append((a, b))

    def chain(self, start, pts):
        """pts = [(co, r), ...] connected from `start` (index or None). Returns the list of new indices."""
        out = []
        prev = start
        for co, r in pts:
            i = self.v(co, r)
            if prev is not None:
                self.link(prev, i)
            out.append(i)
            prev = i
        return out

    def build(self, name, subdiv=2, root=0, branch_smooth=0.0, smooth_shade=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.co, self.e, [])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        sk = ob.modifiers.new("Skin", "SKIN")
        sk.use_smooth_shade = smooth_shade
        sk.branch_smoothing = branch_smooth
        for i, r in enumerate(self.r):
            ob.data.skin_vertices[0].data[i].radius = r
        ob.data.skin_vertices[0].data[root].use_root = True
        if subdiv:
            ss = ob.modifiers.new("Sub", "SUBSURF")
            ss.levels = ss.render_levels = subdiv
        gn.apply(ob)
        return ob


# =============================================================================== primitives (world space)
def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def ellipsoid(center, radii, rot=(0, 0, 0), seg=24, rings=16, name="_part"):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    M = mathutils.Matrix.Translation(center) @ mathutils.Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() \
        @ mathutils.Matrix.Diagonal((*radii, 1.0))
    bm.transform(M)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return _link(bpy.data.objects.new(name, me))


def capsule(a, b, r1, r2=None, seg=16, name="_part", flat=1.0):
    """Tapered capsule from point a (radius r1) to b (radius r2). flat squashes the cross-section (y' = y * flat)."""
    r2 = r1 if r2 is None else r2
    a, b = V(a), V(b)
    d = b - a
    L = d.length
    bm = bmesh.new()
    rings = []
    n_len = max(3, int(L / max(min(r1, r2), 0.004) * 1.2))
    prof = []
    # hemisphere a
    for k in range(4):
        t = k / 4 * (math.pi / 2)
        prof.append((-math.cos(t) * r1, math.sin(t) * r1))
    for k in range(n_len + 1):
        u = k / n_len
        prof.append((u * L, r1 + (r2 - r1) * u))
    for k in range(1, 5):
        t = k / 4 * (math.pi / 2)
        prof.append((L + math.sin(t) * r2, math.cos(t) * r2))
    for (x, r) in prof:
        ring = []
        for s in range(seg):
            ang = 2 * math.pi * s / seg
            ring.append(bm.verts.new((x, max(r, 1e-5) * math.cos(ang), max(r, 1e-5) * math.sin(ang) * flat)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(seg):
            bm.faces.new((rings[i][s], rings[i][(s + 1) % seg], rings[i + 1][(s + 1) % seg], rings[i + 1][s]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    # pole rings (radius ~0) collapse to ONE vertex (no near-coincident verts -> no degenerate / non-manifold faces)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=max(5e-5, 0.02 * min(r1, r2)))
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # orient +X along d
    q = V((1, 0, 0)).rotation_difference(d.normalized())
    bm.transform(mathutils.Matrix.Translation(a) @ q.to_matrix().to_4x4())
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return _link(bpy.data.objects.new(name, me))


def copy(ob, name):
    o = ob.copy()
    o.data = ob.data.copy()
    o.name = name
    for m in list(o.modifiers):
        o.modifiers.remove(m)
    _link(o)
    return o


def join(objs, name):
    objs = [o for o in objs if o is not None]
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def fuse(objs, voxel=0.005, name="High", smooth=0, keep=()):
    """Voxel-remesh the union of objs into ONE watertight mesh. Inputs are consumed except those in `keep`."""
    ob = join([copy(o, o.name + "_f") if o in keep else o for o in objs], name)
    md = ob.modifiers.new("Remesh", "REMESH")
    md.mode = "VOXEL"
    md.voxel_size = voxel
    md.adaptivity = 0.0
    md.use_smooth_shade = True
    gn.apply(ob)
    if smooth:
        laplacian(ob, smooth, 0.5)
    return ob


# =============================================================================== numpy mesh ops
def get_co(ob):
    n = len(ob.data.vertices)
    a = np.empty(n * 3)
    ob.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_co(ob, co):
    ob.data.vertices.foreach_set("co", co.ravel())
    ob.data.update()


def get_nr(ob):
    n = len(ob.data.vertices)
    a = np.empty(n * 3)
    try:
        ob.data.vertex_normals.foreach_get("vector", a)
    except AttributeError:
        ob.data.vertices.foreach_get("normal", a)
    return a.reshape(-1, 3)


def edges_np(ob):
    e = np.empty(len(ob.data.edges) * 2, dtype=np.int64)
    ob.data.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def laplacian(ob, iters=2, fac=0.5, mask=None, keep_boundary=True):
    co = get_co(ob)
    e = edges_np(ob)
    n = len(co)
    fixed = np.zeros(n, dtype=bool)
    if keep_boundary:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        for v in bm.verts:
            if v.is_boundary:
                fixed[v.index] = True
        bm.free()
    w = np.ones(n) if mask is None else np.asarray(mask, dtype=float)
    w = np.where(fixed, 0.0, w)
    for _ in range(iters):
        acc = np.zeros_like(co)
        cnt = np.zeros(n)
        np.add.at(acc, e[:, 0], co[e[:, 1]])
        np.add.at(acc, e[:, 1], co[e[:, 0]])
        np.add.at(cnt, e[:, 0], 1)
        np.add.at(cnt, e[:, 1], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        co = co + (avg - co) * (fac * w)[:, None]
    set_co(ob, co)


def sculpt(ob, ops):
    """Gaussian sculpt ops on vertices (object space = world space for our unparented meshes).
    op = ("push", center, radius, amount)        move along the vertex normal (amount < 0 = dent)
         ("move", center, radius, (dx,dy,dz))     translate with falloff
         ("scale", center, radius, (sx,sy,sz))    scale around center with falloff
         ("flatten_z", zmin)                      clamp z >= zmin (flat soles)
    radius may be a scalar or (rx, ry, rz) for an ellipsoidal falloff."""
    co = get_co(ob)
    ob.data.update()
    nr = get_nr(ob)
    for op in ops:
        k = op[0]
        if k == "flatten_z":
            co[:, 2] = np.maximum(co[:, 2], op[1])
            continue
        c = np.array(op[1], dtype=float)
        if k == "bump_near":
            c = co[int(np.argmin(((co - c) ** 2).sum(1)))].copy()
            k = "push"
        r = np.array(op[2] if isinstance(op[2], (tuple, list)) else (op[2],) * 3, dtype=float)
        d = (co - c) / r
        w = np.exp(-2.0 * (d * d).sum(1))
        if k == "push":
            co += nr * (w * op[3])[:, None]
        elif k == "move":
            co += np.outer(w, np.array(op[3]))
        elif k == "scale":
            s = np.array(op[3])
            co += (co - c) * (s - 1.0)[None, :] * w[:, None]
    set_co(ob, co)


def decimate_to(ob, tris, name=None):
    """Collapse-decimate `ob` (in place) to about `tris` triangles."""
    ob.data.calc_loop_triangles()
    cur = len(ob.data.loop_triangles)
    if cur > tris:
        gn.decimate(ob, tris / cur)
        gn.apply(ob)
    if name:
        ob.name = name
        ob.data.name = name
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def clean(ob, dist=1e-5, recalc=True):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=dist)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def keep_largest(ob):
    """Delete every island except the largest (voxel fusing can leave specks)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    islands = []
    for f in bm.faces:
        if f.index in seen:
            continue
        st, isl = [f], []
        seen.add(f.index)
        while st:
            g = st.pop()
            isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        st.append(h)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    kill = [f for isl in islands[1:] for f in isl]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    return len(islands)


def bvh(ob):
    bm = bmesh.new()
    dg = bpy.context.evaluated_depsgraph_get()
    bm.from_object(ob, dg)
    bm.transform(ob.matrix_world)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def push_outside(ob, colliders, offset=0.01, iters=3, smooth=1, mask=None, reach=0.08):
    """Move vertices of `ob` that are inside / closer than `offset` to a collider surface out to `offset`
    (nearest point + normal). Only surface points within `reach` are considered, so open shells (other garments)
    only push what really lies against them. Interleaved with light smoothing so the garment stays smooth."""
    trees = [bvh(c) for c in colliders]
    moved = 0
    for it in range(iters):
        co = get_co(ob)
        moved = 0
        for i in range(len(co)):
            if mask is not None and not mask[i]:
                continue
            p = V(co[i])
            for t in trees:
                q, n, fi, d = t.find_nearest(p, reach)
                if q is None:
                    continue
                s = (p - q).dot(n)
                if s < offset:
                    p = p + n * (offset - s)
                    moved += 1
            co[i] = p
        set_co(ob, co)
        if smooth and it < iters - 1:
            laplacian(ob, smooth, 0.4, mask=mask)
    return moved


# =============================================================================== garments
def region_shell(src, pred, inflate=0.02, name="Garment", mat=None):
    """New mesh from the faces of `src` whose vertices ALL satisfy pred(co) -> bool, pushed out along normals."""
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.normal_update()
    kill = [f for f in bm.faces if not all(pred(v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * inflate
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = _link(bpy.data.objects.new(name, me))
    for p in ob.data.polygons:
        p.use_smooth = True
    if mat is not None:
        ob.data.materials.append(mat)
    keep_islands(ob, 0.1)
    return ob


def loft(rings, name="Loft", closed_start=False, closed_end=False, mat=None):
    """Mesh from a list of rings (each a list of N points, same N, ordered consistently). Quads between rings."""
    bm = bmesh.new()
    R = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for i in range(len(R) - 1):
        for s in range(n):
            bm.faces.new((R[i][s], R[i][(s + 1) % n], R[i + 1][(s + 1) % n], R[i + 1][s]))
    if closed_start:
        bm.faces.new(list(reversed(R[0])))
    if closed_end:
        bm.faces.new(R[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = _link(bpy.data.objects.new(name, me))
    for p in ob.data.polygons:
        p.use_smooth = True
    if mat is not None:
        ob.data.materials.append(mat)
    return ob


def outward_normals(ob, center_fn=None):
    """Make an open shell's normals point away from its axis (center_fn(co)->point on axis) or recalc."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if center_fn is not None:
        bm.normal_update()
        score = 0.0
        for f in bm.faces:
            c = f.calc_center_median()
            score += (c - V(center_fn(c))).dot(f.normal) * f.calc_area()
        if score < 0:
            for f in bm.faces:
                f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def set_material(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def flip_to_outside(ob):
    outward_normals(ob, lambda c: V((0, 0, c.z)))


def _lap_np(co, e, n):
    acc = np.zeros_like(co)
    for k in range(3):
        acc[:, k] = np.bincount(e[:, 0], weights=co[e[:, 1], k], minlength=n) + \
            np.bincount(e[:, 1], weights=co[e[:, 0], k], minlength=n)
    cnt = np.bincount(e[:, 0], minlength=n) + np.bincount(e[:, 1], minlength=n)
    return acc / np.maximum(cnt, 1)[:, None] - co


def taubin(ob, iters=10, lam=0.5, mu=-0.53, mask=None):
    """Volume-preserving (Taubin lambda/mu) smoothing: blends fused volumes like a sculptor's smooth brush."""
    co = get_co(ob)
    e = edges_np(ob)
    n = len(co)
    w = np.ones(n) if mask is None else np.asarray(mask, dtype=float)
    for _ in range(iters):
        co = co + lam * w[:, None] * _lap_np(co, e, n)
        co = co + mu * w[:, None] * _lap_np(co, e, n)
    set_co(ob, co)


def region_mask(ob, regions, default=1.0):
    """Per-vertex weights: regions = [(centre, radius, weight), ...] (smooth falloff to `default`)."""
    co = get_co(ob)
    w = np.full(len(co), default, dtype=float)
    for c, r, val in regions:
        d = np.linalg.norm(co - np.array(c), axis=1) / r
        f = np.clip(1.0 - (d - 0.7) / 0.3, 0.0, 1.0)
        w = w * (1 - f) + val * f
    return w


def remesh(ob, voxel):
    """Voxel remesh in place (re-closes a mesh after booleans: guaranteed manifold, no slivers)."""
    md = ob.modifiers.new("Remesh", "REMESH")
    md.mode = "VOXEL"
    md.voxel_size = voxel
    md.adaptivity = 0.0
    md.use_smooth_shade = True
    gn.apply(ob)
    return ob


def carve(ob, cutters, solver="EXACT", voxel=None):
    """Boolean-subtract closed cutter meshes (eye sockets, nasal cavity...) from ob, then delete the cutters.
    voxel: re-remesh afterwards (EXACT booleans can leave non-manifold slivers where surfaces nearly touch)."""
    for c in cutters:
        md = ob.modifiers.new("Carve", "BOOLEAN")
        md.operation = "DIFFERENCE"
        md.solver = solver
        md.object = c
        c.hide_render = True
        c.hide_viewport = True
        gn.apply(ob)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    if voxel:
        remesh(ob, voxel)


def bumps_on_surface(ob, centres, radius, amount):
    """Wart / knob bumps at the surface points nearest to `centres`."""
    t = bvh(ob)
    ops = []
    for c in centres:
        q, n, i, d = t.find_nearest(V(c))
        if q is not None:
            ops.append(("push", tuple(q), radius, amount))
    sculpt(ob, ops)


def keep_islands(ob, frac=0.1):
    """Delete islands smaller than frac * the largest island (specks), keep the rest (e.g. both sleeves)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    islands = []
    for f in bm.faces:
        if f.index in seen:
            continue
        st, isl = [f], []
        seen.add(f.index)
        while st:
            g = st.pop()
            isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        st.append(h)
        islands.append(isl)
    mx = max((len(i) for i in islands), default=0)
    kill = [f for isl in islands if len(isl) < frac * mx for f in isl]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


def superellipsoid(center, radii, p=0.4, rot=(0, 0, 0), seg=20, rings=12, name="_part"):
    """Rounded box: sphere coordinates raised to the power p (<1 = boxier)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = V(tuple(math.copysign(abs(c) ** p, c) for c in v.co))
    M = mathutils.Matrix.Translation(center) @ mathutils.Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() \
        @ mathutils.Matrix.Diagonal((*radii, 1.0))
    bm.transform(M)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return _link(bpy.data.objects.new(name, me))


def triangulate(ob):
    """Planar triangles (quads bent by conforming are not planar; glTF triangulates anyway)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def drop_degenerate(ob, min_area=1e-9):
    """Remove zero-area slivers left by conforming/triangulation (collapse their shortest edge)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(4):
        bad = [f for f in bm.faces if f.calc_area() < min_area]
        if not bad:
            break
        edges = set()
        for f in bad:
            if f.is_valid:
                edges.add(min(f.edges, key=lambda e: e.calc_length()))
        bmesh.ops.collapse(bm, edges=[e for e in edges if e.is_valid], uvs=False)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
