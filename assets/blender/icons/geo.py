"""Mesh / material helpers for the icon group (bmesh based, no operators -> fast and deterministic).

Icon space convention used by every builder in this folder:
    X = screen right, Z = screen up, -Y = towards the camera (camera yaw 0 / pitch 0 looks along +Y).
Builders model an object in that space, then `pose()` tilts it for a 3/4 view.
"""
import math
import random

import bpy
import bmesh
from mathutils import Matrix, Vector

import common as C


# --------------------------------------------------------------------------- materials
def M(name, col, rough=0.6, metal=0.0, emit=None, strength=2.0, alpha=1.0):
    """Principled material from sRGB hex strings (`col`, `emit`)."""
    c = C.hex_color(col) if isinstance(col, str) else col
    e = C.hex_color(emit) if isinstance(emit, str) else emit
    return C.material(name, c, rough, metal, e, strength, alpha)


def glass(name, col="#dff4ff", alpha=0.28, rough=0.05):
    m = M(name, col, rough, 0.0, alpha=alpha)
    m.use_backface_culling = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Specular IOR Level"].default_value = 1.0
    return m


def glow(name, col, strength=4.0, base=None, rough=0.4):
    """Emissive material (base colour defaults to the emission colour)."""
    return M(name, base or col, rough, 0.0, emit=col, strength=strength)


