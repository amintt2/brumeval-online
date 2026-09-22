"""Low-poly mesh primitives + a MeshBuilder that assembles rigidly skinned parts into ONE mesh.

Everything here is pure geometry (lists of vertices / faces) so parts can be generated, transformed,
mirrored and weighted to a bone without touching bpy.ops.  Faces are wound so normals point outward.
Coordinates: Blender world space, metres, Z up, characters face -Y (their left side is +X).
"""
import math

import bpy
from mathutils import Euler, Matrix, Vector

TAU = math.tau


# --------------------------------------------------------------------------- matrices
def T(x=0.0, y=0.0, z=0.0):
    if isinstance(x, (tuple, list, Vector)):
        return Matrix.Translation(Vector(x))
    return Matrix.Translation((x, y, z))


def R(rx=0.0, ry=0.0, rz=0.0):
    """Rotation matrix from XYZ euler angles in DEGREES."""
    return Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_matrix().to_4x4()


def S(sx, sy=None, sz=None):
    sy = sx if sy is None else sy
    sz = sx if sz is None else sz
    return Matrix.Diagonal((sx, sy, sz, 1.0))


MIRROR_X = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))


def frame(origin, x, y, z):
    """Matrix mapping local axes X/Y/Z onto the given world vectors, local origin -> `origin`."""
    m = Matrix.Identity(4)
    for i, ax in enumerate((x, y, z)):
        v = Vector(ax)
        for r in range(3):
            m[r][i] = v[r]
    for r in range(3):
        m[r][3] = origin[r]
    return m


def along(p0, p1):
    """Matrix that maps the local +Z axis (starting at the origin) onto the segment p0 -> p1."""
    p0, p1 = Vector(p0), Vector(p1)
    q = Vector((0, 0, 1)).rotation_difference((p1 - p0).normalized())
    return Matrix.Translation(p0) @ q.to_matrix().to_4x4()


# --------------------------------------------------------------------------- 2D rings
def front_phase(n):
    """Angular phase so that a flat side of an n-gon faces the front (-Y)."""
    step = TAU / n
    return (-math.pi / 2 - step / 2) % step


def ring2d(n, rx, ry, shape="ellipse", phase=None, chamfer=0.35):
    if shape == "rect":
        return [(rx, -ry), (rx, ry), (-rx, ry), (-rx, -ry)]
    if shape == "chamfer":
        c = min(rx, ry) * chamfer
        return [(rx, -ry + c), (rx, ry - c), (rx - c, ry), (-rx + c, ry),
                (-rx, ry - c), (-rx, -ry + c), (-rx + c, -ry), (rx - c, -ry)]
    if phase is None:
        phase = front_phase(n)
    return [(rx * math.cos(phase + TAU * i / n), ry * math.sin(phase + TAU * i / n)) for i in range(n)]


