"""Giants kit: helpers shared by the "giants" group (golem, yeti, bog_lurker, troll, frost_giant, sand_wyrm).

Built on the shared kit (assets/blender/kit) — nothing here edits it.

    body = gk.Meta("Troll", res=0.02)                    # metaball sculpting (smooth organic unions)
    body.capsule(a, b, r); body.ellipsoid(c, (rx, ry, rz), rot); body.ball(c, r)
    base = body.to_mesh("TrollBase")                     # one watertight continuous mesh
    high = gk.sculpt_copy(base, layers, subdiv=2)        # Geometry-Nodes displacement (warts, cracks, fur clumps)
    low  = gk.retopo(base, faces=5000, layers=layers)    # QuadriFlow quads + the low-frequency part of the sculpt

Rigging / animation: gk.Rigger builds an armature with leg IK controls, clips are authored with world-axis
rotations and baked to plain FK (one Action per clip, every deforming bone keyed) — see Rigger.
"""
import math
import os
import time

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

import common as C
from kit import bake, export, gn, qa, render, rig
from kit.nodes import NB, sock

THRESH = 0.6


def _mb_scale(stiff, threshold=THRESH):
    """Surface radius / element radius of an isolated metaball element (field s*(1-(d/R)^2)^3)."""
    return math.sqrt(1.0 - (threshold / stiff) ** (1.0 / 3.0))


def _rot_q(rot):
    if rot is None:
        return Quaternion()
    if isinstance(rot, Quaternion):
        return rot
    return Euler(tuple(math.radians(a) for a in rot), "XYZ").to_quaternion()


# =============================================================================== metaball sculpting
class Meta:
    """Metaball body builder. All radii are SURFACE radii (metres) of the isolated element.
    Joined elements blend smoothly (fields add: a joint bulges by ~7 % with stiff=8, ~19 % with stiff=2)."""

    def __init__(self, name, res=0.03, threshold=THRESH):
        self.name = name
        self.mb = bpy.data.metaballs.new(name)
        self.mb.resolution = res
        self.mb.render_resolution = res
        self.mb.threshold = threshold
        self.mb.update_method = "UPDATE_ALWAYS"
        self.obj = bpy.data.objects.new(name, self.mb)
        bpy.context.scene.collection.objects.link(self.obj)
        self.th = threshold
        self.items = []

    def _el(self, typ, co, r, stiff, neg):
        el = self.mb.elements.new(type=typ)
        el.co = tuple(co)
        el.stiffness = stiff
        el.radius = r / _mb_scale(stiff, self.th)
        el.use_negative = neg
        self.items.append((typ, tuple(co), r))
        return el

    def ball(self, c, r, stiff=4.0, neg=False):
        return self._el("BALL", c, r, stiff, neg)

    def ellipsoid(self, c, r3, rot=None, stiff=4.0, neg=False):
        m = max(r3)
        el = self._el("ELLIPSOID", c, m, stiff, neg)
        el.size_x, el.size_y, el.size_z = (r3[0] / m, r3[1] / m, r3[2] / m)
        el.rotation = _rot_q(rot)
        return el

    def capsule(self, a, b, r, stiff=6.0, neg=False):
        a, b = Vector(a), Vector(b)
        d = b - a
        el = self._el("CAPSULE", (a + b) / 2, r, stiff, neg)
        el.size_x = max(d.length / 2, 1e-4)
        el.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized()) if d.length > 1e-6 else Quaternion()
        return el

    def limb(self, pts, stiff=6.0, max_step=None):
        """Tapered limb through [(point, radius), ...]: short capsules with interpolated radii."""
        for (p0, r0), (p1, r1) in zip(pts[:-1], pts[1:]):
            p0, p1 = Vector(p0), Vector(p1)
            L = (p1 - p0).length
            step = max_step or max(0.6 * min(r0, r1), 0.02)
            n = max(1, int(round(L / step))) if abs(r1 - r0) > 0.1 * min(r0, r1) else 1
            for i in range(n):
                a = p0.lerp(p1, i / n)
                b = p0.lerp(p1, (i + 1) / n)
                self.capsule(a, b, r0 + (r1 - r0) * (i + 0.5) / n, stiff)

    def mirror(self, fn, *args, **kw):
        """Call fn(sign, ...) for both sides (sign +1 = left side = +X)."""
        for s in (1, -1):
            fn(s, *args, **kw)

    def to_mesh(self, name, res=None, keep=False):
        if res:
            self.mb.resolution = res
            self.mb.render_resolution = res
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        me = bpy.data.meshes.new_from_object(self.obj.evaluated_get(dg))
        me.name = name
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if not keep:
            bpy.data.objects.remove(self.obj, do_unlink=True)
            bpy.data.metaballs.remove(self.mb)
        cleanup(ob)
        for p in ob.data.polygons:
            p.use_smooth = True
        return ob