# --------------------------------------------------------------------------- objects
def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def obj_from_bm(name, bm, mat=None, smooth=False, sharp_angle=None, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = _link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    if smooth and sharp_angle is not None:
        me.set_sharp_from_angle(angle=math.radians(sharp_angle))
    return ob


def place(ob, loc=None, rot=None, scale=None):
    """rot in DEGREES (XYZ euler)."""
    if loc is not None:
        ob.location = loc
    if rot is not None:
        ob.rotation_euler = tuple(math.radians(a) for a in rot)
    if scale is not None:
        ob.scale = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    return ob


def _connect(bm, a, b, closed=True):
    """Bridge two vertex rings (a ring of length 1 is a pole)."""
    if len(a) == 1 and len(b) == 1:
        return
    if len(a) == 1 or len(b) == 1:
        pole, ring, flip = (a[0], b, False) if len(a) == 1 else (b[0], a, True)
        n = len(ring)
        for j in range(n if closed else n - 1):
            tri = (pole, ring[j], ring[(j + 1) % n])
            bm.faces.new(tri[::-1] if flip else tri)
        return
    n = len(a)
    for j in range(n if closed else n - 1):
        k = (j + 1) % n
        bm.faces.new((a[j], a[k], b[k], b[j]))


def loft(name, sections, mat=None, smooth=False, closed=True, cap_start=True, cap_end=True, sharp_angle=None):
    """Skin a list of rings (each a list of 3D points, all rings same length, or length 1 = pole)."""
    bm = bmesh.new()
    rings = [[bm.verts.new(tuple(p)) for p in sec] for sec in sections]
    for i in range(len(rings) - 1):
        _connect(bm, rings[i], rings[i + 1], closed)
    if closed:
        if cap_start and len(rings[0]) > 2:
            bm.faces.new(rings[0][::-1])
        if cap_end and len(rings[-1]) > 2:
            bm.faces.new(rings[-1])
    return obj_from_bm(name, bm, mat, smooth, sharp_angle)


def lathe(name, profile, segs=16, mat=None, smooth=True, cap=True, phase=0.0, sharp_angle=None):
    """Revolve a (radius, z) profile around the Z axis."""
    secs = []
    for r, z in profile:
        if r <= 1e-6:
            secs.append([(0.0, 0.0, z)])
        else:
            secs.append([(r * math.cos(phase + 2 * math.pi * i / segs), r * math.sin(phase + 2 * math.pi * i / segs), z)
                         for i in range(segs)])
    return loft(name, secs, mat, smooth, True, cap, cap, sharp_angle)


def frames(path):
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    tans = []
    for i in range(n):
        d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tans.append(d.normalized())
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nor = tans[0].cross(ref).normalized()
    out = []
    for i in range(n):
        if i > 0:
            q = tans[i - 1].rotation_difference(tans[i])
            nor = (q @ nor).normalized()
        out.append((pts[i], tans[i], nor, tans[i].cross(nor).normalized()))
    return out


def tube(name, path, radius=0.05, segs=8, mat=None, smooth=True, cap=True, flat_ratio=1.0, twist=0.0, sharp_angle=None):
    """Sweep a circle (or ellipse, flat_ratio<1) along a polyline. `radius` may be a list (one per point)."""
    fr = frames(path)
    secs = []
    for i, (p, t, nrm, bn) in enumerate(fr):
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        if r <= 1e-6:
            secs.append([tuple(p)])
            continue
        ring = []
        for k in range(segs):
            a = twist + 2 * math.pi * k / segs
            ring.append(tuple(p + nrm * (math.cos(a) * r) + bn * (math.sin(a) * r * flat_ratio)))
        secs.append(ring)
    return loft(name, secs, mat, smooth, True, cap, cap, sharp_angle)


def rod(name, p0, p1, r=0.05, segs=8, mat=None, smooth=False, r1=None):
    return tube(name, [p0, p1], [r, r if r1 is None else r1], segs, mat, smooth)


def extrude(name, pts, depth=0.1, mat=None, smooth=False, y=0.0, bevel=0.0, bevel_segs=1):
    """Extrude a 2D polygon given in the XZ plane (x, z) along Y (thickness `depth`, centred on `y`)."""
    bm = bmesh.new()
    front = [bm.verts.new((x, y - depth / 2, z)) for x, z in pts]
    back = [bm.verts.new((x, y + depth / 2, z)) for x, z in pts]
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    n = len(pts)
    for j in range(n):
        k = (j + 1) % n
        bm.faces.new((front[j], back[j], back[k], front[k]))
    ob = obj_from_bm(name, bm, mat, smooth)
    if bevel > 0:
        add_bevel(ob, bevel, bevel_segs)
    return ob


def add_bevel(ob, width, segs=1, angle=35):
    mod = ob.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segs
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    return mod


def box(name, size, mat=None, loc=(0, 0, 0), rot=None, bevel=0.0):
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    ob = obj_from_bm(name, bm, mat, False)
    place(ob, loc, rot)
    if bevel > 0:
        add_bevel(ob, bevel, 1)
    return ob


def ico(name, r=0.5, subdiv=1, mat=None, loc=(0, 0, 0), scale=None, smooth=False, seed=None, jitter=0.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    if seed is not None and jitter > 0:
        rnd = random.Random(seed)
        for v in bm.verts:
            v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter
    ob = obj_from_bm(name, bm, mat, smooth)
    return place(ob, loc, None, scale)


def uvsphere(name, r=0.5, segs=16, rings=10, mat=None, loc=(0, 0, 0), scale=None, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    ob = obj_from_bm(name, bm, mat, smooth)
    return place(ob, loc, None, scale)


def cyl(name, r=0.5, depth=1.0, segs=12, mat=None, loc=(0, 0, 0), rot=None, scale=None, smooth=False, r2=None):
    """Cylinder (or truncated cone with r2) along Z, centred on its middle."""
    top = r if r2 is None else r2
    ob = lathe(name, [(0, -depth / 2), (r, -depth / 2), (top, depth / 2), (0, depth / 2)], segs, mat, smooth,
               sharp_angle=30 if smooth else None)
    return place(ob, loc, rot, scale)


def torus(name, major=0.5, minor=0.1, seg=24, minor_seg=8, mat=None, loc=(0, 0, 0), rot=None, scale=None, smooth=True,
          arc=360.0, start=0.0):
    """Torus in the XY plane (optionally only an arc, degrees)."""
    full = arc >= 359.9
    n = seg if full else seg + 1
    path = []
    for i in range(n):
        a = math.radians(start) + math.radians(arc) * i / seg
        path.append((major * math.cos(a), major * math.sin(a), 0.0))
    if full:
        # closed ring: build manually to weld the seam
        fr = frames(path + [path[0], path[1]])[:seg]
        bm = bmesh.new()
        rings = []
        for p, t, nrm, bn in fr:
            nrm = (Vector(p).normalized())
            bn = Vector((0, 0, 1))
            rings.append([bm.verts.new(tuple(Vector(p) + nrm * (math.cos(2 * math.pi * k / minor_seg) * minor)
                                             + bn * (math.sin(2 * math.pi * k / minor_seg) * minor)))
                          for k in range(minor_seg)])
        for i in range(seg):
            _connect(bm, rings[i], rings[(i + 1) % seg], True)
        ob = obj_from_bm(name, bm, mat, smooth)
    else:
        ob = tube(name, path, minor, minor_seg, mat, smooth)
    return place(ob, loc, rot, scale)


def jitter_obj(ob, amount=0.02, seed=1):
    rnd = random.Random(seed)
    for v in ob.data.vertices:
        v.co += Vector((rnd.uniform(-amount, amount), rnd.uniform(-amount, amount), rnd.uniform(-amount, amount)))
    return ob


def transform_mesh(ob, matrix):
    ob.data.transform(matrix)
    ob.data.update()
    return ob


# --------------------------------------------------------------------------- posing
def pose(objs, turn=0.0, tilt=0.0, roll=0.0, loc=(0, 0, 0), scale=1.0):
    """Parent `objs` to a pivot and rotate it: first `turn` around Z (object's own vertical axis),
    then `tilt` around X (lean towards/away from the camera), then `roll` around Y (in-screen rotation,
    positive = top goes to the right). Degrees."""
    piv = _link(bpy.data.objects.new("Pivot", None))
    for o in objs:
        if o.parent is None:
            o.parent = piv
    piv.rotation_mode = "ZXY"
    piv.rotation_euler = (math.radians(tilt), math.radians(roll), math.radians(turn))
    piv.location = loc
    piv.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    return piv


def all_meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def arc_points(radius, a0, a1, n, z=0.0, plane="XZ", centre=(0, 0, 0)):
    """Points on a circular arc (angles in degrees), in the XZ plane by default."""
    cx, cy, cz = centre
    out = []
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / (n - 1))
        if plane == "XZ":
            out.append((cx + radius * math.cos(a), cy, cz + radius * math.sin(a)))
        else:
            out.append((cx + radius * math.cos(a), cy + radius * math.sin(a), cz + z))
    return out


def ribbon(name, path, widths, mat=None, normal=(0, -1, 0), smooth=True, thickness=0.0):
    """Flat strip along a polyline, facing `normal` (used for slash trails / sound waves)."""
    nrm = Vector(normal).normalized()
    fr = frames(path)
    bm = bmesh.new()
    left, right = [], []
    for i, (p, t, _n, _b) in enumerate(fr):
        side = t.cross(nrm).normalized()
        w = widths[i] if isinstance(widths, (list, tuple)) else widths
        left.append(bm.verts.new(tuple(p + side * (w / 2))))
        right.append(bm.verts.new(tuple(p - side * (w / 2))))
    for i in range(len(path) - 1):
        bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
    if thickness > 0:
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thickness)
    return obj_from_bm(name, bm, mat, smooth, recalc=thickness > 0)


def cones(name, specs, mat=None, verts=5, smooth=False):
    """Many small cones in ONE mesh (fur tufts, spikes). specs: [(base_loc, direction, radius, length), ...]."""
    bm = bmesh.new()
    up = Vector((0, 0, 1))
    for loc, d, r, ln in specs:
        d = Vector(d).normalized()
        ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=0.0, depth=ln)
        mat4 = Matrix.Translation(Vector(loc) + d * (ln / 2)) @ up.rotation_difference(d).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=mat4, verts=ret["verts"])
    return obj_from_bm(name, bm, mat, smooth)


