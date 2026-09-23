"""Geometry + pipeline helpers for the nature group (trees, rocks, cliffs, small vegetation).

Built on the shared kit (assets/blender/kit): materials, Geometry Nodes builders, bake, LODs, QA, render.
Everything is seeded -> deterministic.

Main pieces
    grow_tree(spec, seed)            -> branches [{pts:[(Vector, r)], level}]  species-driven recursive generator
    trunk_high(branches, levels)     -> fused watertight trunk (curve sweep -> voxel remesh -> GN gnarl displace)
    tubes(branches, levels)          -> thin branch tubes (twigs) baked directly (kit_bake_direct)
    crown_shell(clumps)              -> lumpy canopy hull (union of blobs -> voxel remesh -> GN displace)
    scatter_cards(shell, templates)  -> GN scatter of alpha leaf cards on the hull (outer bright / inner dark rows)
    card_template / place_cards      -> quad (or V-folded) cards mapped to one quadrant of a 2x2 foliage atlas
    canopy_normals(obj, ...)         -> custom split normals of the leaf cards pointing out of the crown
    finish_static(...)               -> join -> export -> LODs -> QA -> QA sheets
"""
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import common as C
from kit import bake, export, gn, lod, qa, render
from kit import materials as M

TAU = math.tau
UP = Vector((0, 0, 1))