def _bridge(idx, cap0, cap1):
    faces = []
    for a, b in zip(idx, idx[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            m = len(b)
            faces += [(a[0], b[(i + 1) % m], b[i]) for i in range(m)]
        elif len(b) == 1:
            m = len(a)
            faces += [(a[i], a[(i + 1) % m], b[0]) for i in range(m)]
        else:
            m = len(a)
            faces += [(a[i], a[(i + 1) % m], b[(i + 1) % m], b[i]) for i in range(m)]
    if cap0 and len(idx[0]) > 2:
        faces.append(tuple(reversed(idx[0])))
    if cap1 and len(idx[-1]) > 2:
        faces.append(tuple(idx[-1]))
    return faces


# --------------------------------------------------------------------------- 3D primitives
def loft(rings, n=8, shape="ellipse", cap0=True, cap1=True, phase=None, chamfer=0.35):
    """Stack of horizontal rings. Each ring: (z, rx, ry) or (x, y, z, rx, ry); rx=ry=0 -> apex point."""
    verts, idx = [], []
    zs = []
    for r in rings:
        if len(r) == 3:
            x, y, (z, rx, ry) = 0.0, 0.0, r
        else:
            x, y, z, rx, ry = r[:5]
        zs.append(z)
        if rx <= 1e-6 and ry <= 1e-6:
            idx.append([len(verts)])
            verts.append((x, y, z))
        else:
            pts = ring2d(n, rx, ry, shape, phase, chamfer)
            idx.append(list(range(len(verts), len(verts) + len(pts))))
            verts.extend((x + px, y + py, z) for px, py in pts)
    faces = _bridge(idx, cap0, cap1)
    if zs[-1] < zs[0]:
        faces = [tuple(reversed(f)) for f in faces]
    return verts, faces


def box(c, hx, hy, hz):
    """Axis-aligned box centred on c with half sizes."""
    return loft([(c[0], c[1], c[2] - hz, hx, hy), (c[0], c[1], c[2] + hz, hx, hy)], shape="rect")


def ellipsoid(c, r, seg=8, rings=6, phi0=0.0, phi1=math.pi, cap0=True, cap1=True, phase=None):
    """UV ellipsoid; phi is the polar angle measured from the BOTTOM pole (0) to the top (pi)."""
    rx, ry, rz = (r, r, r) if isinstance(r, (int, float)) else r
    rs = []
    for k in range(rings + 1):
        phi = phi0 + (phi1 - phi0) * k / rings
        s = math.sin(phi)
        if s < 1e-5:
            s = 0.0
        rs.append((c[0], c[1], c[2] - math.cos(phi) * rz, rx * s, ry * s))
    return loft(rs, seg, cap0=cap0, cap1=cap1, phase=phase)


def tube(p0, p1, r0, r1=None, n=6, cap0=True, cap1=True, ry0=None, ry1=None):
    """Tapered (optionally elliptic) cylinder from p0 to p1."""
    r1 = r0 if r1 is None else r1
    ry0 = r0 if ry0 is None else ry0
    ry1 = r1 if ry1 is None else ry1
    L = (Vector(p1) - Vector(p0)).length
    return xform(loft([(0.0, r0, ry0), (L, r1, ry1)], n, cap0=cap0, cap1=cap1), along(p0, p1))


def sweep(points, radii, n=6, normal=(1, 0, 0), cap0=True, cap1=True, phase=0.0):
    """Tube swept along a polyline. radii: float or (ru, rv) per point (ru along `normal`)."""
    P = [Vector(p) for p in points]
    N = Vector(normal)
    verts, idx = [], []
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        u = (N - t * N.dot(t)).normalized()
        v = t.cross(u)
        r = radii[i]
        ru, rv = (r, r) if isinstance(r, (int, float)) else r
        if ru < 1e-6 and rv < 1e-6:
            idx.append([len(verts)])
            verts.append(tuple(p))
            continue
        ring = []
        for k in range(n):
            a = phase + TAU * k / n
            ring.append(len(verts))
            verts.append(tuple(p + u * (ru * math.cos(a)) + v * (rv * math.sin(a))))
        idx.append(ring)
    return verts, _bridge(idx, cap0, cap1)


def disc(c, r, n=10, h=0.02, ry=None):
    """Flat cylinder (coin/shield) lying in the XY plane, centred on c, thickness h."""
    ry = r if ry is None else ry
    return loft([(c[0], c[1], c[2] - h / 2, r, ry), (c[0], c[1], c[2] + h / 2, r, ry)], n)


def ring_band(c, r_in, r_out, h, n=12):
    """Flat annulus (rim, band) in the XY plane."""
    verts, faces = [], []
    for k, (rr, z) in enumerate(((r_out, -h / 2), (r_out, h / 2), (r_in, h / 2), (r_in, -h / 2))):
        for i in range(n):
            a = TAU * i / n
            verts.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a), c[2] + z))
    rings = [list(range(k * n, k * n + n)) for k in range(4)]
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
        A, B = rings[a], rings[b]
        faces += [(A[i], A[(i + 1) % n], B[(i + 1) % n], B[i]) for i in range(n)]
    return verts, faces


def shell(c, r, seg=10, rings=7, keep=None, phi0=0.0, phi1=math.pi, thickness=0.0):
    """Ellipsoid surface where only faces whose centre direction passes `keep(dir)` are kept (open shells:
    hoods, hair caps).  With thickness > 0 an inner copy is added so the shell looks solid from inside."""
    verts, faces = ellipsoid(c, r, seg, rings, phi0, phi1, cap0=False, cap1=False)
    cv = Vector(c)
    if keep is not None:
        kept = []
        for f in faces:
            m = sum((Vector(verts[i]) for i in f), Vector()) / len(f)
            d = m - cv
            if keep(Vector((d.x / r[0], d.y / r[1], d.z / r[2])) if not isinstance(r, (int, float)) else d / r):
                kept.append(f)
        faces = kept
    if thickness > 0:
        n = len(verts)
        inner = []
        for v in verts:
            d = Vector(v) - cv
            inner.append(tuple(cv + d * (1.0 - thickness / max(d.length, 1e-6))))
        verts = verts + inner
        faces = faces + [tuple(n + i for i in reversed(f)) for f in faces]
    return verts, faces


def xform(geo, M):
    verts, faces = geo
    out = [tuple(M @ Vector(v)) for v in verts]
    if M.to_3x3().determinant() < 0:
        faces = [tuple(reversed(f)) for f in faces]
    return out, faces


def merge(*geos):
    verts, faces = [], []
    for v, f in geos:
        b = len(verts)
        verts += list(v)
        faces += [tuple(b + i for i in ff) for ff in f]
    return verts, faces


def jitter(geo, amount, seed):
    import random
    rnd = random.Random(seed)
    verts, faces = geo
    return [tuple(c + rnd.uniform(-amount, amount) for c in v) for v in verts], faces