def align(objs, start, end, twist=0.0, length=None):
    """Parent `objs` (modelled along +Z from the origin) to a pivot placed at `start` whose +Z points to `end`.
    If `length` is given the pivot is scaled so that `length` model units span start->end."""
    s, e = Vector(start), Vector(end)
    d = e - s
    piv = _link(bpy.data.objects.new("Align", None))
    for o in objs:
        if o.parent is None:
            o.parent = piv
    piv.rotation_mode = "QUATERNION"
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    from mathutils import Quaternion
    piv.rotation_quaternion = q @ Quaternion((0, 0, 1), math.radians(twist))
    piv.location = s
    if length:
        k = d.length / length
        piv.scale = (k, k, k)
    bpy.context.view_layer.update()
    return piv


def orient_to(ob, direction):
    """Rotate `ob` so that its local +Z axis points along `direction`."""
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized())
    return ob


def locks(name, specs, mat=None, flat=0.45, verts=6, smooth=True):
    """Flattened cones (fur locks / feathers) in ONE mesh. The flat side faces up (world +Z) as far as possible.
    specs: [(base_loc, direction, radius, length), ...]."""
    bm = bmesh.new()
    up = Vector((0, 0, 1))
    for loc, d, r, ln in specs:
        z = Vector(d).normalized()
        x = up.cross(z)
        x = x.normalized() if x.length > 1e-4 else Vector((1, 0, 0))
        y = z.cross(x).normalized()
        basis = Matrix((x, y * flat, z)).transposed().to_4x4()
        ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=0.0, depth=ln)
        mat4 = Matrix.Translation(Vector(loc)) @ basis @ Matrix.Translation(Vector((0, 0, ln / 2)))
        bmesh.ops.transform(bm, matrix=mat4, verts=ret["verts"])
    return obj_from_bm(name, bm, mat, smooth)
