"""Channel-pass rendering + periodic Geometry Nodes for tileable textures (terrain, water, foam...).

Idea ("photogrammetry in Blender"): build a real 3D ground patch — a Geometry-Nodes displaced grid whose height
field is PERIODIC (4D torus noise), plus scattered instances (pebbles, leaves, twigs, blades, setts...) whose
points are distributed on one tile and copied to the 8 neighbour tiles — then render it straight down with an
orthographic camera that frames exactly one tile. The result tiles perfectly by construction (no offset/blend
ghosting). Every material ends in an Emission shader whose colour is re-linked per pass:
    albedo · roughness · height (world Z + shader micro relief) · normal (world normal after bump) · AO
Top-down ortho => world X = tangent (u), world Y = bitangent (v): the world normal IS the tangent-space normal.
"""
import math

import bpy
import numpy as np

from ld_common import NB, TAU, pnoise, pvoronoi, sock, torus_coords  # noqa: F401

CHANNELS = ("albedo", "rough", "height", "normal", "ao")
_MATS = []


# =============================================================================== channel materials
class CM:
    """Channel material: build the pattern with self.nb, then call finish(albedo, rough, micro)."""

    def __init__(self, name):
        old = bpy.data.materials.get(name)
        if old:
            old.name = name + "_old"
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        nt = self.m.node_tree
        nt.nodes.clear()
        self.nb = NB(nt)
        self.out = self.nb.node("ShaderNodeOutputMaterial")
        self.em = self.nb.node("ShaderNodeEmission", Strength=1.0)
        self.nb.link(self.em.outputs[0], self.out.inputs["Surface"])
        self.geo = self.nb.node("ShaderNodeNewGeometry")
        self.pos = self.geo.outputs["Position"]
        tc = self.nb.node("ShaderNodeTexCoord")
        self.obj = tc.outputs["Object"]
        self.chans = {}

    def xy(self):
        """World position (for periodic ground patterns)."""
        return self.pos

    def rnd(self, name="rnd"):
        """Per-instance random stored on the scatter points (identical on the 9 tile copies)."""
        a = self.nb.node("ShaderNodeAttribute", {"attribute_type": "INSTANCER", "attribute_name": name})
        return a.outputs["Fac"]

    def finish(self, albedo, rough, micro=None, micro_dist=0.002, ao_dist=0.06, bump_strength=1.0):
        nb = self.nb
        normal = self.geo.outputs["Normal"]
        if micro is not None:
            b = nb.node("ShaderNodeBump", Strength=bump_strength, Distance=micro_dist, Height=micro)
            normal = b.outputs["Normal"]
        z = nb.sep(self.pos)[2]
        h = nb.add(z, nb.mul(micro, micro_dist)) if micro is not None else z
        ao = nb.node("ShaderNodeAmbientOcclusion", {"only_local": False, "samples": 16}, Distance=ao_dist)
        nb.feed(sock(ao.inputs, "Normal"), normal)
        self.chans = {
            "albedo": albedo if not isinstance(albedo, (str, tuple)) else nb.mix(albedo, albedo, 0.0),
            "rough": nb.xyz(rough, rough, rough),
            "height": nb.xyz(h, h, h),
            "normal": nb.vmath("ADD", nb.vmath("SCALE", normal, scale=0.5), (0.5, 0.5, 0.5)),
            "ao": nb.xyz(ao.outputs["AO"], ao.outputs["AO"], ao.outputs["AO"]),
        }
        self.set("albedo")
        _MATS.append(self)
        return self.m

    def set(self, ch):
        for l in list(self.em.inputs["Color"].links):
            self.m.node_tree.links.remove(l)
        self.nb.link(self.chans[ch], self.em.inputs["Color"])


def set_pass(ch):
    for c in _MATS:
        if c.m.name in bpy.data.materials:
            c.set(ch)


def reset_mats():
    _MATS.clear()


