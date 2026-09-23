"""Creature body construction helpers (group `creatures` only; built on the shared kit).

* Skel: a vertex/edge skeleton with per-node radii -> Skin modifier + Subdivision = ONE continuous, watertight,
  quad-based body mesh (torso, legs, tail, head, jaw are branches of the same surface).
* sculpt()/attr helpers: numpy displacement and per-vertex attributes read by the creature shaders
  (flow = fur direction, tone = dark saddle / light belly, scar, frost, seg = plate coordinate ...).
* Accessories (eyes, fangs, claws, tusks, ears, crystals) are closed shells embedded in the body, rigidly
  weighted to one bone and joined into the body object (one skinned mesh, one draw call per texture set).
* fur_cards(): Geometry Nodes scatter of alpha fur cards on the body, oriented along the fur flow.
"""
import math

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils import Vector

import common as C
from kit import gn
from kit import rig as KR
from kit.gn import _align, _euler_to_rot, _group, _mod, _random, _rotate
from kit.nodes import sock


# =============================================================================== skeleton -> skin mesh
class Skel:
    def __init__(self):
        self.pts, self.rad, self.edges = [], [], []

    def p(self, co, r):
        self.pts.append(tuple(co))
        self.rad.append((r, r) if isinstance(r, (int, float)) else tuple(r))
        return len(self.pts) - 1

    def e(self, a, b):
        self.edges.append((a, b))

    def chain(self, start, nodes):
        """Append nodes [(co, r), ...] linked one after the other, starting from node index `start` (or None).
        Returns the list of new indices."""
        out = []
        prev = start
        for co, r in nodes:
            i = self.p(co, r)
            if prev is not None:
                self.e(prev, i)
            out.append(i)
            prev = i
        return out

    def mesh(self, name, subsurf=2, root=0, branch_smooth=0.0):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.pts, self.edges, [])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        sk = ob.modifiers.new("Skin", "SKIN")
        sk.use_smooth_shade = True
        if hasattr(sk, "branch_smoothing"):
            sk.branch_smoothing = branch_smooth
        for i, r in enumerate(self.rad):
            me.skin_vertices[0].data[i].radius = r
        me.skin_vertices[0].data[root].use_root = True
        if subsurf:
            ss = ob.modifiers.new("Sub", "SUBSURF")
            ss.levels = ss.render_levels = subsurf
        gn.apply(ob)
        clean(ob)
        fix_nonmanifold(ob)
        delete_loose(ob)
        for p in ob.data.polygons:
            p.use_smooth = True
        return ob


def fix_nonmanifold(ob, iterations=4):
    """The Skin modifier leaves internal 'membrane' faces (caps between hull segments) at busy branch nodes
    (carapace with 4 leg pairs, pincers): their edges are shared by 3-4 faces. Delete the faces lying entirely on
    those edges' vertices (the membranes, never the outer hull), fill any hole left, then check again.
    Returns the number of repaired edges."""
    total = 0
    for _ in range(iterations):
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bad = [e for e in bm.edges if len(e.link_faces) > 2]
        if not bad:
            bm.free()
            break
        total += len(bad)
        bv = set(v for e in bad for v in e.verts)
        kill = set(f for e in bad for f in e.link_faces if all(v in bv for v in f.verts))
        if not kill:   # fallback: the smallest face on each bad edge
            kill = set(min(e.link_faces, key=lambda f: f.calc_area()) for e in bad)
        bmesh.ops.delete(bm, geom=list(kill), context="FACES_ONLY")
        bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context="EDGES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_edges], context="VERTS")
        open_e = [e for e in bm.edges if len(e.link_faces) < 2]
        if open_e:
            res = bmesh.ops.holes_fill(bm, edges=open_e, sides=0)
            bmesh.ops.triangulate(bm, faces=res.get("faces", []))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
    if total:
        print(f"[creatures] {ob.name}: repaired {total} non-manifold skin edge(s)")
    return total


def clean(ob, merge=1e-4):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


# =============================================================================== numpy access
def co_array(ob):
    n = len(ob.data.vertices)
    a = np.empty(n * 3)
    ob.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def normal_array(ob):
    n = len(ob.data.vertices)
    a = np.empty(n * 3)
    try:
        ob.data.vertex_normals.foreach_get("vector", a)
    except AttributeError:
        ob.data.vertices.foreach_get("normal", a)
    return a.reshape(-1, 3)


def set_co(ob, co):
    ob.data.vertices.foreach_set("co", np.asarray(co, dtype=np.float64).ravel())
    ob.data.update()