# =============================================================================== basic mesh utils
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh_obj(name, verts, faces, mat=None, uvs=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    if uvs is not None:
        uvl = me.uv_layers.new(name="UVMap")
        li = 0
        for f, fuv in zip(faces, uvs):
            for k in range(len(f)):
                uvl.data[li].uv = fuv[k]
                li += 1
    if mat is not None:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    me.update()
    return link(bpy.data.objects.new(name, me))


def dup(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    return link(c)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate_to(ob, target):
    t = tris(ob)
    if t > target:
        gn.decimate(ob, target / t)
        gn.apply(ob)
    return ob


def set_smooth(ob, smooth=True):
    for p in ob.data.polygons:
        p.use_smooth = smooth
    ob.data.update()


def ground(ob, sink=0.0):
    """Translate mesh so its lowest vertex sits at z = -sink."""
    mz = min(v.co.z for v in ob.data.vertices)
    for v in ob.data.vertices:
        v.co.z -= mz + sink
    ob.data.update()


def remove(*obs):
    for o in obs:
        if o is None:
            continue
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me is not None and getattr(me, "users", 1) == 0 and isinstance(me, bpy.types.Mesh):
            bpy.data.meshes.remove(me)


def assign_material(ob, mat, pred):
    """Append `mat` to ob and assign it to polygons where pred(poly_center, poly_normal) is true."""
    me = ob.data
    if mat.name not in [m.name for m in me.materials if m]:
        me.materials.append(mat)
    idx = [m.name if m else "" for m in me.materials].index(mat.name)
    n = 0
    for p in me.polygons:
        if pred(p.center, p.normal):
            p.material_index = idx
            n += 1
    me.update()
    return n


# =============================================================================== tree skeleton
def _perp(d):
    p = d.cross(Vector((0.31, 0.77, 0.12)))
    if p.length < 1e-4:
        p = d.cross(Vector((1, 0, 0)))
    return p.normalized()


def grow_tree(spec, seed=0):
    """Species-driven recursive branch generator.

    spec keys (defaults in brackets):
      height [5]         trunk length          radius [0.25]      trunk base radius
      trunk_segs [9]     lean [0.1]            gnarl [0.12]       persistent random turning of every branch
      levels [3]         children [(5,3,2)]    start [(0.4,0.95)] where level-1 children start along the trunk
      spread [(35,70)]   branching angle from the parent (deg)      up_bias [(0.3,0.25,0.2)]
      gravity [(0,0.05,0.12)] downward pull per level               length [(0.5,0.45,0.4)] child/parent length
      segs [(6,4,3)]     child_radius [0.55]  taper [0.72]           roots [0] number of root-flare roots
      root_len [1.0]     root_r [0.5]  (fraction of trunk radius)  whorls [0] conifer: children in whorls
      droop_tip [0]      extra downward pull toward branch tips (willow)
    Returns list of dict(pts=[(Vector, r)], level, parent)."""
    rnd = random.Random(seed)
    g = dict(height=5.0, radius=0.25, trunk_segs=9, lean=0.1, gnarl=0.12, levels=3, children=(5, 3, 2),
             start=(0.4, 0.95), spread=(35, 70), up_bias=(0.3, 0.25, 0.2), gravity=(0.0, 0.05, 0.12),
             length=(0.5, 0.45, 0.4), segs=(6, 4, 3), child_radius=0.55, taper=0.72, roots=0, root_len=1.0,
             root_r=0.5, whorls=0, droop_tip=0.0, min_r=0.006, trunks=1, trunk_spread=0.0)
    g.update(spec)
    out = []

    def lv(key, level):
        v = g[key]
        return v[min(level, len(v) - 1)] if isinstance(v, (tuple, list)) else v

    def grow(p0, d, length, r0, level, nseg, parent=None):
        d = d.normalized()
        turn = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * g["gnarl"]
        pts = []
        p = Vector(p0)
        seg = length / nseg
        for i in range(nseg + 1):
            t = i / nseg
            r = max(g["min_r"], r0 * (1.0 - g["taper"] * t))
            pts.append((p.copy(), r))
            if i < nseg:
                turn = turn * 0.6 + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * g["gnarl"]
                grav = lv("gravity", level) + g["droop_tip"] * t * (level > 0)
                d = (d + turn - UP * grav).normalized()
                if level == 0 and d.z < 0.5:
                    d = (d + UP * 0.3).normalized()
                p = p + d * seg
        br = dict(pts=pts, level=level, parent=parent)
        out.append(br)
        if level + 1 >= g["levels"]:
            return
        n = lv("children", level)
        base_ang = rnd.uniform(0, TAU)
        whorl = g["whorls"] if level == 0 else 0
        for c in range(n):
            if whorl:
                wi = c // whorl
                nw = max(1, n // whorl)
                t = g["start"][0] + (g["start"][1] - g["start"][0]) * (wi + rnd.uniform(-0.1, 0.1)) / max(1, nw - 1)
                ang = base_ang + (c % whorl) * TAU / whorl + wi * 0.7 + rnd.uniform(-0.25, 0.25)
            else:
                if level == 0:
                    t = g["start"][0] + (g["start"][1] - g["start"][0]) * (c + rnd.uniform(0.0, 0.8)) / n
                else:
                    t = rnd.uniform(0.3, 0.92)
                ang = base_ang + c * math.radians(137.5) + rnd.uniform(-0.3, 0.3)
            t = min(max(t, 0.02), 0.98)
            k = min(int(t * (len(pts) - 1)), len(pts) - 2)
            f = t * (len(pts) - 1) - k
            a, b = pts[k][0], pts[k + 1][0]
            pp = a.lerp(b, f)
            pr = pts[k][1] * (1 - f) + pts[k + 1][1] * f
            axis = (b - a).normalized()
            side = _perp(axis)
            side.rotate(Quaternion(axis, ang))
            sp = g["spread"]
            sp = sp[min(level, len(sp) - 1)] if isinstance(sp[0], (tuple, list)) else sp
            el = math.radians(rnd.uniform(*sp))
            nd = (axis * math.cos(el) + side * math.sin(el)).normalized()
            nd = (nd + UP * lv("up_bias", level)).normalized()
            cl = length * lv("length", level) * rnd.uniform(0.8, 1.15)
            if level == 0 and not whorl:
                cl *= (1.1 - 0.5 * t)
            if whorl:
                cl *= (1.15 - 0.85 * t)          # conifer: long low branches, short at the top
            cr = max(g["min_r"], pr * g["child_radius"] * rnd.uniform(0.85, 1.1))
            grow(pp - nd * cr * 0.5, nd, cl, cr, level + 1, lv("segs", level + 1), br)

    for ti in range(g["trunks"]):
        if g["trunks"] > 1:
            a = ti * TAU / g["trunks"] + rnd.uniform(-0.4, 0.4)
            base = Vector((math.cos(a), math.sin(a), 0)) * g["radius"] * 0.9
            d = Vector((math.cos(a) * g["trunk_spread"], math.sin(a) * g["trunk_spread"], 1.0))
            h = g["height"] * rnd.uniform(0.8, 1.0) * (1.0 if ti == 0 else 0.85)
            r = g["radius"] * (1.0 if ti == 0 else 0.8)
        else:
            base = Vector((0, 0, 0))
            la = rnd.uniform(0, TAU)
            d = Vector((math.cos(la) * g["lean"], math.sin(la) * g["lean"], 1.0))
            h, r = g["height"], g["radius"]
        grow(base + Vector((0, 0, -0.12)), d, h, r, 0, g["trunk_segs"])
    # root flare: roots leave the trunk at ~0.35 m and dive under the ground
    for i in range(g["roots"]):
        a = i * TAU / g["roots"] + rnd.uniform(-0.3, 0.3)
        dirv = Vector((math.cos(a), math.sin(a), 0))
        r0 = g["radius"] * g["root_r"] * rnd.uniform(0.8, 1.15)
        L = g["root_len"] * rnd.uniform(0.75, 1.2)
        pts = []
        for k in range(6):
            t = k / 5
            rad = g["radius"] * 0.35 + L * t
            z = 0.42 * g["radius"] * 1.6 * (1 - t) ** 1.6 - 0.1 * t - 0.03
            side = dirv.cross(UP) * math.sin(t * 3 + i) * 0.08 * L
            pts.append((dirv * rad + side + Vector((0, 0, z)), max(0.02, r0 * (1 - 0.8 * t))))
        out.append(dict(pts=pts, level=-1, parent=None))
    return out


def branch_splines(branches, levels):
    return [[(p.x, p.y, p.z, r) for p, r in b["pts"]] for b in branches if b["level"] in levels]


def tips(branches, levels=None, along=(0.5, 1.0)):
    """(position, direction) samples along the outer part of branches (leaf anchors)."""
    out = []
    for b in branches:
        if levels is not None and b["level"] not in levels:
            continue
        pts = b["pts"]
        n = len(pts)
        for i in range(n):
            t = i / (n - 1)
            if along[0] <= t <= along[1]:
                d = (pts[min(i + 1, n - 1)][0] - pts[max(i - 1, 0)][0]).normalized()
                out.append((pts[i][0].copy(), d))
    return out


# =============================================================================== trunk meshes
def sweep(splines, mat, profile_res=10, resolution=4, name="Sweep"):
    cu = gn.make_curve(splines, name, kind="BEZIER", resolution=resolution)
    gn.curve_to_mesh(cu, radius=1.0, profile_res=profile_res, material=mat)
    ob = gn.apply(cu)
    ob.name = name
    return ob


def trunk_high(branches, levels, mat, voxel=0.025, gnarl=0.05, gnarl_scale=1.6, seed=0, profile_res=12,
               ridges=0.0, name="_TrunkHigh", sink=None):
    """Fused, watertight high-poly trunk: sweep -> voxel remesh (one continuous surface: roots, trunk and limbs
    merge with real fillets) -> GN displacement (gnarl + vertical bark ridges)."""
    ob = sweep(branch_splines(branches, levels), mat, profile_res=profile_res, resolution=5, name=name)
    gn.voxel_remesh(ob, voxel=voxel, smooth_iters=4)
    gn.apply(ob)
    if gnarl > 0:
        gn.displace(ob, strength=gnarl, scale=gnarl_scale, detail=4, rough=0.55, seed=seed, voronoi=0.25)
        gn.apply(ob)
    if ridges > 0:
        bark_ridges(ob, ridges, seed=seed)
        gn.apply(ob)
    set_smooth(ob)
    if not ob.data.materials:
        ob.data.materials.append(mat)
    return ob


def bark_ridges(ob, strength=0.02, scale=9.0, seed=0, name="NatBarkRidges"):
    """GN: vertical bark ridges/furrows (noise stretched along Z) displaced along the normal."""
    from kit.nodes import NB, sock
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nb = NB(ng)
    gi, go = nb.node("NodeGroupInput"), nb.node("NodeGroupOutput")
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    p = nb.vmath("MULTIPLY", nb.vmath("ADD", pos, (seed * 1.7, seed * 0.3, 0)), (scale, scale, scale * 0.12))
    vo = nb.voronoi(p, 1.0, "DISTANCE_TO_EDGE", rand=1.0)
    n = nb.noise(p, 1.0, 3.0, 0.5).outputs["Fac"]
    h = nb.add(nb.maprange(vo.outputs["Distance"], 0.0, 0.25, 0.0, 1.0, "SMOOTHSTEP"), nb.mul(n, 0.3))
    off = nb.vmath("SCALE", nrm, scale=nb.mul(nb.sub(h, 0.6), strength))
    sp = nb.node("GeometryNodeSetPosition", Geometry=gi.outputs[0], Offset=off)
    nb.link(sp.outputs[0], go.inputs[0])
    md = ob.modifiers.new(name, "NODES")
    md.node_group = ng
    return md


def trunk_low(high, target, name="Trunk"):
    low = dup(high, name)
    decimate_to(low, target)
    set_smooth(low)
    return low


def twig_bark(mat):
    """Low-frequency copy of a bark material for thin twig tubes: their UV islands are only a few texels wide, so a
    high-frequency bark pattern would jump across every island border (visible seams)."""
    kind = mat.get("kit", "bark_oak").replace("bark_", "") if str(mat.get("kit", "")).startswith("bark_") else "oak"
    tw = M.bark("TwigBark", kind if kind in ("oak", "pine", "birch", "dead") else "oak", seed=1, scale=0.25, dirt=0.0,
                moss=0.0, bump=0.4)
    return tw


def tubes(branches, levels, mat, profile_res=5, resolution=2, name="Twigs"):
    spl = branch_splines(branches, levels)
    if not spl:
        return None
    ob = sweep(spl, twig_bark(mat), profile_res=profile_res, resolution=resolution, name=name)
    ob["kit_bake_direct"] = 1
    return ob


# =============================================================================== canopy
def blob_union(clumps, voxel=0.12, seed=0, noise=0.25, noise_scale=1.3, name="_Crown", subdiv=2):
    """Union of ellipsoid blobs [(centre, (rx,ry,rz))] fused into one lumpy hull (voxel remesh + GN displace)."""
    obs = []
    for i, (c, r) in enumerate(clumps):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1.0, location=tuple(c))
        o = bpy.context.object
        o.scale = tuple(r) if isinstance(r, (tuple, list)) else (r, r, r)
        C.apply_transforms(o)
        obs.append(o)
    ob = C.join(obs, name) if len(obs) > 1 else obs[0]
    ob.name = name
    gn.voxel_remesh(ob, voxel=voxel, smooth_iters=6)
    gn.apply(ob)
    if noise > 0:
        gn.displace(ob, strength=noise, scale=noise_scale, detail=3, rough=0.5, seed=seed, voronoi=0.5)
        gn.apply(ob)
    return ob


def card_template(name, mat, w, h, quad=(0, 1), pivot="center", fold=0.18, plane="XY", inset=0.004, segs=1,
                  bend=0.0):
    """Leaf card template mapped to atlas quadrant `quad` = (column, row) of a 2x2 atlas.
    plane XY: card lies flat, normal +Z (canopy cards: GN scatter aligns Z to the hull normal), long axis +Y.
    plane XZ: vertical card standing on its base (grass / reeds / curtains), normal -Y.
    fold: V-fold depth (fraction of width) along the card's long axis (gives volume under light).
    segs: subdivisions along the long axis (bend > 0 curls the card toward its normal)."""
    col, row = quad
    u0, u1 = col * 0.5 + inset, col * 0.5 + 0.5 - inset
    v0, v1 = row * 0.5 + inset, row * 0.5 + 0.5 - inset
    verts, faces, uvs = [], [], []
    y0 = -h / 2 if pivot == "center" else 0.0
    for i in range(segs + 1):
        t = i / segs
        y = y0 + h * t
        z = bend * (t ** 2) * h
        for j, xs in enumerate((-0.5, 0.0, 0.5)):
            fz = fold * w if xs == 0.0 else 0.0
            verts.append((xs * w, y, z + fz))
    for i in range(segs):
        for j in range(2):
            a = i * 3 + j
            faces.append((a, a + 1, a + 4, a + 3))
            uvs.append([(u0 + (u1 - u0) * (j * 0.5), v0 + (v1 - v0) * (i / segs)),
                        (u0 + (u1 - u0) * ((j + 1) * 0.5), v0 + (v1 - v0) * (i / segs)),
                        (u0 + (u1 - u0) * ((j + 1) * 0.5), v0 + (v1 - v0) * ((i + 1) / segs)),
                        (u0 + (u1 - u0) * (j * 0.5), v0 + (v1 - v0) * ((i + 1) / segs))])
    if plane == "XZ":
        verts = [(x, -z, y) for x, y, z in verts]
    ob = mesh_obj(name, verts, faces, mat, uvs, smooth=True)
    ob["kit_open"] = 1
    return ob


def scatter_cards(shell, templates, density, seed=0, scale=(0.8, 1.2), rot=(0.5, 0.5, math.pi), embed=0.0,
                  distance_min=0.0, up_min=None, name="Leaves"):
    """GN scatter of leaf-card templates (random pick) on the hull surface, card normal = hull normal."""
    target = dup(shell, name)
    gn.scatter(target, list(templates) if len(templates) > 1 else templates[0], density=density, seed=seed,
               scale=scale, rot_random=rot, embed=embed, keep_target=False, distance_min=distance_min, up_min=up_min,
               name="NatCards_" + name)
    ob = gn.apply(target)
    ob.name = name
    ob["kit_open"] = 1
    return ob


def place_cards(frames, templates, rnd, name="Cards"):
    """Python placement: frames = [(pos, x_axis, y_axis, z_axis, scale)], template picked at random.
    Templates are read in their local space (x across, y along, z normal)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    tpl_data = []
    for t in templates:
        me = t.data
        tpl_data.append(([v.co.copy() for v in me.vertices], [(list(p.vertices), [me.uv_layers[0].data[li].uv.copy() for li in p.loop_indices]) for p in me.polygons]))
    for (pos, xa, ya, za, s) in frames:
        vs, fs = tpl_data[rnd.randrange(len(tpl_data))]
        m = Matrix((xa, ya, za)).transposed()
        bv = [bm.verts.new(pos + m @ (v * s)) for v in vs]
        for idx, fuv in fs:
            f = bm.faces.new([bv[i] for i in idx])
            f.smooth = True
            for l, uv in zip(f.loops, fuv):
                l[uvl].uv = uv
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(templates[0].data.materials[0])
    ob = link(bpy.data.objects.new(name, me))
    ob["kit_open"] = 1
    return ob


def frame_from(normal, along):
    """Orthonormal (x, y, z) with z = normal and y as close as possible to `along`."""
    z = Vector(normal).normalized()
    y = Vector(along) - z * Vector(along).dot(z)
    if y.length < 1e-4:
        y = _perp(z)
    y.normalize()
    x = y.cross(z).normalized()
    return x, y, z


def cards_outward(ob, centre):
    """Flip cards (islands) whose normal faces the crown centre so their front faces point outward."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    flip = []
    for f in bm.faces:
        if f.index in seen:
            continue
        isl, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        c = sum((g.calc_center_median() for g in isl), Vector()) / len(isl)
        n = sum((g.normal for g in isl), Vector())
        cc = Vector(centre) if not callable(centre) else centre(c)
        if n.dot(c - cc) < 0:
            flip += isl
    bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(flip)


def canopy_normals(ob, centre, radii, blend=0.75, mat_prefix=("Leaf", "Foliage", "Grass"), up=0.0):
    """Custom split normals: foliage faces get the direction from the crown centre (ellipsoid-scaled), blended with
    their face normal -> the whole canopy shades like one volume (soft, no flat-card look). Other faces keep
    their current normals."""
    me = ob.data
    me.update()
    cn = [Vector(n.vector) for n in me.corner_normals]
    fol = set(i for i, m in enumerate(me.materials) if m and m.name.startswith(mat_prefix))
    c = Vector(centre)
    r = Vector(radii)
    out = list(cn)
    for p in me.polygons:
        if p.material_index not in fol:
            continue
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            d = Vector(((v.x - c.x) / r.x, (v.y - c.y) / r.y, (v.z - c.z) / r.z))
            if d.length < 1e-4:
                d = UP.copy()
            d = Vector((d.x / r.x, d.y / r.y, d.z / r.z)).normalized()       # ellipsoid gradient
            fn = Vector(p.normal)
            if fn.dot(d) < 0:
                fn = -fn
            n = (d * blend + fn * (1 - blend) + UP * up).normalized()
            out[li] = n
    me.normals_split_custom_set([tuple(n) for n in out])
    me.update()


def keep_normals(ob):
    """Freeze the current corner normals as custom normals (so a later join keeps them)."""
    me = ob.data
    me.normals_split_custom_set([tuple(n.vector) for n in me.corner_normals])


# =============================================================================== materials (nature-specific, shader nodes)
def endgrain(name="EndGrain", color="#9a7a55", color2="#5d432b", axis="Z", centre=(0, 0), seed=0, scale=1.0):
    """Cut wood end: growth rings around the log axis, radial cracks, darker weathered rim."""
    from kit.nodes import NB
    m, nb, bsdf = M._new(name, "endgrain")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    if axis == "Z":
        a, b = nb.sub(s[0], centre[0]), nb.sub(s[1], centre[1])
    else:
        a, b = nb.sub(s[1], centre[0]), nb.sub(s[2], centre[1])
    r = nb.vmath("LENGTH", nb.xyz(a, b, 0.0))
    th = nb.math("ARCTAN2", b, a)
    wob = nb.noise(nb.xyz(a, b, seed), 3.0, 3.0, 0.5).outputs["Fac"]
    rr = nb.add(r, nb.mul(wob, 0.03))
    rings = nb.math("FRACT", nb.mul(rr, 38.0 * scale))
    ring = nb.maprange(rings, 0.75, 0.95, 0.0, 1.0, "SMOOTHSTEP")
    crack = nb.maprange(nb.math("ABSOLUTE", nb.math("SINE", nb.mul(nb.add(th, nb.mul(wob, 0.6)), 5.0))), 0.0, 0.05, 1.0, 0.0)
    crack = nb.mul(crack, nb.maprange(r, 0.03, 0.12))
    fine = nb.noise(nb.vmath("SCALE", tc, scale=40.0), 1.0, 6.0, 0.6).outputs["Fac"]
    col = nb.mix(color, color2, nb.add(nb.mul(ring, 0.6), nb.mul(fine, 0.3)))
    col = nb.mix(col, "#2a1d12", nb.mul(crack, 0.9))
    col = nb.mix(col, nb.mix(col, "#6d6a60", 0.5), nb.maprange(fine, 0.55, 0.75))      # grey weathering
    h = nb.sub(nb.sub(nb.mul(fine, 0.3), nb.mul(ring, 0.2)), nb.mul(crack, 0.5))
    return M._finish(m, nb, bsdf, col, 0.85, h, bump=1.0, bump_dist=0.01, dirt=0.4, moss=0.15, vec=tc)


def palm_bark(name="PalmBark", seed=0):
    """Palm trunk: stacked leaf-scar rings (along Z), fibrous brown-grey, frayed fibres between rings."""
    m, nb, bsdf = M._new(name, "palm_bark")
    v = M.coords(nb, "OBJECT", 1.0, seed)
    s = nb.sep(v)
    nz = nb.noise(v, 2.0, 3.0, 0.5).outputs["Fac"]
    ring = nb.math("FRACT", nb.mul(nb.add(s[2], nb.mul(nz, 0.05)), 5.5))
    lip = nb.maprange(ring, 0.0, 0.25, 1.0, 0.0, "SMOOTHSTEP")                # overhanging scar lip
    fib = nb.noise(nb.vmath("MULTIPLY", v, (40.0, 40.0, 3.0)), 1.0, 4.0, 0.6).outputs["Fac"]
    h = nb.add(nb.mul(nb.sub(1.0, ring), 0.6), nb.mul(fib, 0.3))
    col = nb.mix("#6b5e4c", "#3a3024", nb.add(nb.mul(lip, 0.6), nb.mul(fib, 0.4)))
    col = nb.mix(col, "#8f8674", nb.mul(nb.maprange(nz, 0.55, 0.75), 0.5))
    return M._finish(m, nb, bsdf, col, 0.9, h, bump=1.0, bump_dist=0.02, dirt=0.5, vec=v)


def cactus_skin(name="Cactus", seed=0):
    """Saguaro skin: waxy green ribs, darker grooves, areoles (spine dots) along the rib crests, dry base."""
    m, nb, bsdf = M._new(name, "cactus")
    v = M.coords(nb, "OBJECT", 1.0, seed)
    s = nb.sep(v)
    fine = nb.noise(nb.vmath("SCALE", v, scale=18.0), 1.0, 5.0, 0.6).outputs["Fac"]
    big = nb.noise(nb.vmath("SCALE", v, scale=1.5), 1.0, 3.0, 0.5).outputs["Fac"]
    # areoles: small voronoi dots, visible only on rib crests (edge/convexity via the 'wear' attribute)
    ar = nb.voronoi(nb.vmath("MULTIPLY", v, (14.0, 14.0, 9.0)), 1.0, "F1", rand=0.6).outputs["Distance"]
    dot = nb.maprange(ar, 0.16, 0.08)
    crest = nb.maprange(M._attr(nb, "wear"), 0.15, 0.5)
    groove = M._attr(nb, "cavity")
    dotm = nb.mul(dot, crest)
    streak = nb.noise(nb.vmath("MULTIPLY", v, (9.0, 9.0, 0.6)), 1.0, 4.0, 0.55).outputs["Fac"]   # vertical streaks
    col = M._pal(nb, nb.add(nb.mul(big, 0.5), nb.mul(fine, 0.3)), ["#2a3524", "#3f4d33", "#58623f"])
    col = nb.mix(col, nb.mix(col, "#8a8a66", 0.45), nb.mul(nb.maprange(streak, 0.55, 0.75), 0.6))   # sun-bleached
    scar = nb.mul(nb.maprange(nb.noise(nb.vmath("SCALE", v, scale=3.0), 1.0, 6.0, 0.6).outputs["Fac"], 0.66, 0.72),
                  nb.maprange(s[2], 0.3, 1.2, 1.0, 0.2))
    col = nb.mix(col, "#5a4a36", nb.mul(scar, 0.8))                                          # corky scars
    col = nb.mix(col, "#1a2413", nb.mul(nb.maprange(groove, 0.1, 0.6), 0.7))
    col = nb.mix(col, nb.mix(col, "#9aa27a", 0.5), nb.mul(crest, 0.35))                  # dusty crests
    col = nb.mix(col, "#d8cfb8", nb.mul(dotm, 0.9))                                         # spines / areoles
    base = nb.maprange(s[2], 0.0, 0.5, 1.0, 0.0)
    col = nb.mix(col, "#6e5a43", nb.mul(base, nb.maprange(fine, 0.3, 0.6, 0.4, 0.9)))   # dry corky base
    rough = nb.mixf(0.5, 0.85, nb.clamp01(nb.add(nb.add(nb.mul(dotm, 1.0), base), scar)))
    h = nb.add(nb.add(nb.mul(fine, 0.3), nb.mul(dotm, 0.6)), nb.mul(scar, 0.25))
    return M._finish(m, nb, bsdf, col, rough, h, bump=1.0, bump_dist=0.01, dirt=0.35, vec=v, coat=0.15)


def mushroom_mat(name="Mushroom", cap="#3a2446", cap2="#6a3a6e", glow="#63e6c8", strength=5.0, seed=0):
    """Swamp mushroom: dark velvety caps with glowing spots, glowing gills underneath, pale stems.
    Reads per-vertex attributes written by the builder: 'cap' (1 on caps) and 'under' (1 on the gill side)."""
    m, nb, bsdf = M._new(name, "mushroom")
    v = M.coords(nb, "OBJECT", 1.0, seed)
    capm = M._attr(nb, "cap")
    under = M._attr(nb, "under")
    ang = M._attr(nb, "ang")
    fine = nb.noise(nb.vmath("SCALE", v, scale=30.0), 1.0, 5.0, 0.6).outputs["Fac"]
    spots = nb.voronoi(nb.vmath("SCALE", v, scale=22.0), 1.0, "F1", rand=1.0).outputs["Distance"]
    spot = nb.mul(nb.maprange(spots, 0.2, 0.1), nb.mul(capm, nb.sub(1.0, under)))
    gills = nb.maprange(nb.math("ABSOLUTE", nb.math("SINE", nb.mul(ang, 60.0))), 0.0, 0.5, 1.0, 0.0)
    gm = nb.mul(under, capm)
    stem_col = nb.mix("#b9b29a", "#6c6450", nb.mul(fine, 0.6))
    cap_col = nb.mix(nb.mix(cap, cap2, fine), "#15101a", nb.mul(nb.maprange(fine, 0.6, 0.8), 0.5))
    col = nb.mix(stem_col, cap_col, capm)
    col = nb.mix(col, "#cfe8d8", spot)
    col = nb.mix(col, nb.mix("#2a3a3a", glow, gills), gm)
    emis = nb.mix((0, 0, 0), glow, nb.clamp01(nb.add(nb.mul(spot, 0.9), nb.mul(gm, nb.add(0.25, nb.mul(gills, 0.75))))))
    rough = nb.mixf(0.7, 0.45, capm)
    h = nb.add(nb.mul(fine, 0.4), nb.mul(spot, 0.3))
    h = nb.sub(h, nb.mul(nb.mul(gm, nb.sub(1.0, gills)), 0.4))
    return M._finish(m, nb, bsdf, col, rough, h, bump=1.0, bump_dist=0.004, emission=emis, emit_strength=strength,
                     vec=v, dirt=0.3, sss=0.1)


def add_snow(mat, amount=1.0, attr="snow", up_lo=0.45, up_hi=0.8):
    """Overlay packed snow on an existing kit material: up-facing mask x noise (+ 'snow' GN attribute).
    Blends base colour, roughness and normal (snow smooths the rock bump)."""
    from kit.nodes import NB, sock
    nb = NB(mat.node_tree)
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    v = M.coords(nb, "OBJECT", 1.0, 5)
    n = nb.noise(nb.vmath("SCALE", v, scale=2.2), 1.0, 6.0, 0.6).outputs["Fac"]
    upm = M.up_mask(nb, up_lo, up_hi)
    sm = nb.mul(upm, nb.maprange(n, 0.62 - 0.35 * amount, 0.7 - 0.35 * amount))
    sm = nb.math("MAXIMUM", sm, M._attr(nb, attr))
    sm = nb.clamp01(sm)
    grain = nb.noise(nb.vmath("SCALE", v, scale=60.0), 1.0, 3.0, 0.5).outputs["Fac"]
    scol = nb.mix("#e4ebf2", "#a7b9cc", nb.add(nb.mul(M.cavity_mask(nb, 0.2), 0.6), nb.mul(grain, 0.2)))
    bi = sock(bsdf.inputs, "Base Color")
    nb.feed(bi, nb.mix(bi.links[0].from_socket if bi.is_linked else bi.default_value[:], scol, sm))
    ri = sock(bsdf.inputs, "Roughness")
    nb.feed(ri, nb.mixf(ri.links[0].from_socket if ri.is_linked else ri.default_value,
                        nb.maprange(grain, 0.3, 0.7, 0.45, 0.8), sm))
    ni = sock(bsdf.inputs, "Normal")
    if ni.is_linked:
        prev = ni.links[0].from_socket
        sb = nb.node("ShaderNodeBump", Strength=0.25, Distance=0.02, Height=nb.noise(nb.vmath("SCALE", v, scale=6.0), 1.0, 4.0, 0.5).outputs["Fac"])
        nb.feed(ni, nb.mix(prev, sb.outputs["Normal"], sm, typ="VECTOR"))
    return mat


# =============================================================================== rocks
def rock_hull(shape, seed=0, cuts=9, depth=(0.03, 0.09), disp=0.18, disp_scale=1.4, strata=0.08, strata_scale=5.0,
              voronoi=0.45, subdiv=3, name="_RockHigh", blob=0.25, blob_scale=0.7):
    """High-poly rock from a base mesh object `shape` (consumed): GN low-frequency blob deformation (breaks the
    primitive silhouette) + planar fracture cuts + displacement."""
    if blob > 0:
        gn.displace(shape, strength=blob, scale=blob_scale, detail=1.5, rough=0.4, seed=seed + 101, voronoi=0.0,
                    name="KitBlob")
        gn.apply(shape)
    gn.planar_cuts(shape, cuts=cuts, depth=depth, seed=seed, subdiv=subdiv)
    gn.displace(shape, strength=disp, scale=disp_scale, detail=9, rough=0.6, seed=seed, voronoi=voronoi,
                vor_scale=disp_scale * 0.8, strata=strata, strata_scale=strata_scale)
    gn.apply(shape)
    shape.name = name
    set_smooth(shape)
    return shape


def moss_clumps(target, mat, density=9.0, up_min=0.7, scale=(0.5, 1.3), size=0.11, seed=5, distance_min=0.14,
                embed=0.018, name="MossScatter"):
    """GN scatter of flattened displaced moss clumps on up-facing parts of `target` (baked directly)."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=size)
    clump = bpy.context.object
    clump.name = "_MossClumpTpl"
    clump.scale = (1.0, 0.75, 0.22)
    C.apply_transforms(clump)
    set_smooth(clump)
    clump.data.materials.append(mat)
    gn.displace(clump, strength=size * 0.45, scale=22.0 * 0.11 / size, detail=4, voronoi=0.0, seed=seed)
    gn.decimate(clump, 0.35)
    gn.apply(clump)
    ob = dup(target, name)
    ob.modifiers.clear()
    gn.scatter(ob, clump, density=density, up_min=up_min, scale=scale, rot_random=(0.1, 0.1, 3.14), embed=embed,
               seed=seed, keep_target=False, distance_min=distance_min, name="NatMoss_" + name)
    gn.apply(ob)
    gn.remove(clump)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    ob["kit_bake_direct"] = 1
    if not ob.data.polygons:
        remove(ob)
        return None
    return ob


# =============================================================================== LODs / pipeline
def _split_by_material(ob, prefixes):
    """Face indices of `ob` whose material name starts with one of `prefixes`."""
    idx = {i for i, m in enumerate(ob.data.materials) if m and m.name.startswith(prefixes)}
    return [p.index for p in ob.data.polygons if p.material_index in idx]


def foliage_lod(ob, keep=0.5, grow=1.3, seed=0, prefixes=("Leaf", "Foliage", "Grass")):
    """Drop a fraction of the foliage cards (whole islands) and enlarge the survivors to keep coverage."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    fol = {i for i, m in enumerate(ob.data.materials) if m and m.name.startswith(prefixes)}
    seen, kill = set(), []
    for f in bm.faces:
        if f.material_index not in fol or f.index in seen:
            continue
        isl, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if rnd.random() > keep:
            kill += isl
        else:
            verts = {v for g in isl for v in g.verts}
            c = sum((v.co for v in verts), Vector()) / len(verts)
            for v in verts:
                v.co = c + (v.co - c) * grow
    killv = {v for g in kill for v in g.verts}
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def tree_lods(key, ob, out_dir, trunk_ratio=0.35, keep=0.5, grow=1.3, impostor=True, impostor_size=512, seed=0):
    """LOD1: decimated wood + half of the leaf cards (enlarged); LOD2: crossed impostor cards (kit)."""
    infos = []
    c = dup(ob, ob.name + "_lod1")
    foliage_lod(c, keep, grow, seed)
    # decimate only the wood: collapse with a vertex group on non-foliage faces
    fol = set(_split_by_material(c, ("Leaf", "Foliage", "Grass")))
    vg = c.vertex_groups.new(name="wood")
    wood_v = {v for p in c.data.polygons if p.index not in fol for v in p.vertices}
    fol_v = {v for p in c.data.polygons if p.index in fol for v in p.vertices}
    vg.add(list(wood_v - fol_v), 1.0, "REPLACE")
    n_wood = sum(len(p.vertices) - 2 for p in c.data.polygons if p.index not in fol)
    n_all = tris(c)
    md = c.modifiers.new("NatLOD", "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.use_collapse_triangulate = True
    md.vertex_group = "wood"
    md.ratio = max(0.05, (n_all - n_wood * (1 - trunk_ratio)) / max(1, n_all))
    gn.apply(c)
    made = lod.downscale_materials([c], 0.5, "_lod1")
    infos.append(export.export_glb(key, out_dir, objects=[c], budget=None, animations=False, suffix="_lod1"))
    remove(c)
    for mc in made[0]:
        bpy.data.materials.remove(mc)
    for im in made[1]:
        bpy.data.images.remove(im)
    if impostor:
        imp = lod.impostor([ob], key, impostor_size)
        infos.append(export.export_glb(key, out_dir, objects=[imp], budget=None, animations=False, suffix="_lod2"))
        remove(imp)
    else:
        c2 = dup(ob, ob.name + "_lod2")
        foliage_lod(c2, 0.3, 1.6, seed + 1)
        decimate_to(c2, max(200, int(tris(ob) * 0.1)))
        made = lod.downscale_materials([c2], 0.25, "_lod2")
        infos.append(export.export_glb(key, out_dir, objects=[c2], budget=None, animations=False, suffix="_lod2"))
        remove(c2)
        for mc in made[0]:
            bpy.data.materials.remove(mc)
        for im in made[1]:
            bpy.data.images.remove(im)
    return infos


def finish_static(key, ob, args, budget, expected=None, lods="mesh", tol=0.25, open_ok=None, hero_yaw=35.0,
                  lod_seed=0, grounded=True):
    """Export + LODs + QA + sheets for one baked, joined mesh object. lods: 'mesh' (kit decimation), 'tree'
    (foliage-aware LOD1 + impostor LOD2), 'plant' (foliage-aware LOD1/LOD2, no impostor)."""
    info = export.export_glb(key, args.out, objects=[ob], budget=budget)
    if lods == "mesh":
        linfo = lod.export_lods(key, [ob], args.out)
    elif lods == "tree":
        linfo = tree_lods(key, ob, args.out, seed=lod_seed)
    else:
        linfo = tree_lods(key, ob, args.out, impostor=False, seed=lod_seed)
    rep = qa.run(key, [ob], budget=budget, expected=expected, tol=tol, glb=info, open_ok=open_ok, grounded=grounded)
    rep["info"]["lods"] = [(l["path"].replace("\\", "/").split("/")[-1], l["tris"], l["bytes"]) for l in linfo]
    qa.save(rep, args.previews)
    if not args.no_preview:
        render.qa_sheets(key, [ob], args.previews, poses=False)
    return rep


def snow_cap(ob, thickness=0.08, seed=0, lo=0.35, hi=0.8, name="NatSnowCap"):
    """GN: grow a snow layer on up-facing surfaces (offset along normal+up, noisy edge) and store the 'snow'
    attribute (read by add_snow materials). Applied immediately."""
    from kit.nodes import NB, sock
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nb = NB(ng)
    gi, go = nb.node("NodeGroupInput"), nb.node("NodeGroupOutput")
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    z = nb.sep(nrm)[2]
    n = nb.noise(nb.vmath("ADD", pos, (seed, seed * 2.0, 0)), 1.8, 4.0, 0.55).outputs["Fac"]
    m = nb.mul(nb.smooth(z, lo, hi), nb.maprange(n, 0.3, 0.5))
    m = nb.math("POWER", m, 0.6)
    off = nb.vmath("SCALE", nb.vmath("NORMALIZE", nb.vmath("ADD", nrm, (0, 0, 1.0))), scale=nb.mul(m, thickness))
    sp = nb.node("GeometryNodeSetPosition", Geometry=gi.outputs[0], Offset=off)
    st = nb.node("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT", "domain": "POINT"}, Geometry=sp.outputs[0],
                 Name="snow")
    nb.feed(sock(st.inputs, "Value", "VALUE"), nb.smooth(m, 0.2, 0.5))
    nb.link(st.outputs[0], go.inputs[0])
    md = ob.modifiers.new(name, "NODES")
    md.node_group = ng
    gn.apply(ob)
    return ob


def recentre(branches, z0=0.4, z1=None, target=(0.0, 0.0)):
    """Shear the skeleton so the crown (all branch points above z0) is centred over the trunk base, keeping the base
    at the origin: p.xy -= offset * smoothstep(z0, z1, p.z)."""
    pts = [p for b in branches if b["level"] >= 1 for p, r in b["pts"]]
    if not pts:
        return branches
    cx = sum(p.x for p in pts) / len(pts) - target[0]
    cy = sum(p.y for p in pts) / len(pts) - target[1]
    z1 = z1 or max(p.z for p in pts) * 0.7
    for b in branches:
        new = []
        for p, r in b["pts"]:
            t = min(1.0, max(0.0, (p.z - z0) / max(1e-3, z1 - z0)))
            t = t * t * (3 - 2 * t)
            new.append((Vector((p.x - cx * t, p.y - cy * t, p.z)), r))
        b["pts"] = new
    return branches


def terraces(ob, step=0.28, depth=0.06, jitter=0.35, seed=0, name="NatTerraces"):
    """GN sandstone layering: every horizontal layer of height `step` recedes inward toward its top (along the
    horizontal part of the normal) then juts out again -> stacked ledges with small overhangs. Applied."""
    from kit.nodes import NB
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nb = NB(ng)
    gi, go = nb.node("NodeGroupInput"), nb.node("NodeGroupOutput")
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    ps = nb.sep(pos)
    ns = nb.sep(nrm)
    warp = nb.noise(nb.vmath("ADD", pos, (seed, seed * 1.7, 0)), 0.8, 3.0, 0.5).outputs["Fac"]
    z = nb.add(ps[2], nb.mul(nb.sub(warp, 0.5), step * jitter))
    f = nb.math("FRACT", nb.mul(z, 1.0 / step))
    prof = nb.math("POWER", f, 2.2)
    hn = nb.vmath("NORMALIZE", nb.xyz(ns[0], ns[1], 0.0))
    side = nb.maprange(nb.math("ABSOLUTE", ns[2]), 0.9, 0.5)          # only on the flanks
    off = nb.vmath("SCALE", hn, scale=nb.mul(nb.mul(prof, -depth), side))
    sp = nb.node("GeometryNodeSetPosition", Geometry=gi.outputs[0], Offset=off)
    nb.link(sp.outputs[0], go.inputs[0])
    md = ob.modifiers.new(name, "NODES")
    md.node_group = ng
    gn.apply(ob)
    return ob


# =============================================================================== cached foliage atlases
def _cache_dir():
    import os
    import tempfile
    d = os.path.join(tempfile.gettempdir(), "brumeval_nature_cache")
    os.makedirs(d, exist_ok=True)
    return d


def leaf_material(name, maker, size=1024, samples=16, tag=""):
    """Final (baked, glTF-ready) alpha-card material. The procedural card graph (foliage.py) is baked once on a unit
    plane and cached in %TEMP%/brumeval_nature_cache keyed by the source of foliage.py + name + tag + size, so trees
    sharing an atlas do not re-bake a heavy shader (deterministic: same inputs -> same textures).
    maker: callable returning the procedural material (named `name`)."""
    import hashlib
    import os
    import foliage
    src = open(foliage.__file__, "rb").read()
    h = hashlib.sha1(src + f"|{name}|{tag}|{size}|{samples}".encode()).hexdigest()[:16]
    d = _cache_dir()
    paths = {k: os.path.join(d, f"{name}_{h}_{k}.png") for k in ("basecolor", "normal", "orm")}
    if all(os.path.exists(p) for p in paths.values()):
        imgs = {}
        for k, p in paths.items():
            im = bpy.data.images.load(p)
            im.name = f"{name}_{k}"
            if k != "basecolor":
                im.colorspace_settings.name = "Non-Color"
            im.pack()
            imgs[k] = im
        print(f"[nature] leaf atlas {name}: cache hit {h}")
    else:
        mat = maker()
        me = bpy.data.meshes.new("_leafplane")
        me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new(name="UVMap")
        for i, c in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
            uv.data[i].uv = c
        me.materials.append(mat)
        ob = link(bpy.data.objects.new("_leafplane", me))
        ob.location = (500, 500, 500)
        res = bake.bake_asset([ob], "leaf", size=size, samples=samples, ao=False)
        r = res[next(iter(res))]
        imgs = {}
        for k in ("basecolor", "normal", "orm"):
            im = r["images"][k]
            im.name = f"{name}_{k}"
            bake.save_image(im, paths[k])
            imgs[k] = im
        remove(ob)
        print(f"[nature] leaf atlas {name}: baked + cached {h}")
    m = bake.build_gltf_material(name, imgs["basecolor"], imgs["normal"], imgs["orm"], alpha=True, cutoff=0.5)
    m["kit_group"] = name
    return m
