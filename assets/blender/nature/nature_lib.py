"""Helpers for the `nature` asset group (trees, rocks, bushes, flowers).

Every model is built inside ONE bmesh and becomes ONE mesh object (the client draws these props with GPU
instancing, so one mesh with at most 3 materials = at most 3 instanced draw calls per prop type).

Colour strategy
---------------
Each face corner carries a colour in the `Col` colour attribute (per-face tint variation, fake ambient
occlusion on undersides, gradients on grass blades...). Every material multiplies that attribute with a
constant tint (Color Attribute -> Mix[Multiply] -> Base Color). The glTF exporter turns this into
`baseColorFactor = tint` + `COLOR_0 = corner colour / tint`, so:
  * Three.js' GLTFLoader (vertexColors on) shows the full per-face variation;
  * a renderer ignoring COLOR_0 still shows the right overall colour (the tint).
The tint of a material is the per-channel maximum of its faces' colours, so COLOR_0 always stays in 0..1.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

import common as C

TAU = math.tau
GOLDEN = math.pi * (3.0 - math.sqrt(5.0))


# --------------------------------------------------------------------------- colour helpers
def hexc(h):
    """sRGB hex -> linear rgb tuple (Blender colour sockets / glTF colours are linear)."""
    return C.hex_color(h)


def scale(c, k):
    return tuple(max(0.0, x * k) for x in c)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def lerp3(a, b, t):
    return Vector(a).lerp(Vector(b), t)


# --------------------------------------------------------------------------- materials
def _socket(sockets, identifier):
    for s in sockets:
        if s.identifier == identifier:
            return s
    raise KeyError(identifier)


def make_material(name, tint, rough=0.85, metal=0.0, double_sided=False):
    """Principled material whose base colour = colour attribute `Col` x `tint`."""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    attr.location = (-520, 260)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.location = (-260, 260)
    mix.inputs[0].default_value = 1.0
    _socket(mix.inputs, "B_Color").default_value = (*tint, 1.0)
    nt.links.new(attr.outputs["Color"], _socket(mix.inputs, "A_Color"))
    nt.links.new(_socket(mix.outputs, "Result_Color"), bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    # closed meshes -> single sided (glTF doubleSided=false, cheaper & correct shadows);
    # thin cards (grass blades, petals) stay double sided.
    m.use_backface_culling = not double_sided
    m.diffuse_color = (*tint, 1.0)
    return m


# --------------------------------------------------------------------------- mesh builder
class Model:
    """Accumulates geometry for one prop inside a single bmesh."""

    def __init__(self, name, seed):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.rnd = random.Random(seed)
        self.mats = []  # [(key, options)]

    # ---- materials
    def slot(self, key, rough=0.85, metal=0.0, double_sided=False):
        for i, (k, _) in enumerate(self.mats):
            if k == key:
                return i
        if len(self.mats) >= 3:
            raise RuntimeError(f"{self.name}: at most 3 materials per nature prop")
        self.mats.append((key, dict(rough=rough, metal=metal, double_sided=double_sided)))
        return len(self.mats) - 1

    # ---- random helpers
    def u(self, a, b):
        return self.rnd.uniform(a, b)

    def vary(self, c, amount=0.06):
        return scale(c, 1.0 + self.rnd.uniform(-amount, amount))

    # ---- bookkeeping
    def _mark(self):
        return set(self.bm.faces)

    def _new(self, before):
        return [f for f in self.bm.faces if f not in before]

    @staticmethod
    def verts_of(faces):
        seen, out = set(), []
        for f in faces:
            for v in f.verts:
                if v not in seen:
                    seen.add(v)
                    out.append(v)
        return out

    def fix_normals(self, faces):
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        for f in faces:
            f.normal_update()
        return faces

    def jitter(self, faces, amount, z_scale=1.0):
        for v in self.verts_of(faces):
            v.co += Vector((self.u(-amount, amount), self.u(-amount, amount), self.u(-amount, amount) * z_scale))
        for f in faces:
            f.normal_update()
        return faces

    def clamp_bottom(self, faces, z_min, noise=0.0):
        """Flatten every vertex below z_min onto the plane z_min (+/- noise) so the prop sits flat."""
        for v in self.verts_of(faces):
            if v.co.z < z_min:
                v.co.z = z_min - self.u(0.0, noise)
        for f in faces:
            f.normal_update()
        return faces

    # ---- painting
    def paint(self, faces, slot, color):
        """color: (r,g,b) or callable(face)->(r,g,b). Sets material slot + flat shading."""
        for f in faces:
            f.material_index = slot
            f.smooth = False
            f.normal_update()
            c = color(f) if callable(color) else color
            for lp in f.loops:
                lp[self.col] = (c[0], c[1], c[2], 1.0)
        return faces

    def paint_loops(self, faces, slot, color):
        """color: callable(face, loop)->(r,g,b) for per-corner gradients."""
        for f in faces:
            f.material_index = slot
            f.smooth = False
            f.normal_update()
            for lp in f.loops:
                c = color(f, lp)
                lp[self.col] = (c[0], c[1], c[2], 1.0)
        return faces

    def shade(self, base, top=0.10, under=0.45, var=0.05):
        """Colour callable: brighter on up-facing faces, darker underneath (cheap baked AO), random facet variation."""
        def fn(f):
            nz = f.normal.z
            k = 1.0 + top * nz if nz >= 0 else 1.0 + under * nz
            return scale(base, k * (1.0 + self.u(-var, var)))
        return fn

    # ---- primitives (all return the list of new faces)
    def ico(self, center, r, subdiv=2, scl=(1.0, 1.0, 1.0), rot_z=0.0):
        before = self._mark()
        m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Diagonal((*scl, 1.0))
        bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=r, matrix=m, calc_uvs=False)
        return self.fix_normals(self._new(before))

    def octa(self, center, r, rz=None):
        """Tiny octahedron (8 tris) - berries, pebbles."""
        c = Vector(center)
        rz = r if rz is None else rz
        a = self.u(0, TAU)
        ring = [self.bm.verts.new(c + Vector((math.cos(a + i * TAU / 4) * r, math.sin(a + i * TAU / 4) * r, 0))) for i in range(4)]
        top = self.bm.verts.new(c + Vector((0, 0, rz)))
        bot = self.bm.verts.new(c - Vector((0, 0, rz)))
        faces = []
        for i in range(4):
            j = (i + 1) % 4
            faces.append(self.bm.faces.new((ring[i], ring[j], top)))
            faces.append(self.bm.faces.new((ring[j], ring[i], bot)))
        return self.fix_normals(faces)

    def hull(self, points):
        """Convex hull of a point cloud (faceted rocks). Interior points are removed."""
        before = self._mark()
        vs = [self.bm.verts.new(Vector(p)) for p in points]
        res = bmesh.ops.convex_hull(self.bm, input=vs, use_existing_faces=False)
        kill_set = {e for e in res["geom_interior"] + res["geom_unused"] if isinstance(e, bmesh.types.BMVert)}
        kill = [v for v in vs if v in kill_set]  # unique, in creation order
        if kill:
            bmesh.ops.delete(self.bm, geom=kill, context="VERTS")
        return self.fix_normals(self._new(before))

    def tube(self, pts, radii, sides=6, twist=0.0, phase=None, wobble=0.0, cap_start=False, cap_end=True):
        """Tapered tube along a polyline (parallel-transport frames). A radius of 0 makes a pointed tip.
        Winding is built outward: ring vertices turn counter-clockwise around the tangent."""
        bm = self.bm
        pts = [Vector(p) for p in pts]
        n = len(pts)
        phase = self.u(0, TAU) if phase is None else phase
        tans = []
        for i in range(n):
            d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tans.append(d.normalized())
        ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
        nrm = tans[0].cross(ref).normalized()
        rings = []
        before = self._mark()
        for i in range(n):
            t = tans[i]
            if i > 0:
                nrm = tans[i - 1].rotation_difference(t) @ nrm
                nrm = (nrm - t * nrm.dot(t)).normalized()
            b = t.cross(nrm)
            r = radii[i]
            if r <= 1e-5:
                rings.append([bm.verts.new(pts[i])])
                continue
            ring = []
            for k in range(sides):
                a = phase + twist * i + TAU * k / sides
                rr = r * (1.0 + self.u(-wobble, wobble))
                ring.append(bm.verts.new(pts[i] + (nrm * math.cos(a) + b * math.sin(a)) * rr))
            rings.append(ring)
        for i in range(n - 1):
            A, B = rings[i], rings[i + 1]
            for k in range(sides):
                k2 = (k + 1) % sides
                if len(B) == 1:
                    bm.faces.new((A[k], A[k2], B[0]))
                elif len(A) == 1:
                    bm.faces.new((A[0], B[k2], B[k]))
                else:
                    bm.faces.new((A[k], A[k2], B[k2], B[k]))
        if cap_start and len(rings[0]) > 1:
            bm.faces.new(list(reversed(rings[0])))
        if cap_end and len(rings[-1]) > 1:
            bm.faces.new(rings[-1])
        faces = self._new(before)
        for f in faces:
            f.normal_update()
        return faces

    def poly(self, coords):
        """One face from a list of coordinates."""
        vs = [self.bm.verts.new(Vector(c)) for c in coords]
        f = self.bm.faces.new(vs)
        f.normal_update()
        return [f]

    # ---- finalisation
    def build(self):
        """Triangulate, normalise colours per material (tint), create the object. Returns (obj, tris)."""
        bm = self.bm
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        tints = [[1e-4, 1e-4, 1e-4] for _ in self.mats]
        for f in bm.faces:
            t = tints[f.material_index]
            for lp in f.loops:
                c = lp[self.col]
                for i in range(3):
                    t[i] = max(t[i], c[i])
        for f in bm.faces:
            t = tints[f.material_index]
            for lp in f.loops:
                c = lp[self.col]
                lp[self.col] = (min(1.0, c[0] / t[0]), min(1.0, c[1] / t[1]), min(1.0, c[2] / t[2]), 1.0)
        tris = len(bm.faces)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        me.color_attributes.active_color_name = "Col"
        for i, (key, opt) in enumerate(self.mats):
            me.materials.append(make_material(f"{self.name}_{key}", tuple(tints[i]), **opt))
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj, tris


# --------------------------------------------------------------------------- point clouds
def ellipsoid_points(rnd, n, radii, center=(0, 0, 0), noise=0.18, rot_z=0.0, tilt=(0.0, 0.0)):
    """Evenly spread (golden spiral) points on an ellipsoid with radial noise -> chunky rock facets."""
    pts = []
    off = rnd.uniform(0, TAU)
    rot = Matrix.Rotation(rot_z, 3, "Z") @ Matrix.Rotation(tilt[0], 3, "X") @ Matrix.Rotation(tilt[1], 3, "Y")
    for i in range(n):
        z = 1.0 - 2.0 * (i + 0.5) / n
        rr = math.sqrt(max(0.0, 1.0 - z * z))
        a = off + i * GOLDEN + rnd.uniform(-0.25, 0.25)
        d = Vector((math.cos(a) * rr, math.sin(a) * rr, z))
        k = 1.0 - noise * rnd.random()
        p = Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * k
        pts.append(rot @ p + Vector(center))
    return pts