# =============================================================================== geometry nodes helpers
def gn_object(name, build, loc=(0, 0, 0)):
    """Empty mesh object with a GN modifier; build(nb, geo_in) -> geometry socket."""
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    g = bpy.data.node_groups.new(name + "_GN", "GeometryNodeTree")
    g.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    g.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nb = NB(g)
    gi = nb.node("NodeGroupInput")
    go = nb.node("NodeGroupOutput")
    out = build(nb, gi.outputs[0])
    nb.link(out, go.inputs[0])
    md = ob.modifiers.new("GN", "NODES")
    md.node_group = g
    return ob


def gpos(nb):
    return nb.node("GeometryNodeInputPosition").outputs[0]


def ground(name, T, hfun, mat, res_per_m=110, margin=0.12):
    """Displaced periodic ground patch covering the tile [0,T]^2 plus a margin. hfun(nb, pos) -> height (m)."""
    size = T * (1 + 2 * margin)
    n = int(size * res_per_m) + 1

    def build(nb, _g):
        grid = nb.node("GeometryNodeMeshGrid", **{"Size X": size, "Size Y": size, "Vertices X": n, "Vertices Y": n})
        tr = nb.node("GeometryNodeTransform", Geometry=grid.outputs["Mesh"], Translation=(T / 2, T / 2, 0))
        p = gpos(nb)
        h = hfun(nb, p)
        sp = nb.node("GeometryNodeSetPosition", Geometry=tr.outputs[0], Offset=nb.xyz(0, 0, h))
        sm = nb.node("GeometryNodeSetShadeSmooth", Geometry=sp.outputs[0])
        sm_ = nb.node("GeometryNodeSetMaterial", Geometry=sm.outputs[0])
        sm_.inputs["Material"].default_value = mat
        return sm_.outputs[0]
    return gn_object(name, build)


def template_collection(name, objs):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    for i, o in enumerate(objs):
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)
        o.location = (500 + i * 3, 500, -200)   # far outside the camera frustum; reset by Collection Info
    return col


def scatter(name, T, hfun, col, density, seed=0, dist_min=0.0, scale=(0.7, 1.3), tilt=0.15, embed=0.0,
            margin=0.12, zrot=True, flip=False, mask=None, count=None):
    """Scatter the objects of `col` over the tile (Poisson disk), copied to the 3x3 neighbour tiles so the result
    tiles; points sit on the periodic ground height hfun. mask(nb, pos) -> 0..1 optional density mask.
    Stores per-point 'rnd' (0..1) readable in shaders through CM.rnd()."""
    n_obj = len(col.objects)

    def build(nb, _g):
        grid = nb.node("GeometryNodeMeshGrid", **{"Size X": T, "Size Y": T, "Vertices X": 2, "Vertices Y": 2})
        tr = nb.node("GeometryNodeTransform", Geometry=grid.outputs["Mesh"], Translation=(T / 2, T / 2, 0))
        dp = nb.node("GeometryNodeDistributePointsOnFaces", {"distribute_method": "POISSON"}, Mesh=tr.outputs[0],
                     **{"Distance Min": dist_min, "Density Max": density, "Seed": seed})
        pts = dp.outputs["Points"]
        if mask is not None:
            # thin points by the mask (periodic fields only)
            rv = nb.node("FunctionNodeRandomValue", {"data_type": "FLOAT"}, Seed=seed + 101)
            keep = nb.math("LESS_THAN", nb.out(rv, "Value", "FLOAT"), mask(nb, gpos(nb)))
            dg = nb.node("GeometryNodeDeleteGeometry", {"domain": "POINT"}, Geometry=pts,
                         Selection=nb.math("SUBTRACT", 1.0, keep))
            pts = dg.outputs[0]
        # per-point randoms stored BEFORE duplication so the 9 copies are identical
        for attr, sd in (("rnd", 1), ("r2", 2), ("r3", 3), ("r4", 4)):
            rv = nb.node("FunctionNodeRandomValue", {"data_type": "FLOAT"}, Seed=seed * 7 + sd)
            st = nb.node("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT", "domain": "POINT"},
                         Geometry=pts, Name=attr, Value=nb.out(rv, "Value", "FLOAT"))
            pts = st.outputs[0]
        join = nb.node("GeometryNodeJoinGeometry")
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                t = nb.node("GeometryNodeTransform", Geometry=pts, Translation=(i * T, j * T, 0))
                nb.link(t.outputs[0], join.inputs[0])
        p = gpos(nb)
        s = nb.sep(p)
        m = margin * T
        out_x = nb.math("MAXIMUM", nb.math("LESS_THAN", s[0], -m), nb.math("GREATER_THAN", s[0], T + m))
        out_y = nb.math("MAXIMUM", nb.math("LESS_THAN", s[1], -m), nb.math("GREATER_THAN", s[1], T + m))
        dg = nb.node("GeometryNodeDeleteGeometry", {"domain": "POINT"}, Geometry=join.outputs[0],
                     Selection=nb.math("MAXIMUM", out_x, out_y))

        def na(n_):
            return nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT"}, Name=n_).outputs[0]
        r1, r2, r3, r4 = na("rnd"), na("r2"), na("r3"), na("r4")
        sc = nb.maprange(r2, 0, 1, scale[0], scale[1])
        z = nb.sub(hfun(nb, gpos(nb)), nb.mul(sc, embed))
        sp = nb.node("GeometryNodeSetPosition", Geometry=dg.outputs[0], Position=nb.xyz(s[0], s[1], z))
        ci = nb.node("GeometryNodeCollectionInfo", {"transform_space": "ORIGINAL"},
                     **{"Separate Children": True, "Reset Children": True})
        ci.inputs["Collection"].default_value = col
        rz = nb.mul(r3, TAU) if zrot else 0.0
        rx = nb.mul(nb.sub(r4, 0.5), 2 * tilt)
        ry = nb.mul(nb.sub(nb.math("FRACT", nb.mul(r4, 7.31)), 0.5), 2 * tilt)
        if flip:
            rx = nb.add(rx, nb.mul(nb.math("ROUND", nb.math("FRACT", nb.mul(r1, 13.7))), math.pi))
        rot = nb.node("FunctionNodeEulerToRotation", Euler=nb.xyz(rx, ry, rz))
        idx = nb.math("FLOOR", nb.mul(nb.math("FRACT", nb.mul(r1, 3.77)), n_obj - 0.001))
        iop = nb.node("GeometryNodeInstanceOnPoints", Points=sp.outputs[0], Instance=ci.outputs[0],
                      **{"Pick Instance": True, "Instance Index": idx, "Rotation": rot.outputs[0], "Scale": nb.xyz(sc, sc, sc)})
        return iop.outputs[0]
    return gn_object(name, build)


