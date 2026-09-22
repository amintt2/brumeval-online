"""Procedural low-poly mesh helpers for the `creatures` asset group (Blender 5.0). Deterministic."""
import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def from_pydata(name, verts, faces, mat=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update(calc_edges=True)
    obj = _link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    fix_normals(obj)
    for p in me.polygons:
        p.use_smooth = smooth
    return obj


def fix_normals(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def transform(obj, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Bake a transform (rot in degrees, XYZ) into the mesh data."""
    s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    M = Matrix.Translation(Vector(loc)) @ Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))
    obj.data.transform(M)
    obj.data.update()
    return obj


def jitter(obj, amount, seed, axes=(1, 1, 1)):
    rnd = random.Random(seed)
    # displace by vertex position so coincident vertices move together (keeps the mesh closed)
    cache = {}
    for v in obj.data.vertices:
        key = tuple(round(c, 4) for c in v.co)
        if key not in cache:
            cache[key] = Vector((rnd.uniform(-amount, amount) * axes[0], rnd.uniform(-amount, amount) * axes[1],
                                 rnd.uniform(-amount, amount) * axes[2]))
        v.co += cache[key]
    obj.data.update()
    return obj


# --------------------------------------------------------------------------- generators
def lathe(name, profile, n=16, mat=None, smooth=False, phase=0.0):
    """Surface of revolution around Z. profile: [(r, z), ...] bottom->top; r == 0 -> single pole vertex."""
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([len(verts)])
            verts.append((0, 0, z))
        else:
            ring = []
            for k in range(n):
                a = 2 * math.pi * (k + phase) / n
                ring.append(len(verts))
                verts.append((r * math.cos(a), r * math.sin(a), z))
            rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        if len(r0) == 1 and len(r1) == 1:
            continue
        if len(r0) == 1:
            for k in range(n):
                faces.append((r0[0], r1[k], r1[(k + 1) % n]))
        elif len(r1) == 1:
            for k in range(n):
                faces.append((r0[k], r0[(k + 1) % n], r1[0]))
        else:
            for k in range(n):
                faces.append((r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]))
    return from_pydata(name, verts, faces, mat, smooth)


def loft(name, sections, n=8, mat=None, up=(0, 0, 1), caps=(True, True), cap_push=0.35, phase=0.5, smooth=False):
    """Tube through `sections` = [(centre, rx, rz), ...]. rx spans the section's side axis, rz its `up` axis.
    Ends are closed with a slightly pushed-out fan (rounded low-poly look)."""
    pts = [Vector(s[0]) for s in sections]
    m = len(pts)
    verts, faces, rings = [], [], []
    U0 = Vector(up).normalized()
    for i, s in enumerate(sections):
        c, rx, rz = pts[i], s[1], s[2]
        if i == 0:
            t = pts[1] - pts[0]
        elif i == m - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        t.normalize()
        U = U0 if abs(U0.dot(t)) < 0.97 else Vector((0, -1, 0)) if abs(t.z) > 0.9 else Vector((0, 0, 1))
        a = (U - t * U.dot(t)).normalized()
        b = t.cross(a).normalized()
        ring = []
        for k in range(n):
            th = 2 * math.pi * (k + phase) / n
            ring.append(len(verts))
            verts.append(c + b * math.cos(th) * rx + a * math.sin(th) * rz)
        rings.append((ring, t, c, min(rx, rz)))
    for (r0, *_), (r1, *_) in zip(rings, rings[1:]):
        for k in range(n):
            faces.append((r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]))
    for idx, push in ((0, -1), (m - 1, 1)):
        if not caps[0 if idx == 0 else 1]:
            continue
        ring, t, c, r = rings[idx]
        ci = len(verts)
        verts.append(c + t * push * r * cap_push)
        for k in range(n):
            faces.append((ring[k], ring[(k + 1) % n], ci))
    return from_pydata(name, verts, faces, mat, smooth)


def block(name, size, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.18, jit=0.05, seed=0, taper=1.0):
    """Chunky chamfered box (rock block). size = (x, y, z) in metres. `taper` scales the top face in X/Y."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        if v.co.z > 0 and taper != 1.0:
            v.co.x *= taper
            v.co.y *= taper
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, offset_type="OFFSET",
                        segments=1, affect="EDGES", clamp_overlap=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = _link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    transform(obj, scale=size)
    if jit:
        jitter(obj, jit, seed)
    transform(obj, loc=loc, rot=rot)
    fix_normals(obj)
    return obj


def rock(name, r, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), jit=0.12, seed=0, subdiv=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = _link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    if jit:
        jitter(obj, jit * r, seed)
    transform(obj, loc=loc, rot=rot, scale=scale)
    fix_normals(obj)
    return obj


def cone(name, r1, r2, depth, n=6, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Cone/frustum along +Z starting at z=0 (base) to z=depth, then transformed."""
    prof = [(0, 0), (r1, 0), (r2, depth)] if r2 > 1e-6 else [(0, 0), (r1, 0), (0, depth)]
    if r2 > 1e-6:
        prof.append((0, depth))
    obj = lathe(name, prof, n, mat)
    return transform(obj, loc=loc, rot=rot, scale=scale)


def ellipsoid(name, radii, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), seg=12, rings=8, smooth=True):
    prof = []
    for i in range(rings + 1):
        a = -math.pi / 2 + math.pi * i / rings
        prof.append((math.cos(a) if 0 < i < rings else 0.0, math.sin(a)))
    obj = lathe(name, prof, seg, mat, smooth=smooth)
    return transform(obj, loc=loc, rot=rot, scale=radii)


# --------------------------------------------------------------------------- materials on faces
def paint(obj, mats, fn):
    """Assign per-face material: fn(centre_world, normal_world) -> index into `mats` (materials are
    appended to the object's slots in this order)."""
    me = obj.data
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    mw = obj.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for p in me.polygons:
        c = mw @ p.center
        nrm = (nm @ p.normal).normalized()
        p.material_index = fn(c, nrm)
    return obj


def vertex_colors(obj, fn, name="Col"):
    """Per-corner colour attribute: fn(world_co, normal) -> (r, g, b) linear."""
    me = obj.data
    attr = me.color_attributes.get(name) or me.color_attributes.new(name, "FLOAT_COLOR", "CORNER")
    mw = obj.matrix_world
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            r, g, b = fn(mw @ v.co, v.normal)
            attr.data[li].color = (r, g, b, 1.0)
    me.color_attributes.active_color = attr
    return obj


def vcol_material(name, rough=0.3, metal=0.0, emit=None, emit_strength=0.0, attr="Col"):
    """Principled material whose base colour comes from the mesh colour attribute `attr`."""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = attr
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit[:3], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m


def block_between(name, a, b, w, d, mat=None, extend=0.0, bevel=0.18, jit=0.05, seed=0, taper=1.0, twist=0.0):
    """Rock block whose local Z axis runs from point a to point b (length |b-a| + extend)."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    L = axis.length + extend
    obj = block(name, (w, d, L), mat, bevel=bevel, jit=jit, seed=seed, taper=taper)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    tw = Matrix.Rotation(math.radians(twist), 4, "Z")
    obj.data.transform(Matrix.Translation((a + b) / 2) @ rot @ tw)
    obj.data.update()
    return obj


GLYPHS = {
    "algiz": [((0, -1), (0, 1)), ((0, 0.15), (-0.6, 0.85)), ((0, 0.15), (0.6, 0.85))],
    "diamond": [((0, -1), (0.62, 0)), ((0.62, 0), (0, 1)), ((0, 1), (-0.62, 0)), ((-0.62, 0), (0, -1)), ((0, -0.45), (0, 0.45))],
    "raido": [((-0.4, -1), (-0.4, 1)), ((-0.4, 1), (0.42, 0.5)), ((0.42, 0.5), (-0.4, 0.02)), ((-0.4, 0.02), (0.45, -1))],
    "zig": [((-0.55, 1), (0.55, 0.35)), ((0.55, 0.35), (-0.55, -0.3)), ((-0.55, -0.3), (0.55, -1))],
    "eye": [((-0.7, 0), (0, 0.55)), ((0, 0.55), (0.7, 0)), ((0.7, 0), (0, -0.55)), ((0, -0.55), (-0.7, 0)), ((0, 0.9), (0, -0.9))],
}


def rune(name, glyph, centre, normal, size, mat, up=(0, 0, 1), bar=0.055, depth=0.07, spin=0.0):
    """Glowing glyph made of thin bars lying on a surface (centre, outward normal). Returns one mesh."""
    n = Vector(normal).normalized()
    U = Vector(up)
    if abs(U.dot(n)) > 0.95:
        U = Vector((0, -1, 0))
    u = U.cross(n).normalized()
    v = n.cross(u).normalized()
    if spin:
        R = Matrix.Rotation(math.radians(spin), 3, n)
        u, v = R @ u, R @ v
    c = Vector(centre)
    bm = bmesh.new()
    for (x0, y0), (x1, y1) in GLYPHS[glyph]:
        p0 = c + (u * x0 + v * y0) * size
        p1 = c + (u * x1 + v * y1) * size
        seg = p1 - p0
        L = seg.length + bar
        mid = (p0 + p1) / 2
        ax = seg.normalized()
        side = n.cross(ax).normalized()
        basis = Matrix((side, ax, n)).transposed().to_4x4()
        geom = bmesh.ops.create_cube(bm, size=1.0)
        vs = geom["verts"]
        bmesh.ops.transform(bm, verts=vs, matrix=Matrix.Diagonal((bar, L, depth, 1.0)))
        bmesh.ops.transform(bm, verts=vs, matrix=Matrix.Translation(mid) @ basis)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = _link(bpy.data.objects.new(name, me))
    me.materials.append(mat)
    fix_normals(obj)
    return obj