def deform(geo, fn):
    """Apply fn(Vector)->Vector to every vertex."""
    verts, faces = geo
    return [tuple(fn(Vector(v))) for v in verts], faces


# --------------------------------------------------------------------------- builder
def _vc_material(name, rough, metal, emit=None, strength=0.0):
    """Principled material whose Base Color comes from the 'Col' colour attribute (glTF COLOR_0)."""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit[:3], 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def _merge_materials(name, mats, face_mat):
    """Map authored materials to shared ones; returns (materials, face material indices, face RGBA colours)."""
    shared, index, info = [], {}, []
    for m in mats:
        bsdf = m.node_tree.nodes["Principled BSDF"]
        col = tuple(bsdf.inputs["Base Color"].default_value)[:3] + (1.0,)
        metal = bsdf.inputs["Metallic"].default_value
        strength = bsdf.inputs["Emission Strength"].default_value
        emit = tuple(bsdf.inputs["Emission Color"].default_value)[:3]
        if strength > 0 and max(emit) > 0:
            key = ("emit", m.name)
            make = (lambda m=m, emit=emit, strength=strength, rough=bsdf.inputs["Roughness"].default_value:
                    _vc_material(f"{name}_{m.name.split('_', 1)[-1]}", rough, 0.0, emit, strength))
        elif metal > 0.2:
            key = ("metal",)
            make = lambda: _vc_material(f"{name}_Metal", 0.38, 0.5)
        else:
            key = ("matte",)
            make = lambda: _vc_material(f"{name}_Matte", 0.75, 0.0)
        if key not in index:
            index[key] = len(shared)
            shared.append(make())
        info.append((index[key], col))
    return shared, [info[mi][0] for mi in face_mat], [info[mi][1] for mi in face_mat]


class MeshBuilder:
    """Collects parts (geometry + material + bone) and builds one rigidly-skinned mesh object."""

    def __init__(self):
        self.verts, self.faces, self.face_mat, self.vbone = [], [], [], []
        self.mats = []
        self.no_ground = set()

    def add(self, geo, mat, bone, M=None, ground=True):
        if M is not None:
            geo = xform(geo, M)
        verts, faces = geo
        base = len(self.verts)
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        self.verts.extend(tuple(v) for v in verts)
        self.vbone.extend([bone] * len(verts))
        if not ground:
            self.no_ground.update(range(base, base + len(verts)))
        for f in faces:
            self.faces.append(tuple(base + i for i in f))
            self.face_mat.append(mi)
        return self

    def sym(self, geo, mat, bone, M=None, ground=True):
        """Add a part authored on the LEFT side (+X) weighted to `<bone>.L`, plus its mirror on `<bone>.R`.
        `bone` without side suffix is used as-is for both copies (e.g. 'chest')."""
        if M is not None:
            geo = xform(geo, M)
        bl = bone + ".L" if not bone in ("root", "hips", "spine", "chest", "neck", "head") else bone
        br = bone + ".R" if not bone in ("root", "hips", "spine", "chest", "neck", "head") else bone
        self.add(geo, mat, bl, ground=ground)
        self.add(xform(geo, MIRROR_X), mat, br, ground=ground)
        return self

    def tri_count(self):
        return sum(len(f) - 2 for f in self.faces)

    def breakdown(self):
        out = {}
        for f, mi in zip(self.faces, self.face_mat):
            out[self.mats[mi].name] = out.get(self.mats[mi].name, 0) + len(f) - 2
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    def build(self, name, rig=None, merge=True):
        """Create the mesh object. With merge=True (default) the authored materials are collapsed into a few
        shared materials (matte / metal / one per emissive colour) and each part keeps its colour through a
        per-corner colour attribute exported as glTF COLOR_0 -> 2-4 draw calls per character instead of ~15."""
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        if merge:
            mats, face_mat, colors = _merge_materials(name, self.mats, self.face_mat)
            for m in mats:
                me.materials.append(m)
            me.polygons.foreach_set("material_index", face_mat)
            attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
            flat_cols = []
            for p in me.polygons:
                flat_cols.extend(colors[p.index] * p.loop_total)
            attr.data.foreach_set("color", flat_cols)
            me.color_attributes.active_color = attr
            me.color_attributes.render_color_index = me.color_attributes.find("Col")
        else:
            for m in self.mats:
                me.materials.append(m)
            me.polygons.foreach_set("material_index", self.face_mat)
        me.update()
        for p in me.polygons:
            p.use_smooth = False
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        groups = {}
        for i, b in enumerate(self.vbone):
            groups.setdefault(b, []).append(i)
        for b, ids in groups.items():
            vg = obj.vertex_groups.new(name=b)
            vg.add(ids, 1.0, "REPLACE")
        if rig is not None:
            obj.parent = rig
            mod = obj.modifiers.new("Armature", "ARMATURE")
            mod.object = rig
        return obj