# =============================================================================== template meshes (bmesh)
def _obj_from_bm(name, bm, mat, smooth=True):
    import bmesh  # noqa: F401
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def pebble(name, mat, size=0.03, flat=0.55, rough=0.25, seed=0, subdiv=2):
    """Rounded irregular stone, origin at its base centre."""
    import bmesh
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    sx, sy = 1.0 + rng.uniform(-0.25, 0.35), 1.0 + rng.uniform(-0.3, 0.2)
    k = rng.normal(0, 1, (6, 3))
    for v in bm.verts:
        d = v.co.normalized()
        n = sum(math.sin(d.x * k[i, 0] * 2 + d.y * k[i, 1] * 2 + d.z * k[i, 2] * 2 + i) for i in range(6)) / 6
        r = 1.0 + rough * n
        v.co = (d.x * r * sx, d.y * r * sy, d.z * r * flat)
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z = (v.co.z - zmin) if v.co.z > zmin + 0.05 * flat else v.co.z - zmin + 0.0
        v.co *= size
    return _obj_from_bm(name, bm, mat)


def rounded_box(name, mat, dims=(0.2, 0.15, 0.1), bevel=0.35, seed=0, dome=0.2, jitter=0.05):
    """Cobble sett / flagstone: superellipsoid-ish rounded block, origin at base centre."""
    import bmesh
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    for _ in range(3):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    # round the corners: push towards a superellipsoid
    e = 2.0 / max(bevel, 0.05)
    for v in bm.verts:
        x, y, z = v.co
        r = (abs(x) ** e + abs(y) ** e + abs(z) ** e) ** (1 / e)
        s = 1.0 / max(r, 1e-6)
        v.co = (x * s, y * s, z * s)
    k = rng.normal(0, 1, (5, 3))
    for v in bm.verts:
        x, y, z = v.co
        n = sum(math.sin(x * k[i, 0] * 3 + y * k[i, 1] * 3 + z * k[i, 2] * 3 + i * 1.3) for i in range(5)) / 5
        top = max(0.0, z)
        v.co = (x * dims[0] / 2 * (1 + jitter * n), y * dims[1] / 2 * (1 + jitter * n),
                (z + dome * top * (1 - x * x) * (1 - y * y)) * dims[2] / 2 * (1 + jitter * n))
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z -= zmin
    return _obj_from_bm(name, bm, mat)