def sculpt(ob, fn):
    """fn(co Nx3, normal Nx3) -> offset Nx3 (numpy). Displaces the vertices."""
    co, nr = co_array(ob), normal_array(ob)
    set_co(ob, co + fn(co, nr))


def smooth_verts(ob, iterations=2, factor=0.5, mask=None):
    """Laplacian smoothing (numpy); mask Nx bool/float limits where it applies."""
    me = ob.data
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    co = co_array(ob)
    w = np.ones(len(co)) if mask is None else np.asarray(mask, dtype=np.float64)
    for _ in range(iterations):
        acc = np.zeros_like(co)
        cnt = np.zeros(len(co))
        np.add.at(acc, e[:, 0], co[e[:, 1]])
        np.add.at(acc, e[:, 1], co[e[:, 0]])
        np.add.at(cnt, e[:, 0], 1)
        np.add.at(cnt, e[:, 1], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        co = co + (avg - co) * (factor * w)[:, None]
    set_co(ob, co)


def set_attr(ob, name, values, kind="FLOAT"):
    me = ob.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    at = me.attributes.new(name, kind, "POINT")
    v = np.asarray(values, dtype=np.float64)
    if kind == "FLOAT_VECTOR":
        at.data.foreach_set("vector", v.reshape(-1).astype(np.float32))
    else:
        at.data.foreach_set("value", v.reshape(-1).astype(np.float32))
    return at


def get_attr(ob, name, kind="FLOAT"):
    at = ob.data.attributes.get(name)
    n = len(ob.data.vertices)
    if at is None:
        return np.zeros((n, 3) if kind == "FLOAT_VECTOR" else n)
    if kind == "FLOAT_VECTOR":
        a = np.empty(n * 3, dtype=np.float32)
        at.data.foreach_get("vector", a)
        return a.reshape(-1, 3).astype(np.float64)
    a = np.empty(n, dtype=np.float32)
    at.data.foreach_get("value", a)
    return a.astype(np.float64)


def seg_dist(P, a, b):
    """Distance of points P (Nx3) to segment a-b and the segment parameter t."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    L = max(float(ab @ ab), 1e-12)
    t = np.clip(((P - a) @ ab) / L, 0.0, 1.0)
    q = a + t[:, None] * ab
    return np.linalg.norm(P - q, axis=1), t


def flow_field(ob, segs, down=0.35, power=4.0):
    """Fur direction per vertex: segs = [(a, b, dir)], blended by inverse distance (power), tilted downwards by
    `down`, projected on the tangent plane. Stored as the 'flow' vector attribute."""
    co, nr = co_array(ob), normal_array(ob)
    acc = np.zeros_like(co)
    wsum = np.zeros(len(co))
    for a, b, d in segs:
        dist, _ = seg_dist(co, a, b)
        w = 1.0 / np.maximum(dist, 0.01) ** power
        d = np.asarray(d, float)
        d = d / np.linalg.norm(d)
        acc += w[:, None] * d
        wsum += w
    f = acc / wsum[:, None]
    f[:, 2] -= down
    f -= nr * np.sum(f * nr, axis=1, keepdims=True)
    f /= np.maximum(np.linalg.norm(f, axis=1, keepdims=True), 1e-6)
    set_attr(ob, "flow", f, "FLOAT_VECTOR")
    return f


# =============================================================================== materials per face
def add_mat(ob, mat):
    for i, s in enumerate(ob.material_slots):
        if s.material == mat:
            return i
    ob.data.materials.append(mat)
    return len(ob.data.materials) - 1


def paint_faces(ob, mat, fn):
    """Assign `mat` to faces where fn(centre Nx3, normal Nx3) is True (numpy)."""
    idx = add_mat(ob, mat)
    me = ob.data
    n = len(me.polygons)
    c = np.empty(n * 3)
    me.polygons.foreach_get("center", c)
    nr = np.empty(n * 3)
    me.polygons.foreach_get("normal", nr)
    sel = np.asarray(fn(c.reshape(-1, 3), nr.reshape(-1, 3)), dtype=bool)
    mi = np.empty(n, dtype=np.int32)
    me.polygons.foreach_get("material_index", mi)
    mi[sel] = idx
    me.polygons.foreach_set("material_index", mi)
    me.update()
    return int(sel.sum())


def set_mat(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


# =============================================================================== accessories
def _finish(ob, mat=None, smooth=True):
    if mat is not None:
        set_mat(ob, mat)
    for p in ob.data.polygons:
        p.use_smooth = smooth
    return ob


def sphere(name, center, r, mat=None, seg=16, rings=10, scale=(1, 1, 1), yaw=0.0, pitch=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    ob.rotation_euler = (math.radians(pitch), 0, math.radians(yaw))
    C.apply_transforms(ob)
    return _finish(ob, mat)


def eye(name, center, r, mat=None, look=(0, -1, 0), seg=16, rings=10, scale=(1, 1, 1), yaw=0.0, pitch=0.0):
    """Eyeball sphere + 'iris' point attribute = cos(angle to the look direction) (1 = pupil centre), read by
    cmat.eye() to draw sclera / iris / pupil / catch-light independently of where the eye sits on the body."""
    ob = sphere(name, center, r, mat, seg=seg, rings=rings, scale=scale, yaw=yaw, pitch=pitch)
    lk = np.asarray(look, float)
    lk /= np.linalg.norm(lk)
    d = co_array(ob) - np.asarray(center, float)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    set_attr(ob, "iris", d @ lk)
    return ob


def horn(name, pts, radius, mat=None, taper=((0, 1.0), (1, 0.05)), res=6, flatten=None, resolution=6):
    """Curved tapered horn / fang / claw / tusk / leg spine swept along `pts` with Geometry Nodes
    (kit.gn.make_curve + curve_to_mesh). pts = [(x, y, z), ...] root -> tip. Returns a closed mesh."""
    cv = gn.make_curve([[(*p, 1.0) for p in pts]], name=name, kind="NURBS" if len(pts) > 2 else "POLY",
                       resolution=resolution)
    gn.curve_to_mesh(cv, radius=radius, profile_res=res, fill_caps=True, taper=list(taper))
    ob = gn.apply(cv)
    ob = bpy.context.view_layer.objects.active if ob is None else ob
    ob.name = name
    clean(ob, 1e-5)
    if flatten is not None:   # (axis_vector, factor): squash across this world axis around the root
        ax = np.asarray(flatten[0], float)
        ax /= np.linalg.norm(ax)
        co = co_array(ob)
        root = np.asarray(pts[0], float)
        d = (co - root) @ ax
        set_co(ob, co - np.outer(d * (1 - flatten[1]), ax))
    return _finish(ob, mat)


def ear(name, base, tip, width, depth, mat=None, cup=0.5, facing=(0, -1, 0), segs=5):
    """Pointed mammal ear: a tapered, flattened, cupped cone from `base` to `tip`, opening towards `facing`."""
    base, tip = Vector(base), Vector(tip)
    axis = (tip - base)
    L = axis.length
    axis.normalize()
    f = Vector(facing)
    f = (f - axis * f.dot(axis)).normalized()
    side = axis.cross(f).normalized()
    bm = bmesh.new()
    rings = []
    ring_n = 10
    for k in range(segs + 1):
        t = k / segs
        w = width * (1 - t) ** 0.9 * (1 + 0.25 * math.sin(math.pi * t))
        d = depth * (1 - t) ** 0.8
        ring = []
        for j in range(ring_n):
            a = 2 * math.pi * j / ring_n
            x, y = math.cos(a) * w * 0.5, math.sin(a) * d * 0.5
            if y > 0:   # front half cupped inwards
                y = y * (1 - 2 * cup * (1 - abs(x) / max(w * 0.5, 1e-6)))
            p = base + axis * (L * t) + side * x + f * y
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for k in range(segs):
        for j in range(ring_n):
            a, b = rings[k][j], rings[k][(j + 1) % ring_n]
            c, d = rings[k + 1][(j + 1) % ring_n], rings[k + 1][j]
            bm.faces.new((a, b, c, d))
    bm.faces.new(list(reversed(rings[0])))
    top = bm.verts.new(tip + axis * 0.003)
    for j in range(ring_n):
        bm.faces.new((rings[-1][j], rings[-1][(j + 1) % ring_n], top))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return _finish(ob, mat)


def mirror_x(ob, name=None):
    """Copy an object mirrored across X (L -> R) with consistent normals."""
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name or ob.name + "_R"
    bpy.context.scene.collection.objects.link(c)
    co = co_array(c)
    co[:, 0] *= -1
    set_co(c, co)
    bm = bmesh.new()
    bm.from_mesh(c.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(c.data)
    bm.free()
    c.data.update()
    return c


# =============================================================================== skinning
def rigid(ob, bone, weight=1.0):
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), weight, "REPLACE")
    return ob


def blend_bones(ob, arm, names, sharp=8.0):
    """Distance-based blended weights between a few bones (for accessories spanning a joint)."""
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    co = co_array(ob)
    D = []
    for n in names:
        b = arm.data.bones[n]
        d, _ = seg_dist(co, b.head_local, b.tail_local)
        D.append(d)
    D = np.stack(D, 1)
    W = np.exp(-sharp * (D - D.min(1, keepdims=True)) / (D.min(1, keepdims=True) + 0.03))
    W /= W.sum(1, keepdims=True)
    for j, n in enumerate(names):
        g = ob.vertex_groups.new(name=n)
        for i in np.nonzero(W[:, j] > 0.01)[0]:
            g.add([int(i)], float(W[i, j]), "REPLACE")
    return ob


def bind(body, arm, overrides=(), smooth=3, factor=0.5, post_smooth=2):
    """Heat weights (kit.rig.bind, smoothed, <= 4 influences), then region overrides:
    overrides = [(mask_fn(co Nx3) -> float weight 0..1 array, {bone: w, ...}), ...] blended in, in order,
    then a light smoothing pass (weights stay continuous across region borders)."""
    KR.bind(body, arm, smooth=smooth, factor=factor)
    names = KR.deform_bones(arm)
    if overrides:
        W = KR.weights_array(body, names)
        co = co_array(body)
        for fn, target in overrides:
            m = np.clip(np.asarray(fn(co), dtype=np.float64), 0, 1)
            T = np.zeros(len(names))
            for bn, w in target.items():
                T[names.index(bn)] = w
            T /= max(T.sum(), 1e-9)
            W = W * (1 - m[:, None]) + T[None, :] * m[:, None]
        KR.set_weights(body, names, W)
        if post_smooth:
            KR.smooth_weights(body, names, post_smooth, 0.4)
    return body


def join_into(body, parts):
    """Join weighted accessory objects into `body` (keeps vertex groups, attributes and materials)."""
    parts = [p for p in parts if p is not None]
    if not parts:
        return body
    for p in parts:
        C.apply_transforms(p)
    C.deselect_all()
    for p in parts:
        p.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    delete_loose(body)
    return body


def delete_loose(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context="EDGES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def limit_weights(ob, arm, limit=4):
    names = KR.deform_bones(arm)
    W = KR.weights_array(ob, names)
    KR.set_weights(ob, names, W, limit)


# =============================================================================== fur cards (Geometry Nodes)
def card_template(name="_card", length=1.0, width=0.32, segs=3, lift=0.35, droop=0.12):
    """One fur card lying along +Y (root at the origin), curving off the surface (+Z) then drooping.
    UV: U across, V root(0) -> tip(1) (kit.materials.fur_card draws strands along V)."""
    verts, faces, uvs = [], [], []
    for k in range(segs + 1):
        t = k / segs
        z = lift * t ** 0.8 * length * 0.35 - droop * t ** 2 * length * 0.35
        w = width * (1.0 - 0.35 * t)
        verts += [(-w / 2, t * length, z), (w / 2, t * length, z)]
    for k in range(segs):
        a = 2 * k
        faces.append((a, a + 1, a + 3, a + 2))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = (vi % 2, (vi // 2) / segs)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def fur_cards(body, card, mat, density=400.0, mask="furmask", length_attr="furlen", length=(0.8, 1.2), seed=0,
              embed=0.006, name="Fur", min_z=0.015):
    """Scatter `card` on `body` with Geometry Nodes: density x mask attribute, card +Y along the 'flow' attribute,
    +Z along the surface normal, scale = furlen attribute x random. Returns a NEW mesh object (the cards only)."""
    ncard = len(card.data.polygons)
    src = body.copy()
    src.data = body.data.copy()
    src.name = name
    for md in list(src.modifiers):
        src.modifiers.remove(md)
    bpy.context.scene.collection.objects.link(src)
    gn.hide_template(card)
    ng, nb, gi, go = _group("CreatureFurCards")
    geo = gi.outputs[0]
    ma = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT"}, Name=mask)
    mval = sock(ma.outputs, "Attribute", "VALUE")
    d = nb.node("GeometryNodeDistributePointsOnFaces", {"distribute_method": "RANDOM"}, Mesh=geo)
    sock(d.inputs, "Density").default_value = density
    sock(d.inputs, "Seed").default_value = seed
    nb.feed(sock(d.inputs, "Density Factor"), mval) if any(s.name == "Density Factor" for s in d.inputs) else \
        nb.feed(sock(d.inputs, "Selection"), nb.math("GREATER_THAN", mval, 0.3))
    pts = d.outputs["Points"]
    pn = d.outputs["Normal"]
    pts = nb.node("GeometryNodeSetPosition", Geometry=pts, Offset=nb.vmath("SCALE", pn, scale=-embed)).outputs[0]
    fa = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT_VECTOR"}, Name="flow")
    flow = sock(fa.outputs, "Attribute", "VECTOR")
    la = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT"}, Name=length_attr)
    ln = sock(la.outputs, "Attribute", "VALUE")
    rot = _align(nb, None, pn, "Z")
    rot = _align(nb, rot, flow, "Y", "Z")
    rot = _rotate(nb, rot, _euler_to_rot(nb, _random(nb, "FLOAT_VECTOR", (-0.12, -0.05, -0.25), (0.12, 0.05, 0.25), seed + 1)))
    sc = nb.mul(_random(nb, "FLOAT", length[0], length[1], seed + 2), ln)
    iop = nb.node("GeometryNodeInstanceOnPoints", Points=pts, Instance=gn._obj_geo(nb, card), Rotation=rot, Scale=sc)
    out = nb.node("GeometryNodeRealizeInstances", Geometry=iop.outputs[0]).outputs[0]
    cols = int(mat.get("kit_cols", 1))
    if cols > 1:   # move every card's U into the texture column of the pelt tone under it
        ua = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT_VECTOR"}, Name="UVMap")
        uv = nb.sep(sock(ua.outputs, "Attribute", "VECTOR"))
        ta = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT"}, Name="tone")
        t01 = nb.math("MINIMUM", nb.math("MAXIMUM", nb.mul(nb.add(sock(ta.outputs, "Attribute", "VALUE"), 1.0), 0.5), 0.0), 0.999)
        k = nb.math("FLOOR", nb.mul(t01, float(cols)))
        nu = nb.mul(nb.add(uv[0], k), 1.0 / cols)
        st = nb.node("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT2", "domain": "CORNER"}, Geometry=out, Name="UVMap")
        nb.feed(sock(st.inputs, "Value", "VECTOR"), nb.xyz(nu, uv[1], 0.0))
        out = st.outputs[0]
    out = nb.node("GeometryNodeSetMaterial", Geometry=out, Material=mat).outputs[0]
    nb.link(out, go.inputs[0])
    _mod(src, ng, "CreatureFurCards")
    src.data.materials.clear()
    src.data.materials.append(mat)
    gn.apply(src)
    for g in list(src.vertex_groups):
        src.vertex_groups.remove(g)
    for a in [a.name for a in src.data.attributes if a.name in ("flow", "furmask", "furlen", "scar", "tone", "frost", "seg", "mark")]:
        src.data.attributes.remove(src.data.attributes[a])
    # drop degenerate / duplicate cards (zero length where the mask fades out)
    bm = bmesh.new()
    bm.from_mesh(src.data)
    island_faces = {}
    for f in bm.faces:
        island_faces.setdefault(tuple(round(c, 5) for c in f.calc_center_median()), []).append(f)
    kill = set()
    for fl in island_faces.values():
        kill.update(fl[1:])
    kill.update(f for f in bm.faces if f.calc_area() < 2e-7)
    # remove whole cards that lost faces
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=list(kill), context="FACES")
    seen, drop = set(), []
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
        if len(isl) < ncard or min(v.co.z for g in isl for v in g.verts) < min_z:
            drop += isl
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(src.data)
    bm.free()
    src.data.update()
    return src


def drop_empty_slots(ob):
    """Remove material slots without a material (faces are moved to slot 0)."""
    me = ob.data
    mats = list(me.materials)
    if all(m is not None for m in mats):
        return ob
    keep = [i for i, m in enumerate(mats) if m is not None]
    remap = {old: new for new, old in enumerate(keep)}
    n = len(me.polygons)
    mi = np.empty(n, dtype=np.int32)
    me.polygons.foreach_get("material_index", mi)
    mi = np.array([remap.get(int(i), 0) for i in mi], dtype=np.int32)
    me.materials.clear()
    for i in keep:
        me.materials.append(mats[i])
    me.polygons.foreach_set("material_index", mi)
    me.update()
    print(f"[creatures] {ob.name}: dropped {len(mats) - len(keep)} empty material slot(s)")
    return ob