def cleanup(ob, merge=1e-5, keep_largest=True):
    """Merge doubles, drop loose bits (metaball polygonisation can leave tiny islands), recalc normals outward."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
    if keep_largest:
        bm.faces.ensure_lookup_table()
        seen, islands = set(), []
        for f in bm.faces:
            if f.index in seen:
                continue
            stack, isl = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop()
                isl.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen:
                            seen.add(h.index)
                            stack.append(h)
            islands.append(isl)
        islands.sort(key=len, reverse=True)
        kill = [f for isl in islands[1:] if len(isl) < 0.02 * len(islands[0]) for f in isl]
        if kill:
            bmesh.ops.delete(bm, geom=kill, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def dup(ob, name):
    o = ob.copy()
    o.data = ob.data.copy()
    o.name = name
    o.data.name = name
    for c in list(o.users_collection):
        c.objects.unlink(o)
    bpy.context.scene.collection.objects.link(o)
    for md in list(o.modifiers):
        o.modifiers.remove(md)
    return o


def tris(ob):
    return export.triangles([ob])


# =============================================================================== GN sculpt layers
def sculpt(ob, layers, subdiv=0, name="GkSculpt", max_scale=None, min_scale=None, seed=0):
    """Displace `ob` along its normals with a sum of procedural layers (Geometry Nodes, applied later).

    layers: list of dicts, each {"type": ..., "scale": features/metre, "amp": metres, optional "stretch": (x,y,z),
            "mask": vertex-group name (0..1 weight multiplies the layer), "seed": int, ...}
      noise   : fbm noise, signed (lumps, muscle mass, fur clumps when stretched)
      bumps   : voronoi F1 domes (warts, pustules, pebbles) ; "size" 0..1 dome radius in cell units
      cracks  : voronoi distance-to-edge grooves (stone cracks, dried mud, scales)
      ridges  : 1-|2n-1| sharp ridges of noise (wrinkles, roots, veins, strands when stretched)
      cells   : voronoi smooth-F1 plateaus (stone plates, chunky rock)
      strata  : horizontal bands (sediment, ice layers)
    max_scale / min_scale: only keep layers whose scale is <= / >= the value (the low mesh gets only the big shapes).
    """
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nb = NB(ng)
    gi = nb.node("NodeGroupInput")
    go = nb.node("NodeGroupOutput")
    geo = gi.outputs[0]
    if subdiv:
        geo = nb.node("GeometryNodeSubdivisionSurface", Mesh=geo, Level=subdiv).outputs[0]
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    total = None
    stores = []
    for L in layers:
        sc = L["scale"]
        if max_scale is not None and sc > max_scale:
            continue
        if min_scale is not None and sc < min_scale:
            continue
        sd = L.get("seed", seed) * 1.713 + 3.1
        p = nb.vmath("ADD", pos, (sd % 41.0, (sd * 2.3) % 37.0, (sd * 0.7) % 29.0))
        if "stretch" in L:
            p = nb.vmath("MULTIPLY", p, tuple(L["stretch"]))
        if L.get("warp"):
            w = nb.noise(p, sc * 0.5, 2.0, 0.5).outputs["Color"]
            p = nb.vmath("ADD", p, nb.vmath("SCALE", nb.vmath("SUBTRACT", w, (0.5, 0.5, 0.5)), scale=L["warp"] / sc))
        t = L["type"]
        if t == "noise":
            n = nb.noise(p, sc, L.get("detail", 4.0), L.get("rough", 0.55), dist=L.get("dist", 0.0)).outputs["Fac"]
            h = nb.mul(nb.sub(n, 0.5), 2.0)
        elif t == "bumps":
            vo = nb.voronoi(p, sc, "F1", rand=L.get("rand", 1.0)).outputs["Distance"]
            size = L.get("size", 0.45)
            h = nb.maprange(vo, 0.0, size, 1.0, 0.0, "SMOOTHSTEP")
            if L.get("density", 1.0) < 1.0:     # only some cells carry a bump
                col = nb.voronoi(p, sc, "F1", rand=L.get("rand", 1.0)).outputs["Color"]
                keep = nb.math("LESS_THAN", nb.sep(col)[0], L["density"])
                h = nb.mul(h, keep)
        elif t == "cracks":
            vo = nb.voronoi(p, sc, "DISTANCE_TO_EDGE", rand=L.get("rand", 1.0)).outputs["Distance"]
            h = nb.mul(nb.maprange(vo, 0.0, L.get("width", 0.06), 1.0, 0.0, "SMOOTHSTEP"), -1.0)
        elif t == "ridges":
            n = nb.noise(p, sc, L.get("detail", 3.0), L.get("rough", 0.5), dist=L.get("dist", 0.0)).outputs["Fac"]
            r = nb.sub(1.0, nb.math("ABSOLUTE", nb.mul(nb.sub(n, 0.5), 2.0)))
            h = nb.math("POWER", r, L.get("sharp", 4.0))
        elif t == "cells":
            vo = nb.voronoi(p, sc, "SMOOTH_F1", rand=1.0, smooth=L.get("smooth", 0.3)).outputs["Distance"]
            h = nb.mul(nb.sub(0.5, vo), 2.0)
        elif t == "strata":
            z = nb.sep(p)[2]
            n = nb.noise(p, sc * 0.3, 2.0).outputs["Fac"]
            st = nb.math("FRACT", nb.mul(nb.add(z, nb.mul(n, 0.4 / sc)), sc))
            h = nb.sub(nb.math("POWER", st, 0.4), 0.5)
        else:
            raise ValueError(t)
        if L.get("store"):
            stores.append((L["store"], h))
        h = nb.mul(h, L["amp"])
        if L.get("mask"):
            a = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT"}, Name=L["mask"])
            m = sock(a.outputs, "Attribute", "VALUE")
            if L.get("invert"):
                m = nb.sub(1.0, m)
            h = nb.mul(h, m)
        total = h if total is None else nb.add(total, h)
    for aname, val in stores:       # raw layer value (before amplitude) as a point attribute for the shaders
        st = nb.node("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT", "domain": "POINT"}, Geometry=geo, Name=aname)
        nb.feed(sock(st.inputs, "Value", "VALUE"), val)
        geo = st.outputs[0]
    if total is not None:
        off = nb.vmath("SCALE", nrm, scale=total)
        geo = nb.node("GeometryNodeSetPosition", Geometry=geo, Offset=off).outputs[0]
    nb.link(geo, go.inputs[0])
    md = ob.modifiers.new(name, "NODES")
    md.node_group = ng
    return md


def sculpt_copy(base, layers, subdiv=2, name=None, seed=0):
    hi = dup(base, name or ("_" + base.name + "High"))
    sculpt(hi, layers, subdiv=subdiv, seed=seed)
    gn.apply(hi)
    return hi


def retopo(base, faces=4000, layers=None, max_scale=None, name=None, seed=0, smooth=0):
    """Low-poly quad mesh: QuadriFlow on the smooth base, then the low-frequency sculpt layers (max_scale)."""
    lo = dup(base, name or base.name + "Low")
    # quad retopology = coarse voxel remesh (all quads, even density, watertight) sized from the surface area.
    # (QuadriFlow refuses some of these meshes in 5.0.1 and is not needed at this density.)
    area = sum(p.area for p in base.data.polygons)
    vox = math.sqrt(area / max(faces, 50))
    for _ in range(4):
        tmp = dup(base, "_vox_try")
        md = tmp.modifiers.new("Vox", "REMESH")
        md.mode = "VOXEL"
        md.voxel_size = vox
        md.use_smooth_shade = True
        gn.apply(tmp)
        n = len(tmp.data.polygons)
        if abs(n - faces) < 0.12 * faces:
            break
        vox *= math.sqrt(n / faces)
        bpy.data.objects.remove(tmp, do_unlink=True)
        tmp = None
    if tmp is None:
        tmp = dup(base, "_vox_try")
        md = tmp.modifiers.new("Vox", "REMESH")
        md.mode = "VOXEL"
        md.voxel_size = vox
        gn.apply(tmp)
    old = lo.data
    lo.data = tmp.data
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.meshes.remove(old)
    lo.data.name = lo.name
    cleanup(lo)
    cs = lo.modifiers.new("Relax", "CORRECTIVE_SMOOTH")     # even out the voxel staircase before snapping
    cs.iterations = 6
    cs.use_only_smooth = True
    cs.smooth_type = "LENGTH_WEIGHTED"
    gn.apply(lo)
    # snap the quads back onto the smooth base surface (QuadriFlow shrinks convex areas a little)
    sw = lo.modifiers.new("Snap", "SHRINKWRAP")
    sw.target = base
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    if smooth:
        cs = lo.modifiers.new("Relax", "CORRECTIVE_SMOOTH")
        cs.iterations = smooth
        cs.use_only_smooth = True
        cs.smooth_type = "LENGTH_WEIGHTED"
    gn.apply(lo)
    if layers:
        sculpt(lo, layers, subdiv=0, max_scale=max_scale, seed=seed, name="GkSculptLow")
        gn.apply(lo)
    for p in lo.data.polygons:
        p.use_smooth = True
    cleanup(lo, keep_largest=False)
    return lo


# =============================================================================== vertex-group masks
def vgroup_from(ob, name, fn, smooth_iters=0):
    """Create/replace vertex group `name` with weight fn(world_co, normal) in 0..1 (optionally smoothed)."""
    if name in ob.vertex_groups:
        ob.vertex_groups.remove(ob.vertex_groups[name])
    g = ob.vertex_groups.new(name=name)
    mw = ob.matrix_world
    n = len(ob.data.vertices)
    w = np.array([max(0.0, min(1.0, fn(mw @ v.co, v.normal))) for v in ob.data.vertices])
    if smooth_iters:
        e = np.empty(len(ob.data.edges) * 2, dtype=np.int64)
        ob.data.edges.foreach_get("vertices", e)
        e = e.reshape(-1, 2)
        for _ in range(smooth_iters):
            acc = np.zeros(n)
            cnt = np.zeros(n)
            np.add.at(acc, e[:, 0], w[e[:, 1]])
            np.add.at(acc, e[:, 1], w[e[:, 0]])
            np.add.at(cnt, e[:, 0], 1)
            np.add.at(cnt, e[:, 1], 1)
            w = 0.5 * w + 0.5 * acc / np.maximum(cnt, 1)
    for i in range(n):
        if w[i] > 1e-4:
            g.add([i], float(w[i]), "REPLACE")
    return g


def seg_dist(p, a, b):
    p, a, b = Vector(p), Vector(a), Vector(b)
    d = b - a
    t = 0.0 if d.length_squared < 1e-12 else max(0.0, min(1.0, (p - a).dot(d) / d.length_squared))
    return (p - (a + d * t)).length


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def assign_material(ob, mat_fn):
    """mat_fn(face_centre_world, face_normal_world) -> material index; slots must exist already."""
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for p in ob.data.polygons:
        p.material_index = mat_fn(mw @ p.center, (nm @ p.normal).normalized())


# =============================================================================== simple meshes
def lathe(profile, seg=16, name="Lathe", cap_top=True, cap_bottom=True, axis_fn=None):
    """Revolve [(radius, z), ...] around Z. axis_fn(t, angle) -> (dx, dy, dz, radius_scale) optional deformation."""
    verts, faces = [], []
    n = len(profile)
    for i, (r, z) in enumerate(profile):
        for s in range(seg):
            a = 2 * math.pi * s / seg
            dx = dy = dz = 0.0
            k = 1.0
            if axis_fn:
                dx, dy, dz, k = axis_fn(i / max(n - 1, 1), a)
            verts.append((r * k * math.cos(a) + dx, r * k * math.sin(a) + dy, z + dz))
    for i in range(n - 1):
        for s in range(seg):
            a, b = i * seg + s, i * seg + (s + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    if cap_bottom:
        verts.append((0, 0, profile[0][1]))
        c = len(verts) - 1
        for s in range(seg):
            faces.append((c, (s + 1) % seg, s))
    if cap_top:
        verts.append((0, 0, profile[-1][1]))
        c = len(verts) - 1
        base = (n - 1) * seg
        for s in range(seg):
            faces.append((c, base + s, base + (s + 1) % seg))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    cleanup(ob, keep_largest=False)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def tube(points, radii, seg=10, name="Tube", caps=True, flat=None, closed=False, loop_axis=(0, 0, 1)):
    """Tube along a polyline [(x,y,z)...] with per-point radius (parallel-transport frames). flat: (sx, sy).
    closed=True: the polyline is a loop (do NOT repeat the first point); frames use `loop_axis` so the ring
    closes exactly (watertight torus: belts, bands, collars)."""
    P = [Vector(p) for p in points]
    n = len(P)
    T = []
    for i in range(n):
        if closed:
            d = P[(i + 1) % n] - P[(i - 1) % n]
        else:
            d = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)])
        T.append(d.normalized())
    if closed:
        ax = Vector(loop_axis).normalized()
        N = [T[i].cross(ax).normalized() for i in range(n)]
        caps = False
    else:
        up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
        N = [T[0].cross(up).normalized()]
        for i in range(1, n):
            v = N[-1] - T[i] * N[-1].dot(T[i])
            N.append(v.normalized() if v.length > 1e-6 else N[-1])
    verts, faces = [], []
    fx, fy = flat or (1.0, 1.0)
    for i in range(n):
        B = T[i].cross(N[i])
        for s in range(seg):
            a = 2 * math.pi * s / seg
            verts.append(P[i] + (N[i] * math.cos(a) * fx + B * math.sin(a) * fy) * radii[i])
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        for s in range(seg):
            a, b = i * seg + s, i * seg + (s + 1) % seg
            faces.append((a, b, j * seg + (s + 1) % seg, j * seg + s))
    if caps:
        verts.append(P[0] - T[0] * radii[0] * 0.3)
        c = len(verts) - 1
        for s in range(seg):
            faces.append((c, (s + 1) % seg, s))
        verts.append(P[-1] + T[-1] * radii[-1] * 0.3)
        c = len(verts) - 1
        b0 = (n - 1) * seg
        for s in range(seg):
            faces.append((c, b0 + s, b0 + (s + 1) % seg))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    cleanup(ob, keep_largest=False)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def spike(base, tip, r, seg=6, rings=3, bend=None, name="Spike"):
    """Curved cone (horn / tooth / icicle / claw) from base to tip, radius r at the base."""
    a, b = Vector(base), Vector(tip)
    pts, rad = [], []
    for i in range(rings + 1):
        t = i / rings
        p = a.lerp(b, t)
        if bend is not None:
            p = p + Vector(bend) * math.sin(math.pi * t) * 1.0
        pts.append(p)
        rad.append(max(r * (1 - t) ** 0.9, r * 0.22))
    return tube(pts, rad, seg=seg, name=name, caps=True)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        o = objs[0]
        o.name = name
        C.apply_transforms(o)
        return o
    return C.join(objs, name)


def mat_slot(ob, mat):
    for i, s in enumerate(ob.material_slots):
        if s.material == mat:
            return i
    ob.data.materials.append(mat)
    return len(ob.material_slots) - 1


def set_mat(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


# =============================================================================== rig
class Rigger:
    """Armature + authoring + FK bake.

    joints : {bone: (head, tail)} deform bones (metres, model faces -Y, root at the origin)
    parents: {bone: parent}
    legs   : [("L", thigh, shin, foot), ...] -> leg IK controls ik_foot.<s> / pole.<s> (removed after baking)

    Author clips with key(name, [(frame, pose), ...]). A pose maps bone -> spec:
        (x, y, z)                 rotation in degrees about the ARMATURE axes (X right->left, Y back, Z up),
                                  applied in the bone's parent space (so +X on an upright spine bends it forward,
                                  -X on a hanging arm/leg swings it forward)
        {"rot": (..), "loc": (dx, dy, dz)}   loc = offset in armature axes (metres)
    ik_foot.<s> loc = foot offset from its rest position (armature axes); "rot" tilts the foot.
    Clip frames are shifted so the first key is frame 0; 24 fps.
    """

    def __init__(self, joints, parents, legs=(), name="Rig", pole_dist=1.0, extra_nondeform=()):
        self.joints = dict(joints)
        self.parents = dict(parents)
        self.legs = list(legs)
        J = dict(joints)
        P = dict(parents)
        for side, th, sh, ft in self.legs:
            ank = Vector(J[sh][1])
            knee = Vector(J[th][1])
            J[f"ik_foot.{side}"] = (tuple(ank), tuple(ank + Vector((0, 0.25 * pole_dist, 0))))
            P[f"ik_foot.{side}"] = "root"
            pole = knee + Vector((0, -pole_dist, 0))
            J[f"pole.{side}"] = (tuple(pole), tuple(pole + Vector((0, 0.2 * pole_dist, 0))))
            P[f"pole.{side}"] = "root"
        self.arm = rig.armature(J, P, name=name)
        self.controls = [b for b in J if b.startswith(("ik_foot.", "pole."))] + list(extra_nondeform)
        for b in self.controls:
            self.arm.data.bones[b].use_deform = False
        # constraints
        for side, th, sh, ft in self.legs:
            pb = self.arm.pose.bones[sh]
            c = pb.constraints.new("IK")
            c.target = self.arm
            c.subtarget = f"ik_foot.{side}"
            c.pole_target = self.arm
            c.pole_subtarget = f"pole.{side}"
            c.chain_count = 2
            c.pole_angle = self._pole_angle(th, sh, f"pole.{side}")
            fp = self.arm.pose.bones[ft]
            c2 = fp.constraints.new("CHILD_OF")
            c2.target = self.arm
            c2.subtarget = f"ik_foot.{side}"
            ik = self.arm.data.bones[f"ik_foot.{side}"]
            c2.inverse_matrix = ik.matrix_local.inverted()
            c2.set_inverse_pending = False
        self.rest = {b.name: b.matrix_local.to_3x3().to_quaternion() for b in self.arm.data.bones}
        self.clips = []

    def _pole_angle(self, th, sh, pole):
        """Pole angle so that the IK chain keeps its rest orientation (classic formula)."""
        bones = self.arm.data.bones
        base = bones[th]
        head = base.head_local
        axis = base.tail_local - head
        pole_loc = bones[pole].head_local
        pole_normal = (bones[sh].tail_local - head).cross(pole_loc - head)
        proj = pole_normal.cross(axis)
        x = base.matrix_local.to_3x3() @ Vector((1, 0, 0))
        ang = x.angle(proj)
        if x.cross(proj).angle(axis) < 1.0:
            ang = -ang
        return ang

    # ------------------------------------------------------------------ authoring
    def _local(self, bone, spec):
        rot, loc = (0, 0, 0), (0, 0, 0)
        if isinstance(spec, dict):
            rot, loc = spec.get("rot", rot), spec.get("loc", loc)
        elif spec is not None:
            rot = spec
        R = self.rest[bone]
        qw = _rot_q(rot)
        ql = R.inverted() @ qw @ R
        ll = R.inverted() @ Vector(loc)
        return ql, ll

    def apply_pose(self, pose):
        for pb in self.arm.pose.bones:
            pb.rotation_mode = "QUATERNION"
            q, l = self._local(pb.name, pose.get(pb.name))
            pb.rotation_quaternion = q
            pb.location = l
            pb.scale = (1, 1, 1)

    def key(self, name, keys, cyclic=False):
        """keys = [(frame, pose), ...]; cyclic: the first pose is repeated at ('loop', frame)."""
        ks = list(keys)
        if ks and ks[-1][0] == "loop":
            ks = ks[:-1] + [(keys[-1][1], ks[0][1])]
        f0 = ks[0][0]
        ks = [(f - f0, p) for f, p in ks]
        arm = self.arm
        arm.animation_data_create()
        old = bpy.data.actions.get("_src_" + name)
        if old:
            bpy.data.actions.remove(old)
        act = bpy.data.actions.new("_src_" + name)
        arm.animation_data.action = act
        for f, p in ks:
            self.apply_pose(p)
            for pb in arm.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
                pb.keyframe_insert("location", frame=f, group=pb.name)
        rig._set_interp(act, "BEZIER")
        act.frame_range = (ks[0][0], ks[-1][0])
        self.clips.append((name, act, int(ks[-1][0]), cyclic))
        arm.animation_data.action = None
        return act

    # ------------------------------------------------------------------ bake to FK
    def bake(self):
        """Evaluate every source clip frame by frame (IK + constraints), store armature-space matrices of the kept
        bones, delete control bones and constraints, then key plain FK Actions named after the clips."""
        arm = self.arm
        sc = bpy.context.scene
        keep = [b.name for b in arm.data.bones if b.name not in self.controls]
        data = {}
        for name, act, nf, cyc in self.clips:
            arm.animation_data.action = act
            try:
                if act.slots:
                    arm.animation_data.action_slot = act.slots[0]
            except AttributeError:
                pass
            frames = []
            for f in range(0, nf + 1):
                sc.frame_set(f)
                frames.append({b: arm.pose.bones[b].matrix.copy() for b in keep})
            data[name] = (frames, cyc)
        arm.animation_data.action = None
        for name, act, nf, cyc in self.clips:
            bpy.data.actions.remove(act)
        # remove constraints + control bones
        for pb in arm.pose.bones:
            for c in list(pb.constraints):
                pb.constraints.remove(c)
        C.activate(arm)
        bpy.ops.object.mode_set(mode="EDIT")
        for b in self.controls:
            eb = arm.data.edit_bones.get(b)
            if eb:
                arm.data.edit_bones.remove(eb)
        bpy.ops.object.mode_set(mode="OBJECT")
        bones = arm.data.bones
        order = [b.name for b in bones]  # parents come before children in Blender's list? ensure by depth
        order.sort(key=lambda n: len(bones[n].parent_recursive))
        for name, (frames, cyc) in data.items():
            act = bpy.data.actions.new(name)
            act.use_fake_user = True
            arm.animation_data.action = act
            prevq = {}
            for f, mats in enumerate(frames):
                for bn in order:
                    b = bones[bn]
                    M = mats[bn]
                    if b.parent:
                        Pm = mats[b.parent.name]
                        rest_rel = b.parent.matrix_local.inverted() @ b.matrix_local
                        basis = (Pm @ rest_rel).inverted() @ M
                    else:
                        basis = b.matrix_local.inverted() @ M
                    loc, q, _s = basis.decompose()
                    if bn in prevq and prevq[bn].dot(q) < 0:
                        q = -q
                    prevq[bn] = q
                    pb = arm.pose.bones[bn]
                    pb.rotation_mode = "QUATERNION"
                    pb.rotation_quaternion = q
                    pb.location = loc
                    pb.scale = (1, 1, 1)
                    pb.keyframe_insert("rotation_quaternion", frame=f, group=bn)
                    pb.keyframe_insert("location", frame=f, group=bn)
            rig._set_interp(act, "LINEAR")
            act.frame_range = (0, len(frames) - 1)
            act.use_frame_range = True
            if cyc:
                act.use_cyclic = True
            arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        sc.frame_set(0)
        return data


def rigid(ob, arm, bone):
    """Bind every vertex of `ob` 100 % to `bone` (rigid prop: weapon, tooth ring...)."""
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    mw = ob.matrix_world.copy()
    ob.parent = arm
    ob.matrix_world = mw
    rig._add_armature_mod(ob, arm)
    return ob


def weights_by_segments(ob, arm, bones=None, falloff=0.35, power=4.0, limit=4, smooth=2):
    """Distance-to-bone-segment weights (smooth, deterministic) — used for long chains (wyrm spine) where
    bone heat struggles. w ~ 1 / (d + eps)^power, normalised, limited to `limit` influences, smoothed."""
    bones = bones or rig.deform_bones(arm)
    segs = [(arm.matrix_world @ arm.data.bones[b].head_local, arm.matrix_world @ arm.data.bones[b].tail_local) for b in bones]
    mw = ob.matrix_world
    co = np.array([tuple(mw @ v.co) for v in ob.data.vertices])
    W = np.zeros((len(co), len(bones)))
    for j, (a, b) in enumerate(segs):
        a, b = np.array(a), np.array(b)
        d = b - a
        L2 = max(d.dot(d), 1e-12)
        t = np.clip(((co - a) @ d) / L2, 0, 1)
        dist = np.linalg.norm(co - (a + t[:, None] * d), axis=1)
        W[:, j] = 1.0 / (dist + falloff) ** power
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    for b in bones:
        ob.vertex_groups.new(name=b)
    rig.set_weights(ob, bones, W / W.sum(axis=1, keepdims=True), limit)
    if smooth:
        rig.smooth_weights(ob, bones, smooth, 0.5, limit)
    mw = ob.matrix_world.copy()
    ob.parent = arm
    ob.matrix_world = mw
    rig._add_armature_mod(ob, arm)
    return ob


# =============================================================================== gait helpers
def ease(t):
    return t * t * (3 - 2 * t)


def foot_cycle(p, stride, lift, duty=0.6):
    """In-place foot path for phase p in [0,1): (dy, dz, pitch_deg). Stance: front(-y) -> back(+y) on the ground."""
    p %= 1.0
    if p < duty:
        s = p / duty
        return (-stride / 2 + stride * s, 0.0, 0.0)
    s = (p - duty) / (1 - duty)
    y = stride / 2 - stride * ease(s)
    z = lift * math.sin(math.pi * s) ** 0.8
    # feet stay flat: big creatures shuffle their weight; tilting a flat foot around the ankle digs the heel/toe
    # into the ground (the IK target is the ankle, not the toe)
    pitch = 6.0 * math.sin(math.pi * s) * (1 - 2 * s)
    return (y, z, pitch)


# =============================================================================== QA helpers
def ground_report(rep, arm, meshes, frames=9):
    """Warn when any clip pushes the mesh >5 cm under the ground or leaves it floating >10 cm (not Death/Special)."""
    sc = bpy.context.scene
    res = {}
    for act in [a for a in bpy.data.actions if not a.name.startswith("_")]:
        arm.animation_data.action = act
        try:
            if act.slots:
                arm.animation_data.action_slot = act.slots[0]
        except AttributeError:
            pass
        f0, f1 = act.frame_range
        lo, hi = 1e9, -1e9
        for k in range(frames):
            f = f0 + (f1 - f0) * k / (frames - 1)
            sc.frame_set(int(f), subframe=f - int(f))
            mn, mx = render.bbox(meshes)
            lo = min(lo, mn.z)
            hi = max(hi, mn.z)
        res[act.name] = {"min_z": round(lo, 3), "max_min_z": round(hi, 3)}
        if lo < -0.06 and act.name not in ("Special",):
            rep.warn(f"clip {act.name}: mesh goes {-lo:.2f} m under the ground")
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    sc.frame_set(0)
    rep["info"]["ground"] = res
    return res


def clip_durations(fps=24):
    return {a.name: round((a.frame_range[1] - a.frame_range[0]) / fps, 3) for a in bpy.data.actions if not a.name.startswith("_")}


# =============================================================================== quick look-dev
def clay_sheet(objs, path, views=((0, 8), (90, 8), (180, 8), (35, 20)), size=420):
    """Fast grey-clay turntable of the raw shapes (shape iteration before any bake)."""
    m = bpy.data.materials.get("_GkClay") or bpy.data.materials.new("_GkClay")
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (0.35, 0.33, 0.31, 1)
    b.inputs["Roughness"].default_value = 0.7
    vl = bpy.context.view_layer
    objs = [o for o in objs if o.type == "MESH"]
    hidden = [o for o in bpy.context.scene.objects if o.type == "MESH" and o not in objs and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    tiles = []
    with render.Stage(ground=True) as st:
        vl.material_override = m
        mn, mx = render.bbox(objs)
        for yaw, pitch in views:
            st.frame(mn, mx, yaw, pitch)
            t = render.over_bg(st.shoot(size))
            render.draw_text(t, f"{yaw}", 6, 6, 2)
            tiles.append(t)
        vl.material_override = None
    for o in hidden:
        o.hide_render = False
    sheet = render.grid(tiles, len(tiles))
    render.draw_text(sheet, os.path.basename(path).split(".")[0].upper(), 8, 8, 3)
    return render.save_png(sheet, path)


def wip_path(name):
    import tempfile
    d = os.environ.get("GIANTS_WIP") or os.path.join(tempfile.gettempdir(), "giants_wip")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, name)


# =============================================================================== export + QA + sheets
def finish(key, args, arm, meshes, budget, expected=None, body=None, cloths=None, hero=("Idle", 0), frames=9,
           extra_info=None):
    """Export <key>.glb (armature + meshes, every Action), run the kit QA (+ per-frame clothing test when
    `cloths` is given, + ground contact + clip durations), save <key>_qa.json and render every QA sheet."""
    info = export.export_glb(key, args.out, objects=[arm] + meshes, budget=budget)
    skin = dict(body=body, cloths=cloths, armature=arm, frames=frames,
                actions=[a for a in bpy.data.actions if not a.name.startswith("_")]) if cloths else None
    rep = qa.run(key, meshes, budget=budget, expected=expected, glb=info, skin=skin)
    ground_report(rep, arm, meshes)
    rep["info"]["clips"] = clip_durations()
    rep["info"]["bones"] = [b.name for b in arm.data.bones]
    if extra_info:
        rep["info"].update(extra_info)
    qa.save(rep, args.previews)
    if not args.no_preview:
        render.qa_sheets(key, meshes, args.previews, hero_action=hero[0] if hero else None,
                         hero_frame=hero[1] if hero else None, poses=False)
        pose_sheet(key, meshes, arm, args.previews)
    return rep


def pose_sheet(key, meshes, arm, out_dir, frames=6, size=250, yaw=35.0, pitch=10.0, side_clips=("Walk", "Run")):
    """Pose sheet framed PER CLIP (each row fills its tiles): every clip x `frames` instants at 3/4 view, plus a
    side-view row for the locomotion clips (foot contact / sliding). -> <out_dir>/<key>_poses.png"""
    sc = bpy.context.scene
    acts = sorted([a for a in bpy.data.actions if not a.name.startswith("_")], key=lambda a: a.name)
    rows = []
    others = [o for o in sc.objects if o.type == "MESH" and o not in meshes and not o.hide_render]
    for o in others:
        o.hide_render = True
    with render.Stage(ground=True) as st:
        for act in acts:
            render._set_action(arm, act)
            f0, f1 = act.frame_range
            fr = [f0 + (f1 - f0) * k / (frames - 1) for k in range(frames)]
            mn = Vector((1e9,) * 3)
            mx = Vector((-1e9,) * 3)
            for f in fr:
                sc.frame_set(int(f), subframe=f - int(f))
                a, b = render.bbox(meshes)
                mn = Vector(map(min, mn, a))
                mx = Vector(map(max, mx, b))
            views = [(yaw, pitch)] + ([(90.0, 4.0)] if act.name in side_clips else [])
            for vy, vp in views:
                tiles = []
                for f in fr:
                    sc.frame_set(int(f), subframe=f - int(f))
                    st.frame(mn, mx, vy, vp, margin=1.0)
                    t = render.over_bg(st.shoot(size))
                    render.draw_text(t, f"{act.name} {f:.0f}" + (" SIDE" if vy == 90.0 else ""), 5, 5, 2)
                    tiles.append(t)
                rows.append(tiles)
    for o in others:
        o.hide_render = False
    render._set_action(arm, None)
    render._rest(arm)
    sc.frame_set(0)
    sheet = render.grid([t for r in rows for t in r], frames)
    render.draw_text(sheet, f"{key} POSES", 8, 8, 3)
    return render.save_png(sheet, os.path.join(out_dir, f"{key}_poses.png"))


# =============================================================================== fur locks / strands (Geometry Nodes)
def lock_mesh(name="Lock", length=0.3, width=0.09, thick=0.035, curl=0.12, seg=5, rings=4):
    """One shaggy fur lock / moss strand, modelled along +Z and curling towards +X (flattened tapered tube)."""
    pts, rad = [], []
    for i in range(rings + 1):
        t = i / rings
        pts.append((curl * t * t, 0.0, length * t))
        rad.append(max(0.004, width * 0.5 * (1 - t) ** 0.8))
    ob = tube(pts, rad, seg=seg, name=name, caps=True, flat=(1.0, thick / width))
    return ob


def scatter_locks(target, templates, density=40.0, mask=None, threshold=0.5, seed=0, scale=(0.7, 1.3),
                  droop=0.75, embed=0.02, name="GkLocks", distance_min=0.0):
    """Instance fur locks (template objects modelled along +Z, curling to +X) on `target`'s surface where the
    point attribute / vertex group `mask` > threshold. Each lock stands on the surface normal, then bends towards
    world -Z by `droop` (0 = along the normal, 1 = hanging) with its curl facing down: shaggy fur, hanging moss.
    Returns a NEW realised mesh object (the target is untouched)."""
    import random as _r
    out = dup(target, name)
    col = gn.template_collection(list(templates), f"_tpl_{name}")
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nb = NB(ng)
    gi = nb.node("NodeGroupInput")
    go = nb.node("NodeGroupOutput")
    mode = "POISSON" if distance_min > 0 else "RANDOM"
    d = nb.node("GeometryNodeDistributePointsOnFaces", {"distribute_method": mode}, Mesh=gi.outputs[0])
    if mode == "POISSON":
        sock(d.inputs, "Distance Min").default_value = distance_min
        sock(d.inputs, "Density Max").default_value = density
    else:
        sock(d.inputs, "Density").default_value = density
    sock(d.inputs, "Seed").default_value = seed
    if mask:
        a = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT"}, Name=mask)
        nb.feed(sock(d.inputs, "Selection"), nb.math("GREATER_THAN", sock(a.outputs, "Attribute", "VALUE"), threshold))
    pts = d.outputs["Points"]
    nrm = d.outputs["Normal"]
    if embed:
        pts = nb.node("GeometryNodeSetPosition", Geometry=pts, Offset=nb.vmath("SCALE", nrm, scale=-embed)).outputs[0]
    # stand direction = normalize(normal + droop * down), curl (+X) towards down
    down = (0.0, 0.0, -1.0)
    dirv = nb.vmath("NORMALIZE", nb.vmath("ADD", nb.vmath("SCALE", nrm, scale=1.0 - droop * 0.6),
                                          nb.vmath("SCALE", down, scale=droop)))
    rnd = gn._random(nb, "FLOAT_VECTOR", (-0.25, -0.25, -0.25), (0.25, 0.25, 0.25), seed + 1)
    dirv = nb.vmath("NORMALIZE", nb.vmath("ADD", dirv, rnd))
    rot = gn._align(nb, None, dirv, "Z")
    rot = gn._align(nb, rot, down, "X", "Z")
    sc = gn._random(nb, "FLOAT", scale[0], scale[1], seed + 2)
    ci = nb.node("GeometryNodeCollectionInfo", {"transform_space": "ORIGINAL"})
    ci.inputs["Collection"].default_value = col
    ci.inputs["Separate Children"].default_value = True
    ci.inputs["Reset Children"].default_value = True
    iop = nb.node("GeometryNodeInstanceOnPoints", Points=pts, Instance=ci.outputs[0], Rotation=rot, Scale=sc)
    iop.inputs["Pick Instance"].default_value = True
    nb.feed(iop.inputs["Instance Index"], gn._random(nb, "INT", 0, len(col.objects) - 1, seed + 3))
    real = nb.node("GeometryNodeRealizeInstances", Geometry=iop.outputs[0]).outputs[0]
    nb.link(real, go.inputs[0])
    md = out.modifiers.new(name, "NODES")
    md.node_group = ng
    gn.apply(out)
    for g in list(out.vertex_groups):
        out.vertex_groups.remove(g)
    for t in templates:
        gn.remove(t)
    c = bpy.data.collections.get(f"_tpl_{name}")
    if c:
        bpy.data.collections.remove(c)
    return out


# =============================================================================== stone plates / boulders
def rounded_box(size, round_=0.25, cuts=3, name="Box", loc=(0, 0, 0), rot=(0, 0, 0), taper=0.0):
    """Quad box (size = full x,y,z) with rounded corners (super-ellipsoid blend) and optional top taper."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        c = v.co.copy()
        sph = c.normalized() * math.sqrt(3) * 0.62
        c = c.lerp(Vector((sph.x, sph.y, sph.z)), round_)
        c.x = max(-1.0, min(1.0, c.x))
        if taper:
            k = 1.0 - taper * (c.z + 1) / 2
            c.x *= k
            c.y *= k
        v.co = Vector((c.x * size[0] / 2, c.y * size[1] / 2, c.z * size[2] / 2))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    ob.location = loc
    C.apply_transforms(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def assign_bone(ob, bone):
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    return ob


def bind_groups(ob, arm):
    """Parent to the armature and add the Armature modifier, keeping the existing vertex groups (rigid parts)."""
    mw = ob.matrix_world.copy()
    ob.parent = arm
    ob.matrix_world = mw
    rig._add_armature_mod(ob, arm)
    return ob


def _min_z(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    mz = 1e9
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        n = len(me.vertices)
        if n:
            co = np.empty(n * 3)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ np.array(o.matrix_world)[:3, :3].T + np.array(o.matrix_world)[:3, 3]
            mz = min(mz, float(co[:, 2].min()))
        ev.to_mesh_clear()
    return mz


def ground_clamp(arm, meshes, clips=("Attack", "Attack2", "Hit", "Death", "Special"), floor=0.0, window=2):
    """Keep one-shot clips above the ground: per frame, if the deformed meshes dip below `floor`, raise the root
    bone by that amount (smoothed with a running max over +-window frames so the correction never pops).
    Run AFTER Rigger.bake() (plain FK keys every frame)."""
    sc = bpy.context.scene
    root = arm.pose.bones["root"]
    Rr = arm.data.bones["root"].matrix_local.to_3x3().inverted()
    report = {}
    for act in [a for a in bpy.data.actions if a.name in clips]:
        arm.animation_data.action = act
        try:
            if act.slots:
                arm.animation_data.action_slot = act.slots[0]
        except AttributeError:
            pass
        f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
        need = []
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            need.append(max(0.0, floor - _min_z(meshes)))
        if max(need) < 0.005:
            continue
        sm = [max(need[max(0, i - window):i + window + 1]) for i in range(len(need))]
        fcs = {}
        from kit import rig as _rig
        for fc in _rig._fcurves(act):
            if fc.data_path == 'pose.bones["root"].location':
                fcs[fc.array_index] = fc
        for i, f in enumerate(range(f0, f1 + 1)):
            if sm[i] <= 0:
                continue
            d = Rr @ Vector((0, 0, sm[i] + 0.005))
            for ax in range(3):
                fc = fcs.get(ax)
                if fc is None:
                    continue
                for kp in fc.keyframe_points:
                    if int(round(kp.co.x)) == f:
                        kp.co.y += d[ax]
                        kp.handle_left.y += d[ax]
                        kp.handle_right.y += d[ax]
        for fc in fcs.values():
            fc.update()
        report[act.name] = round(max(need), 3)
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    sc.frame_set(0)
    print(f"[gk] ground clamp (m raised): {report}", flush=True)
    return report