def blade(name, mat, length=0.08, width=0.004, bend=0.6, segs=5, seed=0, lie=0.0):
    """Grass blade strip (tapered, curved), origin at root."""
    import bmesh
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    prev = None
    side = rng.uniform(-0.3, 0.3)
    x = y = z = 0.0
    step = length / segs
    for i in range(segs + 1):
        t = i / segs
        w = width * (1 - t) ** 0.8 * 0.5 + 1e-5
        a = bm.verts.new((x - w, y, z))
        b = bm.verts.new((x + w, y, z))
        if prev:
            bm.faces.new((prev[0], prev[1], b, a))
        prev = (a, b)
        ang = lie + bend * t
        y += math.sin(ang) * step
        z += math.cos(ang) * step
        x += side * step * t * 0.4
    return _obj_from_bm(name, bm, mat)


def leaf(name, mat, length=0.07, width=0.035, lobes=0, curl=0.25, seed=0, res=14):
    """Flat leaf outline (ellipse / lobed oak), slight curl, lying on z=0, origin at centre."""
    import bmesh
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    pts = []
    for i in range(res * 2):
        t = i / (res * 2) * TAU
        # teardrop: wider near the base, pointed tip at +Y
        c, s = math.cos(t), math.sin(t)
        y = s * length / 2
        prof = (1 - s) ** 0.35 * (1 + s) ** 0.6 / 1.2
        xw = c * width / 2 * prof
        if lobes:
            xw *= 1.0 + 0.22 * math.cos(lobes * 2 * t)
        xw *= 1 + rng.uniform(-0.04, 0.04)
        pts.append((xw, y))
    center = bm.verts.new((0, 0, 0))
    vs = [bm.verts.new((x, y, curl * width * (2 * x / width) ** 2 * 0.5 + 0.01 * length * (y / length + 0.5) ** 2)) for x, y in pts]
    for i in range(len(vs)):
        bm.faces.new((center, vs[i], vs[(i + 1) % len(vs)]))
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if center in e.verts], cuts=2)
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z -= zmin - 0.0005
    return _obj_from_bm(name, bm, mat)


def stick(name, mat, length=0.15, radius=0.004, bend=0.2, seed=0, segs=6, sides=6, branch=True):
    """Twig / needle: bent tapered tube lying on the ground (along X), origin at centre."""
    import bmesh
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    rings = []
    ph = rng.uniform(0, TAU)
    for i in range(segs + 1):
        t = i / segs
        x = (t - 0.5) * length
        y = math.sin(t * math.pi + ph) * bend * length * 0.15
        r = radius * (1 - 0.5 * t)
        ring = [bm.verts.new((x, y + r * math.cos(a), r + r * math.sin(a))) for a in (j / sides * TAU for j in range(sides))]
        rings.append(ring)
    for i in range(segs):
        for j in range(sides):
            a, b = rings[i][j], rings[i][(j + 1) % sides]
            c, d = rings[i + 1][(j + 1) % sides], rings[i + 1][j]
            bm.faces.new((a, b, c, d))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return _obj_from_bm(name, bm, mat)


# =============================================================================== camera / render passes
def ortho_topdown(sc, T, res=1024, height=20.0):
    cd = bpy.data.cameras.new("Top")
    cd.type = "ORTHO"
    cd.ortho_scale = T
    cd.clip_start = 0.1
    cd.clip_end = height + 5.0
    cam = bpy.data.objects.new("Top", cd)
    sc.collection.objects.link(cam)
    cam.location = (T / 2, T / 2, height)
    cam.rotation_euler = (0, 0, 0)
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = res
    return cam
