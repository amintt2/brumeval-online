"""Props-group helpers (Brumeval, Blender 5.0 headless) - built ON TOP of the shared kit (never edits it).

    import pk
    base = pk.loft([...rings...])                       # closed lofted solid (bmesh)
    high, low = pk.eroded_pair(base, target_tris=4200, voxel=0.015, erosion=dict(...))
    objs = pk.finish(key, [low, ...], args, high=high, budget="prop", expected=(...), size=1024)

Geometry Nodes groups defined here (all built from Python with the kit's NB node builder):
    erode()     : ancient-stone erosion = rounded + chipped edges (curvature from blurred positions), pitting,
                  weathering noise and sparse cracks, displaced along the normal.
    fracture()  : broken surface - every point beyond a NOISY plane is projected back onto it (broken pillar
                  tops, snapped arches, crumbled wall crests).
    sag()       : gentle sag / lean of a mesh (old roofs, leaning stilts).
"""
import math
import os
import random
import sys

import bmesh
import bpy
import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402
from kit import bake, export, gn, gpu, lod, qa, render  # noqa: E402
from kit import materials as M  # noqa: E402
from kit.nodes import NB, sock  # noqa: E402

V = mathutils.Vector


# =============================================================================== object utils
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh_obj(name, verts, faces, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def from_bm(name, bm, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def dup(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    link(c)
    return c


def tris(ob):
    return export.triangles([ob])


def set_mat(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def decimate_to(ob, target):
    t = tris(ob)
    if t > target:
        gn.decimate(ob, target / t)
        gn.apply(ob)
    return ob


def transform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    ob.location = loc
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    ob.scale = scale if isinstance(scale, (tuple, list)) else (scale,) * 3
    C.apply_transforms(ob)
    return ob


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        C.apply_transforms(objs[0])
        return objs[0]
    return C.join(objs, name)


def ground(ob, sink=0.0):
    """Translate so the lowest vertex is at z = -sink."""
    mn = min(v.co.z for v in ob.data.vertices)
    for v in ob.data.vertices:
        v.co.z -= mn + sink
    ob.data.update()
    return ob


def smooth_all(ob, flag=True):
    for p in ob.data.polygons:
        p.use_smooth = flag
    return ob


def weld(ob, dist=1e-4):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def clean(ob, dist=1e-4, min_area=1e-9):
    """Weld, dissolve degenerate faces, recalc outward normals."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=dist)
    bad = [f for f in bm.faces if f.calc_area() < min_area]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


# =============================================================================== primitives
def ring(n, rx, ry=None, z=0.0, cx=0.0, cy=0.0, phase=0.0, fn=None):
    """n points on an ellipse; fn(theta)->radius factor (flutes, jagged...)."""
    ry = rx if ry is None else ry
    pts = []
    for i in range(n):
        t = phase + 2 * math.pi * i / n
        f = fn(t) if fn else 1.0
        pts.append((cx + math.cos(t) * rx * f, cy + math.sin(t) * ry * f, z))
    return pts


def rect_ring(w, d, z, n_side=4, bevel=0.0, cx=0.0, cy=0.0):
    """Rounded-rectangle ring (w along X, d along Y) with `n_side` points per straight edge; counter-clockwise."""
    pts = []
    hw, hd = w / 2 - bevel, d / 2 - bevel
    corners = [(hw, -hd, -90), (hw, hd, 0), (-hw, hd, 90), (-hw, -hd, 180)]
    for k, (x, y, a0) in enumerate(corners):
        if bevel > 0:
            for j in range(3):
                a = math.radians(a0 + 45 * j)
                pts.append((cx + x + math.cos(a) * bevel, cy + y + math.sin(a) * bevel, z))
        else:
            pts.append((cx + x, cy + y, z))
        # straight edge towards next corner
        nx, ny, _ = corners[(k + 1) % 4]
        a1 = math.radians(a0 + 90)
        sx, sy = x + math.cos(a1) * bevel, y + math.sin(a1) * bevel
        a2 = math.radians(corners[(k + 1) % 4][2])
        ex, ey = nx + math.cos(a2) * bevel, ny + math.sin(a2) * bevel
        for j in range(1, n_side):
            t = j / n_side
            pts.append((cx + sx + (ex - sx) * t, cy + sy + (ey - sy) * t, z))
    return pts


def loft(name, rings, mat=None, cap_bottom=True, cap_top=True, smooth=True):
    """Closed solid from stacked rings (same point count, counter-clockwise seen from +Z)."""
    bm = bmesh.new()
    rows = []
    for r in rings:
        rows.append([bm.verts.new(p) for p in r])
    n = len(rows[0])
    for a, b in zip(rows[:-1], rows[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_bottom:
        f = bm.faces.new(list(reversed(rows[0])))
        bmesh.ops.triangulate(bm, faces=[f])
    if cap_top:
        f = bm.faces.new(rows[-1])
        bmesh.ops.triangulate(bm, faces=[f])
    return from_bm(name, bm, mat, smooth)


def box(name, size, loc=(0, 0, 0), mat=None, rot=(0, 0, 0), bevel=0.0, seg=1):
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    C.apply_transforms(ob)
    if bevel > 0:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=seg, affect="EDGES", profile=0.5)
        bm.to_mesh(ob.data)
        bm.free()
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    ob.location = loc
    C.apply_transforms(ob)
    if mat is not None:
        ob.data.materials.append(mat)
    return ob


def cyl(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), verts=12, mat=None, r2=None, smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h)
    ob = bpy.context.object
    ob.name = name
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    ob.location = loc
    C.apply_transforms(ob)
    if mat is not None:
        ob.data.materials.append(mat)
    smooth_all(ob, smooth)
    return ob


def beam(name, p0, p1, r, verts=8, mat=None, r1=None, twist=0.0):
    """Cylinder between two points (logs, posts, poles)."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r1 is None else r1, depth=d.length)
    ob = bpy.context.object
    ob.name = name
    q = V((0, 0, 1)).rotation_difference(d.normalized())
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = q @ mathutils.Quaternion((0, 0, 1), twist)
    ob.location = (p0 + p1) / 2
    C.apply_transforms(ob)
    ob.rotation_mode = "XYZ"
    if mat is not None:
        ob.data.materials.append(mat)
    smooth_all(ob)
    return ob


def plank(name, p0, p1, width, thick, up=(0, 0, 1), mat=None, seed=0, taper=0.0):
    """Board from p0 to p1 (length axis), `width` along the side axis, `thick` along `up`."""
    p0, p1, up = V(p0), V(p1), V(up).normalized()
    ax = (p1 - p0)
    L = ax.length
    ax.normalize()
    side = ax.cross(up).normalized()
    upv = side.cross(ax).normalized()
    rnd = random.Random(seed)
    verts = []
    for t, w in ((0.0, width), (1.0, width * (1 - taper))):
        c = p0 + ax * (L * t)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            j = V((rnd.uniform(-0.1, 0.1) * thick, rnd.uniform(-0.1, 0.1) * thick, 0))
            verts.append(c + side * (sx * w / 2) + upv * (sy * thick / 2) + side * j.x + upv * j.y)
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh_obj(name, verts, faces, mat, smooth=False)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(width, thick) * 0.18, segments=1, affect="EDGES")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


# =============================================================================== GN groups
def _grp(name):
    return gn._group(name)


def erode(ob, strength=0.03, scale=3.0, edge=0.05, edge_iters=8, edge_gain=18.0, pits=0.4, cracks=0.3,
          crack_scale=1.2, seed=0, name="PkErode"):
    """Weathered stone: edges eaten away (convexity from blurred positions, broken up by noise), pitting,
    broad weathering bumps and a few cracks. Offset along the normal. Needs a dense mesh (voxel remesh first)."""
    ng, nb, gi, go = _grp(name)
    geo = gi.outputs[0]
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    p = nb.vmath("ADD", pos, (seed * 3.7 % 41, seed * 1.9 % 37, seed * 5.3 % 29))
    bl = nb.node("GeometryNodeBlurAttribute", {"data_type": "FLOAT_VECTOR"})
    nb.feed(sock(bl.inputs, "Value", "VECTOR"), pos)
    bl.inputs["Iterations"].default_value = edge_iters
    conv = nb.vmath("DOT_PRODUCT", nrm, nb.vmath("SUBTRACT", pos, sock(bl.outputs, "Value", "VECTOR")))
    convm = nb.clamp01(nb.mul(conv, edge_gain))
    # chipped edges: the convex mask modulated by a sharp noise -> irregular bites, not a uniform round-over
    chip = nb.noise(nb.vmath("SCALE", p, scale=1.0), scale * 2.2, 5.0, 0.7).outputs["Fac"]
    chipm = nb.maprange(chip, 0.35, 0.65, 0.25, 1.0)
    h = nb.mul(nb.mul(convm, chipm), -edge)
    # broad weathering
    big = nb.noise(p, scale, 6.0, 0.6, dist=0.3).outputs["Fac"]
    h = nb.add(h, nb.mul(nb.sub(big, 0.5), strength))
    # pitting (small voronoi holes)
    if pits > 0:
        vo = nb.voronoi(p, scale * 9.0, "F1", rand=1.0).outputs["Distance"]
        pm = nb.maprange(vo, 0.0, 0.22, 1.0, 0.0, "SMOOTHSTEP")
        pmask = nb.maprange(nb.noise(nb.vmath("ADD", p, (5.1, 2.2, 9.4)), scale * 0.7, 3.0).outputs["Fac"], 0.45, 0.65)
        h = nb.sub(h, nb.mul(nb.mul(pm, pmask), strength * 0.6 * pits))
    # cracks
    if cracks > 0:
        ve = nb.voronoi(p, crack_scale, "DISTANCE_TO_EDGE").outputs["Distance"]
        warp = nb.noise(nb.vmath("ADD", p, (1.3, 7.7, 2.9)), crack_scale * 1.3, 2.0).outputs["Fac"]
        cm = nb.maprange(warp, 0.52, 0.6)
        cr = nb.mul(nb.maprange(ve, 0.0, 0.02, 1.0, 0.0, "SMOOTHSTEP"), cm)
        h = nb.sub(h, nb.mul(cr, strength * 1.2 * cracks))
    off = nb.vmath("SCALE", nrm, scale=h)
    sp = nb.node("GeometryNodeSetPosition", Geometry=geo, Offset=off)
    nb.link(sp.outputs[0], go.inputs[0])
    return gn._mod(ob, ng, name)


def fracture(ob, normal, point, noise=0.12, scale=2.0, seed=0, jag=0.05, radius=None, name="PkFracture"):
    """Break the mesh along a noisy plane: points with (p - point).n > h(p) are projected back onto the plane
    (h = fbm noise * `noise` + fine jag). Keeps the part on the -normal side."""
    n = V(normal).normalized()
    ng, nb, gi, go = _grp(name)
    geo = gi.outputs[0]
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    p = nb.vmath("ADD", pos, (seed * 2.3 % 31, seed * 4.1 % 23, seed * 0.7 % 17))
    h1 = nb.noise(p, scale, 4.0, 0.6).outputs["Fac"]
    h2 = nb.noise(p, scale * 6.0, 3.0, 0.7).outputs["Fac"]
    hh = nb.add(nb.mul(nb.sub(h1, 0.5), noise * 2.0), nb.mul(nb.sub(h2, 0.5), jag * 2.0))
    d = nb.vmath("DOT_PRODUCT", nb.vmath("SUBTRACT", pos, tuple(point)), tuple(n))
    excess = nb.math("MAXIMUM", nb.sub(d, hh), 0.0)
    if radius:                               # local break only (distance to `point` < radius)
        dist = nb.vmath("DISTANCE", pos, tuple(point))
        excess = nb.mul(excess, nb.math("LESS_THAN", dist, radius))
    off = nb.vmath("SCALE", tuple(-x for x in n), scale=excess)
    sp = nb.node("GeometryNodeSetPosition", Geometry=geo, Offset=off)
    nb.link(sp.outputs[0], go.inputs[0])
    return gn._mod(ob, ng, name)


def sag(ob, amount=0.05, axis="X", length=4.0, name="PkSag"):
    """Parabolic sag in -Z along `axis` (old roof ridges / beams)."""
    ng, nb, gi, go = _grp(name)
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    s = nb.sep(pos)
    c = s[0] if axis == "X" else s[1]
    t = nb.math("DIVIDE", c, length / 2.0)
    dz = nb.mul(nb.sub(1.0, nb.mul(t, t)), -amount)
    sp = nb.node("GeometryNodeSetPosition", Geometry=gi.outputs[0], Offset=nb.xyz(0.0, 0.0, dz))
    nb.link(sp.outputs[0], go.inputs[0])
    return gn._mod(ob, ng, name)


def ground_clip(ob, z=0.0, name="PkGroundClip"):
    """Flatten everything below z onto z (GN): a clean contact face on the ground."""
    ng, nb, gi, go = _grp(name)
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    s = nb.sep(pos)
    dz = nb.math("MAXIMUM", nb.sub(z, s[2]), 0.0)
    sp = nb.node("GeometryNodeSetPosition", Geometry=gi.outputs[0], Offset=nb.xyz(0.0, 0.0, dz))
    nb.link(sp.outputs[0], go.inputs[0])
    return gn._mod(ob, ng, name)


# =============================================================================== stone high/low
def eroded_pair(base, target_tris, voxel=0.015, erosion=None, fractures=(), sink=0.0, remesh_after_fracture=True,
                name="Stone", clip_ground=True, bite_spots=None, bite_seed=0, open_bottom=True, sharp_angle=70.0):
    """Dense eroded HIGH mesh + decimated LOW mesh from a clean `base` solid (base is consumed).
    Returns (high, low). The low keeps the eroded silhouette; the high carries the detail for the bake."""
    high = base
    high.name = "_" + name + "High"
    gn.voxel_remesh(high, voxel)
    gn.apply(high)
    if bite_spots or fractures:
        carve(high, bite_spots, fractures, seed=bite_seed)
        gn.voxel_remesh(high, voxel)
        gn.apply(high)
    erode(high, **(erosion or {}))
    gn.apply(high)
    if clip_ground:
        ground_clip(high, 0.0 - sink)
        gn.apply(high)
    remove_small_islands(high, 200)
    smooth_all(high)
    low = dup(high, name)
    decimate_to(low, target_tris)
    remove_small_islands(low, 24)
    if open_bottom:
        delete_bottom(low, z=0.02 - sink)
    smooth_all(low)
    sharp_edges(low, sharp_angle)
    return high, low


def sharp_edges(ob, angle=70.0):
    """Split normals on creases sharper than `angle` (> the UV smart-project angle so they sit on UV seams):
    the low mesh then shades crisp rims instead of asking the normal map to bend 90 degrees."""
    if angle:
        smooth_all(ob)
        ob.data.set_sharp_from_angle(angle=math.radians(angle))
    return ob


def moss_clumps(target_low, density=6.0, up_min=0.6, size=0.1, seed=3, embed=0.015, distance_min=0.12,
                attr_mask=None, name="MossScatter", mat=None, scale=(0.5, 1.3), flat=0.22, zmax=None, zmin=None):
    """GN scatter of small moss cushions on up-facing surfaces of the LOW mesh; flagged kit_bake_direct."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=size)
    clump = bpy.context.object
    clump.name = "_MossClumpTpl"
    clump.scale = (1.0, 0.75, flat)
    C.apply_transforms(clump)
    smooth_all(clump)
    clump.data.materials.append(mat or M.moss("MossMat", seed=seed))
    gn.displace(clump, strength=size * 0.45, scale=2.2 / size, detail=4, voronoi=0.0, seed=seed)
    gn.decimate(clump, 0.5)
    gn.apply(clump)
    obj = dup(target_low, name)
    if zmax is not None or zmin is not None:          # only grow moss in a height band (never on rims up high)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        kill = [f for f in bm.faces if (zmax is not None and f.calc_center_median().z > zmax)
                or (zmin is not None and f.calc_center_median().z < zmin)]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(obj.data)
        bm.free()
        # shrink the scatter area away from the band's rims (clumps must not overhang edges)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        rim = [f for f in bm.faces if any(e.is_boundary for e in f.edges)]
        bmesh.ops.delete(bm, geom=rim, context="FACES")
        bm.to_mesh(obj.data)
        bm.free()
    gn.scatter(obj, clump, density=density, up_min=up_min, attr_mask=attr_mask, scale=scale,
               rot_random=(0.1, 0.1, 3.14), embed=embed, seed=seed, keep_target=False, distance_min=distance_min)
    gn.apply(obj)
    gn.remove(clump)
    remove_small_islands(obj, 8)
    if not obj.data.polygons:
        bpy.data.objects.remove(obj, do_unlink=True)
        return None
    obj["kit_bake_direct"] = 1
    smooth_all(obj)
    return obj


# =============================================================================== cards (grass / leaves)
def card_template(name, w, h, mat, crossed=2, bend=0.15, segs=3):
    """Crossed vertical alpha cards (0..1 UVs), pivot at the base, slight forward bend. For GN scatter."""
    verts, faces, uvs = [], [], []
    for c in range(crossed):
        a = math.pi * c / crossed
        ca, sa = math.cos(a), math.sin(a)
        base_i = len(verts)
        for s in range(segs + 1):
            t = s / segs
            z = h * t
            off = bend * h * t * t
            for u in (0.0, 1.0):
                x = (u - 0.5) * w
                verts.append((x * ca - off * sa, x * sa + off * ca, z))
                uvs.append((u, t))
        for s in range(segs):
            i = base_i + s * 2
            faces.append((i, i + 1, i + 3, i + 2))
    ob = mesh_obj(name, verts, faces, mat, smooth=True)
    uvl = ob.data.uv_layers.new(name="UVMap")
    for p in ob.data.polygons:
        for li in p.loop_indices:
            uvl.data[li].uv = uvs[ob.data.loops[li].vertex_index]
    ob["kit_open"] = 1
    return ob


def ground_disc(name, r_in, r_out, z=0.0, n=32, rings=3):
    """Flat annulus used as a scatter target (grass around a base). Hidden helper."""
    verts, faces = [], []
    for k in range(rings + 1):
        r = r_in + (r_out - r_in) * k / rings
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((math.cos(a) * r, math.sin(a) * r, z))
    for k in range(rings):
        for i in range(n):
            j = (i + 1) % n
            faces.append((k * n + i, (k + 1) * n + i, (k + 1) * n + j, k * n + j))
    return mesh_obj(name, verts, faces, None, smooth=True)


def scatter_cards(target, card, density, seed, scale=(0.7, 1.2), name="GrassScatter", patchy=0.0, up_min=None,
                  distance_min=0.0, align_normal=False, embed=0.01):
    """Realised GN scatter of `card` over `target` (target consumed). patchy>0: noise mask (GN stored attribute)
    so tufts grow in clumps instead of a uniform ring. Returns the new mesh object."""
    mask = None
    if patchy > 0:
        gn.store_up_mask(target, "patch", lo=-1.0, hi=-0.99, noise_scale=patchy, seed=seed)
        mask = "patch"
    gn.scatter(target, card, density=density, seed=seed, up_min=up_min, attr_mask=mask, attr_threshold=0.5,
               scale=scale, rot_random=(0.12, 0.12, math.pi), align_normal=align_normal, embed=embed,
               keep_target=False, distance_min=distance_min, name=name)
    gn.apply(target)
    target.name = name
    target["kit_open"] = 1
    return target


# =============================================================================== pipeline
def finish(key, objs, args, *, budget, expected, high=None, size=1024, extrusion=0.05, max_ray=0.2, ao_samples=64,
           lods=True, group_sizes=None, join_name=None, ao_distance=None, hero_yaw=35.0, uv_margin=0.006,
           sheets=True, open_ok=None, post=None, uv_method=None):
    """bake (high->low if `high`) -> join -> export -> LODs -> QA -> QA sheets. Returns the final object."""
    import time
    t0 = time.time()
    objs = [o for o in objs if o is not None]
    for o in objs:
        remove_small_islands(o, 3)                    # never ship loose triangles
        fix_slots(o)                                  # before waiting for the GPU: empty slots crash the bake
    highs = [] if high is None else (list(high) if isinstance(high, (list, tuple)) else [high])
    for h in highs:
        h.hide_render = False
    # Hold the (re-entrant) cross-process GPU lock for the WHOLE bake: the kit takes it per pass, and with ~10
    # Blender agents running, every pass otherwise waits 240 s before falling back to the CPU.
    held = gpu.enable_hip() and gpu.acquire(wait=int(os.environ.get("PK_GPU_WAIT", "1500")))
    saved_hip = gpu._state["hip"]
    if not held:
        gpu._state["hip"] = False          # straight to CPU for every pass, no more 240 s waits
    try:
        res = bake.bake_asset(objs, key, size=size, high=highs or None, extrusion=extrusion, max_ray=max_ray,
                              ao_samples=ao_samples, ao_in_base=0.0, group_sizes=group_sizes, ao_distance=ao_distance,
                              uv_margin=uv_margin, uv_method=uv_method or ("CHARTS" if highs else "SMART"))
    finally:
        if held:
            gpu.release()
        gpu._state["hip"] = saved_hip
    for h in highs:
        gn.remove(h)
    gn.remove_templates()
    final = join(objs, join_name or key)
    final["kit_open"] = 1 if open_ok else 0
    if post:
        post(final)
    for o in list(bpy.context.scene.objects):          # nothing else may be exported
        if o is not final and o.type == "MESH":
            gn.remove(o)
    info = export.export_glb(key, args.out, objects=[final], budget=budget)
    lod_infos = lod.export_lods(key, [final], args.out) if lods else []
    rep = qa.run(key, [final], budget=budget, expected=expected, glb=info, open_ok=open_ok)
    rep["info"]["bake_s"] = {g: r["times"] for g, r in res.items()}
    rep["info"]["lods"] = [(os.path.basename(l["path"]), l["tris"], l["bytes"]) for l in lod_infos]
    rep["info"]["build_s"] = round(time.time() - t0, 1)
    qa.save(rep, args.previews)
    if sheets and not args.no_preview:
        render.qa_sheets(key, [final], args.previews, poses=False)
    print(f"[props] {key}: {info['tris']} tris, {info['bytes'] / 1024:.0f} KB, lods="
          f"{[(l['tris'], round(l['bytes'] / 1024)) for l in lod_infos]}, QA fails={rep['fails']}", flush=True)
    return final


# =============================================================================== cleanup / carving
def fix_slots(ob):
    """Empty material slots (GN realise / join leftovers): unused ones are removed, used ones get the first real
    material of the object."""
    me = ob.data
    used = {p.material_index for p in me.polygons}
    real = next((m for m in me.materials if m is not None), None)
    for i in range(len(me.materials) - 1, -1, -1):
        if me.materials[i] is None:
            if i in used and real is not None:
                me.materials[i] = real
            elif i not in used:
                for p in me.polygons:
                    if p.material_index > i:
                        p.material_index -= 1
                me.materials.pop(index=i)
    return ob


def remove_small_islands(ob, min_faces=24, keep_alpha=True):
    """Delete connected pieces smaller than `min_faces` (voxel/decimate crumbs). Alpha-card faces are kept."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    alpha = {i for i, s in enumerate(ob.material_slots) if s.material and s.material.get("kit_alpha")} if keep_alpha else set()
    seen = set()
    kill = []
    for f in bm.faces:
        if f.index in seen or f.material_index in alpha:
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
        if len(isl) < min_faces:
            kill.extend(isl)
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(kill)


def delete_bottom(ob, z=0.03, nz=-0.8):
    """Delete ground-contact faces (never seen, waste texels). The mesh becomes open at the ground."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if f.normal.z < nz and f.calc_center_median().z < z]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    ob["kit_open"] = 1
    return len(kill)


def bites(ob, spots, seed=0, rough=0.35, name="PkBites"):
    """Geometry-Nodes 'chunk missing' carving: every point inside an irregular ellipsoid (centre, radius[, (sx,sy,sz)])
    is pushed out onto its surface (SDF projection) -> broken corners, missing stones. Run on a DENSE mesh (after a
    voxel remesh) and remesh again afterwards (eroded_pair does it)."""
    ng, nb, gi, go = _grp(name)
    geo = gi.outputs[0]
    for k, sp in enumerate(spots):
        c, r = V(sp[0]), sp[1]
        sc = sp[2] if len(sp) > 2 else (1.0, 1.0, 1.0)
        pos = nb.node("GeometryNodeInputPosition").outputs[0]
        q = nb.vmath("DIVIDE", nb.vmath("SUBTRACT", pos, tuple(c)), tuple(sc))
        d = nb.vmath("LENGTH", q)
        nz = nb.noise(nb.vmath("ADD", pos, (seed * 1.7 + k * 3.1, k * 2.3, seed * 0.9)), 2.5 / r, 3.0, 0.6).outputs["Fac"]
        reff = nb.mul(r, nb.add(1.0, nb.mul(nb.sub(nz, 0.5), 2.0 * rough)))
        inside = nb.math("LESS_THAN", d, reff)
        fac = nb.sub(nb.math("DIVIDE", reff, nb.math("MAXIMUM", d, 1e-4)), 1.0)
        off = nb.vmath("MULTIPLY", nb.vmath("SCALE", q, scale=nb.mul(fac, inside)), tuple(sc))
        geo = nb.node("GeometryNodeSetPosition", Geometry=geo, Offset=off).outputs[0]
    nb.link(geo, go.inputs[0])
    gn._mod(ob, ng, name)
    gn.apply(ob)
    return ob


# =============================================================================== material overlays (shader nodes)
def _bsdf(mat):
    return next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")


def _input_src(nb, s):
    return s.links[0].from_socket if s.is_linked else tuple(s.default_value[:]) if hasattr(s.default_value, "__len__") else s.default_value


def overlay_streaks(mat, color="#2a2620", strength=0.45, scale=1.0, seed=0, rough_add=0.0):
    """Vertical rain-run-off streaks (object-space noise stretched along Z) multiplied over the base colour."""
    nb = NB(mat.node_tree)
    bsdf = _bsdf(mat)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    v = nb.vmath("MULTIPLY", tc, (9.0 * scale, 9.0 * scale, 0.35 * scale))
    v = nb.vmath("ADD", v, (seed * 1.3, seed * 2.1, seed * 0.7))
    n1 = nb.noise(v, 1.0, 5.0, 0.6).outputs["Fac"]
    n2 = nb.noise(nb.vmath("SCALE", tc, scale=0.8 * scale), 1.0, 2.0, 0.5).outputs["Fac"]
    m = nb.mul(nb.maprange(n1, 0.5, 0.75), nb.maprange(n2, 0.4, 0.65))
    m = nb.clamp01(nb.mul(m, strength))
    bc = sock(bsdf.inputs, "Base Color")
    prev = _input_src(nb, bc)
    nb.feed(bc, nb.mix(prev, color, m))
    if rough_add:
        rs = sock(bsdf.inputs, "Roughness")
        prev_r = _input_src(nb, rs)
        nb.feed(rs, nb.clamp01(nb.add(prev_r, nb.mul(m, rough_add))))
    return mat


def overlay_ground_dirt(mat, color="#3b3222", height=0.6, strength=0.7, seed=0):
    """Earth / splash dirt rising from the ground (object Z), broken up by noise."""
    nb = NB(mat.node_tree)
    bsdf = _bsdf(mat)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    z = nb.sep(tc)[2]
    n = nb.noise(nb.vmath("ADD", nb.vmath("SCALE", tc, scale=3.0), (seed, 0, 0)), 1.0, 4.0, 0.6).outputs["Fac"]
    m = nb.mul(nb.maprange(nb.add(z, nb.mul(nb.sub(n, 0.5), height * 0.8)), 0.0, height, strength, 0.0), 1.0)
    bc = sock(bsdf.inputs, "Base Color")
    nb.feed(bc, nb.mix(_input_src(nb, bc), color, nb.clamp01(m)))
    return mat


# =============================================================================== masonry
def block(name, x0, x1, y0, y1, z0, z1, chamfer=0.035, mat=None, jitter=0.0, seed=0):
    """Chamfered ashlar block (axis aligned), optional random skew of its corners."""
    rnd = random.Random(seed)
    ob = box(name, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), mat,
             bevel=chamfer, seg=1)
    if jitter:
        for v in ob.data.vertices:
            v.co.x += rnd.uniform(-jitter, jitter) * 0.5
            v.co.y += rnd.uniform(-jitter, jitter) * 0.5
    return ob


def courses(x0, x1, y0, y1, zs, lengths=(0.8, 1.5), seed=0, chamfer=0.035, mat=None, keep=None, jitter=0.01,
            inset=0.0):
    """Running-bond ashlar courses. zs = [z0, z1, z2...] course boundaries. keep(x0,x1,z0,z1) -> bool filter.
    inset: per-course random setback of the faces (irregular old masonry)."""
    rnd = random.Random(seed)
    out = []
    for c, (za, zb) in enumerate(zip(zs[:-1], zs[1:])):
        x = x0
        first = True
        while x < x1 - 1e-3:
            L = rnd.uniform(*lengths) * (0.5 if first and c % 2 else 1.0)
            first = False
            xe = min(x1, x + L)
            if x1 - xe < lengths[0] * 0.4:
                xe = x1
            if keep is None or keep(x, xe, za, zb):
                ins = rnd.uniform(0, inset)
                out.append(block(f"Blk{c}_{len(out)}", x, xe, y0 + ins, y1 - ins * rnd.random(), za, zb, chamfer, mat,
                                 jitter, seed + len(out)))
            x = xe
    return out


def wedge_ring(name, r_in, r_out, a0, a1, y0, y1, n, cz, mat=None, chamfer=0.035, keep=None):
    """Voussoirs of an arch in the XZ plane (centre (0, cz)), angles in degrees from +X, counter-clockwise."""
    out = []
    for i in range(n):
        b0 = math.radians(a0 + (a1 - a0) * i / n)
        b1 = math.radians(a0 + (a1 - a0) * (i + 1) / n)
        if keep is not None and not keep(i, math.degrees(b0), math.degrees(b1)):
            continue
        pts = []
        for y in (y0, y1):
            for r, b in ((r_in, b0), (r_out, b0), (r_out, b1), (r_in, b1)):
                pts.append((math.cos(b) * r, y, cz + math.sin(b) * r))
        faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        ob = mesh_obj(f"{name}{i}", pts, faces, mat, smooth=False)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=chamfer, segments=1, affect="EDGES")
        bm.to_mesh(ob.data)
        bm.free()
        out.append(ob)
    return out


def exclude_faces(ob, fn):
    """Delete faces whose centre satisfies fn(x, y, z) (e.g. grass cards hidden inside a wall)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if fn(*f.calc_center_median())]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


# =============================================================================== boolean carving (manifold solver)
def _bool_diff(ob, cutter):
    md = ob.modifiers.new("PkCut", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.object = cutter
    try:
        md.solver = "MANIFOLD"
    except TypeError:
        md.solver = "EXACT"
    cutter.hide_render = True
    gn.apply(ob)
    gn.remove(cutter)
    return ob


def fracture_cutter(normal, point, noise=0.12, scale=2.0, seed=0, jag=0.05, radius=None, extent=12.0, res=48,
                    name="_FractureCutter"):
    """Closed cutter: a noisy displaced plane (the break surface) extruded far along +normal."""
    n = V(normal).normalized()
    half = radius if radius else extent / 2
    verts, faces = [], []
    rnd = random.Random(seed)
    ox, oy = rnd.uniform(0, 50), rnd.uniform(0, 50)
    for j in range(res + 1):
        for i in range(res + 1):
            x = -half + 2 * half * i / res
            y = -half + 2 * half * j / res
            h = (mathutils.noise.fractal(V((x * scale + ox, y * scale + oy, seed * 0.37)), 0.5, 2.0, 4) * noise
                 + mathutils.noise.noise(V((x * scale * 6 + oy, y * scale * 6 + ox, seed))) * jag)
            if radius:                        # blend the local break back into the surface at its rim
                r = math.hypot(x, y) / half
                h += max(0.0, r - 0.6) ** 2 * 6.0
            verts.append((x, y, h))
    W = res + 1
    for j in range(res):
        for i in range(res):
            a = j * W + i
            faces.append((a, a + W, a + W + 1, a + 1))          # facing -Z (into the kept part)
    top = len(verts)
    H = extent
    for (x, y, _z) in verts[:top]:
        verts.append((x, y, H))
    for j in range(res):
        for i in range(res):
            a = top + j * W + i
            faces.append((a, a + 1, a + W + 1, a + W))
    ring = [0] + [i for i in range(1, W)] + [j * W + res for j in range(1, W)] + \
           [res * W + i for i in range(res - 1, -1, -1)] + [j * W for j in range(res - 1, 0, -1)]
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]
        faces.append((a, b, top + b, top + a))
    ob = mesh_obj(name, verts, faces, None, smooth=False)
    clean(ob)
    q = V((0, 0, 1)).rotation_difference(n)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = q
    ob.location = point
    C.apply_transforms(ob)
    return ob


def bite_cutter(spots, seed=0, rough=0.35, name="_BiteCutter"):
    rnd = random.Random(seed)
    cutters = []
    for k, sp in enumerate(spots):
        c, r = sp[0], sp[1]
        sc = sp[2] if len(sp) > 2 else (1, 1, 1)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r)
        cu = bpy.context.object
        cu.name = f"{name}{k}"
        rr = random.Random(seed * 31 + k)
        off = V((rr.uniform(0, 40), rr.uniform(0, 40), rr.uniform(0, 40)))
        for v in cu.data.vertices:          # lumpy, faceted chunk
            d = mathutils.noise.fractal(v.co * (2.2 / r) + off, 0.6, 2.0, 3)
            v.co += v.normal * r * rough * d
        cu.scale = sc
        cu.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))
        cu.location = c
        C.apply_transforms(cu)
        cutters.append(cu)
    return cutters


def carve(ob, bite_spots=None, fractures=(), seed=0):
    """Boolean (manifold solver) removal of chunks and broken-off parts from a manifold (voxel-remeshed) mesh."""
    for i, fr in enumerate(fractures):
        _bool_diff(ob, fracture_cutter(name=f"_Frac{i}", **fr))
    for cu in bite_cutter(bite_spots or [], seed=seed):
        _bool_diff(ob, cu)
    return ob
